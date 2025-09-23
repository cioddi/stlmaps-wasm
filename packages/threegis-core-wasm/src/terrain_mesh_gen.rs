// Terrain mesh generation with proper manifold triangulation
use crate::elevation::ElevationProcessingResult;
use crate::terrain::{TerrainGeometryParams, TerrainGeometryResult};

// Terrain resolution is now dynamically determined from elevation data
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

/// Create a manifold terrain mesh with proper vertex sharing
fn create_manifold_terrain_mesh(
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
    let push_triangle = |indices_array: &mut Vec<u32>, i0: u32, i1: u32, i2: u32| {
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
            let top_tl = bottom_tl + total_vertices_per_layer as u32;
            let top_tr = bottom_tr + total_vertices_per_layer as u32;
            let top_bl = bottom_bl + total_vertices_per_layer as u32;
            let top_br = bottom_br + total_vertices_per_layer as u32;

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

/// Test function to verify terrain mesh is manifold using csgrs
#[cfg(test)]
pub fn test_manifold_terrain_mesh() -> Result<bool, String> {
    use csgrs::{CSG, Vertex};
    use nalgebra::Point3;
    use csgrs::polygon::Polygon;

    // Create a simple 3x3 terrain mesh for testing
    let (positions, indices) = create_manifold_terrain_mesh(3, 3, 10.0);

    // Convert to csgrs format - create triangular polygons
    let mut polygons = Vec::new();

    for triangle_chunk in indices.chunks_exact(3) {
        let i0 = triangle_chunk[0] as usize;
        let i1 = triangle_chunk[1] as usize;
        let i2 = triangle_chunk[2] as usize;

        let v0_pos = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        let v1_pos = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        let v2_pos = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

        let p0 = Point3::new(v0_pos[0] as f64, v0_pos[1] as f64, v0_pos[2] as f64);
        let p1 = Point3::new(v1_pos[0] as f64, v1_pos[1] as f64, v1_pos[2] as f64);
        let p2 = Point3::new(v2_pos[0] as f64, v2_pos[1] as f64, v2_pos[2] as f64);

        // Calculate normal for the triangle
        let edge1 = p1 - p0;
        let edge2 = p2 - p0;
        let normal = edge1.cross(&edge2).normalize();

        let vertex0 = Vertex::new(p0, normal);
        let vertex1 = Vertex::new(p1, normal);
        let vertex2 = Vertex::new(p2, normal);

        let polygon = Polygon::new(vec![vertex0, vertex1, vertex2], None);
        polygons.push(polygon);
    }

    // Create CSG and check if manifold
    let csg: CSG<()> = CSG::from_polygons(&polygons);
    Ok(csg.is_manifold())
}

/// Test function to verify the full terrain generation pipeline produces manifold mesh
#[cfg(test)]
pub fn test_full_terrain_generation_manifold() -> Result<bool, String> {
    use csgrs::{CSG, Vertex};
    use nalgebra::Point3;
    use csgrs::polygon::Polygon;

    // Create fake DEM data - a simple 8x8 grid with realistic elevation values
    let grid_size = 8;
    let mut elevation_grid = Vec::new();

    for y in 0..grid_size {
        let mut row = Vec::new();
        for x in 0..grid_size {
            // Create a simple hill pattern - higher in the center
            let center_x = grid_size as f64 / 2.0;
            let center_y = grid_size as f64 / 2.0;
            let dist_from_center = ((x as f64 - center_x).powi(2) + (y as f64 - center_y).powi(2)).sqrt();
            let max_dist = (center_x.powi(2) + center_y.powi(2)).sqrt();
            let normalized_dist = (dist_from_center / max_dist).min(1.0);
            // Create a hill that goes from 20m at center to 5m at edges
            let elevation = 20.0 - (normalized_dist * 15.0);
            row.push(elevation);
        }
        elevation_grid.push(row);
    }

    // Create fake elevation processing result
    let elevation_data = ElevationProcessingResult {
        elevation_grid,
        grid_size: crate::elevation::GridSize {
            width: grid_size as u32,
            height: grid_size as u32,
        },
        min_elevation: 5.0,
        max_elevation: 20.0,
        processed_min_elevation: 5.0,
        processed_max_elevation: 20.0,
        cache_hit_rate: 1.0,
    };

    // Create terrain parameters
    let params = crate::terrain::TerrainGeometryParams {
        min_lng: -122.5,
        min_lat: 37.7,
        max_lng: -122.4,
        max_lat: 37.8,
        vertical_exaggeration: 2.0,
        terrain_base_height: 1.0,
        process_id: "test".to_string(),
    };

    // Generate terrain using the full pipeline
    let terrain_result = generate_terrain_with_mesh_cutting(&elevation_data, &params)
        .map_err(|e| format!("Terrain generation failed: {}", e))?;

    // Convert to csgrs format - create triangular polygons
    let mut polygons = Vec::new();

    for triangle_chunk in terrain_result.indices.chunks_exact(3) {
        let i0 = triangle_chunk[0] as usize;
        let i1 = triangle_chunk[1] as usize;
        let i2 = triangle_chunk[2] as usize;

        let v0_pos = [terrain_result.positions[i0 * 3], terrain_result.positions[i0 * 3 + 1], terrain_result.positions[i0 * 3 + 2]];
        let v1_pos = [terrain_result.positions[i1 * 3], terrain_result.positions[i1 * 3 + 1], terrain_result.positions[i1 * 3 + 2]];
        let v2_pos = [terrain_result.positions[i2 * 3], terrain_result.positions[i2 * 3 + 1], terrain_result.positions[i2 * 3 + 2]];

        let p0 = Point3::new(v0_pos[0] as f64, v0_pos[1] as f64, v0_pos[2] as f64);
        let p1 = Point3::new(v1_pos[0] as f64, v1_pos[1] as f64, v1_pos[2] as f64);
        let p2 = Point3::new(v2_pos[0] as f64, v2_pos[1] as f64, v2_pos[2] as f64);

        // Calculate normal for the triangle
        let edge1 = p1 - p0;
        let edge2 = p2 - p0;
        let normal = edge1.cross(&edge2);

        // Check for degenerate triangles (zero area)
        if normal.norm() < 1e-12 {
            continue; // Skip degenerate triangles
        }

        let normal = normal.normalize();

        let vertex0 = Vertex::new(p0, normal);
        let vertex1 = Vertex::new(p1, normal);
        let vertex2 = Vertex::new(p2, normal);

        let polygon = Polygon::new(vec![vertex0, vertex1, vertex2], None);
        polygons.push(polygon);
    }

    println!("Generated {} triangular polygons from full terrain pipeline", polygons.len());
    println!("Total positions: {}, indices: {}", terrain_result.positions.len() / 3, terrain_result.indices.len() / 3);

    // Create CSG and check if manifold
    let csg: CSG<()> = CSG::from_polygons(&polygons);
    Ok(csg.is_manifold())
}

/// Main function to generate terrain using the new mesh-based approach
pub fn generate_terrain_with_mesh_cutting(
    elevation_data: &ElevationProcessingResult,
    params: &TerrainGeometryParams,
) -> Result<TerrainGeometryResult, String> {
    // Use elevation data resolution directly to avoid interpolation issues
    let mesh_width = (elevation_data.grid_size.width - 1) as usize;
    let mesh_height = (elevation_data.grid_size.height - 1) as usize;

    // Ensure minimum resolution
    let mesh_width = mesh_width.max(3);
    let mesh_height = mesh_height.max(3);

    // Create base manifold mesh
    let (mut positions, indices) = create_manifold_terrain_mesh(
        mesh_width,
        mesh_height,
        params.terrain_base_height as f32,
    );

    // Apply elevation data to displace top vertices
    apply_elevation_to_positions(
        &mut positions,
        elevation_data,
        params,
        mesh_width,
        mesh_height,
    )?;

    // Generate colors based on final vertex positions
    let colors = generate_colors_from_positions(&positions, params);

    // Generate normals for triangular faces (same method as buildings)
    let normals = generate_triangle_normals(&positions, &indices);

    // Create processed elevation grid for output - use original data directly
    let processed_elevation_grid = elevation_data.elevation_grid.clone();

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terrain_mesh_is_manifold() {
        match test_manifold_terrain_mesh() {
            Ok(is_manifold) => {
                println!("Terrain mesh manifold test result: {}", is_manifold);
                assert!(is_manifold, "Terrain mesh should be manifold!");
            }
            Err(e) => {
                panic!("Failed to test manifold: {}", e);
            }
        }
    }

    #[test]
    fn test_full_terrain_generation_with_fake_dem_is_manifold() {
        match test_full_terrain_generation_manifold() {
            Ok(is_manifold) => {
                println!("Full terrain generation with DEM manifold test result: {}", is_manifold);
                assert!(is_manifold, "Full terrain generation should produce manifold mesh!");
            }
            Err(e) => {
                panic!("Failed to test full terrain generation manifold: {}", e);
            }
        }
    }
}