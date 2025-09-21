// Terrain geometry generation module with sequential processing for WASM compatibility
use js_sys::{Float32Array, Object, Uint32Array};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
// Sequential processing for WASM compatibility

use crate::elevation::ElevationProcessingResult;
use crate::module_state::ModuleState;
use crate::{csg_union, polygon_geometry::BufferGeometry};

#[derive(Serialize, Deserialize)]
pub struct TerrainGeometryParams {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64,
    pub max_lat: f64,
    pub vertical_exaggeration: f64,
    pub terrain_base_height: f64,
    pub process_id: String,
    #[serde(default)]
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

const TARGET_TERRAIN_RESOLUTION: usize = 64;
const MIN_TERRAIN_THICKNESS: f32 = 0.3; // Ensures top surface never collapses to the base plane
const LIGHT_BROWN: [f32; 3] = [0.82, 0.71, 0.55];
const DARK_BROWN: [f32; 3] = [0.66, 0.48, 0.30];
const BOTTOM_SHADE_FACTOR: f32 = 0.6;

fn generate_terrain_indices(indices: &mut Vec<u32>, width: usize, height: usize) {
    indices.clear();

    for y in 0..(height - 1) {
        for x in 0..(width - 1) {
            let top_left = ((y * width + x) * 2) as u32;
            let top_right = ((y * width + x + 1) * 2) as u32;
            let bottom_left = (((y + 1) * width + x) * 2) as u32;
            let bottom_right = (((y + 1) * width + x + 1) * 2) as u32;

            indices.extend_from_slice(&[top_left, bottom_left, top_right]);
            indices.extend_from_slice(&[top_right, bottom_left, bottom_right]);
        }
    }

    for y in 0..(height - 1) {
        for x in 0..(width - 1) {
            let top_left = ((y * width + x) * 2 + 1) as u32;
            let top_right = ((y * width + x + 1) * 2 + 1) as u32;
            let bottom_left = (((y + 1) * width + x) * 2 + 1) as u32;
            let bottom_right = (((y + 1) * width + x + 1) * 2 + 1) as u32;

            indices.extend_from_slice(&[top_left, bottom_right, bottom_left]);
            indices.extend_from_slice(&[top_left, top_right, bottom_right]);
        }
    }

    for y in 0..(height - 1) {
        let curr_top = ((y * width) * 2) as u32;
        let curr_bottom = ((y * width) * 2 + 1) as u32;
        let next_top = (((y + 1) * width) * 2) as u32;
        let next_bottom = (((y + 1) * width) * 2 + 1) as u32;

        indices.extend_from_slice(&[curr_top, curr_bottom, next_top]);
        indices.extend_from_slice(&[next_top, curr_bottom, next_bottom]);
    }

    for y in 0..(height - 1) {
        let curr_top = ((y * width + width - 1) * 2) as u32;
        let curr_bottom = ((y * width + width - 1) * 2 + 1) as u32;
        let next_top = (((y + 1) * width + width - 1) * 2) as u32;
        let next_bottom = (((y + 1) * width + width - 1) * 2 + 1) as u32;

        indices.extend_from_slice(&[curr_top, next_top, curr_bottom]);
        indices.extend_from_slice(&[next_top, next_bottom, curr_bottom]);
    }

    for x in 0..(width - 1) {
        let curr_top = (x * 2) as u32;
        let curr_bottom = (x * 2 + 1) as u32;
        let next_top = ((x + 1) * 2) as u32;
        let next_bottom = ((x + 1) * 2 + 1) as u32;

        indices.extend_from_slice(&[curr_top, next_top, curr_bottom]);
        indices.extend_from_slice(&[next_top, next_bottom, curr_bottom]);
    }

    for x in 0..(width - 1) {
        let curr_top = (((height - 1) * width + x) * 2) as u32;
        let curr_bottom = (((height - 1) * width + x) * 2 + 1) as u32;
        let next_top = (((height - 1) * width + x + 1) * 2) as u32;
        let next_bottom = (((height - 1) * width + x + 1) * 2 + 1) as u32;

        indices.extend_from_slice(&[curr_top, curr_bottom, next_top]);
        indices.extend_from_slice(&[next_top, curr_bottom, next_bottom]);
    }
}

fn generate_terrain_normals(normals: &mut Vec<f32>, positions: &[f32], indices: &[u32]) {
    normals.clear();
    normals.resize(positions.len(), 0.0);

    for triangle in indices.chunks_exact(3) {
        let i0 = triangle[0] as usize;
        let i1 = triangle[1] as usize;
        let i2 = triangle[2] as usize;

        let p0 = [
            positions[i0 * 3],
            positions[i0 * 3 + 1],
            positions[i0 * 3 + 2],
        ];
        let p1 = [
            positions[i1 * 3],
            positions[i1 * 3 + 1],
            positions[i1 * 3 + 2],
        ];
        let p2 = [
            positions[i2 * 3],
            positions[i2 * 3 + 1],
            positions[i2 * 3 + 2],
        ];

        let edge1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let edge2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

        let face_normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0],
        ];

        for &index in triangle {
            let offset = index as usize * 3;
            normals[offset] += face_normal[0];
            normals[offset + 1] += face_normal[1];
            normals[offset + 2] += face_normal[2];
        }
    }

    for (vertex_index, normal) in normals.chunks_mut(3).enumerate() {
        let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if length > f32::EPSILON {
            let inv = 1.0 / length;
            normal[0] *= inv;
            normal[1] *= inv;
            normal[2] *= inv;
        } else if vertex_index % 2 == 0 {
            normal[0] = 0.0;
            normal[1] = 0.0;
            normal[2] = 1.0;
        } else {
            normal[0] = 0.0;
            normal[1] = 0.0;
            normal[2] = -1.0;
        }
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
fn remove_outliers(
    grid: Vec<Vec<f64>>,
    min_elevation: f64,
    max_elevation: f64,
) -> (Vec<Vec<f64>>, f64, f64) {
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
        let processed_row: Vec<f64> = row
            .iter()
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
    let (final_min, final_max) = final_result
        .iter()
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

    if params.use_simple_mesh {
        let result = generate_simple_terrain_mesh(
            params.vertical_exaggeration,
            params.terrain_base_height,
        );
        let result = apply_csg_cleanup(result, params.vertical_exaggeration, params.terrain_base_height);
        let js_result = convert_terrain_geometry_to_js(result)?;
        return Ok(js_result);
    }

    // Get module state to access cached elevation data
    let (_keys, cached_grid, _has_process_elevation) = ModuleState::with(|state| {
        let keys = state.elevation_grids.keys().cloned().collect::<Vec<_>>();
        let has = state.elevation_grids.contains_key(&params.process_id);
        let cached = state.get_elevation_grid(&params.process_id).cloned();
        (keys, cached, has)
    });

    // Get elevation data with retry mechanism
    let elevation_grid = {
        // First try to get existing elevation data
        if let Some(grid) = cached_grid {
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
                                    let _delay_ms = 500 * (1 << (attempt - 1));

                                    // Simple delay - just log the delay for now
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

    // Get information from elevation module
    use crate::elevation::{ElevationProcessingResult, GridSize};

    // Create elevation result based on the cached grid
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
    let smoothed_grid =
        smooth_elevation_grid(elevation_grid.clone(), width as usize, height as usize);

    // Remove extreme values by clamping outliers
    let (cleaned_grid, clean_min, clean_max) =
        remove_outliers(smoothed_grid, min_elevation, max_elevation);

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
        params.terrain_base_height,
    );

    // Convert result to JS
    let js_result = convert_terrain_geometry_to_js(result)?;

    Ok(js_result)
}

fn generate_simple_terrain_mesh(
    vertical_exaggeration: f64,
    terrain_base_height: f64,
) -> TerrainGeometryResult {
    let width = 2usize;
    let height = 2usize;

    let terrain_base_height_f32 = terrain_base_height as f32;
    let base_bottom_z_f32 = 0.0f32;
    let top_z = (terrain_base_height_f32 + vertical_exaggeration as f32)
        .max(base_bottom_z_f32 + MIN_TERRAIN_THICKNESS);

    let mut positions: Vec<f32> = Vec::with_capacity(width * height * 2 * 3);
    let mut colors: Vec<f32> = Vec::with_capacity(width * height * 2 * 3);
    let mut processed_elevation_grid: Vec<Vec<f64>> = Vec::with_capacity(height);

    for y in 0..height {
        let mesh_y = (y as f32 / (height - 1) as f32 - 0.5) * 200.0;
        let mut row = Vec::with_capacity(width);

        for x in 0..width {
            let mesh_x = (x as f32 / (width - 1) as f32 - 0.5) * 200.0;

            row.push(top_z as f64);

            positions.push(mesh_x);
            positions.push(mesh_y);
            positions.push(top_z);
            colors.extend_from_slice(&DARK_BROWN);

            positions.push(mesh_x);
            positions.push(mesh_y);
            positions.push(base_bottom_z_f32);
            colors.extend_from_slice(&[
                DARK_BROWN[0] * BOTTOM_SHADE_FACTOR,
                DARK_BROWN[1] * BOTTOM_SHADE_FACTOR,
                DARK_BROWN[2] * BOTTOM_SHADE_FACTOR,
            ]);
        }

        processed_elevation_grid.push(row);
    }

    let mut indices: Vec<u32> = Vec::with_capacity(36);
    generate_terrain_indices(&mut indices, width, height);

    let mut normals: Vec<f32> = Vec::with_capacity(positions.len());
    generate_terrain_normals(&mut normals, &positions, &indices);

    TerrainGeometryResult {
        positions,
        indices,
        colors,
        normals,
        processed_elevation_grid,
        processed_min_elevation: base_bottom_z_f32 as f64,
        processed_max_elevation: top_z as f64,
        original_min_elevation: terrain_base_height,
        original_max_elevation: terrain_base_height,
    }
}

// The core function that generates the terrain mesh from elevation data with optimized performance
fn generate_terrain_mesh(
    elevation_data: &ElevationProcessingResult,
    vertical_exaggeration: f64,
    terrain_base_height: f64,
) -> TerrainGeometryResult {
    let source_width = elevation_data.grid_size.width as usize;
    let source_height = elevation_data.grid_size.height as usize;

    let target_width = source_width.min(TARGET_TERRAIN_RESOLUTION).max(2);
    let target_height = source_height.min(TARGET_TERRAIN_RESOLUTION).max(2);

    let elevation_range = f64::max(
        1.0,
        elevation_data.max_elevation - elevation_data.min_elevation,
    );
    let terrain_base_height_f32 = terrain_base_height as f32;
    let base_bottom_z_f32 = 0.0f32;

    let vertex_count = target_width * target_height * 2;
    let top_quad_count = (target_width - 1) * (target_height - 1);
    let bottom_quad_count = top_quad_count;
    let side_quad_count = 2 * ((target_width - 1) + (target_height - 1));
    let total_triangle_count = top_quad_count * 2 + bottom_quad_count * 2 + side_quad_count * 2;

    let mut positions: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    let mut colors: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    let mut indices: Vec<u32> = Vec::with_capacity(total_triangle_count * 3);
    let mut normals: Vec<f32> = Vec::with_capacity(vertex_count * 3);

    let mut processed_elevation_grid: Vec<Vec<f64>> = Vec::with_capacity(target_height);
    let mut processed_min_elevation = base_bottom_z_f32 as f64;
    let mut processed_max_elevation = f64::NEG_INFINITY;

    let max_source_x = if source_width > 0 {
        (source_width - 1) as f64
    } else {
        0.0
    };
    let max_source_y = if source_height > 0 {
        (source_height - 1) as f64
    } else {
        0.0
    };

    let sample_grid_value = |x: usize, y: usize| -> f64 {
        let value = elevation_data.elevation_grid[y][x];
        if value.is_finite() {
            value
        } else {
            terrain_base_height
        }
    };

    let sample_elevation = |src_x: f64, src_y: f64| -> f64 {
        let sx = if max_source_x > 0.0 {
            src_x.clamp(0.0, max_source_x)
        } else {
            0.0
        };
        let sy = if max_source_y > 0.0 {
            src_y.clamp(0.0, max_source_y)
        } else {
            0.0
        };

        let x0 = sx.floor() as usize;
        let y0 = sy.floor() as usize;
        let x1 = if source_width > 1 {
            (x0 + 1).min(source_width - 1)
        } else {
            x0
        };
        let y1 = if source_height > 1 {
            (y0 + 1).min(source_height - 1)
        } else {
            y0
        };

        let dx = sx - x0 as f64;
        let dy = sy - y0 as f64;

        let v00 = sample_grid_value(x0, y0);
        let v10 = sample_grid_value(x1, y0);
        let v01 = sample_grid_value(x0, y1);
        let v11 = sample_grid_value(x1, y1);

        let v0 = v00 * (1.0 - dx) + v10 * dx;
        let v1 = v01 * (1.0 - dx) + v11 * dx;

        v0 * (1.0 - dy) + v1 * dy
    };

    for y in 0..target_height {
        let normalized_y = if target_height > 1 {
            y as f64 / (target_height - 1) as f64
        } else {
            0.0
        };
        let source_y = normalized_y * max_source_y;
        let mesh_y = (normalized_y as f32 - 0.5) * 200.0;

        let mut row_elevation = Vec::with_capacity(target_width);

        for x in 0..target_width {
            let normalized_x = if target_width > 1 {
                x as f64 / (target_width - 1) as f64
            } else {
                0.0
            };
            let source_x = normalized_x * max_source_x;
            let mesh_x = (normalized_x as f32 - 0.5) * 200.0;

            let safe_elevation = sample_elevation(source_x, source_y);
            let normalized_elevation =
                ((safe_elevation - elevation_data.min_elevation) / elevation_range).clamp(0.0, 1.0);
            let elevation_variation = (normalized_elevation * vertical_exaggeration) as f32;
            let mut top_z = terrain_base_height_f32 + elevation_variation;
            if top_z - base_bottom_z_f32 < MIN_TERRAIN_THICKNESS {
                top_z = base_bottom_z_f32 + MIN_TERRAIN_THICKNESS;
            }

            row_elevation.push(safe_elevation);

            if (top_z as f64).is_finite() {
                processed_max_elevation = processed_max_elevation.max(top_z as f64);
            }

            let normalized_z_f32 = normalized_elevation as f32;
            let inv_norm = 1.0 - normalized_z_f32;
            let r = LIGHT_BROWN[0] * inv_norm + DARK_BROWN[0] * normalized_z_f32;
            let g = LIGHT_BROWN[1] * inv_norm + DARK_BROWN[1] * normalized_z_f32;
            let b = LIGHT_BROWN[2] * inv_norm + DARK_BROWN[2] * normalized_z_f32;

            positions.push(mesh_x);
            positions.push(mesh_y);
            positions.push(top_z);
            colors.extend_from_slice(&[r, g, b]);

            positions.push(mesh_x);
            positions.push(mesh_y);
            positions.push(base_bottom_z_f32);
            colors.extend_from_slice(&[
                r * BOTTOM_SHADE_FACTOR,
                g * BOTTOM_SHADE_FACTOR,
                b * BOTTOM_SHADE_FACTOR,
            ]);
        }

        processed_elevation_grid.push(row_elevation);
    }

    generate_terrain_indices(&mut indices, target_width, target_height);
    generate_terrain_normals(&mut normals, &positions, &indices);

    if !processed_min_elevation.is_finite() || processed_min_elevation == f64::INFINITY {
        processed_min_elevation = base_bottom_z_f32 as f64;
    }
    if !processed_max_elevation.is_finite() || processed_max_elevation == f64::NEG_INFINITY {
        processed_max_elevation = (base_bottom_z_f32 + MIN_TERRAIN_THICKNESS) as f64;
    }

    let result = TerrainGeometryResult {
        positions,
        indices,
        colors,
        normals,
        processed_elevation_grid,
        processed_min_elevation,
        processed_max_elevation,
        original_min_elevation: elevation_data.min_elevation,
        original_max_elevation: elevation_data.max_elevation,
    };

    apply_csg_cleanup(result, vertical_exaggeration, terrain_base_height)
}

fn apply_csg_cleanup(
    result: TerrainGeometryResult,
    vertical_exaggeration: f64,
    terrain_base_height: f64,
) -> TerrainGeometryResult {
    if result.positions.is_empty() {
        return result;
    }

    let buffer_geometry = BufferGeometry {
        vertices: result.positions.clone(),
        normals: Some(result.normals.clone()),
        colors: if result.colors.is_empty() {
            None
        } else {
            Some(result.colors.clone())
        },
        indices: if result.indices.is_empty() {
            None
        } else {
            Some(result.indices.clone())
        },
        uvs: None,
        has_data: true,
        properties: None,
    };

    let cleaned = csg_union::rebuild_single_geometry(buffer_geometry);
    if !cleaned.has_data || cleaned.vertices.len() < 9 {
        return result;
    }

    let positions = cleaned.vertices;
    let indices = cleaned
        .indices
        .unwrap_or_else(|| (0..(positions.len() / 3) as u32).collect());

    let normals = cleaned
        .normals
        .unwrap_or_else(|| generate_normals_from_indices(&positions, &indices));

    let colors = if let Some(existing_colors) = cleaned.colors {
        if !existing_colors.is_empty() {
            existing_colors
        } else {
            compute_vertex_colors(&positions, vertical_exaggeration, terrain_base_height)
        }
    } else {
        compute_vertex_colors(&positions, vertical_exaggeration, terrain_base_height)
    };

    TerrainGeometryResult {
        positions,
        indices,
        colors,
        normals,
        processed_elevation_grid: result.processed_elevation_grid,
        processed_min_elevation: result.processed_min_elevation,
        processed_max_elevation: result.processed_max_elevation,
        original_min_elevation: result.original_min_elevation,
        original_max_elevation: result.original_max_elevation,
    }
}

fn generate_normals_from_indices(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let mut normals = vec![0.0f32; positions.len()];

    for triangle in indices.chunks_exact(3) {
        let i0 = triangle[0] as usize;
        let i1 = triangle[1] as usize;
        let i2 = triangle[2] as usize;

        let p0 = [
            positions[i0 * 3],
            positions[i0 * 3 + 1],
            positions[i0 * 3 + 2],
        ];
        let p1 = [
            positions[i1 * 3],
            positions[i1 * 3 + 1],
            positions[i1 * 3 + 2],
        ];
        let p2 = [
            positions[i2 * 3],
            positions[i2 * 3 + 1],
            positions[i2 * 3 + 2],
        ];

        let edge1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let edge2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

        let face_normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0],
        ];

        for &index in triangle {
            let offset = index as usize * 3;
            normals[offset] += face_normal[0];
            normals[offset + 1] += face_normal[1];
            normals[offset + 2] += face_normal[2];
        }
    }

    for normal in normals.chunks_mut(3) {
        let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if length > f32::EPSILON {
            let inv = 1.0 / length;
            normal[0] *= inv;
            normal[1] *= inv;
            normal[2] *= inv;
        } else {
            normal[0] = 0.0;
            normal[1] = 0.0;
            normal[2] = 1.0;
        }
    }

    normals
}

fn compute_vertex_colors(
    positions: &[f32],
    vertical_exaggeration: f64,
    terrain_base_height: f64,
) -> Vec<f32> {
    let mut colors = Vec::with_capacity(positions.len());
    let base_bottom_z = 0.0f32;
    let terrain_base_height_f32 = terrain_base_height as f32;
    let exaggeration = vertical_exaggeration.max(1e-6) as f32;

    for vertex in positions.chunks_exact(3) {
        let z = vertex[2];
        let normalized = ((z - terrain_base_height_f32) / exaggeration).clamp(0.0, 1.0);
        let inv = 1.0 - normalized;
        let r = LIGHT_BROWN[0] * inv + DARK_BROWN[0] * normalized;
        let g = LIGHT_BROWN[1] * inv + DARK_BROWN[1] * normalized;
        let b = LIGHT_BROWN[2] * inv + DARK_BROWN[2] * normalized;

        if (z - base_bottom_z).abs() <= 1e-3 {
            colors.extend_from_slice(&[
                r * BOTTOM_SHADE_FACTOR,
                g * BOTTOM_SHADE_FACTOR,
                b * BOTTOM_SHADE_FACTOR,
            ]);
        } else {
            colors.extend_from_slice(&[r, g, b]);
        }
    }

    colors
}

// Helper function to convert our Rust terrain geometry to JavaScript-friendly objects
fn convert_terrain_geometry_to_js(result: TerrainGeometryResult) -> Result<JsValue, JsValue> {
    let geometry = BufferGeometry {
        vertices: result.positions.clone(),
        normals: Some(result.normals.clone()),
        colors: if result.colors.is_empty() {
            None
        } else {
            Some(result.colors.clone())
        },
        indices: Some(result.indices.clone()),
        uvs: None,
        has_data: true,
        properties: None,
    };

    let positions_array = Float32Array::from(geometry.vertices.as_slice());

    let indices_vec = geometry
        .indices
        .clone()
        .unwrap_or_else(|| (0..(geometry.vertices.len() / 3) as u32).collect());
    let indices_array = Uint32Array::from(indices_vec.as_slice());

    let colors_vec = geometry.colors.clone().unwrap_or_default();
    let colors_array = Float32Array::from(colors_vec.as_slice());

    let normals_vec = geometry
        .normals
        .clone()
        .unwrap_or_else(|| vec![0.0; geometry.vertices.len()]);
    let normals_array = Float32Array::from(normals_vec.as_slice());

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
