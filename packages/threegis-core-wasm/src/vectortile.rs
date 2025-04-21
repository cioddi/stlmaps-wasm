use wasm_bindgen::prelude::*;
use js_sys::{Uint8Array, Date, Object, Array, JSON};
use serde::{Serialize, Deserialize};
use serde_wasm_bindgen::{to_value, from_value};
use wasm_bindgen_futures::JsFuture;

use crate::module_state::{ModuleState, TileData, create_tile_key};
use crate::{console_log, fetch_tile};

// Reuse the TileRequest struct from elevation.rs
#[derive(Serialize, Deserialize, Clone)]
pub struct TileRequest {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

// Input for vector tile fetching
#[derive(Serialize, Deserialize, Clone)]
pub struct VectortileProcessingInput {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64,
    pub max_lat: f64,
    pub zoom: u32,
    pub grid_width: u32,
    pub grid_height: u32,
    // Use the same process_id concept for caching as terrain
    pub process_id: Option<String>,
}

// Result structure compatible with JS expectations
#[derive(Serialize, Deserialize)]
pub struct VectorTileResult {
    pub tile: TileRequest,
    pub data: Vec<u8>, // Vector tile binary data
}

// Structure for the GeometryData that we extract from vector tiles
#[derive(Serialize, Deserialize, Clone)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>, // Represents a geometry's coordinates
    pub r#type: String,          // Geometry type (e.g., "Polygon", "LineString")
    pub height: f64,             // Feature height
    pub base_elevation: f64,     // Elevation at geometry position
}

// Structure for VtDataset config
#[derive(Serialize, Deserialize, Clone)]
pub struct VtDataset {
    pub source_layer: String,
    pub sub_class: Option<Vec<String>>,
    pub filter: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    // Add other properties as needed
}

// Input for extracting GeoJSON features from vector tiles
#[derive(Serialize, Deserialize)]
pub struct ExtractFeaturesInput {
    pub bbox: Vec<f64>,                    // [minLng, minLat, maxLng, maxLat]
    pub vt_dataset: VtDataset,             // Configuration for the layer
    pub process_id: String,                // Cache key/process ID
    pub elevation_process_id: Option<String>, // ID to find cached elevation data
}

// Convert latitude to tile Y coordinate
fn lat_to_tile_y(lat: f64, zoom: u32) -> u32 {
    let lat_rad = lat.to_radians();
    let n = 2.0_f64.powi(zoom as i32);
    let y = ((1.0 - ((lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / std::f64::consts::PI)) / 2.0 * n).floor();
    y as u32
}

// Convert longitude to tile X coordinate
fn lng_to_tile_x(lng: f64, zoom: u32) -> u32 {
    let n = 2.0_f64.powi(zoom as i32);
    let x = ((lng + 180.0) / 360.0 * n).floor();
    x as u32
}

// Calculate the tiles needed to cover a bounding box
fn get_tiles_for_bbox(min_lng: f64, min_lat: f64, max_lng: f64, max_lat: f64, zoom: u32) -> Vec<TileRequest> {
    // Convert bbox to tile coordinates
    let min_x = lng_to_tile_x(min_lng, zoom);
    let min_y = lat_to_tile_y(max_lat, zoom); // Note: y is inverted in tile coordinates
    let max_x = lng_to_tile_x(max_lng, zoom);
    let max_y = lat_to_tile_y(min_lat, zoom);

    // Generate list of tiles
    let mut tiles = Vec::new();
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            tiles.push(TileRequest { x, y, z: zoom });
        }
    }

    tiles
}

// Calculate the number of tiles that would be needed
fn calculate_tile_count(min_lng: f64, min_lat: f64, max_lng: f64, max_lat: f64, zoom: u32) -> usize {
    let min_x = lng_to_tile_x(min_lng, zoom);
    let min_y = lat_to_tile_y(max_lat, zoom);
    let max_x = lng_to_tile_x(max_lng, zoom);
    let max_y = lat_to_tile_y(min_lat, zoom);

    ((max_x - min_x + 1) * (max_y - min_y + 1)) as usize
}

// Calculate the base elevation for a polygon ring using the elevation grid
fn calculate_base_elevation(
    ring: &Vec<Vec<f64>>,
    elevation_grid: &Vec<Vec<f64>>,
    grid_width: u32,
    grid_height: u32,
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
) -> f64 {
    let width = grid_width as usize;
    let height = grid_height as usize;
    
    let mut total_elevation = 0.0;
    let mut valid_points = 0;

    for point in ring {
        if point.len() < 2 {
            continue;
        }

        let lng = point[0];
        let lat = point[1];
        
        let x = ((lng - min_lng) / (max_lng - min_lng) * (width as f64 - 1.0)).floor() as usize;
        let y = ((lat - min_lat) / (max_lat - min_lat) * (height as f64 - 1.0)).floor() as usize;

        if x < width && y < height {
            total_elevation += elevation_grid[y][x];
            valid_points += 1;
        }
    }

    if valid_points > 0 {
        total_elevation / valid_points as f64
    } else {
        0.0
    }
}

// Evaluate a MapLibre filter expression against a feature
fn evaluate_filter(filter: &serde_json::Value, feature: &serde_json::Value) -> bool {
    // If no filter is provided, allow all features
    if filter.is_null() {
        return true;
    }

    // Basic filter evaluation - this is a simplified version
    // In a real implementation, you would handle more filter types
    if let serde_json::Value::Array(filter_array) = filter {
        if filter_array.is_empty() {
            return true;
        }

        // Get operator type (first element in the array)
        if let Some(serde_json::Value::String(operator)) = filter_array.get(0) {
            match operator.as_str() {
                "all" => {
                    // All conditions must be true
                    for i in 1..filter_array.len() {
                        if !evaluate_filter(&filter_array[i], feature) {
                            return false;
                        }
                    }
                    return true;
                },
                "any" => {
                    // At least one condition must be true
                    for i in 1..filter_array.len() {
                        if evaluate_filter(&filter_array[i], feature) {
                            return true;
                        }
                    }
                    return false;
                },
                "==" => {
                    // Property equals value
                    if filter_array.len() < 3 {
                        return false;
                    }
                    
                    if let Some(serde_json::Value::String(key)) = filter_array.get(1) {
                        let value = filter_array.get(2).unwrap();
                        
                        if key == "$type" {
                            // Check geometry type
                            if let Some(geometry) = feature.get("geometry") {
                                if let Some(geom_type) = geometry.get("type") {
                                    return geom_type == value;
                                }
                            }
                        } else {
                            // Check property value
                            if let Some(properties) = feature.get("properties") {
                                if let Some(prop_value) = properties.get(key) {
                                    return prop_value == value;
                                }
                            }
                        }
                    }
                },
                // Add other filter types as needed
                _ => console_log!("Unsupported filter operator: {}", operator),
            }
        }
    }

    // Default to true for unsupported filters
    true
}

// Fetch vector tile data for a specified bounding box
#[wasm_bindgen]
pub async fn fetch_vector_tiles(input_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse input parameters
    let input: VectortileProcessingInput = from_value(input_js)?;
    
    // Get module state
    let module_state = ModuleState::global();
    let mut state = module_state.lock().unwrap();
    
    // Generate cache key from process_id
    let cache_group = input.process_id.clone().unwrap_or_else(|| "default_vectortile".to_string());
    
    // Calculate tiles needed
    let tiles = get_tiles_for_bbox(
        input.min_lng,
        input.min_lat,
        input.max_lng,
        input.max_lat,
        input.zoom
    );
    
    // Check if tile count is reasonable (< 10 tiles)
    let tile_count = tiles.len();
    if tile_count > 9 {
        console_log!("Skipping vector tile fetch: area too large ({} tiles, max allowed: 9)", tile_count);
        return Ok(to_value(&Vec::<VectorTileResult>::new())?);
    }

    console_log!("Fetching {} vector tiles for bbox", tiles.len());
    
    // Store the tile count before we use the tiles vector
    let tile_count = tiles.len();
    
    // Fetch vector tiles with caching
    let mut vector_tile_results = Vec::new();
    let mut cache_hits = 0;

    for tile in &tiles {
        // Create a unique key for this tile
        let cache_key = format!("vectortile_{}_{}_{}", tile.z, tile.x, tile.y);
        let tile_key = create_tile_key(tile.x, tile.y, tile.z);
        
        // Try to get tile from cache
        if let Some(cached_data) = state.get_raster_tile(&tile_key) {
            // Cache hit
            cache_hits += 1;
            console_log!("Cache hit for vector tile {}/{}/{}", tile.z, tile.x, tile.y);
            
            vector_tile_results.push(VectorTileResult {
                tile: TileRequest { x: tile.x, y: tile.y, z: tile.z },
                data: cached_data.data.clone(),
            });
        } else {
            // Cache miss, need to fetch
            console_log!("Cache miss for vector tile {}/{}/{}", tile.z, tile.x, tile.y);
            
            // Get the Promise from fetch_tile
            let promise = fetch_tile(tile.z, tile.x, tile.y)?;
            
            // Use JsFuture to await the Promise
            let fetch_result = JsFuture::from(promise).await?;
            
            // Convert result to Uint8Array and then to Rust Vec<u8>
            let array_buffer = Uint8Array::new(&fetch_result);
            let data = array_buffer.to_vec();
            
            // Store in cache
            let tile_data = TileData {
                width: 512, // Default values for vector tiles
                height: 512,
                x: tile.x,
                y: tile.y,
                z: tile.z,
                data: data.clone(),
                timestamp: Date::now(),
            };
            
            // Add the tile to the cache
            state.add_raster_tile(tile_key, tile_data);
            
            // Add to results
            vector_tile_results.push(VectorTileResult {
                tile: TileRequest { x: tile.x, y: tile.y, z: tile.z },
                data,
            });
        }
    }
    
    // Log cache efficiency
    let cache_hit_rate = if tile_count > 0 {
        (cache_hits as f64) / (tile_count as f64) * 100.0
    } else {
        0.0
    };
    console_log!("Vector tile cache hit rate: {:.1}%", cache_hit_rate);
    
    // Return the results
    Ok(to_value(&vector_tile_results)?)
}

// Extract GeoJSON features from vector tiles
#[wasm_bindgen]
pub async fn extract_geojson_features(input_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse input parameters
    let input: ExtractFeaturesInput = from_value(input_js)?;
    
    // Get module state
    let module_state = ModuleState::global();
    let mut state = module_state.lock().unwrap();
    
    // Extract bbox coordinates
    if input.bbox.len() != 4 {
        return Err(JsValue::from_str("Invalid bbox: expected [minLng, minLat, maxLng, maxLat]"));
    }
    
    let min_lng = input.bbox[0];
    let min_lat = input.bbox[1];
    let max_lng = input.bbox[2];
    let max_lat = input.bbox[3];
    
    // Generate a cache key for this extraction operation
    let feature_cache_key = format!("features_{}_{}", input.process_id, input.vt_dataset.source_layer);
    
    // Check if we already have cached results for this exact configuration
    let cache_key = create_tile_key(
        input.vt_dataset.source_layer.len() as u32, 
        input.process_id.len() as u32, 
        0
    );
    
    if let Some(cached_data) = state.get_cached_object(&feature_cache_key) {
        console_log!("Cache hit for GeoJSON features: {}", feature_cache_key);
        return Ok(cached_data.clone());
    }
    
    console_log!("Cache miss for GeoJSON features: {}. Extracting features...", feature_cache_key);
    
    // We need to get the vector tiles first
    let vt_input = VectortileProcessingInput {
        min_lng,
        min_lat,
        max_lng,
        max_lat,
        zoom: 14, // Standard zoom level for detail
        grid_width: 256,
        grid_height: 256,
        process_id: Some(input.process_id.clone()),
    };
    
    // First fetch the vector tiles (which are cached internally)
    let vector_tiles_js = fetch_vector_tiles(to_value(&vt_input)?).await?;
    let vector_tiles: Vec<VectorTileResult> = from_value(vector_tiles_js)?;
    
    // Skip processing if the layer is explicitly disabled
    if let Some(enabled) = input.vt_dataset.enabled {
        if !enabled {
            console_log!("Skipping disabled layer: {}", input.vt_dataset.source_layer);
            return Ok(to_value(&Vec::<GeometryData>::new())?);
        }
    }
    
    // We need to get the elevation grid
    let mut elevation_grid = Vec::new();
    let mut grid_width = 0;
    let mut grid_height = 0;
    
    if let Some(elevation_id) = &input.elevation_process_id {
        // Try to get elevation data from cache
        if let Some(elevation_data) = state.get_elevation_grid(elevation_id) {
            elevation_grid = elevation_data.clone(); // Just clone the entire grid
            grid_width = 256; // Default values or get from elsewhere if needed
            grid_height = 256;
            console_log!("Using cached elevation grid: {}x{}", grid_width, grid_height);
        } else {
            console_log!("Elevation grid not found in cache. Using flat terrain.");
            // Create a flat terrain if elevation data is not available
            grid_width = 256;
            grid_height = 256;
            elevation_grid = vec![vec![0.0; grid_width as usize]; grid_height as usize];
        }
    } else {
        console_log!("No elevation_process_id provided. Using flat terrain.");
        // Create a flat terrain if no elevation_process_id is provided
        grid_width = 256;
        grid_height = 256;
        elevation_grid = vec![vec![0.0; grid_width as usize]; grid_height as usize];
    }
    
    // Now process each vector tile to extract GeoJSON features
    let mut geometry_data = Vec::new();
    
    // Call to extract the features from all vector tiles
    for vt_result in &vector_tiles {
        // We need to process the binary data and extract features
        // This is where we'd use a Rust library for parsing PBF/MVT data
        // For now, we'll use JavaScript for this part via a helper function
        
        let extract_args = to_value(&serde_json::json!({
            "tileData": vt_result.data,
            "tile": vt_result.tile,
            "sourceLayer": input.vt_dataset.source_layer,
            "subClass": input.vt_dataset.sub_class,
            "filter": input.vt_dataset.filter
        }))?;
        
        // Call JavaScript helper to extract features from the tile
        // In a real implementation, you'd use a Rust MVT parser library
        let window = web_sys::window().expect("no global window exists");
        let js_extractors = js_sys::Reflect::get(&window, &JsValue::from_str("wasmJsHelpers"))?;
        let extract_fn = js_sys::Reflect::get(&js_extractors, &JsValue::from_str("extractFeaturesFromTile"))?;
        let features_js = js_sys::Reflect::apply(
            &extract_fn.dyn_into::<js_sys::Function>()?,
            &JsValue::NULL,
            &Array::of1(&extract_args)
        )?;
        
        // Process the features
        let features: Vec<serde_json::Value> = from_value(features_js)?;
        
        for feature in features {
            if let Some(geometry) = feature.get("geometry") {
                if let Some(geom_type) = geometry.get("type") {
                    if let Some(coordinates) = geometry.get("coordinates") {
                        // Process based on geometry type
                        match geom_type.as_str() {
                            Some("Polygon") => {
                                if let Some(rings) = coordinates.as_array() {
                                    for ring in rings {
                                        if let Some(points) = ring.as_array() {
                                            let coords: Vec<Vec<f64>> = points
                                                .iter()
                                                .filter_map(|p| {
                                                    if let Some(coords) = p.as_array() {
                                                        if coords.len() >= 2 {
                                                            if let (Some(lng), Some(lat)) = (coords[0].as_f64(), coords[1].as_f64()) {
                                                                return Some(vec![lng, lat]);
                                                            }
                                                        }
                                                    }
                                                    None
                                                })
                                                .collect();
                                            
                                            if !coords.is_empty() {
                                                let base_elevation = calculate_base_elevation(
                                                    &coords,
                                                    &elevation_grid,
                                                    grid_width,
                                                    grid_height,
                                                    min_lng,
                                                    min_lat,
                                                    max_lng,
                                                    max_lat
                                                );
                                                
                                                // Get height from properties
                                                let mut height = 0.0;
                                                if let Some(properties) = feature.get("properties") {
                                                    if let Some(h) = properties.get("height").and_then(|h| h.as_f64()) {
                                                        height = h;
                                                    } else if let Some(h) = properties.get("render_height").and_then(|h| h.as_f64()) {
                                                        height = h;
                                                    }
                                                }
                                                
                                                geometry_data.push(GeometryData {
                                                    geometry: coords,
                                                    r#type: "Polygon".to_string(),
                                                    height,
                                                    base_elevation,
                                                });
                                            }
                                        }
                                    }
                                }
                            },
                            Some("MultiPolygon") => {
                                if let Some(polygons) = coordinates.as_array() {
                                    for polygon in polygons {
                                        if let Some(rings) = polygon.as_array() {
                                            for ring in rings {
                                                if let Some(points) = ring.as_array() {
                                                    let coords: Vec<Vec<f64>> = points
                                                        .iter()
                                                        .filter_map(|p| {
                                                            if let Some(coords) = p.as_array() {
                                                                if coords.len() >= 2 {
                                                                    if let (Some(lng), Some(lat)) = (coords[0].as_f64(), coords[1].as_f64()) {
                                                                        return Some(vec![lng, lat]);
                                                                    }
                                                                }
                                                            }
                                                            None
                                                        })
                                                        .collect();
                                                    
                                                    if !coords.is_empty() {
                                                        let base_elevation = calculate_base_elevation(
                                                            &coords,
                                                            &elevation_grid,
                                                            grid_width,
                                                            grid_height,
                                                            min_lng,
                                                            min_lat,
                                                            max_lng,
                                                            max_lat
                                                        );
                                                        
                                                        // Get height from properties
                                                        let mut height = 0.0;
                                                        if let Some(properties) = feature.get("properties") {
                                                            if let Some(h) = properties.get("height").and_then(|h| h.as_f64()) {
                                                                height = h;
                                                            } else if let Some(h) = properties.get("render_height").and_then(|h| h.as_f64()) {
                                                                height = h;
                                                            }
                                                        }
                                                        
                                                        geometry_data.push(GeometryData {
                                                            geometry: coords,
                                                            r#type: "Polygon".to_string(),
                                                            height,
                                                            base_elevation,
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            Some("LineString") => {
                                if let Some(points) = coordinates.as_array() {
                                    let coords: Vec<Vec<f64>> = points
                                        .iter()
                                        .filter_map(|p| {
                                            if let Some(coords) = p.as_array() {
                                                if coords.len() >= 2 {
                                                    if let (Some(lng), Some(lat)) = (coords[0].as_f64(), coords[1].as_f64()) {
                                                        return Some(vec![lng, lat]);
                                                    }
                                                }
                                            }
                                            None
                                        })
                                        .collect();
                                    
                                    if !coords.is_empty() {
                                        let base_elevation = calculate_base_elevation(
                                            &coords,
                                            &elevation_grid,
                                            grid_width,
                                            grid_height,
                                            min_lng,
                                            min_lat,
                                            max_lng,
                                            max_lat
                                        );
                                        
                                        // Get height from properties
                                        let mut height = 0.0;
                                        if let Some(properties) = feature.get("properties") {
                                            if let Some(h) = properties.get("height").and_then(|h| h.as_f64()) {
                                                height = h;
                                            } else if let Some(h) = properties.get("render_height").and_then(|h| h.as_f64()) {
                                                height = h;
                                            }
                                        }
                                        
                                        geometry_data.push(GeometryData {
                                            geometry: coords,
                                            r#type: "LineString".to_string(),
                                            height,
                                            base_elevation,
                                        });
                                    }
                                }
                            },
                            // Add handling for Point, MultiLineString, MultiPoint as needed
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    
    console_log!("Extracted {} geometry features for layer {}", geometry_data.len(), input.vt_dataset.source_layer);
    
    // Convert results to JsValue
    let result = to_value(&geometry_data)?;
    
    // Cache the results
    state.add_cached_object(&feature_cache_key, result.clone());
    
    // Return the results
    Ok(result)
}
