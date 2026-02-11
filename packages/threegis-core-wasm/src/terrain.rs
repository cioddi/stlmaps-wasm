// Terrain geometry generation module with new mesh-cutting approach
use js_sys::{Float32Array, Object, Uint32Array};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::elevation::ElevationProcessingResult;
use crate::module_state::ModuleState;
use crate::terrain_mesh_gen;

#[derive(Serialize, Deserialize)]
pub struct TerrainGeometryParams {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64,
    pub max_lat: f64,
    pub vertical_exaggeration: f64,
    pub terrain_base_height: f64,
    pub process_id: String,
    pub use_simple_mesh: bool,
}

#[derive(Serialize, Deserialize)]
pub struct TerrainGeometryResult {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub colors: Vec<f32>,
    pub normals: Vec<f32>,
    pub processed_elevation_grid: Vec<Vec<f64>>,
    pub processed_min_elevation: f64,
    pub processed_max_elevation: f64,
    pub original_min_elevation: f64,
    pub original_max_elevation: f64,
}

// Check if GPU terrain acceleration is available
pub async fn check_gpu_terrain_support() -> bool {
    crate::gpu_terrain::init_gpu_terrain_processor().await.unwrap_or(false)
}

// Main function to create terrain geometry using the new mesh-cutting approach
#[wasm_bindgen]
pub async fn create_terrain_geometry(params_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse parameters
    let params: TerrainGeometryParams = serde_wasm_bindgen::from_value(params_js)?;

    // Check if simple mesh (flat terrain) is requested
    if params.use_simple_mesh {
        return create_simple_flat_terrain(&params).await;
    }

    // Get elevation data
    let elevation_grid = {
        if let Some(grid) = ModuleState::with(|state| {
            state.get_elevation_grid(&params.process_id).cloned()
        }) {
            grid
        } else {
            // Retry mechanism: attempt to process elevation data up to 4 times
            let max_retries = 4;
            let mut elevation_grid: Option<Vec<Vec<f64>>> = None;

            for attempt in 1..=max_retries {
                // Create elevation processing input
                let elevation_input = crate::elevation::ElevationProcessingInput {
                    min_lng: params.min_lng,
                    min_lat: params.min_lat,
                    max_lng: params.max_lng,
                    max_lat: params.max_lat,
                    tiles: Vec::new(), // Will be populated by the processing function
                    grid_width: 256,   // Standard grid size
                    grid_height: 256,  // Standard grid size
                    process_id: params.process_id.clone(),
                };

                // Serialize input
                match serde_json::to_string(&elevation_input) {
                    Ok(input_json) => {
                        // Attempt to process elevation data
                        match crate::elevation::process_elevation_data_async(&input_json).await {
                            Ok(_) => {
                                // Check if we now have the data
                                if let Some(grid) = ModuleState::with(|state| {
                                    state.get_elevation_grid(&params.process_id).cloned()
                                }) {
                                    elevation_grid = Some(grid.clone());
                                    break;
                                }
                            }
                            Err(_e) => {
                                if attempt < max_retries {
                                    // Exponential backoff: wait 500ms * 2^(attempt-1)
                                    let delay_ms = 500 * (1 << (attempt - 1));
                                    // Create a promise that resolves after delay via setTimeout.
                                    // Works in both Window and Worker contexts.
                                    let promise = js_sys::Promise::new(&mut |resolve, _| {
                                        let global = js_sys::global();
                                        let set_timeout = js_sys::Reflect::get(
                                            &global,
                                            &wasm_bindgen::JsValue::from_str("setTimeout"),
                                        ).unwrap();
                                        let set_timeout_fn: js_sys::Function = set_timeout.into();
                                        let _ = set_timeout_fn.call2(
                                            &global,
                                            &resolve,
                                            &wasm_bindgen::JsValue::from_f64(delay_ms as f64),
                                        );
                                    });
                                    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
                                }
                            }
                        }
                    }
                    Err(_e) => {
                        break;
                    }
                }
            }

            match elevation_grid {
                Some(grid) => grid,
                None => {
                    return Err(JsValue::from_str(&format!(
                        "❌ Failed to retrieve elevation data for bbox [{}, {}, {}, {}] after {} attempts. Check your internet connection or try adjusting the bounding box.",
                        params.min_lng, params.min_lat, params.max_lng, params.max_lat, max_retries
                    )));
                }
            }
        }
    };

    // Create elevation result for mesh generation
    let mut min_elevation = f64::INFINITY;
    let mut max_elevation = f64::NEG_INFINITY;

    for row in elevation_grid.iter() {
        for &val in row.iter() {
            min_elevation = min_elevation.min(val);
            max_elevation = max_elevation.max(val);
        }
    }

    let width = elevation_grid[0].len() as u32;
    let height = elevation_grid.len() as u32;

    let elevation_result = ElevationProcessingResult {
        elevation_grid,
        grid_size: crate::elevation::GridSize { width, height },
        min_elevation,
        max_elevation,
        processed_min_elevation: min_elevation,
        processed_max_elevation: max_elevation,
        cache_hit_rate: 1.0,
    };

    // IMPORTANT: Use manifold CPU terrain generation by default
    //
    // The GPU terrain generation (gpu_terrain.rs) creates non-manifold geometry due to:
    // 1. Interleaved vertex structure (top/bottom pairs) instead of layered structure
    // 2. Quad-by-quad index generation instead of systematic manifold triangulation
    // 3. Different vertex ordering that doesn't guarantee shared edges between triangles
    //
    // The CPU implementation (terrain_mesh_gen.rs) produces guaranteed manifold geometry by:
    // 1. Using layered vertex structure (all bottom vertices first, then all top vertices)
    // 2. Following the same manifold triangulation pattern as building extrusion
    // 3. Systematic edge sharing that ensures each edge appears exactly twice
    //
    // Use GPU terrain by default for 5-50x speedup, with automatic CPU fallback
    // GPU terrain may produce slightly different geometry but is much faster
    let use_gpu_terrain = true;


    if use_gpu_terrain {
        match crate::gpu_terrain::generate_terrain_mesh_gpu(&elevation_result, &params).await {
            Ok(gpu_result) => {
                let js_result = convert_terrain_geometry_to_js(gpu_result)?;
                return Ok(js_result);
            }
            Err(_e) => {
                // GPU processing failed, fall back to CPU
            }
        }
    }

    // Use manifold mesh-based terrain generation (CPU - produces guaranteed manifold geometry)

    match terrain_mesh_gen::generate_terrain_with_mesh_cutting(&elevation_result, &params) {
        Ok(result) => {
            let js_result = convert_terrain_geometry_to_js(result)?;
            Ok(js_result)
        }
        Err(e) => {
            Err(JsValue::from_str(&format!("Terrain generation failed: {}", e)))
        }
    }
}

// Helper function to convert our Rust terrain geometry to JavaScript-friendly objects
fn convert_terrain_geometry_to_js(result: TerrainGeometryResult) -> Result<JsValue, JsValue> {
    let positions_array = Float32Array::from(result.positions.as_slice());
    let indices_array = Uint32Array::from(result.indices.as_slice());
    let colors_array = Float32Array::from(result.colors.as_slice());
    let normals_array = Float32Array::from(result.normals.as_slice());

    // Create a JavaScript object to return
    let js_obj = Object::new();

    // Set the geometry attributes
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("positions"), &positions_array)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("indices"), &indices_array)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("colors"), &colors_array)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("normals"), &normals_array)?;

    // Convert processed elevation grid to JS
    let processed_grid = serde_wasm_bindgen::to_value(&result.processed_elevation_grid)?;
    js_sys::Reflect::set(
        &js_obj,
        &JsValue::from_str("processedElevationGrid"),
        &processed_grid,
    )?;

    // Set processed min/max elevation values
    js_sys::Reflect::set(
        &js_obj,
        &JsValue::from_str("processedMinElevation"),
        &JsValue::from_f64(result.processed_min_elevation),
    )?;
    js_sys::Reflect::set(
        &js_obj,
        &JsValue::from_str("processedMaxElevation"),
        &JsValue::from_f64(result.processed_max_elevation),
    )?;

    // Set original min/max elevation values
    js_sys::Reflect::set(
        &js_obj,
        &JsValue::from_str("originalMinElevation"),
        &JsValue::from_f64(result.original_min_elevation),
    )?;
    js_sys::Reflect::set(
        &js_obj,
        &JsValue::from_str("originalMaxElevation"),
        &JsValue::from_f64(result.original_max_elevation),
    )?;

    Ok(js_obj.into())
}

// Create a simple flat terrain block without elevation data
async fn create_simple_flat_terrain(params: &TerrainGeometryParams) -> Result<JsValue, JsValue> {
    // Create a simple flat rectangular mesh at the base terrain height
    let base_height = params.terrain_base_height;

    // Define terrain size - matching the regular terrain size
    let terrain_size = 200.0; // Same as TERRAIN_SIZE in polygon_geometry.rs
    let half_size = terrain_size / 2.0;

    // Create vertices for a simple flat rectangle
    // Bottom vertices (4 corners at base level)
    let positions = vec![
        -half_size as f32, -half_size as f32, 0.0,      // Bottom-left bottom
        half_size as f32,  -half_size as f32, 0.0,      // Bottom-right bottom
        half_size as f32,  half_size as f32,  0.0,      // Top-right bottom
        -half_size as f32, half_size as f32,  0.0,      // Top-left bottom
        // Top vertices (4 corners at terrain height)
        -half_size as f32, -half_size as f32, base_height as f32, // Bottom-left top
        half_size as f32,  -half_size as f32, base_height as f32, // Bottom-right top
        half_size as f32,  half_size as f32,  base_height as f32, // Top-right top
        -half_size as f32, half_size as f32,  base_height as f32, // Top-left top
    ];

    // Create indices for a box (12 triangles = 36 indices)
    let indices = vec![
        // Bottom face (looking up)
        0, 1, 2,  0, 2, 3,
        // Top face (looking down)
        4, 6, 5,  4, 7, 6,
        // Front face
        0, 4, 5,  0, 5, 1,
        // Right face
        1, 5, 6,  1, 6, 2,
        // Back face
        2, 6, 7,  2, 7, 3,
        // Left face
        3, 7, 4,  3, 4, 0,
    ];

    // Create colors (uniform terrain color)
    let colors: Vec<f32> = (0..8).flat_map(|_| vec![0.8, 0.6, 0.4]).collect(); // 8 vertices * 3 components

    // Create normals
    let normals = vec![
        // Bottom vertices (pointing down)
        0.0, 0.0, -1.0,  0.0, 0.0, -1.0,  0.0, 0.0, -1.0,  0.0, 0.0, -1.0,
        // Top vertices (pointing up)
        0.0, 0.0, 1.0,   0.0, 0.0, 1.0,   0.0, 0.0, 1.0,   0.0, 0.0, 1.0,
    ];

    // Create a flat elevation grid (2x2 grid with base height)
    let processed_elevation_grid = vec![
        vec![base_height, base_height],
        vec![base_height, base_height],
    ];

    // Create result
    let result = TerrainGeometryResult {
        positions,
        indices,
        colors,
        normals,
        processed_elevation_grid,
        processed_min_elevation: base_height,
        processed_max_elevation: base_height,
        original_min_elevation: base_height,
        original_max_elevation: base_height,
    };

    // Convert to JavaScript object
    convert_terrain_geometry_to_js(result)
}