use wasm_bindgen::prelude::*;
use crate::cache_keys::make_inner_key_from_filter;
use geo::{Coord, LineString};
use geo::algorithm::buffer::Buffer;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::to_value;
use js_sys::Date;

// Create a console module for logging
pub mod console;
// Import our elevation processing module
mod elevation;
// Import our module state management
mod module_state;
// Import our models
mod models;
// Import our cache manager
mod cache_manager;
mod cache_keys;
// Import our terrain geometry generation module
mod terrain;
// Import our vector tile processing module
mod vectortile;
// Import our geojson features module
pub mod geojson_features;
// Import our polygon geometry module
mod polygon_geometry;
// Import our bbox filter module
mod bbox_filter;
// Import our geometry functions
#[path = "../geometry_functions/extrude.rs"]
pub mod extrude;
// Import CSG union functionality
mod csg_union;
// Import cancellation handling
mod cancellation;
// Import 3MF export functionality
mod export_3mf;

use module_state::{ModuleState, TileData, create_tile_key};
use models::{CacheStats, RustResponse};

// Enable better panic messages in console during development
#[cfg(feature = "console_error_panic_hook")]
pub use console_error_panic_hook::set_once as set_panic_hook;

#[wasm_bindgen]
extern "C" {
    // JavaScript function to fetch data from URL
    #[wasm_bindgen(js_namespace = wasmJsHelpers, catch)]
    pub fn fetch(url: &str) -> Result<js_sys::Promise, JsValue>;
}

// Use the macro from our console module
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => (crate::console::log(&format!($($t)*)))
}

use std::sync::Once;
static INIT: Once = Once::new();

// This sets up the wasm_bindgen start functionality
#[wasm_bindgen(start)]
pub fn start() {
    INIT.call_once(|| {
        // Set the panic hook for better error messages
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();
        
        // Initialize the module state
        let state = ModuleState::global();
        let mut state = state.lock().unwrap();
        // Set initial cache limits
        state.max_raster_tiles = 200;
        state.max_vector_tiles = 100;
        
        // Log that the module has been initialized
        console_log!("WASM module initialized successfully");
    });
}

// Function to store a raster tile in the cache
#[wasm_bindgen]
pub fn store_raster_tile(x: u32, y: u32, z: u32, _source: &str, width: u32, height: u32, data: &[u8]) -> bool {
    let state = ModuleState::global();
    let mut state = state.lock().unwrap();
    
    let key_obj = create_tile_key(x, y, z);
    let tile_data = TileData {
        width,
        height,
        x,
        y,
        z,
        data: data.to_vec(),
        timestamp: Date::now(),
        key: format!("{}/{}/{}", z, x, y),
        buffer: data.to_vec(),
        parsed_layers: None,
        rust_parsed_mvt: None,
    };
    
    state.add_raster_tile(key_obj, tile_data);
    true
}

// Function to check if a raster tile exists in the cache
#[wasm_bindgen]
pub fn has_raster_tile(x: u32, y: u32, z: u32, _source: &str) -> bool {
    let state = ModuleState::global();
    let mut state = state.lock().unwrap();
    
    let key_obj = create_tile_key(x, y, z);
    state.get_raster_tile(&key_obj).is_some()
}

// Function to get cache statistics
#[wasm_bindgen]
pub fn get_cache_stats() -> Result<JsValue, JsValue> {
    let state = ModuleState::global();
    let state = state.lock().unwrap();
    
    let (raster_count, vector_count, elevation_count, max_raster, max_vector, total_requests) = state.get_stats();
    
    let hit_rate = if total_requests > 0 {
        state.cache_hits as f64 / total_requests as f64
    } else {
        0.0
    };
    
    let stats = CacheStats {
        raster_tiles_count: raster_count,
        vector_tiles_count: vector_count,
        elevation_grids_count: elevation_count,
        max_raster_tiles: max_raster,
        max_vector_tiles: max_vector,
        total_requests,
        hit_rate,
    };
    
    Ok(to_value(&stats)?)
}

// Function to clear all caches
#[wasm_bindgen]
pub fn clear_caches() -> bool {
    let state = ModuleState::global();
    let mut state = state.lock().unwrap();
    
    state.clear_all_caches();
    true
}
/// Store extracted feature data under a bbox_key and inner_key
#[wasm_bindgen]
pub fn add_feature_data_js(bbox_key: &str, inner_key: &str, value: JsValue) -> bool {
    let mut state = ModuleState::global().lock().unwrap();
    // Convert JsValue to String before storing
    let json = value.as_string().unwrap_or_else(|| String::from("{}"));
    state.add_feature_data(bbox_key, inner_key, json);
    true
}
/// Retrieve stored feature data by bbox_key and inner_key
#[wasm_bindgen]
pub fn get_feature_data_js(bbox_key: &str, inner_key: &str) -> JsValue {
    let state = ModuleState::global().lock().unwrap();
    state
        .get_feature_data(bbox_key, inner_key)
        .unwrap_or(JsValue::undefined())
}
/// Clear feature data entries for a given bbox_key
#[wasm_bindgen]
pub fn clear_feature_data_for_bbox_js(bbox_key: &str) -> bool {
    let mut state = ModuleState::global().lock().unwrap();
    state.clear_feature_data_for_bbox(bbox_key);
    true
}

#[wasm_bindgen]
pub fn hello_from_rust(name: &str) -> Result<JsValue, JsValue> {
    // Get cache stats for demonstration
    let state = ModuleState::global();
    let state = state.lock().unwrap();
    let (raster_count, vector_count, _, _, _, _) = state.get_stats();
    
    let response = RustResponse {
        message: format!("Hello, {}! Cache contains {} raster tiles and {} vector tiles.", 
                        name, raster_count, vector_count),
        value: 42,
    };
    // Use serde_wasm_bindgen to convert Rust struct to JS object
    Ok(to_value(&response)?)
}

// Add a placeholder for projection testing later
#[wasm_bindgen]
pub fn transform_coordinate(_lon: f64, _lat: f64, _from_epsg: u32, _to_epsg: u32) -> Result<JsValue, JsValue> {
    // Simple implementation without using the 'proj' crate
    // For EPSG:4326 (WGS84) to EPSG:3857 (Web Mercator)
    // This is a basic implementation - for production, use a proper projection library
    
    Ok(to_value(&"Placeholder for transform_coordinate function")?)
}

// Re-export the vector tile fetching function
// Note: We don't use #[wasm_bindgen] on the use statement
pub use vectortile::fetch_vector_tiles;

// Example of a simple function that will be exposed to JavaScript
#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

// Buffer a LineString by a distance (in coordinate units) with parallel processing
// Returns a serialized array of polygon coordinates.
#[wasm_bindgen]
pub fn buffer_line_string_direct(coordinates: &[f64], dist: f64) -> String {
    console_log!("Buffering LineString with {} coordinates, distance: {}", coordinates.len() / 2, dist);

    // Defensive: non-positive or NaN distances return empty geometry
    if !dist.is_finite() || dist == 0.0 || coordinates.len() < 4 {
        return "[]".to_string();
    }
    let dist = dist.abs();

    // Convert flat coordinate array to LineString
    if coordinates.len() % 2 != 0 {
        return "[]".to_string();
    }

    // Convert coordinates for better performance
    let coords: Vec<Coord> = coordinates
        .chunks_exact(2)
        .map(|chunk| Coord { x: chunk[0], y: chunk[1] })
        .collect();
    
    let linestring = LineString::new(coords);
    let buffered = linestring.buffer(dist);

    // Serialize result as simple coordinate array
    if buffered.0.is_empty() {
        return "[]".to_string();
    }

    // Convert to coordinate array format
    let coords_array: Vec<Vec<Vec<f64>>> = buffered
        .0
        .into_iter()
        .map(|poly| {
            // Only take exterior ring for simplicity
            poly.exterior().coords().map(|c| vec![c.x, c.y]).collect()
        })
        .collect();

    let result = serde_json::to_string(&coords_array).unwrap_or_else(|_| "[]".to_string());
    console_log!("Buffering completed, result size: {} bytes", result.len());
    result
}

// Legacy buffer function for backward compatibility - uses direct coordinate processing
#[wasm_bindgen]
pub fn buffer_line_string(geojson_str: &str, dist: f64) -> String {
    // Parse simple GeoJSON and extract coordinates
    match serde_json::from_str::<serde_json::Value>(geojson_str) {
        Ok(geojson) => {
            if let Some(geometry) = geojson.get("geometry") {
                if let Some(coords) = geometry.get("coordinates") {
                    if let Some(coord_array) = coords.as_array() {
                        // Convert coordinate array to flat array
                        let mut flat_coords = Vec::new();
                        for coord in coord_array {
                            if let Some(coord_pair) = coord.as_array() {
                                if coord_pair.len() >= 2 {
                                    if let (Some(x), Some(y)) = (coord_pair[0].as_f64(), coord_pair[1].as_f64()) {
                                        flat_coords.push(x);
                                        flat_coords.push(y);
                                    }
                                }
                            }
                        }
                        
                        // Call the optimized direct function
                        let result = buffer_line_string_direct(&flat_coords, dist);
                        
                        // Convert back to GeoJSON format for backward compatibility
                        match serde_json::from_str::<Vec<Vec<Vec<f64>>>>(&result) {
                            Ok(polygons) => {
                                if polygons.is_empty() {
                                    return "{}".to_string();
                                }
                                
                                // Create MultiPolygon GeoJSON
                                let multipolygon_coords: Vec<Vec<Vec<Vec<f64>>>> = polygons
                                    .into_iter()
                                    .map(|exterior| vec![exterior])
                                    .collect();
                                
                                let feature = serde_json::json!({
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "MultiPolygon",
                                        "coordinates": multipolygon_coords
                                    },
                                    "properties": {}
                                });
                                
                                serde_json::to_string(&feature).unwrap_or_else(|_| "{}".to_string())
                            }
                            Err(_) => "{}".to_string()
                        }
                    } else {
                        "{}".to_string()
                    }
                } else {
                    "{}".to_string()
                }
            } else {
                "{}".to_string()
            }
        }
        Err(_) => "{}".to_string()
    }
}

// Function to create 3D building geometry from a GeoJSON polygon
#[wasm_bindgen]
pub fn create_building_geometry(_building_json: &str, height: f64) -> String {
    
    
    // In a real implementation, this would:
    // 1. Parse the building GeoJSON
    // 2. Extrude the building polygon to the specified height
    // 3. Return a JSON representation of the 3D geometry
    // 
    // This is just a placeholder function for demonstration
    
    format!("{{\"success\": true, \"message\": \"Building with height {} created\"}}", height)
}

// An example struct that can be passed between Rust and JavaScript
#[wasm_bindgen]
pub struct TerrainSample {
    x: f64,
    y: f64,
    elevation: f64,
}

#[wasm_bindgen]
impl TerrainSample {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64, elevation: f64) -> TerrainSample {
        TerrainSample { x, y, elevation }
    }
    
    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f64 {
        self.x
    }
    
    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f64 {
        self.y
    }
    
    #[wasm_bindgen(getter)]
    pub fn elevation(&self) -> f64 {
        self.elevation
    }
}

// A more complex data structure using serde for serialization
#[derive(Serialize, Deserialize)]
pub struct ProcessedMesh {
    vertices: Vec<f64>,
    indices: Vec<u32>,
    normals: Vec<f64>,
}

// Export cache manager functions
#[wasm_bindgen]
pub fn register_cache_group(group_id: &str) -> Result<(), JsValue> {
    crate::cache_manager::register_group_js(group_id)
}

#[wasm_bindgen]
pub fn free_cache_group(group_id: &str) -> Result<(), JsValue> {
    crate::cache_manager::free_group_js(group_id)
}

// Export CSG union functionality with parallel processing
#[wasm_bindgen]
pub fn merge_geometries_with_csg_union(geometries_json: &str) -> Result<JsValue, JsValue> {
    console_log!("Starting CSG union with parallel processing");
    
    // Parse input geometries
    let geometries: Vec<crate::polygon_geometry::BufferGeometry> = 
        serde_json::from_str(geometries_json)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse geometries: {}", e)))?;
    
    console_log!("Parsed {} geometries for CSG union", geometries.len());
    
    // Merge geometries by layer
    let merged_by_layer = csg_union::merge_geometries_by_layer(geometries);
    
    console_log!("Merged into {} layers", merged_by_layer.len());
    
    // Convert to output format with sequential optimization
    let result: Vec<crate::polygon_geometry::BufferGeometry> = merged_by_layer
        .into_iter()
        .map(|(layer_name, geometry)| {
            console_log!("Optimizing geometry for layer: {}", layer_name);
            csg_union::optimize_geometry(geometry, 0.01) // 1cm tolerance
        })
        .collect();
    
    console_log!("Optimization complete, {} final geometries", result.len());
    
    // Serialize result
    let json = serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))?;
    
    Ok(JsValue::from_str(&json))
}

// Batch buffer multiple LineStrings in parallel for optimal performance
#[wasm_bindgen]
pub fn buffer_line_strings_batch(geojson_features_json: &str, dist: f64) -> String {
    console_log!("Starting batch LineString buffering with distance: {}", dist);
    
    // Parse input features
    let features: Vec<serde_json::Value> = match serde_json::from_str(geojson_features_json) {
        Ok(features) => features,
        Err(_) => return "[]".to_string()
    };
    
    console_log!("Processing {} features sequentially", features.len());
    
    // Process features sequentially
    let buffered_results: Vec<String> = features
        .into_iter()
        .filter_map(|feature| {
            // Extract coordinates from each feature
            if let Some(geometry) = feature.get("geometry") {
                if let Some(coords) = geometry.get("coordinates") {
                    if let Some(coord_array) = coords.as_array() {
                        // Convert to flat coordinates
                        let mut flat_coords = Vec::new();
                        for coord in coord_array {
                            if let Some(coord_pair) = coord.as_array() {
                                if coord_pair.len() >= 2 {
                                    if let (Some(x), Some(y)) = (coord_pair[0].as_f64(), coord_pair[1].as_f64()) {
                                        flat_coords.push(x);
                                        flat_coords.push(y);
                                    }
                                }
                            }
                        }
                        
                        if flat_coords.len() >= 4 {
                            Some(buffer_line_string_direct(&flat_coords, dist))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    
    console_log!("Batch buffering completed, {} results", buffered_results.len());
    
    // Combine all results into a single array
    serde_json::to_string(&buffered_results).unwrap_or_else(|_| "[]".to_string())
}

// Get information about WASM module capabilities
#[wasm_bindgen]
pub fn get_wasm_info() -> String {
    serde_json::to_string(&serde_json::json!({
        "parallel_processing": false,
        "reason": "Simplified sequential processing for WASM compatibility",
        "performance_optimizations": [
            "Efficient triangulation",
            "Geometry caching", 
            "Memory optimization",
            "Fast coordinate transforms"
        ]
    })).unwrap_or_else(|_| "{}".to_string())
}

// Test function to verify thread pool initialization
#[wasm_bindgen]
pub fn test_initialization() -> String {
    // Test calling start multiple times to ensure no panic
    start();
    start();
    start();
    "Initialization test passed - no panics occurred".to_string()
}

// Export the polygon geometry creation function with cached feature retrieval
#[wasm_bindgen]
pub fn process_polygon_geometry(input_json: &str) -> Result<JsValue, JsValue> {
    // Parse input JSON to extract bbox and vtDataSet
    let mut input_val: serde_json::Value = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid input JSON: {}", e)))?;
    // Extract bbox coordinates
    let bbox = input_val.get("bbox")
        .and_then(|v| v.as_array())
        .ok_or_else(|| JsValue::from_str("Missing or invalid 'bbox' field"))?;
    if bbox.len() != 4 {
        return Err(JsValue::from_str("Invalid 'bbox': must contain [minLng, minLat, maxLng, maxLat]"));
    }
    let min_lng = bbox[0].as_f64().unwrap_or(0.0);
    let min_lat = bbox[1].as_f64().unwrap_or(0.0);
    let max_lng = bbox[2].as_f64().unwrap_or(0.0);
    let max_lat = bbox[3].as_f64().unwrap_or(0.0);
    // Compute consistent bbox_key using central function
    let bbox_key = cache_keys::make_bbox_key(min_lng, min_lat, max_lng, max_lat);
    // Determine source layer from vtDataSet
    let source_layer = input_val
        .get("vtDataSet")
        .and_then(|v| v.get("sourceLayer"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsValue::from_str("Missing 'vtDataSet.sourceLayer' field"))?;

    // Retrieve cached features for this bbox and layer, preferring feature_data_cache populated by extract_features_from_vector_tiles
    let state = ModuleState::global();
    let mut state = state.lock().unwrap();
    // Assemble inner cache key using central function (no filter currently)
    let inner_key = make_inner_key_from_filter(
        source_layer, 
        input_val.get("vtDataSet").and_then(|v| v.get("filter"))
    );
    
    
    // Retrieve features from feature_data_cache
    let features: Vec<crate::polygon_geometry::GeometryData> = if let Some(js_val) = state.get_feature_data(&bbox_key, &inner_key) {
        // Stored as JSON string in JsValue
        let json_str = js_val.as_string().unwrap_or_else(|| "[]".to_string());
        
        match serde_json::from_str::<Vec<crate::polygon_geometry::GeometryData>>(&json_str) {
            Ok(data) => {
                
                data
            },
            Err(_e) => {
                
                Vec::new()
            }
        }
    } else {
        
        
        // List what cache keys are actually available
        if let Some(bbox_cache) = state.feature_data_cache.get(&bbox_key) {
            for (_key, _) in bbox_cache.iter() {
                
            }
        } else {
            
        }
        Vec::new()
    };

    // Insert retrieved features into 'polygons' field
    let features_value: serde_json::Value = serde_json::to_value(&features)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize features: {}", e)))?;
    input_val["polygons"] = features_value;
    // Update bbox_key in input
    input_val["bbox_key"] = serde_json::Value::String(bbox_key.clone());

    // Serialize modified input for geometry creation
    let new_input = serde_json::to_string(&input_val)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize input: {}", e)))?;

    // Call create_polygon_geometry with cached features applied
    match polygon_geometry::create_polygon_geometry(&new_input) {
        Ok(json_string) => Ok(JsValue::from_str(&json_string)),
        Err(err_string) => Err(JsValue::from_str(&err_string)),
    }
}
