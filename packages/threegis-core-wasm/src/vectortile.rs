// filepath: /home/tobi/project/stlmaps/packages/threegis-core-wasm/src/vectortile.rs
use wasm_bindgen::prelude::*;
use js_sys::{Uint8Array, Date, Object, Array, JSON, Math};
use serde::{Serialize, Deserialize};
use serde_wasm_bindgen::{to_value, from_value};
use wasm_bindgen_futures::JsFuture;
use std::collections::HashMap;

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
    pub buffer_size: Option<f64>,
}

// Input for extracting features from vector tiles
#[derive(Serialize, Deserialize)]
pub struct ExtractFeaturesInput {
    pub bbox: Vec<f64>,                     // [minLng, minLat, maxLng, maxLat]
    pub vt_dataset: VtDataset,              // Configuration for the layer
    pub process_id: String,                 // Cache key/process ID
    pub elevation_process_id: Option<String>, // ID to find cached elevation data
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
    let process_id = &input.process_id;
    
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
    
    // Try to access cached vector tile data
    let vector_tiles = match module_state.get_vector_tiles(process_id) {
        Some(tiles) => tiles,
        None => {
            console_log!("No cached vector tiles found for process_id: {}", process_id);
            return Err(JsValue::from_str(&format!("No cached vector tiles found for process_id: {}", process_id)));
        }
    };
    
    // Get cached elevation data if available
    let elevation_data = if let Some(elevation_id) = &input.elevation_process_id {
        module_state.get_elevation_data(elevation_id)
    } else {
        module_state.get_elevation_data(process_id)
    };
    
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
    
    // Use the process_id from input or generate one if not provided
    let process_id = match input.process_id {
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
            // Fetch the tile if not cached
            let fetch_promise = fetch_tile(tile.x, tile.y, tile.z)?;
            let fetch_result = JsFuture::from(fetch_promise).await?;
            let data_array = Uint8Array::new(&fetch_result);
            let data_vec = data_array.to_vec();
            
            // Create new tile data entry
            let tile_data = TileData {
                width: 256, // Default tile size
                height: 256,
                x: tile.x,
                y: tile.y,
                z: tile.z,
                data: data_vec.clone(),
                timestamp: Date::now(),
                key: tile_key.clone(),
                buffer: data_vec.clone(),
                parsed_layers: None, // We'll parse this later when needed
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
    
    // Store all tiles under the process_id for later retrieval
    module_state_lock.store_vector_tiles(&process_id, &tile_results);
    
    // Return success with the process_id
    Ok(to_value(&process_id)?)
}
