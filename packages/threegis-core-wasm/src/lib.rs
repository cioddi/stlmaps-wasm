use wasm_bindgen::prelude::*;
use geojson::{Feature, GeoJson, Geometry, Value};
use geo::{Coord, LineString, Polygon};
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::to_value;

// Enable better panic messages in console during development
#[cfg(feature = "console_error_panic_hook")]
pub use console_error_panic_hook::set_once as set_panic_hook;

// This exports the function to JavaScript
#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// A macro to provide `println!(..)`-style syntax for `console.log` logging.
macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

#[wasm_bindgen]
pub fn initialize() {
    // Set up the panic hook if the feature is enabled.
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();
    console_log!("ThreeGIS WASM module initialized");
}

// Example struct to return
#[derive(Serialize)]
pub struct RustResponse {
    pub message: String,
    pub value: i32,
}

#[wasm_bindgen]
pub fn hello_from_rust(name: &str) -> Result<JsValue, JsValue> {
    let response = RustResponse {
        message: format!("Hello, {}! This response comes from Rust.", name),
        value: 42,
    };
    // Use serde_wasm_bindgen to convert Rust struct to JS object
    Ok(to_value(&response)?)
}

// Add a placeholder for projection testing later
#[wasm_bindgen]
pub fn transform_coordinate(lon: f64, lat: f64, from_epsg: u32, to_epsg: u32) -> Result<JsValue, JsValue> {
    // Implementation will use the 'proj' crate
    // Placeholder: just return input for now
    #[derive(Serialize)]
    struct Coords { lon: f64, lat: f64 };
    Ok(to_value(&Coords{lon, lat})?)
}

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

// Example function to create terrain geometry
#[wasm_bindgen]
pub fn create_terrain_geometry(dem_data: &[u8], width: u32, height: u32, scale: f64) -> String {
    console_log!("Creating terrain geometry from {}x{} DEM", width, height);
    
    // In a real implementation, this would:
    // 1. Process the DEM data
    // 2. Create a 3D mesh
    // 3. Return the mesh as JSON
    
    let mesh = ProcessedMesh {
        vertices: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        indices: vec![0, 1, 2],
        normals: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
    };
    
    serde_json::to_string(&mesh).unwrap()
}
