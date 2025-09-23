// Terrain mesh generation with rectangular faces (no manual triangulation)
use crate::elevation::ElevationProcessingResult;
use crate::terrain::{TerrainGeometryParams, TerrainGeometryResult};

const TARGET_TERRAIN_RESOLUTION: usize = 64;
const MIN_TERRAIN_THICKNESS: f32 = 0.3;
const MESH_SIZE_METERS: f32 = 200.0;
const LIGHT_BROWN: [f32; 3] = [0.82, 0.71, 0.55];
const DARK_BROWN: [f32; 3] = [0.66, 0.48, 0.30];
const BOTTOM_SHADE_FACTOR: f32 = 0.6;

/// Apply elevation data to mesh positions
fn apply_elevation_to_positions(
    positions: &mut [f32],
    elevation_data: &ElevationProcessingResult,
    params: &TerrainGeometryParams,
    width_segments: usize,
    height_segments: usize,
) -> Result<(), String> {
    let elevation_range = f64::max(
        1.0,
        elevation_data.max_elevation - elevation_data.min_elevation,
    );

    let source_width = elevation_data.grid_size.width as usize;
    let source_height = elevation_data.grid_size.height as usize;

    let sample_elevation = |normalized_x: f64, normalized_y: f64| -> f64 {
        let src_x = normalized_x * (source_width - 1) as f64;
        let src_y = normalized_y * (source_height - 1) as f64;

        let x0 = src_x.floor() as usize;
        let y0 = src_y.floor() as usize;
        let x1 = (x0 + 1).min(source_width - 1);
        let y1 = (y0 + 1).min(source_height - 1);

        let dx = src_x - x0 as f64;
        let dy = src_y - y0 as f64;

        let v00 = elevation_data.elevation_grid[y0][x0];
        let v10 = elevation_data.elevation_grid[y0][x1];
        let v01 = elevation_data.elevation_grid[y1][x0];
        let v11 = elevation_data.elevation_grid[y1][x1];

        let v0 = v00 * (1.0 - dx) + v10 * dx;
        let v1 = v01 * (1.0 - dx) + v11 * dx;

        v0 * (1.0 - dy) + v1 * dy
    };

    let grid_width = width_segments + 1;
    let grid_height = height_segments + 1;
    let total_vertices_per_layer = grid_width * grid_height;

    // Update top layer vertices with elevation data
    // Top layer starts after all bottom layer vertices
    for y in 0..grid_height {
        for x in 0..grid_width {
            let vertex_index = (total_vertices_per_layer + y * grid_width + x) * 3; // Top layer offset + grid position * 3 components

            let normalized_x = x as f64 / width_segments as f64;
            let normalized_y = y as f64 / height_segments as f64;

            let elevation = sample_elevation(normalized_x, normalized_y);
            let normalized_elevation = ((elevation - elevation_data.min_elevation) / elevation_range).clamp(0.0, 1.0);
            let elevation_variation = (normalized_elevation * params.vertical_exaggeration) as f32;

            let mut new_z = params.terrain_base_height as f32 + elevation_variation;
            if new_z < MIN_TERRAIN_THICKNESS {
                new_z = MIN_TERRAIN_THICKNESS;
            }

            // Update the Z coordinate of the top layer vertex
            if vertex_index + 2 < positions.len() {
                positions[vertex_index + 2] = new_z;
            }
        }
    }

    Ok(())
}

/// Generate colors based on vertex heights
fn generate_colors_from_positions(
    positions: &[f32],
    params: &TerrainGeometryParams,
) -> Vec<f32> {
    let mut colors = Vec::new();
    let base_height = 0.0f32;
    let terrain_base_height_f32 = params.terrain_base_height as f32;
    let exaggeration = params.vertical_exaggeration.max(1e-6) as f32;

    for vertex in positions.chunks_exact(3) {
        let z = vertex[2];
        let normalized = ((z - terrain_base_height_f32) / exaggeration).clamp(0.0, 1.0);
        let inv_norm = 1.0 - normalized;
        let r = LIGHT_BROWN[0] * inv_norm + DARK_BROWN[0] * normalized;
        let g = LIGHT_BROWN[1] * inv_norm + DARK_BROWN[1] * normalized;
        let b = LIGHT_BROWN[2] * inv_norm + DARK_BROWN[2] * normalized;

        // Darken bottom vertices
        if (z - base_height).abs() <= 1e-3 {
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

/// Generate normals for triangular faces (same method as buildings)
fn generate_triangle_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let mut normals = vec![0.0f32; positions.len()];

    // Calculate face normals and accumulate at vertices for triangles
    for triangle in indices.chunks_exact(3) {
        let i0 = triangle[0] as usize;
        let i1 = triangle[1] as usize;
        let i2 = triangle[2] as usize;

        let p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        let p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        let p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

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

    // Normalize accumulated normals
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

/// Create rectangular mesh with proper quad topology
fn create_rectangular_terrain_mesh(
    width_segments: usize,
    height_segments: usize,
    base_height: f32,
) -> (Vec<f32>, Vec<u32>) {
    let mut positions = Vec::new();
    let mut indices = Vec::new();

    let grid_width = width_segments + 1;
    let grid_height = height_segments + 1;

    // Create vertices in layers like buildings: bottom layer first, then top layer
    // This ensures proper vertex sharing for manifold edges

    // Bottom layer vertices (z = 0)
    for y in 0..grid_height {
        for x in 0..grid_width {
            let mesh_x = (x as f32 / width_segments as f32 - 0.5) * MESH_SIZE_METERS;
            let mesh_y = (y as f32 / height_segments as f32 - 0.5) * MESH_SIZE_METERS;
            positions.extend_from_slice(&[mesh_x, mesh_y, 0.0]);
        }
    }

    // Top layer vertices (z = base_height, will be displaced by elevation)
    for y in 0..grid_height {
        for x in 0..grid_width {
            let mesh_x = (x as f32 / width_segments as f32 - 0.5) * MESH_SIZE_METERS;
            let mesh_y = (y as f32 / height_segments as f32 - 0.5) * MESH_SIZE_METERS;
            positions.extend_from_slice(&[mesh_x, mesh_y, base_height]);
        }
    }

    // Create triangular indices using the same manifold method as buildings
    // Helper function to push triangle with proper winding
    let mut push_triangle = |indices_array: &mut Vec<u32>, i0: u32, i1: u32, i2: u32| {
        indices_array.push(i0);
        indices_array.push(i1);
        indices_array.push(i2);
    };

    // Generate triangular faces for the terrain grid using layered vertex structure
    let total_vertices_per_layer = grid_width * grid_height;

    for y in 0..height_segments {
        for x in 0..width_segments {
            // Bottom layer vertex indices (like buildings bottom face)
            let bottom_tl = (y * grid_width + x) as u32;
            let bottom_tr = (y * grid_width + x + 1) as u32;
            let bottom_bl = ((y + 1) * grid_width + x) as u32;
            let bottom_br = ((y + 1) * grid_width + x + 1) as u32;

            // Top layer vertex indices (like buildings top face)
            let top_tl = (bottom_tl + total_vertices_per_layer as u32);
            let top_tr = (bottom_tr + total_vertices_per_layer as u32);
            let top_bl = (bottom_bl + total_vertices_per_layer as u32);
            let top_br = (bottom_br + total_vertices_per_layer as u32);

            // Bottom surface triangles (reversed winding like buildings)
            push_triangle(&mut indices, bottom_tl, bottom_bl, bottom_tr);
            push_triangle(&mut indices, bottom_tr, bottom_bl, bottom_br);

            // Top surface triangles (same pattern as building extrude)
            push_triangle(&mut indices, top_tl, top_tr, top_bl);
            push_triangle(&mut indices, top_tr, top_br, top_bl);
        }
    }

    // Add side faces using the same manifold triangle method as buildings
    // Now using layered vertex structure for proper manifold edges
    for y in 0..height_segments {
        // Left side wall (x = 0)
        let bottom_curr = (y * grid_width) as u32;
        let bottom_next = ((y + 1) * grid_width) as u32;
        let top_curr = bottom_curr + total_vertices_per_layer as u32;
        let top_next = bottom_next + total_vertices_per_layer as u32;

        push_triangle(&mut indices, top_curr, bottom_curr, top_next);
        push_triangle(&mut indices, bottom_curr, bottom_next, top_next);

        // Right side wall (x = width_segments)
        let bottom_curr = (y * grid_width + width_segments) as u32;
        let bottom_next = ((y + 1) * grid_width + width_segments) as u32;
        let top_curr = bottom_curr + total_vertices_per_layer as u32;
        let top_next = bottom_next + total_vertices_per_layer as u32;

        push_triangle(&mut indices, top_curr, top_next, bottom_curr);
        push_triangle(&mut indices, bottom_curr, top_next, bottom_next);
    }

    for x in 0..width_segments {
        // Front side wall (y = 0)
        let bottom_curr = x as u32;
        let bottom_next = (x + 1) as u32;
        let top_curr = bottom_curr + total_vertices_per_layer as u32;
        let top_next = bottom_next + total_vertices_per_layer as u32;

        push_triangle(&mut indices, top_curr, top_next, bottom_curr);
        push_triangle(&mut indices, bottom_curr, top_next, bottom_next);

        // Back side wall (y = height_segments)
        let bottom_curr = (height_segments * grid_width + x) as u32;
        let bottom_next = (height_segments * grid_width + x + 1) as u32;
        let top_curr = bottom_curr + total_vertices_per_layer as u32;
        let top_next = bottom_next + total_vertices_per_layer as u32;

        push_triangle(&mut indices, top_curr, bottom_curr, top_next);
        push_triangle(&mut indices, bottom_curr, bottom_next, top_next);
    }

    (positions, indices)
}

/// Main function to generate terrain using rectangular mesh approach
pub fn generate_terrain_with_mesh_cutting(
    elevation_data: &ElevationProcessingResult,
    params: &TerrainGeometryParams,
) -> Result<TerrainGeometryResult, String> {
    // Create base rectangular mesh with consistent quad topology
    let (mut positions, indices) = create_rectangular_terrain_mesh(
        TARGET_TERRAIN_RESOLUTION,
        TARGET_TERRAIN_RESOLUTION,
        params.terrain_base_height as f32,
    );

    // Apply elevation data to displace top vertices
    apply_elevation_to_positions(
        &mut positions,
        elevation_data,
        params,
        TARGET_TERRAIN_RESOLUTION,
        TARGET_TERRAIN_RESOLUTION,
    )?;

    // Generate colors based on final vertex positions
    let colors = generate_colors_from_positions(&positions, params);

    // Generate normals for triangular faces (same method as buildings)
    let normals = generate_triangle_normals(&positions, &indices);

    // Create processed elevation grid for output
    let mut processed_elevation_grid = Vec::new();
    let grid_size = TARGET_TERRAIN_RESOLUTION;
    for y in 0..grid_size {
        let mut row = Vec::new();
        for x in 0..grid_size {
            let normalized_x = x as f64 / (grid_size - 1) as f64;
            let normalized_y = y as f64 / (grid_size - 1) as f64;

            let src_x = (normalized_x * (elevation_data.grid_size.width - 1) as f64) as usize;
            let src_y = (normalized_y * (elevation_data.grid_size.height - 1) as f64) as usize;
            let src_x = src_x.min(elevation_data.elevation_grid[0].len() - 1);
            let src_y = src_y.min(elevation_data.elevation_grid.len() - 1);

            row.push(elevation_data.elevation_grid[src_y][src_x]);
        }
        processed_elevation_grid.push(row);
    }

    Ok(TerrainGeometryResult {
        positions,
        indices,
        colors,
        normals,
        processed_elevation_grid,
        processed_min_elevation: elevation_data.min_elevation,
        processed_max_elevation: elevation_data.max_elevation,
        original_min_elevation: elevation_data.min_elevation,
        original_max_elevation: elevation_data.max_elevation,
    })
}