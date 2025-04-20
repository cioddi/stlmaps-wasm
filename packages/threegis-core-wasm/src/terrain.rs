// Terrain geometry generation module
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use js_sys::{Float32Array, Uint32Array, Array, Object};
use std::collections::HashMap;

use crate::module_state::{ModuleState};
use crate::elevation::{ElevationProcessingResult, GridSize};
use crate::console_log;

#[derive(Serialize, Deserialize)]
pub struct TerrainGeometryParams {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64, 
    pub max_lat: f64,
    pub vertical_exaggeration: f64,
    pub terrain_base_height: f64,
    pub process_id: String,
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
}

// Main function to create terrain geometry from elevation data
#[wasm_bindgen]
pub fn create_terrain_geometry(params_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse parameters
    let params: TerrainGeometryParams = serde_wasm_bindgen::from_value(params_js)?;
    
    // Get module state to access cached elevation data
    let state = ModuleState::global();
    let state = state.lock().unwrap();
    
    // Try to get cached elevation data for this process_id
    let elevation_grid = match state.get_elevation_grid(&params.process_id) {
        Some(grid) => grid,
        None => {
            return Err(JsValue::from_str("No elevation data found for this process_id. Process elevation data first."));
        }
    };
    
    // For this example, we'll need to get information from elevation module
    // We'll create a simplified ElevationProcessingResult for testing
    // In a real implementation, you would store and retrieve the full result
    use crate::elevation::{GridSize, ElevationProcessingResult};
    
    // Create a simplified elevation result based on the cached grid
    // In a production environment, you would store and retrieve the complete result
    let mut min_elevation = f64::INFINITY;
    let mut max_elevation = f64::NEG_INFINITY;
    
    // Find min/max elevations
    for row in elevation_grid.iter() {
        for &val in row.iter() {
            min_elevation = min_elevation.min(val);
            max_elevation = max_elevation.max(val);
        }
    }
    
    let width = elevation_grid[0].len() as u32;
    let height = elevation_grid.len() as u32;
    
    let elevation_result = ElevationProcessingResult {
        elevation_grid: elevation_grid.clone(),
        grid_size: GridSize { width, height },
        min_elevation,
        max_elevation,
        processed_min_elevation: min_elevation,
        processed_max_elevation: max_elevation,
        cache_hit_rate: 1.0, // Not important for this function
    };
    
    // Create terrain geometry
    let result = generate_terrain_mesh(
        &elevation_result,
        params.vertical_exaggeration,
        params.terrain_base_height
    );
    
    // Convert result to JS
    let js_result = convert_terrain_geometry_to_js(result)?;
    
    Ok(js_result)
}

// The core function that generates the terrain mesh from elevation data
fn generate_terrain_mesh(
    elevation_data: &ElevationProcessingResult,
    vertical_exaggeration: f64,
    terrain_base_height: f64
) -> TerrainGeometryResult {
    let width = elevation_data.grid_size.width as usize;
    let height = elevation_data.grid_size.height as usize;
    
    // Initialize result arrays
    let mut positions: Vec<f32> = Vec::with_capacity(width * height * 6); // x,y,z for both top and bottom
    let mut colors: Vec<f32> = Vec::with_capacity(width * height * 6); // r,g,b for both top and bottom 
    let mut indices: Vec<u32> = Vec::new();
    let mut normals: Vec<f32> = Vec::with_capacity(width * height * 6);
    
    // Store processed elevation data
    let mut processed_elevation_grid: Vec<Vec<f64>> = vec![vec![0.0; width]; height];
    let mut processed_min_elevation = f64::INFINITY;
    let mut processed_max_elevation = f64::NEG_INFINITY;
    
    // Generate top vertices (terrain surface)
    let mut top_positions: Vec<f32> = Vec::with_capacity(width * height * 3);
    let mut bottom_positions: Vec<f32> = Vec::with_capacity(width * height * 3);
    
    // Generate top vertices (terrain)
    for y in 0..height {
        for x in 0..width {
            // Convert grid position to mesh coordinates
            let mesh_x = (x as f32 / (width - 1) as f32 - 0.5) * 200.0;
            let mesh_y = (y as f32 / (height - 1) as f32 - 0.5) * 200.0;
            
            // Calculate normalized elevation value
            let normalized_z = (elevation_data.elevation_grid[y][x] - elevation_data.min_elevation) /
                               f64::max(1.0, elevation_data.max_elevation - elevation_data.min_elevation);
            
            // Apply vertical exaggeration and base height
            let mesh_z = (terrain_base_height + normalized_z * (200.0 * 0.2) * vertical_exaggeration) as f32;
            
            // Track processed elevation ranges
            processed_min_elevation = f64::min(processed_min_elevation, mesh_z as f64);
            processed_max_elevation = f64::max(processed_max_elevation, mesh_z as f64);
            
            // Store processed elevation
            processed_elevation_grid[y][x] = mesh_z as f64;
            
            // Store top vertex position
            top_positions.push(mesh_x);
            top_positions.push(mesh_y);
            top_positions.push(mesh_z);
            
            // Store bottom vertex position (flat at z=0)
            bottom_positions.push(mesh_x);
            bottom_positions.push(mesh_y);
            bottom_positions.push(0.0);
            
            // Calculate terrain color (similar to JavaScript implementation)
            // Light brown to dark brown gradient based on height
            let light_brown = [0.82, 0.71, 0.55]; // rgb for #d2b48c
            let dark_brown = [0.66, 0.48, 0.30];  // rgb for #a87b4d
            
            let normalized_z_f32 = normalized_z as f32;
            let r = light_brown[0] * (1.0 - normalized_z_f32) + dark_brown[0] * normalized_z_f32;
            let g = light_brown[1] * (1.0 - normalized_z_f32) + dark_brown[1] * normalized_z_f32;
            let b = light_brown[2] * (1.0 - normalized_z_f32) + dark_brown[2] * normalized_z_f32;
            
            // Add color for top vertex
            colors.push(r);
            colors.push(g);
            colors.push(b);
            
            // Add color for bottom vertex (same as top)
            colors.push(r);
            colors.push(g);
            colors.push(b);
        }
    }
    
    // Combine top and bottom vertices into one array
    positions.extend_from_slice(&top_positions);
    positions.extend_from_slice(&bottom_positions);
    
    // Bottom surface starts at this offset
    let bottom_offset = (width * height) as u32;
    
    // Build top surface indices (triangles)
    for y in 0..(height - 1) {
        for x in 0..(width - 1) {
            let tl = (y * width + x) as u32;
            let tr = tl + 1;
            let bl = tl + width as u32;
            let br = bl + 1;
            
            // Two triangles per grid cell for the top
            indices.push(tl);
            indices.push(tr);
            indices.push(bl);
            
            indices.push(bl);
            indices.push(tr);
            indices.push(br);
        }
    }
    
    // Build bottom surface indices (triangles with opposite winding)
    for y in 0..(height - 1) {
        for x in 0..(width - 1) {
            let tl = bottom_offset + (y * width + x) as u32;
            let tr = tl + 1;
            let bl = tl + width as u32;
            let br = bl + 1;
            
            // Two triangles per grid cell for the bottom (reversed winding)
            indices.push(tl);
            indices.push(bl);
            indices.push(tr);
            
            indices.push(tr);
            indices.push(bl);
            indices.push(br);
        }
    }
    
    // Build side walls - right edge
    for y in 0..(height - 1) {
        let top_idx_top = (y * width + (width - 1)) as u32;
        let bottom_idx_top = bottom_offset + top_idx_top;
        let top_idx_bot = ((y + 1) * width + (width - 1)) as u32;
        let bottom_idx_bot = bottom_offset + top_idx_bot;
        
        // Two triangles for the side wall
        indices.push(top_idx_top);
        indices.push(bottom_idx_top);
        indices.push(bottom_idx_bot);
        
        indices.push(top_idx_top);
        indices.push(bottom_idx_bot);
        indices.push(top_idx_bot);
    }
    
    // Build side walls - left edge
    for y in 0..(height - 1) {
        let left_top_idx = (y * width) as u32;
        let left_bottom_idx = bottom_offset + left_top_idx;
        let left_top_next = ((y + 1) * width) as u32;
        let left_bottom_next = bottom_offset + left_top_next;
        
        // Two triangles for the side wall
        indices.push(left_top_idx);
        indices.push(left_bottom_next);
        indices.push(left_bottom_idx);
        
        indices.push(left_top_idx);
        indices.push(left_top_next);
        indices.push(left_bottom_next);
    }
    
    // Build side walls - top edge
    for x in 0..(width - 1) {
        let top_edge_idx = x as u32;
        let bottom_edge_idx = bottom_offset + top_edge_idx;
        let top_edge_next = (x + 1) as u32;
        let bottom_edge_next = bottom_offset + top_edge_next;
        
        // Two triangles for the side wall
        indices.push(top_edge_idx);
        indices.push(bottom_edge_idx);
        indices.push(bottom_edge_next);
        
        indices.push(top_edge_idx);
        indices.push(bottom_edge_next);
        indices.push(top_edge_next);
    }
    
    // Build side walls - bottom edge
    for x in 0..(width - 1) {
        let top_idx_top = ((height - 1) * width + x) as u32;
        let bottom_idx_top = bottom_offset + top_idx_top;
        let top_idx_bot = top_idx_top + 1;
        let bottom_idx_bot = bottom_offset + top_idx_bot;
        
        // Two triangles for the side wall
        indices.push(top_idx_top);
        indices.push(bottom_idx_bot);
        indices.push(bottom_idx_top);
        
        indices.push(top_idx_top);
        indices.push(top_idx_bot);
        indices.push(bottom_idx_bot);
    }
    
    // Calculate normals (simplified approach)
    // For each vertex, we should average the normals of adjacent triangles
    // For this example, we'll use a simplified approach with up-facing for top, down-facing for bottom
    for _ in 0..(width * height) {
        // Top vertices face up
        normals.push(0.0);
        normals.push(0.0);
        normals.push(1.0);
    }
    
    for _ in 0..(width * height) {
        // Bottom vertices face down
        normals.push(0.0);
        normals.push(0.0);
        normals.push(-1.0);
    }
    
    // Return the result
    TerrainGeometryResult {
        positions,
        indices,
        colors,
        normals,
        processed_elevation_grid,
        processed_min_elevation,
        processed_max_elevation,
    }
}

// Helper function to convert our Rust terrain geometry to JavaScript-friendly objects
fn convert_terrain_geometry_to_js(result: TerrainGeometryResult) -> Result<JsValue, JsValue> {
    // Create TypedArrays for the geometry data
    let positions_array = Float32Array::new_with_length(result.positions.len() as u32);
    positions_array.copy_from(&result.positions);
    
    let indices_array = Uint32Array::new_with_length(result.indices.len() as u32);
    indices_array.copy_from(&result.indices);
    
    let colors_array = Float32Array::new_with_length(result.colors.len() as u32);
    colors_array.copy_from(&result.colors);
    
    let normals_array = Float32Array::new_with_length(result.normals.len() as u32);
    normals_array.copy_from(&result.normals);
    
    // Create a JavaScript object to return
    let js_obj = Object::new();
    
    // Set the geometry attributes
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("positions"), &positions_array)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("indices"), &indices_array)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("colors"), &colors_array)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("normals"), &normals_array)?;
    
    // Convert processed elevation grid to JS
    let processed_grid = serde_wasm_bindgen::to_value(&result.processed_elevation_grid)?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("processedElevationGrid"), &processed_grid)?;
    
    // Set min/max elevation values
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("processedMinElevation"), &JsValue::from_f64(result.processed_min_elevation))?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("processedMaxElevation"), &JsValue::from_f64(result.processed_max_elevation))?;
    
    Ok(js_obj.into())
}
