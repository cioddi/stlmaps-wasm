// Terrain geometry generation module
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use js_sys::{Float32Array, Uint32Array, Array, Object};
use std::collections::HashMap;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen::closure::Closure;

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
    pub bbox_key: String,
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

// Function to smooth the elevation grid using a gaussian kernel
fn smooth_elevation_grid(grid: Vec<Vec<f64>>, width: usize, height: usize) -> Vec<Vec<f64>> {
    let mut result = vec![vec![0.0; width]; height];
    let kernel_size = 3; // Smaller 3x3 kernel for less smoothing (was 5)
    let kernel_radius = kernel_size / 2;
    let sigma = 0.8; // Reduced sigma for sharper falloff (was 1.0)
    
    
    
    // Precompute gaussian weights for optimization
    let mut kernel_weights = vec![vec![0.0; kernel_size]; kernel_size];
    let mut weight_sum = 0.0;
    
    for ky in 0..kernel_size {
        for kx in 0..kernel_size {
            let dx = (kx as isize - kernel_radius as isize) as f64;
            let dy = (ky as isize - kernel_radius as isize) as f64;
            let dist_sq = dx * dx + dy * dy;
            // Gaussian function: e^(-(d²/2σ²))
            let weight = (-dist_sq / (2.0 * sigma * sigma)).exp();
            kernel_weights[ky][kx] = weight;
            weight_sum += weight;
        }
    }
    
    // Normalize weights
    for ky in 0..kernel_size {
        for kx in 0..kernel_size {
            kernel_weights[ky][kx] /= weight_sum;
        }
    }
    
    // Apply the kernel to each grid cell
    for y in 0..height {
        for x in 0..width {
            let mut weighted_sum = 0.0;
            let mut total_weight = 0.0;
            
            for ky in 0..kernel_size {
                let grid_y = y as isize + (ky as isize - kernel_radius as isize);
                if grid_y < 0 || grid_y >= height as isize {
                    continue;
                }
                
                for kx in 0..kernel_size {
                    let grid_x = x as isize + (kx as isize - kernel_radius as isize);
                    if grid_x < 0 || grid_x >= width as isize {
                        continue;
                    }
                    
                    let weight = kernel_weights[ky][kx];
                    weighted_sum += grid[grid_y as usize][grid_x as usize] * weight;
                    total_weight += weight;
                }
            }
            
            // Normalize by the actual weights used (for edge pixels)
            if total_weight > 0.0 {
                result[y][x] = weighted_sum / total_weight;
            } else {
                // Fall back to original value if no valid neighbors (shouldn't happen)
                result[y][x] = grid[y][x];
            }
        }
    }
    
    result
}

// Function to remove outliers from the elevation data
fn remove_outliers(grid: Vec<Vec<f64>>, min_elevation: f64, max_elevation: f64) -> (Vec<Vec<f64>>, f64, f64) {
    let width = grid[0].len();
    let height = grid.len();
    let mut result = vec![vec![0.0; width]; height];
    
    // Calculate the range and derive reasonable thresholds
    let range = max_elevation - min_elevation;
    
    // Calculate mean and standard deviation
    let mut sum = 0.0;
    let mut count = 0;
    for row in &grid {
        for &val in row {
            if val.is_finite() {
                sum += val;
                count += 1;
            }
        }
    }
    
    let mean = if count > 0 { sum / count as f64 } else { (min_elevation + max_elevation) / 2.0 };
    
    // Calculate standard deviation
    let mut sum_sq_diff = 0.0;
    for row in &grid {
        for &val in row {
            if val.is_finite() {
                let diff = val - mean;
                sum_sq_diff += diff * diff;
            }
        }
    }
    
    let std_dev = if count > 0 { (sum_sq_diff / count as f64).sqrt() } else { range / 4.0 };
    
    // Set thresholds for clipping (mean ± 2.5 standard deviations)
    let lower_threshold = mean - 2.5 * std_dev;
    let upper_threshold = mean + 2.5 * std_dev;
    
    
    
    
    // Apply clipping
    let mut new_min = f64::INFINITY;
    let mut new_max = f64::NEG_INFINITY;
    
    for y in 0..height {
        for x in 0..width {
            let val = grid[y][x];
            // Clamp value to thresholds
            let clamped_val = val.max(lower_threshold).min(upper_threshold);
            result[y][x] = clamped_val;
            
            // Track new min/max
            if clamped_val.is_finite() {
                new_min = new_min.min(clamped_val);
                new_max = new_max.max(clamped_val);
            }
        }
    }
    
    // Apply a second smoothing pass after outlier removal to blend the clamped values
    let final_result = smooth_elevation_grid(result, width, height);
    
    // Recalculate min/max after the second smoothing
    let mut final_min = f64::INFINITY;
    let mut final_max = f64::NEG_INFINITY;
    
    for row in &final_result {
        for &val in row {
            if val.is_finite() {
                final_min = final_min.min(val);
                final_max = final_max.max(val);
            }
        }
    }
    
    (final_result, final_min, final_max)
}

// Main function to create terrain geometry from elevation data with retry mechanism
#[wasm_bindgen]
pub async fn create_terrain_geometry(params_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse parameters
    let params: TerrainGeometryParams = serde_wasm_bindgen::from_value(params_js)?;
    
    
    
    console_log!("🏔️ [Terrain] Terrain params: bbox=[{}, {}, {}, {}], vertical_exaggeration={}, base_height={}", 
                params.min_lng, params.min_lat, params.max_lng, params.max_lat, 
                params.vertical_exaggeration, params.terrain_base_height);
    
    // Get module state to access cached elevation data
    let state = ModuleState::global();
    let state = state.lock().unwrap();
    
    
    
    // List all keys in cache for debugging
    let keys: Vec<String> = state.elevation_grids.keys().cloned().collect();
    
    
    // Create the bbox_key format - this is the same format used in elevation.rs
    let bbox_key = format!("{}_{}_{}_{}", params.min_lng, params.min_lat, params.max_lng, params.max_lat);
    let has_bbox_key = state.elevation_grids.contains_key(&bbox_key);
    
    
    
    
    // Get elevation data with retry mechanism
    let elevation_grid = {
        // First try to get existing elevation data
        if let Some(grid) = state.get_elevation_grid(&bbox_key) {
            console_log!("🏔️ Found cached elevation data for bbox_key: {}", bbox_key);
            grid.clone()
        } else {
            console_log!("🔄 No cached elevation data found for bbox_key: {}, attempting retry...", bbox_key);
            
            // Release the lock before async operations
            drop(state);
            
            // Retry mechanism: attempt to process elevation data up to 4 times
            let max_retries = 4;
            let mut elevation_grid: Option<Vec<Vec<f64>>> = None;
            
            for attempt in 1..=max_retries {
                console_log!("🔄 Elevation data retry attempt {} of {}", attempt, max_retries);
                
                // Create elevation processing input
                let elevation_input = crate::elevation::ElevationProcessingInput {
                    min_lng: params.min_lng,
                    min_lat: params.min_lat,
                    max_lng: params.max_lng,
                    max_lat: params.max_lat,
                    tiles: Vec::new(), // Will be populated by the processing function
                    grid_width: 256,   // Standard grid size
                    grid_height: 256,  // Standard grid size
                    bbox_key: Some(bbox_key.clone()),
                };
                
                // Serialize input
                match serde_json::to_string(&elevation_input) {
                    Ok(input_json) => {
                        // Attempt to process elevation data
                        match crate::elevation::process_elevation_data_async(&input_json).await {
                            Ok(_) => {
                                console_log!("✅ Elevation processing succeeded on attempt {}", attempt);
                                
                                // Check if we now have the data
                                let state = ModuleState::global();
                                let state = state.lock().unwrap();
                                if let Some(grid) = state.get_elevation_grid(&bbox_key) {
                                    elevation_grid = Some(grid.clone());
                                    break;
                                }
                            },
                            Err(e) => {
                                console_log!("❌ Elevation processing failed on attempt {}: {:?}", attempt, e);
                                
                                if attempt < max_retries {
                                    // Exponential backoff: wait 500ms * 2^(attempt-1)
                                    let delay_ms = 500 * (1 << (attempt - 1));
                                    console_log!("⏳ Waiting {}ms before retry...", delay_ms);
                                    
                                    // Simple delay - just log the delay for now
                                    // In a real implementation, you might want to add actual delay
                                    console_log!("⏳ Retry delay would be {}ms", delay_ms);
                                }
                            }
                        }
                    },
                    Err(e) => {
                        console_log!("❌ Failed to serialize elevation input: {}", e);
                        break;
                    }
                }
            }
            
            match elevation_grid {
                Some(grid) => {
                    console_log!("✅ Successfully retrieved elevation data after retry");
                    grid
                },
                None => {
                    return Err(JsValue::from_str(&format!(
                        "❌ Failed to retrieve elevation data for bbox [{}, {}, {}, {}] after {} attempts. Check your internet connection or try adjusting the bounding box.",
                        params.min_lng, params.min_lat, params.max_lng, params.max_lat, max_retries
                    )));
                }
            }
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
    
    // Apply smoothing to reduce spikiness
    let smoothed_grid = smooth_elevation_grid(elevation_grid.clone(), width as usize, height as usize);
    
    // Remove extreme values by clamping outliers
    let (cleaned_grid, clean_min, clean_max) = remove_outliers(smoothed_grid, min_elevation, max_elevation);
    
    console_log!("Terrain smoothing applied: min:{:.2} -> {:.2}, max:{:.2} -> {:.2}", 
                min_elevation, clean_min, max_elevation, clean_max);
    
    let elevation_result = ElevationProcessingResult {
        elevation_grid: cleaned_grid,
        grid_size: GridSize { width, height },
        min_elevation: clean_min,
        max_elevation: clean_max,
        processed_min_elevation: clean_min,
        processed_max_elevation: clean_max,
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
