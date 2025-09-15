// Terrain geometry generation module with sequential processing for WASM compatibility
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use js_sys::{Float32Array, Uint32Array, Object};
// Sequential processing for WASM compatibility

use crate::module_state::{ModuleState};
use crate::elevation::ElevationProcessingResult;

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
    pub original_min_elevation: f64,
    pub original_max_elevation: f64,
}

// Generate triangle indices for 3D terrain box (top, bottom, and side surfaces)
fn generate_terrain_indices(indices: &mut Vec<u32>, width: usize, height: usize) {
    // Each vertex position has 2 vertices: top (even index) and bottom (odd index)
    // Vertex at (x,y) has top vertex at index (y*width+x)*2 and bottom at (y*width+x)*2+1

    // Generate top surface triangles (counter-clockwise winding for upward normals)
    for y in 0..(height - 1) {
        for x in 0..(width - 1) {
            let top_left = ((y * width + x) * 2) as u32;
            let top_right = ((y * width + x + 1) * 2) as u32;
            let bottom_left = (((y + 1) * width + x) * 2) as u32;
            let bottom_right = (((y + 1) * width + x + 1) * 2) as u32;

            // Triangle 1: counter-clockwise for outward normal
            indices.extend_from_slice(&[top_left, bottom_left, bottom_right]);
            // Triangle 2: counter-clockwise for outward normal
            indices.extend_from_slice(&[top_left, bottom_right, top_right]);
        }
    }

    // Generate bottom surface triangles (clockwise winding for downward-facing normals)
    for y in 0..(height - 1) {
        for x in 0..(width - 1) {
            let top_left = ((y * width + x) * 2 + 1) as u32; // bottom vertex
            let top_right = ((y * width + x + 1) * 2 + 1) as u32; // bottom vertex
            let bottom_left = (((y + 1) * width + x) * 2 + 1) as u32; // bottom vertex
            let bottom_right = (((y + 1) * width + x + 1) * 2 + 1) as u32; // bottom vertex

            // Triangle 1: clockwise winding for downward-facing normals
            indices.extend_from_slice(&[top_left, bottom_left, bottom_right]);
            // Triangle 2: clockwise winding for downward-facing normals
            indices.extend_from_slice(&[top_left, bottom_right, top_right]);
        }
    }

    // Generate side wall triangles
    generate_terrain_side_walls(indices, width, height);
}

// Generate side wall triangles for the terrain box
fn generate_terrain_side_walls(indices: &mut Vec<u32>, width: usize, height: usize) {
    // Left wall (x = 0) - flip winding for outward-facing normals
    for y in 0..(height - 1) {
        let curr_top = ((y * width) * 2) as u32;
        let curr_bottom = ((y * width) * 2 + 1) as u32;
        let next_top = (((y + 1) * width) * 2) as u32;
        let next_bottom = (((y + 1) * width) * 2 + 1) as u32;

        // Flipped winding for outward normal
        indices.extend_from_slice(&[curr_top, next_bottom, curr_bottom]);
        indices.extend_from_slice(&[curr_top, next_top, next_bottom]);
    }

    // Right wall (x = width - 1) - flip winding for outward-facing normals
    for y in 0..(height - 1) {
        let curr_top = ((y * width + width - 1) * 2) as u32;
        let curr_bottom = ((y * width + width - 1) * 2 + 1) as u32;
        let next_top = (((y + 1) * width + width - 1) * 2) as u32;
        let next_bottom = (((y + 1) * width + width - 1) * 2 + 1) as u32;

        // Flipped winding for outward normal
        indices.extend_from_slice(&[curr_top, curr_bottom, next_bottom]);
        indices.extend_from_slice(&[curr_top, next_bottom, next_top]);
    }

    // Front wall (y = 0) - flip winding for outward-facing normals
    for x in 0..(width - 1) {
        let curr_top = (x * 2) as u32;
        let curr_bottom = (x * 2 + 1) as u32;
        let next_top = ((x + 1) * 2) as u32;
        let next_bottom = ((x + 1) * 2 + 1) as u32;

        // Flipped winding for outward normal
        indices.extend_from_slice(&[curr_top, curr_bottom, next_bottom]);
        indices.extend_from_slice(&[curr_top, next_bottom, next_top]);
    }

    // Back wall (y = height - 1) - flip winding for outward-facing normals
    for x in 0..(width - 1) {
        let curr_top = (((height - 1) * width + x) * 2) as u32;
        let curr_bottom = (((height - 1) * width + x) * 2 + 1) as u32;
        let next_top = (((height - 1) * width + x + 1) * 2) as u32;
        let next_bottom = (((height - 1) * width + x + 1) * 2 + 1) as u32;

        // Flipped winding for outward normal
        indices.extend_from_slice(&[curr_top, next_bottom, curr_bottom]);
        indices.extend_from_slice(&[curr_top, next_top, next_bottom]);
    }
}


// Generate normals for 3D terrain box vertices
fn generate_terrain_normals(normals: &mut Vec<f32>, positions: &[f32], width: usize, height: usize) {
    let vertex_count = width * height * 2; // top and bottom vertices
    normals.reserve(vertex_count * 3);

    // Generate normals for all vertices (top and bottom)
    for y in 0..height {
        for x in 0..width {
            // Calculate normal for top surface vertex
            let top_normal = if x < width - 1 && y < height - 1 {
                calculate_terrain_vertex_normal(positions, x, y, width, true) // true = top vertex
            } else {
                [0.0, 0.0, 1.0] // Default up-facing normal for edge vertices
            };

            // Calculate normal for bottom surface vertex (always pointing down)
            let bottom_normal = [0.0, 0.0, -1.0]; // Always down-facing for bottom

            // Add normals for top and bottom vertices
            normals.extend_from_slice(&top_normal);
            normals.extend_from_slice(&bottom_normal);
        }
    }
}

// Calculate vertex normal for terrain box structure using cross product of adjacent edges
fn calculate_terrain_vertex_normal(positions: &[f32], x: usize, y: usize, width: usize, is_top: bool) -> [f32; 3] {
    // Each vertex position has 2 vertices: top (even index) and bottom (odd index)
    // Vertex at (x,y) has top vertex at index (y*width+x)*2*3 and bottom at (y*width+x)*2*3+3
    let vertex_offset = if is_top { 0 } else { 3 }; // 3 floats per vertex (x,y,z)
    let idx = ((y * width + x) * 2) * 3 + vertex_offset;
    let right_idx = ((y * width + x + 1) * 2) * 3 + vertex_offset;
    let down_idx = (((y + 1) * width + x) * 2) * 3 + vertex_offset;
    
    // Get vertex positions
    let v = [positions[idx], positions[idx + 1], positions[idx + 2]];
    let vr = [positions[right_idx], positions[right_idx + 1], positions[right_idx + 2]];
    let vd = [positions[down_idx], positions[down_idx + 1], positions[down_idx + 2]];
    
    // Calculate edges
    let edge_right = [vr[0] - v[0], vr[1] - v[1], vr[2] - v[2]];
    let edge_down = [vd[0] - v[0], vd[1] - v[1], vd[2] - v[2]];
    
    // Calculate cross product (normal) - using edge_down × edge_right for correct orientation
    let normal = [
        edge_down[1] * edge_right[2] - edge_down[2] * edge_right[1],
        edge_down[2] * edge_right[0] - edge_down[0] * edge_right[2],
        edge_down[0] * edge_right[1] - edge_down[1] * edge_right[0],
    ];
    
    // Normalize
    let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
    if length > 0.0 {
        [normal[0] / length, normal[1] / length, normal[2] / length]
    } else {
        if is_top { [0.0, 0.0, 1.0] } else { [0.0, 0.0, -1.0] }
    }
}

// Function to smooth the elevation grid using a gaussian kernel with optimized processing
fn smooth_elevation_grid(grid: Vec<Vec<f64>>, width: usize, height: usize) -> Vec<Vec<f64>> {
    let kernel_size = 3;
    let kernel_radius = kernel_size / 2;
    let sigma = 0.8;
    
    // Precompute gaussian weights for optimization (flattened for better cache performance)
    let mut kernel_weights = vec![0.0; kernel_size * kernel_size];
    let mut weight_sum = 0.0;
    
    for ky in 0..kernel_size {
        for kx in 0..kernel_size {
            let dx = (kx as isize - kernel_radius as isize) as f64;
            let dy = (ky as isize - kernel_radius as isize) as f64;
            let dist_sq = dx * dx + dy * dy;
            let weight = (-dist_sq / (2.0 * sigma * sigma)).exp();
            kernel_weights[ky * kernel_size + kx] = weight;
            weight_sum += weight;
        }
    }
    
    // Normalize weights
    for weight in &mut kernel_weights {
        *weight /= weight_sum;
    }
    
    // Process grid in chunks for better cache locality and potential parallelization
    let mut result = vec![vec![0.0; width]; height];
    let chunk_size = 32; // Process in 32x32 chunks for better cache performance
    
    for chunk_y in (0..height).step_by(chunk_size) {
        let end_y = (chunk_y + chunk_size).min(height);
        
        for chunk_x in (0..width).step_by(chunk_size) {
            let end_x = (chunk_x + chunk_size).min(width);
            
            // Process chunk
            for y in chunk_y..end_y {
                for x in chunk_x..end_x {
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
                            
                            let weight = kernel_weights[ky * kernel_size + kx];
                            weighted_sum += grid[grid_y as usize][grid_x as usize] * weight;
                            total_weight += weight;
                        }
                    }
                    
                    // Normalize by the actual weights used (for edge pixels)
                    result[y][x] = if total_weight > 0.0 {
                        weighted_sum / total_weight
                    } else {
                        grid[y][x] // Fall back to original value
                    };
                }
            }
        }
    }
    
    result
}

// Function to remove outliers from the elevation data with optimized processing
fn remove_outliers(grid: Vec<Vec<f64>>, min_elevation: f64, max_elevation: f64) -> (Vec<Vec<f64>>, f64, f64) {
    let width = grid[0].len();
    let height = grid.len();
    
    // Use a more efficient percentile-based approach instead of standard deviation
    // Collect all valid values for percentile calculation
    let mut all_values: Vec<f64> = Vec::with_capacity(width * height);
    for row in &grid {
        for &val in row {
            if val.is_finite() {
                all_values.push(val);
            }
        }
    }
    
    if all_values.is_empty() {
        return (grid, min_elevation, max_elevation);
    }
    
    // Sort for percentile calculation (using unstable sort for better performance)
    all_values.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    
    let len = all_values.len();
    
    // Use 5th and 95th percentiles for more robust outlier detection
    let lower_threshold = all_values[(len as f64 * 0.05) as usize];
    let upper_threshold = all_values[(len as f64 * 0.95) as usize];
    
    // Apply clipping with optimized memory allocation
    let mut result = Vec::with_capacity(height);
    for row in &grid {
        let processed_row: Vec<f64> = row.iter()
            .map(|&val| {
                if val.is_finite() {
                    val.clamp(lower_threshold, upper_threshold)
                } else {
                    (min_elevation + max_elevation) / 2.0 // Replace invalid values
                }
            })
            .collect();
        result.push(processed_row);
    }
    
    // Apply a single smoothing pass after outlier removal to blend clamped values
    let final_result = smooth_elevation_grid(result, width, height);
    
    // Find min/max in a single optimized pass
    let (final_min, final_max) = final_result.iter()
        .flat_map(|row| row.iter())
        .filter(|val| val.is_finite())
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), &val| {
            (min.min(val), max.max(val))
        });
    
    (final_result, final_min, final_max)
}

// Main function to create terrain geometry from elevation data with retry mechanism
#[wasm_bindgen]
pub async fn create_terrain_geometry(params_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse parameters
    let params: TerrainGeometryParams = serde_wasm_bindgen::from_value(params_js)?;
    
    
    
    
    // Get module state to access cached elevation data
    let state = ModuleState::global();
    let state = state.lock().unwrap();
    
    
    
    // List all keys in cache for debugging
    let _keys: Vec<String> = state.elevation_grids.keys().cloned().collect();
    
    
    // Create the bbox_key format - this is the same format used in elevation.rs
    let bbox_key = format!("{}_{}_{}_{}", params.min_lng, params.min_lat, params.max_lng, params.max_lat);
    let _has_bbox_key = state.elevation_grids.contains_key(&bbox_key);
    
    
    
    
    // Get elevation data with retry mechanism
    let elevation_grid = {
        // First try to get existing elevation data
        if let Some(grid) = state.get_elevation_grid(&bbox_key) {
            grid.clone()
        } else {
            
            // Release the lock before async operations
            drop(state);
            
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
                    bbox_key: Some(bbox_key.clone()),
                };
                
                // Serialize input
                match serde_json::to_string(&elevation_input) {
                    Ok(input_json) => {
                        // Attempt to process elevation data
                        match crate::elevation::process_elevation_data_async(&input_json).await {
                            Ok(_) => {
                                
                                // Check if we now have the data
                                let state = ModuleState::global();
                                let state = state.lock().unwrap();
                                if let Some(grid) = state.get_elevation_grid(&bbox_key) {
                                    elevation_grid = Some(grid.clone());
                                    break;
                                }
                            },
                            Err(_e) => {
                                
                                if attempt < max_retries {
                                    // Exponential backoff: wait 500ms * 2^(attempt-1)
                                    let _delay_ms = 500 * (1 << (attempt - 1));
                                    
                                    // Simple delay - just log the delay for now
                                    // In a real implementation, you might want to add actual delay
                                }
                            }
                        }
                    },
                    Err(_e) => {
                        break;
                    }
                }
            }
            
            match elevation_grid {
                Some(grid) => {
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

// The core function that generates the terrain mesh from elevation data with optimized performance
fn generate_terrain_mesh(
    elevation_data: &ElevationProcessingResult,
    vertical_exaggeration: f64,
    terrain_base_height: f64
) -> TerrainGeometryResult {
    let width = elevation_data.grid_size.width as usize;
    let height = elevation_data.grid_size.height as usize;
    
    // Pre-calculate array sizes for optimal memory allocation  
    let vertex_count = width * height * 2; // top and bottom vertices for 3D terrain box
    let surface_triangle_count = (width - 1) * (height - 1) * 2; // 2 triangles per quad for top surface
    let bottom_triangle_count = (width - 1) * (height - 1) * 2; // 2 triangles per quad for bottom surface
    let side_triangle_count = 2 * ((width - 1) + (height - 1)) * 2; // side walls
    let total_triangle_count = surface_triangle_count + bottom_triangle_count + side_triangle_count;
    
    // Initialize result arrays with precise capacity
    let mut positions: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    let mut colors: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    let mut indices: Vec<u32> = Vec::with_capacity(total_triangle_count * 3);
    let mut normals: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    
    // Store processed elevation data
    let mut processed_elevation_grid: Vec<Vec<f64>> = Vec::with_capacity(height);
    let mut processed_min_elevation = f64::INFINITY;
    let mut processed_max_elevation = f64::NEG_INFINITY;
    
    // Pre-calculate constants to avoid repeated calculations
    let elevation_range = f64::max(1.0, elevation_data.max_elevation - elevation_data.min_elevation);
    let light_brown = [0.82f32, 0.71f32, 0.55f32]; // rgb for #d2b48c
    let dark_brown = [0.66f32, 0.48f32, 0.30f32];  // rgb for #a87b4d
    let terrain_base_height_f32 = terrain_base_height as f32;
    
    // Generate vertices for 3D terrain box (top and bottom surfaces)
    for y in 0..height {
        let mesh_y = (y as f32 / (height - 1) as f32 - 0.5) * 200.0;
        let mut row_elevation = Vec::with_capacity(width);
        
        for x in 0..width {
            let mesh_x = (x as f32 / (width - 1) as f32 - 0.5) * 200.0;
            
            // Get elevation data and apply vertical exaggeration with proper scaling
            let elevation = elevation_data.elevation_grid[y][x];

            // Handle invalid elevation data by using terrain base height as fallback
            let safe_elevation = if elevation.is_finite() {
                elevation
            } else {
                terrain_base_height
            };

            let normalized_elevation = (safe_elevation - elevation_data.min_elevation) / elevation_range;

            // Scale the elevation properly: terrain extends from 0 to terrain_base_height + elevation variation
            // The terrain base height defines the base terrain box height (no magic numbers)
            let elevation_variation = normalized_elevation * vertical_exaggeration; // Direct application of user setting
            let top_z = terrain_base_height_f32 + elevation_variation as f32;

            // Track processed elevation
            row_elevation.push(safe_elevation);

            // Update min/max with actual processed terrain heights
            let bottom_z = terrain_base_height; // Bottom of terrain box
            processed_min_elevation = processed_min_elevation.min(bottom_z);

            // Ensure top_z is finite before using it
            if (top_z as f64).is_finite() {
                processed_max_elevation = processed_max_elevation.max(top_z as f64);
            }
            
            // Top surface vertex (DEM-based height)
            positions.push(mesh_x);
            positions.push(mesh_y);
            positions.push(top_z);
            
            // Bottom surface vertex (at Z=0, terrain base is the height from 0)
            positions.push(mesh_x);
            positions.push(mesh_y);
            positions.push(0.0);
            
            // Calculate terrain color based on elevation
            let normalized_z_f32 = normalized_elevation as f32;
            let inv_norm = 1.0 - normalized_z_f32;
            let r = light_brown[0] * inv_norm + dark_brown[0] * normalized_z_f32;
            let g = light_brown[1] * inv_norm + dark_brown[1] * normalized_z_f32;
            let b = light_brown[2] * inv_norm + dark_brown[2] * normalized_z_f32;
            
            // Add color for top vertex
            colors.extend_from_slice(&[r, g, b]);
            // Add color for bottom vertex (darker)
            colors.extend_from_slice(&[r * 0.6, g * 0.6, b * 0.6]);
        }
        processed_elevation_grid.push(row_elevation);
    }
    
    // Generate optimized triangle indices and normals
    generate_terrain_indices(&mut indices, width, height);
    generate_terrain_normals(&mut normals, &positions, width, height);

    // Ensure processed min/max elevation values are valid - use terrain_base_height as fallback
    if !processed_min_elevation.is_finite() || processed_min_elevation == f64::INFINITY {
        processed_min_elevation = terrain_base_height;
    }
    if !processed_max_elevation.is_finite() || processed_max_elevation == f64::NEG_INFINITY {
        processed_max_elevation = terrain_base_height;
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
        original_min_elevation: elevation_data.min_elevation,
        original_max_elevation: elevation_data.max_elevation,
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
    
    // Set processed min/max elevation values
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("processedMinElevation"), &JsValue::from_f64(result.processed_min_elevation))?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("processedMaxElevation"), &JsValue::from_f64(result.processed_max_elevation))?;

    // Set original min/max elevation values
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("originalMinElevation"), &JsValue::from_f64(result.original_min_elevation))?;
    js_sys::Reflect::set(&js_obj, &JsValue::from_str("originalMaxElevation"), &JsValue::from_f64(result.original_max_elevation))?;

    Ok(js_obj.into())
}
