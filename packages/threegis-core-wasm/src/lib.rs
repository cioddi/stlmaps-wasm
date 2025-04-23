use wasm_bindgen::prelude::*;
use geojson::{Feature, GeoJson, Geometry, Value};
use geo::{Coord, LineString, Polygon};
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::to_value;
use std::collections::HashMap;
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
// Import our terrain geometry generation module
mod terrain;
// Import our vector tile processing module
mod vectortile;
// Import our enhanced MVT parser
mod mvt_parser;
// Import our geojson features module
pub mod geojson_features;
// Import our polygon geometry module
mod polygon_geometry;
// Import our bbox filter module
mod bbox_filter;

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

// This sets up the wasm_bindgen start functionality
#[wasm_bindgen(start)]
pub fn start() {
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
    console_log!("ThreeGIS WASM module initialized with caching");
}

// Function to store a raster tile in the cache
#[wasm_bindgen]
pub fn store_raster_tile(x: u32, y: u32, z: u32, source: &str, width: u32, height: u32, data: &[u8]) -> bool {
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
pub fn has_raster_tile(x: u32, y: u32, z: u32, source: &str) -> bool {
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
pub fn transform_coordinate(lon: f64, lat: f64, from_epsg: u32, to_epsg: u32) -> Result<JsValue, JsValue> {
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

// Buffer a line string by a distance (in coordinate units)
#[wasm_bindgen]
pub fn buffer_line_string(line_string_json: &str, buffer_distance: f64) -> String {
    console_log!("Buffering line string with distance: {}", buffer_distance);
    
    // Parse the GeoJSON
    let geojson = line_string_json.parse::<GeoJson>().unwrap();
    
    // Extract the line string coordinates
    if let GeoJson::Feature(feature) = geojson {
        if let Some(geometry) = feature.geometry {
            if let Value::LineString(coordinates) = geometry.value {
                // Convert to geo LineString
                let points: Vec<Coord<f64>> = coordinates
                    .iter()
                    .map(|c| Coord {
                        x: c[0],
                        y: c[1],
                    })
                    .collect();
                
                let line = LineString::new(points);
                
                // Implement the buffer logic (simplified example)
                // In a real implementation, you'd use proper buffering algorithms
                // This is just a placeholder for demonstration
                let buffered = line; // Replace with real buffering
                
                // Convert back to GeoJSON Feature
                let geo_poly = Polygon::new(buffered.into(), vec![]);
                let coords = geo_poly.exterior().coords().map(|c| vec![c.x, c.y]).collect();
                
                let geometry = Geometry::new(Value::Polygon(vec![coords]));
                let feature = Feature {
                    bbox: None,
                    geometry: Some(geometry),
                    id: None,
                    properties: None,
                    foreign_members: None,
                };
                
                return serde_json::to_string(&feature).unwrap();
            }
        }
    }
    
    // Return empty result if parsing fails or input is not a LineString
    "{}".to_string()
}

// Function to create 3D building geometry from a GeoJSON polygon
#[wasm_bindgen]
pub fn create_building_geometry(building_json: &str, height: f64) -> String {
    console_log!("Creating building geometry with height: {}", height);
    
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

// Export the polygon geometry creation function
#[wasm_bindgen]
pub fn process_polygon_geometry(input_json: &str) -> Result<JsValue, JsValue> {
    match polygon_geometry::create_polygon_geometry(input_json) {
        Ok(json_string) => {
            // Debug log the size of the string we're sending back
            let bytes = json_string.as_bytes().len();
            console_log!("Sending back {} bytes of geometry data", bytes);
            
            // For very large results, parse the string to check vertex count
            if bytes > 100000 {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_string) {
                    if let Some(vertices) = parsed.get("vertices") {
                        if let Some(arr) = vertices.as_array() {
                            console_log!("Verified {} vertices in geometry", arr.len() / 3);
                        }
                    }
                }
            }
            
            Ok(JsValue::from_str(&json_string))
        },
        Err(err_string) => Err(JsValue::from_str(&err_string)),
    }
}
