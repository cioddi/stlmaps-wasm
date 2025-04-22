use wasm_bindgen::prelude::*;
use js_sys::{Uint8Array, Date, Object, Array, JSON, Math};
use serde::{Serialize, Deserialize};
use serde_wasm_bindgen::{to_value, from_value};
use wasm_bindgen_futures::JsFuture;
use std::collections::HashMap;
use flate2::read::GzDecoder;
use std::io::Read;
use mvt::{Tile, GeomType};
use geozero::mvt::tile;
use geozero::mvt::decode;
use geozero::{GeomProcessor, ToJson};

use crate::module_state::{ModuleState, TileData, create_tile_key};
use crate::{console_log, fetch};

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
    // Bbox key for consistent caching across the application
    pub bbox_key: Option<String>,
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
    pub buffer_size: Option<f64>,
}

// Input for extracting features from vector tiles
#[derive(Serialize, Deserialize)]
pub struct ExtractFeaturesInput {
    pub bbox: Vec<f64>,                     // [minLng, minLat, maxLng, maxLat]
    pub vt_dataset: VtDataset,              // Configuration for the layer
    pub bbox_key: String,                   // Cache key for vector tiles
    pub elevation_bbox_key: Option<String>, // ID to find cached elevation data
}

// Feature geometry types
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub enum GeometryType {
    Point,
    LineString,
    Polygon,
    MultiPoint,
    MultiLineString,
    MultiPolygon,
}

// GeoJSON-like feature structure
#[derive(Serialize, Deserialize, Clone)]
pub struct Feature {
    pub geometry: FeatureGeometry,
    pub properties: serde_json::Value,
}

// Geometry part of a feature
#[derive(Serialize, Deserialize, Clone)]
pub struct FeatureGeometry {
    pub r#type: String,
    pub coordinates: serde_json::Value, // Using Value for flexibility with different geometry types
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
pub fn calculate_tile_count(min_lng: f64, min_lat: f64, max_lng: f64, max_lat: f64, zoom: u32) -> usize {
    let min_x = lng_to_tile_x(min_lng, zoom);
    let min_y = lat_to_tile_y(max_lat, zoom);
    let max_x = lng_to_tile_x(max_lng, zoom);
    let max_y = lat_to_tile_y(min_lat, zoom);

    ((max_x - min_x + 1) * (max_y - min_y + 1)) as usize
}

// Calculate base elevation for a geometry based on its position relative to elevation grid
fn calculate_base_elevation(
    coordinates: &[Vec<f64>],
    elevation_grid: &[Vec<f64>],
    grid_width: usize,
    grid_height: usize,
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
) -> f64 {
    // Calculate centroid of the coordinates
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let point_count = coordinates.len();

    if point_count == 0 {
        return 0.0;
    }

    for point in coordinates {
        if point.len() >= 2 {
            sum_x += point[0];
            sum_y += point[1];
        }
    }

    let centroid_lng = sum_x / point_count as f64;
    let centroid_lat = sum_y / point_count as f64;

    // Map centroid to grid coordinates
    let grid_x = ((centroid_lng - min_lng) / (max_lng - min_lng).max(f64::EPSILON)) * (grid_width as f64 - 1.0);
    let grid_y = ((centroid_lat - min_lat) / (max_lat - min_lat).max(f64::EPSILON)) * (grid_height as f64 - 1.0);

    let grid_x_floor = grid_x.floor() as usize;
    let grid_y_floor = grid_y.floor() as usize;

    // Ensure we're within bounds
    if grid_x_floor < grid_width && grid_y_floor < grid_height {
        elevation_grid[grid_y_floor][grid_x_floor]
    } else {
        // If we're out of bounds, use the nearest valid grid point
        let nearest_x = grid_x_floor.min(grid_width - 1);
        let nearest_y = grid_y_floor.min(grid_height - 1);
        elevation_grid[nearest_y][nearest_x]
    }
}

// Evaluate if a feature matches a filter expression
fn evaluate_filter(filter: &serde_json::Value, feature: &Feature) -> bool {
    // This is a simplified filter evaluation - you may need to implement a more comprehensive 
    // filter system based on your application's needs
    
    // For now, just assume true if there's no filter
    // In a real implementation, you'd parse and evaluate the filter expression
    true
}

// Main function to extract features from vector tiles
#[wasm_bindgen]
pub async fn extract_features_from_vector_tiles(
    input_js: JsValue
) -> Result<JsValue, JsValue> {
    // Parse input
    let input: ExtractFeaturesInput = from_value(input_js)?;
    let bbox = &input.bbox;
    
    if bbox.len() != 4 {
        return Err(JsValue::from_str("Invalid bbox: must contain [minLng, minLat, maxLng, maxLat]"));
    }
    
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];
    let vt_dataset = &input.vt_dataset;
    let bbox_key = &input.bbox_key;
    
    // Skip processing if layer is disabled
    if let Some(enabled) = vt_dataset.enabled {
        if !enabled {
            console_log!("Skipping disabled layer: {}", vt_dataset.source_layer);
            return Ok(to_value(&Vec::<GeometryData>::new())?);
        }
    }
    
    // Retrieve module state
    let module_state = ModuleState::get_instance();
    let module_state = module_state.lock().unwrap();
    
    // Create the bbox_key format to consistently access cached data
    let bbox_key = format!("{}_{}_{}_{}", min_lng, min_lat, max_lng, max_lat);
    console_log!("Using bbox_key for vector tiles lookup: {}", bbox_key);
    
    // Try to access cached vector tile data using the standardized bbox_key format
    let vector_tiles = match module_state.get_vector_tiles(&bbox_key) {
        Some(tiles) => tiles,
        None => {
            console_log!("No cached vector tiles found for bbox_key: {}", bbox_key);
            return Err(JsValue::from_str(&format!("No cached vector tiles found for bbox_key: {}", bbox_key)));
        }
    };
    
    // Get cached elevation data if available - using the standard bbox_key format
    // Create the bbox_key for elevation data (same format as used for vector tiles)
    let bbox_key_for_elevation = format!("{}_{}_{}_{}", min_lng, min_lat, max_lng, max_lat);
    console_log!("Using bbox_key for elevation data lookup: {}", bbox_key_for_elevation);
    
    let elevation_data = module_state.get_elevation_data(&bbox_key_for_elevation);
    
    let (elevation_grid, grid_size) = match elevation_data {
        Some(elev_data) => (elev_data.elevation_grid, (elev_data.grid_width, elev_data.grid_height)),
        None => {
            console_log!("No cached elevation data found. Using flat elevation (0).");
            // Create a small dummy grid if no elevation data available
            let dummy_grid = vec![vec![0.0; 2]; 2];
            ((dummy_grid), (2, 2))
        }
    };
    
    // Initialize result vector
    let mut geometry_data: Vec<GeometryData> = Vec::new();
    
    // Process each vector tile
    for vt_entry in vector_tiles {
        // Check if this tile has data for the requested layer
        let tile_layers: &HashMap<String, Vec<Feature>> = match vt_entry.parsed_layers {
            Some(ref layers) => layers,
            None => continue,
        };
        
        // Find the requested layer
        let layer_data = match tile_layers.get(&vt_dataset.source_layer) {
            Some(layer) => layer,
            None => {
                console_log!("Source layer '{}' not found in tile", vt_dataset.source_layer);
                continue;
            }
        };
        
        // Process each feature in the layer
        for feature in layer_data {
            // Filter by subclass if specified
            if let Some(ref sub_classes) = vt_dataset.sub_class {
                if let Some(feature_subclass) = feature.properties.get("subclass") {
                    if feature_subclass.is_string() {
                        let subclass_str = feature_subclass.as_str().unwrap_or("");
                        if sub_classes.iter().any(|s| s == subclass_str) {
                            continue;
                        }
                    }
                }
            }
            
            // Apply filter expression if provided
            if let Some(ref filter) = vt_dataset.filter {
                if !evaluate_filter(filter, feature) {
                    continue;
                }
            }
            
            // Extract height property
            let height = feature.properties.get("height")
                .and_then(|v| v.as_f64())
                .or_else(|| feature.properties.get("render_height").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            
            // Process based on geometry type
            match feature.geometry.r#type.as_str() {
                "Polygon" => {
                    if let Ok(coords) = serde_json::from_value::<Vec<Vec<Vec<f64>>>>(feature.geometry.coordinates.clone()) {
                        for ring in coords {
                            let base_elevation = calculate_base_elevation(
                                &ring,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                min_lng,
                                min_lat,
                                max_lng,
                                max_lat
                            );
                            
                            geometry_data.push(GeometryData {
                                geometry: ring,
                                r#type: "Polygon".to_string(),
                                height,
                                base_elevation,
                            });
                        }
                    }
                },
                "MultiPolygon" => {
                    if let Ok(multi_coords) = serde_json::from_value::<Vec<Vec<Vec<Vec<f64>>>>>(feature.geometry.coordinates.clone()) {
                        for polygon in multi_coords {
                            for ring in polygon {
                                let base_elevation = calculate_base_elevation(
                                    &ring,
                                    &elevation_grid,
                                    grid_size.0 as usize,
                                    grid_size.1 as usize,
                                    min_lng,
                                    min_lat,
                                    max_lng,
                                    max_lat
                                );
                                
                                geometry_data.push(GeometryData {
                                    geometry: ring,
                                    r#type: "Polygon".to_string(),
                                    height,
                                    base_elevation,
                                });
                            }
                        }
                    }
                },
                "LineString" => {
                    if let Ok(line_coords) = serde_json::from_value::<Vec<Vec<f64>>>(feature.geometry.coordinates.clone()) {
                        let base_elevation = calculate_base_elevation(
                            &line_coords,
                            &elevation_grid,
                            grid_size.0 as usize,
                            grid_size.1 as usize,
                            min_lng,
                            min_lat,
                            max_lng,
                            max_lat
                        );
                        
                        geometry_data.push(GeometryData {
                            geometry: line_coords,
                            r#type: "LineString".to_string(),
                            height,
                            base_elevation,
                        });
                    }
                },
                "MultiLineString" => {
                    if let Ok(multi_line_coords) = serde_json::from_value::<Vec<Vec<Vec<f64>>>>(feature.geometry.coordinates.clone()) {
                        for line_coords in multi_line_coords {
                            let base_elevation = calculate_base_elevation(
                                &line_coords,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                min_lng,
                                min_lat,
                                max_lng,
                                max_lat
                            );
                            
                            geometry_data.push(GeometryData {
                                geometry: line_coords,
                                r#type: "LineString".to_string(),
                                height,
                                base_elevation,
                            });
                        }
                    }
                },
                "Point" => {
                    if let Ok(point_coords) = serde_json::from_value::<Vec<f64>>(feature.geometry.coordinates.clone()) {
                        let point_as_vec = vec![point_coords.clone()];
                        let base_elevation = calculate_base_elevation(
                            &point_as_vec,
                            &elevation_grid,
                            grid_size.0 as usize,
                            grid_size.1 as usize,
                            min_lng,
                            min_lat,
                            max_lng,
                            max_lat
                        );
                        
                        geometry_data.push(GeometryData {
                            geometry: vec![point_coords],
                            r#type: "Point".to_string(),
                            height,
                            base_elevation,
                        });
                    }
                },
                "MultiPoint" => {
                    if let Ok(multi_point_coords) = serde_json::from_value::<Vec<Vec<f64>>>(feature.geometry.coordinates.clone()) {
                        for point_coords in multi_point_coords {
                            let point_as_vec = vec![point_coords.clone()];
                            let base_elevation = calculate_base_elevation(
                                &point_as_vec,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                min_lng,
                                min_lat,
                                max_lng,
                                max_lat
                            );
                            
                            geometry_data.push(GeometryData {
                                geometry: vec![point_coords],
                                r#type: "Point".to_string(),
                                height,
                                base_elevation,
                            });
                        }
                    }
                },
                _ => {
                    // Unhandled geometry type
                    console_log!("Unhandled geometry type: {}", feature.geometry.r#type);
                }
            }
        }
    }
    
    console_log!("Extracted {} geometries from source layer '{}'", 
        geometry_data.len(), vt_dataset.source_layer);
    
    // Return the extracted geometry data
    Ok(to_value(&geometry_data)?)
}

// Make this function available to JS
#[wasm_bindgen]
pub async fn fetch_vector_tiles(input_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse input
    let input: VectortileProcessingInput = from_value(input_js)?;
    
    // Use the bbox_key from input or generate one if not provided
    let bbox_key = match input.bbox_key {
        Some(id) => id,
        None => format!("vt_{}_{}", Date::now(), Math::random()),
    };
    
    // Calculate tiles for the requested bounding box
    let tiles = get_tiles_for_bbox(
        input.min_lng,
        input.min_lat,
        input.max_lng,
        input.max_lat,
        input.zoom
    );
    
    console_log!("Fetching {} vector tiles for zoom level {}", tiles.len(), input.zoom);
    
    // Fetch tiles in parallel and store them
    let module_state = ModuleState::get_instance();
    let mut module_state_lock = module_state.lock().unwrap();
    
    // Store the fetch results for later processing
    let mut tile_results = Vec::new();
    
    for tile in tiles {
        let tile_key = format!("{}/{}/{}", tile.z, tile.x, tile.y);
        
        // Check if we already have this tile cached
        let tile_data = if let Some(existing_data) = module_state_lock.get_tile_data(&tile_key) {
            existing_data
        } else {
            // Construct the appropriate URL for vector tiles
            // Using Mapbox Vector Tile format
            let url = format!("https://wms.wheregroup.com/tileserver/tile/world-0-14/{}/{}/{}.pbf", tile.z, tile.x, tile.y);
            
            // Fetch the tile if not cached
            let fetch_promise = fetch(&url)?;
            let fetch_result = JsFuture::from(fetch_promise).await?;
            let data_array = Uint8Array::new(&fetch_result);
            let mut data_vec = data_array.to_vec();

            // Check if the data is gzipped and decompress if necessary
            if data_vec.starts_with(&[0x1f, 0x8b]) { // Gzip magic number
                console_log!("Detected gzipped tile, decompressing...");
                let mut decoder = GzDecoder::new(&data_vec[..]);
                let mut decompressed_data = Vec::new();
                decoder.read_to_end(&mut decompressed_data).map_err(|e| {
                    console_log!("Failed to decompress gzipped tile: {}", e);
                    JsValue::from_str("Decompression error")
                })?;
                data_vec = decompressed_data;
            }
            
            // Parse the MVT data using our enhanced Rust MVT parser
            let parsed_mvt = match enhanced_parse_mvt_data(&data_vec, &tile) {
                Ok(parsed) => {
                    console_log!("Successfully parsed MVT data with Rust parser for tile {}/{}/{}", 
                        tile.z, tile.x, tile.y);
                    // Log the number of layers found
                    let layer_count = parsed.layers.len();
                    let layer_names: Vec<String> = parsed.layers.keys().cloned().collect();
                    console_log!("Found {} layers: {:?}", layer_count, layer_names);
                    
                    // Convert Rust-parsed features to the legacy format for compatibility
                    let mut legacy_layers = HashMap::new();
                    for (layer_name, layer) in &parsed.layers {
                        let mut features = Vec::new();
                        for mvt_feature in &layer.features {
                            let geometry_type = mvt_feature.geometry_type.clone();
                            let coordinates = match geometry_type.as_str() {
                                "Point" => {
                                    if !mvt_feature.geometry.is_empty() && !mvt_feature.geometry[0].is_empty() {
                                        serde_json::to_value(mvt_feature.geometry[0][0].clone()).unwrap_or(serde_json::Value::Null)
                                    } else {
                                        serde_json::Value::Null
                                    }
                                },
                                "LineString" => {
                                    if !mvt_feature.geometry.is_empty() {
                                        serde_json::to_value(mvt_feature.geometry[0].clone()).unwrap_or(serde_json::Value::Null)
                                    } else {
                                        serde_json::Value::Null
                                    }
                                },
                                "Polygon" => {
                                    serde_json::to_value(mvt_feature.geometry.clone()).unwrap_or(serde_json::Value::Null)
                                },
                                _ => serde_json::Value::Null
                            };
                            
                            features.push(Feature {
                                geometry: FeatureGeometry {
                                    r#type: geometry_type,
                                    coordinates
                                },
                                properties: serde_json::Value::Object(
                                    serde_json::Map::from_iter(mvt_feature.properties.clone().into_iter())
                                )
                            });
                        }
                        legacy_layers.insert(layer_name.clone(), features);
                    }
                    
                    Some((parsed, legacy_layers))
                },
                Err(e) => {
                    console_log!("Failed to parse MVT data: {}", e);
                    None
                }
            };

            // Create new tile data entry
            let mut tile_data = TileData {
                width: 256, // Default tile size
                height: 256,
                x: tile.x,
                y: tile.y,
                z: tile.z,
                data: data_vec.clone(),
                timestamp: Date::now(),
                key: tile_key.clone(),
                buffer: data_vec.clone(),
                parsed_layers: parsed_mvt.as_ref().map(|(_, legacy_layers)| legacy_layers.clone()), // Store legacy format for compatibility
                rust_parsed_mvt: Some(data_vec.clone()), // Store the raw MVT data for Rust parsing
            };
            
            // Cache the tile
            module_state_lock.set_tile_data(&tile_key, tile_data.clone());
            tile_data
        };
        
        // Add to results
        tile_results.push(VectorTileResult {
            tile: tile.clone(),
            data: tile_data.buffer,
        });
    }
    
    // Store all tiles under the bbox_key for later retrieval
    console_log!("🔍 DEBUG: Storing {} vector tiles under bbox_key: {}", tile_results.len(), bbox_key);
    module_state_lock.store_vector_tiles(&bbox_key, &tile_results);
    
    // Also store tiles under standard bbox_key format for consistency across the application
    let standard_bbox_key = format!("{}_{}_{}_{}", input.min_lng, input.min_lat, input.max_lng, input.max_lat);
    console_log!("🔍 DEBUG: Also storing vector tiles under standard bbox_key: {}", standard_bbox_key);
    module_state_lock.store_vector_tiles(&standard_bbox_key, &tile_results);
    
    // Return tile data that has been processed by Rust
    // We're still returning the VectorTileResult format for compatibility,
    // but we're now parsing the MVT data in Rust instead of JavaScript
    Ok(to_value(&tile_results)?)
}

// MVT-specific structures for Rust parsing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MvtLayer {
    pub name: String,
    pub features: Vec<MvtFeature>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MvtFeature {
    pub id: Option<u64>,
    pub properties: HashMap<String, serde_json::Value>,
    pub geometry_type: String,
    pub geometry: Vec<Vec<Vec<f64>>>, // Coordinates in [[[x, y],...],...]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedMvtTile {
    pub tile: TileRequest,
    pub layers: HashMap<String, MvtLayer>,
    pub raw_data: Vec<u8>,
}

// Function to detect if data is gzipped (checking for gzip magic number)
fn is_gzipped(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0x1F && data[1] == 0x8B
}

// Function to decompress gzipped data
fn decompress_gzip(data: &[u8]) -> Result<Vec<u8>, String> {
    if !is_gzipped(data) {
        return Ok(data.to_vec());
    }
    
    let mut decoder = GzDecoder::new(data);
    let mut decompressed_data = Vec::new();
    
    decoder.read_to_end(&mut decompressed_data)
        .map_err(|e| format!("Error decompressing gzip data: {}", e))?;
    
    Ok(decompressed_data)
}

// Enhanced function to parse MVT data with proper geometry decoding
fn enhanced_parse_mvt_data(tile_data: &[u8], tile: &TileRequest) -> Result<ParsedMvtTile, String> {
    // Decompress if the data is gzipped
    let data = decompress_gzip(tile_data)?;
    
    // Create the result structure
    let mut tile_result = ParsedMvtTile {
        tile: tile.clone(),
        layers: HashMap::new(),
        raw_data: data.clone(),
    };
    
    // Try to decode the MVT data using the mvt crate
    match decode::decode_tile(&data) {
        Ok(mvt_tile) => {
            // Process each layer in the tile
            for layer in mvt_tile.layers {
                let mut mvt_layer = MvtLayer {
                    name: layer.name.clone(),
                    features: Vec::new(),
                };
                
                // Get the layer extent (usually 4096)
                let extent = layer.extent as u32;
                
                // Process each feature in the layer
                for feature in layer.features {
                    // Determine geometry type
                    let geom_type = match feature.type_ {
                        GeomType::Point => "Point",
                        GeomType::LineString => "LineString",
                        GeomType::Polygon => "Polygon",
                        GeomType::Unknown(_) => continue, // Skip unknown geometries
                    };
                    
                    // Convert MVT properties to standard JSON values
                    let mut properties = HashMap::new();
                    for (key, value) in feature.properties {
                        // Convert the different types of MVT values to JSON values
                        let json_value = match value {
                            mvt::Value::String(s) => serde_json::Value::String(s),
                            mvt::Value::Float(f) => serde_json::Value::Number(serde_json::Number::from_f64(f as f64).unwrap_or(serde_json::Number::from(0))),
                            mvt::Value::Double(d) => serde_json::Value::Number(serde_json::Number::from_f64(d).unwrap_or(serde_json::Number::from(0))),
                            mvt::Value::Int(i) => serde_json::Value::Number(serde_json::Number::from(i)),
                            mvt::Value::UInt(u) => serde_json::Value::Number(serde_json::Number::from(u)),
                            mvt::Value::SInt(s) => serde_json::Value::Number(serde_json::Number::from(s)),
                            mvt::Value::Bool(b) => serde_json::Value::Bool(b),
                            _ => serde_json::Value::Null,
                        };
                        properties.insert(key, json_value);
                    }
                    
                    // Decode MVT geometry commands
                    let decoded_geometry = decode_mvt_geometry(&feature.geometry, tile.z, extent, geom_type);
                    
                    let mvt_feature = MvtFeature {
                        id: feature.id,
                        properties,
                        geometry_type: geom_type.to_string(),
                        geometry: decoded_geometry,
                    };
                    
                    mvt_layer.features.push(mvt_feature);
                }
                
                tile_result.layers.insert(layer.name, mvt_layer);
            }
            
            Ok(tile_result)
        },
        Err(e) => {
            Err(format!("Error decoding MVT tile: {:?}", e))
        }
    }
}

// Decode MVT geometry commands to coordinate arrays
fn decode_mvt_geometry(commands: &[u32], zoom: u32, extent: u32, geom_type: &str) -> Vec<Vec<Vec<f64>>> {
    let mut result = Vec::new();
    
    match geom_type {
        "Point" => {
            // For points, we expect a single MoveTo command
            if commands.len() >= 3 && (commands[0] & 0x7) == 1 {
                let cmd_count = (commands[0] >> 3) as usize;
                if cmd_count >= 1 && commands.len() >= 1 + 2 * cmd_count {
                    let mut points = Vec::new();
                    let mut cursor_x = 0;
                    let mut cursor_y = 0;
                    
                    for i in 0..cmd_count {
                        let idx = 1 + 2 * i;
                        let param_x = commands[idx] as i32;
                        let param_y = commands[idx + 1] as i32;
                        
                        // Decode zig-zag encoding
                        let dx = ((param_x >> 1) ^ (-(param_x & 1) as i32)) as i64;
                        let dy = ((param_y >> 1) ^ (-(param_y & 1) as i32)) as i64;
                        
                        cursor_x += dx;
                        cursor_y += dy;
                        
                        // Convert to lng/lat
                        let (lng, lat) = tile_to_lng_lat(
                            cursor_x as f64, 
                            cursor_y as f64, 
                            zoom,
                            extent
                        );
                        
                        points.push(vec![lng, lat]);
                    }
                    
                    if !points.is_empty() {
                        result.push(points);
                    }
                }
            }
        },
        "LineString" => {
            // For LineString, we expect a MoveTo followed by LineTo commands
            // This is a simplified implementation
            let mut current_line = Vec::new();
            let mut cursor_x = 0;
            let mut cursor_y = 0;
            let mut i = 0;
            
            while i < commands.len() {
                let cmd_id = commands[i] & 0x7;
                let cmd_count = (commands[i] >> 3) as usize;
                i += 1;
                
                if cmd_id == 1 { // MoveTo
                    // Start a new line if we have an existing one
                    if !current_line.is_empty() {
                        result.push(current_line);
                        current_line = Vec::new();
                    }
                    
                    // Process MoveTo point
                    if i + 1 < commands.len() {
                        let param_x = commands[i] as i32;
                        let param_y = commands[i + 1] as i32;
                        
                        // Decode zig-zag encoding
                        let dx = ((param_x >> 1) ^ (-(param_x & 1) as i32)) as i64;
                        let dy = ((param_y >> 1) ^ (-(param_y & 1) as i32)) as i64;
                        
                        cursor_x += dx;
                        cursor_y += dy;
                        
                        // Convert to lng/lat
                        let (lng, lat) = tile_to_lng_lat(
                            cursor_x as f64, 
                            cursor_y as f64, 
                            zoom,
                            extent
                        );
                        
                        current_line.push(vec![lng, lat]);
                        i += 2;
                    }
                } else if cmd_id == 2 { // LineTo
                    for _ in 0..cmd_count {
                        if i + 1 < commands.len() {
                            let param_x = commands[i] as i32;
                            let param_y = commands[i + 1] as i32;
                            
                            // Decode zig-zag encoding
                            let dx = ((param_x >> 1) ^ (-(param_x & 1) as i32)) as i64;
                            let dy = ((param_y >> 1) ^ (-(param_y & 1) as i32)) as i64;
                            
                            cursor_x += dx;
                            cursor_y += dy;
                            
                            // Convert to lng/lat
                            let (lng, lat) = tile_to_lng_lat(
                                cursor_x as f64, 
                                cursor_y as f64, 
                                zoom,
                                extent
                            );
                            
                            current_line.push(vec![lng, lat]);
                            i += 2;
                        }
                    }
                } else if cmd_id == 7 { // ClosePath
                    // For ClosePath, we don't have parameters but we need to close the line
                    // by adding the first point again
                    if !current_line.is_empty() {
                        current_line.push(current_line[0].clone());
                    }
                } else {
                    // Unknown command, skip
                    i += 2 * cmd_count;
                }
            }
            
            // Add the last line if we have one
            if !current_line.is_empty() {
                result.push(current_line);
            }
        },
        "Polygon" => {
            // Polygons are similar to LineStrings but with more complex rules
            // This is a simplified implementation
            let mut rings = Vec::new();
            let mut current_ring = Vec::new();
            let mut cursor_x = 0;
            let mut cursor_y = 0;
            let mut i = 0;
            
            while i < commands.len() {
                let cmd_id = commands[i] & 0x7;
                let cmd_count = (commands[i] >> 3) as usize;
                i += 1;
                
                if cmd_id == 1 { // MoveTo
                    // Start a new ring if we have an existing one
                    if !current_ring.is_empty() {
                        rings.push(current_ring);
                        current_ring = Vec::new();
                    }
                    
                    // Process MoveTo point
                    if i + 1 < commands.len() {
                        let param_x = commands[i] as i32;
                        let param_y = commands[i + 1] as i32;
                        
                        // Decode zig-zag encoding
                        let dx = ((param_x >> 1) ^ (-(param_x & 1) as i32)) as i64;
                        let dy = ((param_y >> 1) ^ (-(param_y & 1) as i32)) as i64;
                        
                        cursor_x += dx;
                        cursor_y += dy;
                        
                        // Convert to lng/lat
                        let (lng, lat) = tile_to_lng_lat(
                            cursor_x as f64, 
                            cursor_y as f64, 
                            zoom,
                            extent
                        );
                        
                        current_ring.push(vec![lng, lat]);
                        i += 2;
                    }
                } else if cmd_id == 2 { // LineTo
                    for _ in 0..cmd_count {
                        if i + 1 < commands.len() {
                            let param_x = commands[i] as i32;
                            let param_y = commands[i + 1] as i32;
                            
                            // Decode zig-zag encoding
                            let dx = ((param_x >> 1) ^ (-(param_x & 1) as i32)) as i64;
                            let dy = ((param_y >> 1) ^ (-(param_y & 1) as i32)) as i64;
                            
                            cursor_x += dx;
                            cursor_y += dy;
                            
                            // Convert to lng/lat
                            let (lng, lat) = tile_to_lng_lat(
                                cursor_x as f64, 
                                cursor_y as f64, 
                                zoom,
                                extent
                            );
                            
                            current_ring.push(vec![lng, lat]);
                            i += 2;
                        }
                    }
                } else if cmd_id == 7 { // ClosePath
                    // For ClosePath in polygons, we add the first point again to close the ring
                    if !current_ring.is_empty() {
                        current_ring.push(current_ring[0].clone());
                    }
                } else {
                    // Unknown command, skip
                    i += 2 * cmd_count;
                }
            }
            
            // Add the last ring if we have one
            if !current_ring.is_empty() {
                rings.push(current_ring);
            }
            
            // Add all rings to the result
            for ring in rings {
                result.push(ring);
            }
        },
        _ => {}
    }
    
    result
}
