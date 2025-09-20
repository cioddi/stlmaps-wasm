use crate::polygon_geometry::BufferGeometry;
use rayon::prelude::*;
use std::collections::HashMap;

const POSITION_EPSILON: f32 = 1e-5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct QuantizedPosition(i32, i32, i32);

fn quantize_position(x: f32, y: f32, z: f32) -> QuantizedPosition {
    let scale = 1.0 / POSITION_EPSILON;
    QuantizedPosition(
        (x * scale).round() as i32,
        (y * scale).round() as i32,
        (z * scale).round() as i32,
    )
}

fn get_or_insert_vertex(
    original_index: u32,
    local_vertices: &[f32],
    local_colors: Option<&[f32]>,
    vertex_map: &mut HashMap<QuantizedPosition, u32>,
    global_vertices: &mut Vec<f32>,
    global_colors: &mut Vec<f32>,
    has_global_colors: &mut bool,
    remap_cache: &mut HashMap<u32, u32>,
) -> Option<u32> {
    if let Some(mapped) = remap_cache.get(&original_index) {
        return Some(*mapped);
    }

    let base = original_index as usize * 3;
    if base + 2 >= local_vertices.len() {
        return None;
    }

    let x = local_vertices[base];
    let y = local_vertices[base + 1];
    let z = local_vertices[base + 2];
    let key = quantize_position(x, y, z);

    let mapped_index = match vertex_map.get(&key) {
        Some(existing) => *existing,
        None => {
            let new_index = (global_vertices.len() / 3) as u32;
            global_vertices.push(x);
            global_vertices.push(y);
            global_vertices.push(z);
            vertex_map.insert(key, new_index);

            if let Some(colors) = local_colors {
                let base = original_index as usize * 3;
                if base + 2 < colors.len() {
                    global_colors.push(colors[base]);
                    global_colors.push(colors[base + 1]);
                    global_colors.push(colors[base + 2]);
                    *has_global_colors = true;
                } else if *has_global_colors {
                    global_colors.extend_from_slice(&[0.0, 0.0, 0.0]);
                }
            } else if *has_global_colors {
                global_colors.extend_from_slice(&[0.0, 0.0, 0.0]);
            }

            new_index
        }
    };

    remap_cache.insert(original_index, mapped_index);
    Some(mapped_index)
}

pub fn build_layer_union(geometries: Vec<BufferGeometry>) -> BufferGeometry {
    let mut vertex_map: HashMap<QuantizedPosition, u32> = HashMap::new();
    let mut vertices: Vec<f32> = Vec::new();
    let mut colors: Vec<f32> = Vec::new();
    let mut has_global_colors = false;
    let mut indices: Vec<[u32; 3]> = Vec::new();
    let mut face_lookup: HashMap<(u32, u32, u32), usize> = HashMap::new();

    for geometry in geometries {
        if !geometry.has_data || geometry.vertices.len() < 9 {
            continue;
        }

        let local_vertices = geometry.vertices;
        let local_indices = if let Some(idx) = geometry.indices {
            idx
        } else {
            (0..(local_vertices.len() / 3) as u32).collect()
        };

        let local_colors = geometry.colors.as_ref().map(|c| c.as_slice());

        let mut remap_cache: HashMap<u32, u32> = HashMap::new();

        for face in local_indices.chunks(3) {
            if face.len() < 3 {
                continue;
            }

            let i0 = match get_or_insert_vertex(
                face[0],
                &local_vertices,
                local_colors,
                &mut vertex_map,
                &mut vertices,
                &mut colors,
                &mut has_global_colors,
                &mut remap_cache,
            ) {
                Some(idx) => idx,
                None => continue,
            };
            let i1 = match get_or_insert_vertex(
                face[1],
                &local_vertices,
                local_colors,
                &mut vertex_map,
                &mut vertices,
                &mut colors,
                &mut has_global_colors,
                &mut remap_cache,
            ) {
                Some(idx) => idx,
                None => continue,
            };
            let i2 = match get_or_insert_vertex(
                face[2],
                &local_vertices,
                local_colors,
                &mut vertex_map,
                &mut vertices,
                &mut colors,
                &mut has_global_colors,
                &mut remap_cache,
            ) {
                Some(idx) => idx,
                None => continue,
            };

            if i0 == i1 || i1 == i2 || i2 == i0 {
                continue;
            }

            let base0 = i0 as usize * 3;
            let base1 = i1 as usize * 3;
            let base2 = i2 as usize * 3;

            let ax = vertices[base0];
            let ay = vertices[base0 + 1];
            let az = vertices[base0 + 2];
            let bx = vertices[base1];
            let by = vertices[base1 + 1];
            let bz = vertices[base1 + 2];
            let cx = vertices[base2];
            let cy = vertices[base2 + 1];
            let cz = vertices[base2 + 2];

            let v1x = bx - ax;
            let v1y = by - ay;
            let v1z = bz - az;
            let v2x = cx - ax;
            let v2y = cy - ay;
            let v2z = cz - az;

            let nx = v1y * v2z - v1z * v2y;
            let ny = v1z * v2x - v1x * v2z;
            let nz = v1x * v2y - v1y * v2x;
            let normal_len_sq = nx * nx + ny * ny + nz * nz;
            if normal_len_sq <= 1e-12 {
                continue;
            }

            let mut sorted = [i0, i1, i2];
            sorted.sort();
            let key = (sorted[0], sorted[1], sorted[2]);

            if let Some(existing_idx) = face_lookup.get(&key) {
                let existing_triangle = indices[*existing_idx];
                let bx0 = vertices[existing_triangle[1] as usize * 3];
                let by0 = vertices[existing_triangle[1] as usize * 3 + 1];
                let bz0 = vertices[existing_triangle[1] as usize * 3 + 2];
                let cx0 = vertices[existing_triangle[2] as usize * 3];
                let cy0 = vertices[existing_triangle[2] as usize * 3 + 1];
                let cz0 = vertices[existing_triangle[2] as usize * 3 + 2];

                let v1x0 = bx0 - ax;
                let v1y0 = by0 - ay;
                let v1z0 = bz0 - az;
                let v2x0 = cx0 - ax;
                let v2y0 = cy0 - ay;
                let v2z0 = cz0 - az;

                let existing_nx = v1y0 * v2z0 - v1z0 * v2y0;
                let existing_ny = v1z0 * v2x0 - v1x0 * v2z0;
                let existing_nz = v1x0 * v2y0 - v1y0 * v2x0;
                let dot = existing_nx * nx + existing_ny * ny + existing_nz * nz;

                if dot < 0.0 {
                    // Opposite orientation – remove the existing interior face
                    indices[*existing_idx] = [u32::MAX, u32::MAX, u32::MAX];
                    face_lookup.remove(&key);
                }

                continue;
            }

            face_lookup.insert(key, indices.len());
            indices.push([i0, i1, i2]);
        }
    }

    if vertices.is_empty() || indices.is_empty() {
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            has_data: false,
            properties: None,
        };
    }

    let mut normals = vec![0.0f32; vertices.len()];
    for tri in &indices {
        if tri[0] == u32::MAX {
            continue;
        }
        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        let ax = vertices[i0 * 3];
        let ay = vertices[i0 * 3 + 1];
        let az = vertices[i0 * 3 + 2];
        let bx = vertices[i1 * 3];
        let by = vertices[i1 * 3 + 1];
        let bz = vertices[i1 * 3 + 2];
        let cx = vertices[i2 * 3];
        let cy = vertices[i2 * 3 + 1];
        let cz = vertices[i2 * 3 + 2];

        let v1x = bx - ax;
        let v1y = by - ay;
        let v1z = bz - az;
        let v2x = cx - ax;
        let v2y = cy - ay;
        let v2z = cz - az;

        let nx = v1y * v2z - v1z * v2y;
        let ny = v1z * v2x - v1x * v2z;
        let nz = v1x * v2y - v1y * v2x;

        for &idx in &[i0, i1, i2] {
            normals[idx * 3] += nx;
            normals[idx * 3 + 1] += ny;
            normals[idx * 3 + 2] += nz;
        }
    }

    for normal in normals.chunks_mut(3) {
        let len = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if len > 1e-6 {
            normal[0] /= len;
            normal[1] /= len;
            normal[2] /= len;
        } else {
            normal[0] = 0.0;
            normal[1] = 0.0;
            normal[2] = 1.0;
        }
    }

    let mut final_indices = Vec::with_capacity(indices.len() * 3);
    for tri in indices {
        if tri[0] == u32::MAX {
            continue;
        }
        final_indices.push(tri[0]);
        final_indices.push(tri[1]);
        final_indices.push(tri[2]);
    }

    BufferGeometry {
        vertices,
        normals: Some(normals),
        colors: if has_global_colors { Some(colors) } else { None },
        indices: Some(final_indices),
        uvs: None,
        has_data: true,
        properties: None,
    }
}

// Simple CSG union implementation for merging geometries
// This is a basic implementation - for production use, consider a more robust CSG library

pub struct CSGUnion {
    vertices: Vec<f32>,
    indices: Vec<u32>,
    normals: Vec<f32>,
    colors: Vec<f32>,
    next_vertex_index: u32,
}

impl CSGUnion {
    pub fn new() -> Self {
        Self {
            vertices: Vec::new(),
            indices: Vec::new(),
            normals: Vec::new(),
            colors: Vec::new(),
            next_vertex_index: 0,
        }
    }

    /// Add a geometry to the union
    pub fn add_geometry(&mut self, geometry: &BufferGeometry) {
        if !geometry.has_data || geometry.vertices.is_empty() {
            return;
        }

        let vertex_count = geometry.vertices.len() / 3;

        // Add vertices
        self.vertices.extend_from_slice(&geometry.vertices);

        // Add indices, adjusting for vertex offset
        if let Some(ref indices) = geometry.indices {
            for &index in indices {
                self.indices.push(index + self.next_vertex_index);
            }
        } else {
            // Generate sequential indices if none provided
            for i in 0..vertex_count as u32 {
                self.indices.push(self.next_vertex_index + i);
            }
        }

        // Add normals
        if let Some(ref normals) = geometry.normals {
            self.normals.extend_from_slice(normals);
        } else {
            // Generate default normals pointing up
            for _ in 0..vertex_count {
                self.normals.extend_from_slice(&[0.0, 0.0, 1.0]);
            }
        }

        // Add colors
        if let Some(ref colors) = geometry.colors {
            self.colors.extend_from_slice(colors);
        } else {
            // Generate default colors (gray)
            for _ in 0..vertex_count {
                self.colors.extend_from_slice(&[0.7, 0.7, 0.7]);
            }
        }

        self.next_vertex_index += vertex_count as u32;
    }

    /// Finish the union and return the merged geometry
    pub fn finish(self) -> BufferGeometry {
        let has_data = !self.vertices.is_empty();
        BufferGeometry {
            vertices: self.vertices,
            normals: if self.normals.is_empty() {
                None
            } else {
                Some(self.normals)
            },
            colors: if self.colors.is_empty() {
                None
            } else {
                Some(self.colors)
            },
            indices: if self.indices.is_empty() {
                None
            } else {
                Some(self.indices)
            },
            uvs: None,
            has_data: has_data,
            properties: None,
        }
    }
}

/// Merge multiple geometries into a single unified geometry per layer
pub fn merge_geometries_by_layer(
    geometries: Vec<BufferGeometry>,
) -> HashMap<String, BufferGeometry> {
    if geometries.is_empty() {
        return HashMap::new();
    }

    // For buildings and similar features, merge all geometries into a single layer
    // This creates one unified mesh per source layer (e.g., all buildings become one mesh)
    let merged_geometry = build_layer_union(geometries);

    if merged_geometry.has_data {
        let mut result = HashMap::new();
        result.insert("merged_layer".to_string(), merged_geometry);
        result
    } else {
        HashMap::new()
    }
}

/// Merge geometries with more advanced spatial grouping using parallel processing
#[allow(dead_code)]
pub fn merge_geometries_with_spatial_grouping(
    geometries: Vec<BufferGeometry>,
    max_distance: f32,
) -> HashMap<String, BufferGeometry> {
    if geometries.is_empty() {
        return HashMap::new();
    }

    // Calculate geometry centers in parallel
    let geometry_centers: Vec<(BufferGeometry, (f32, f32))> = geometries
        .into_par_iter()
        .filter(|geometry| geometry.has_data && geometry.vertices.len() >= 9)
        .map(|geometry| {
            let vertex_count = geometry.vertices.len() / 3;
            let (center_x, center_y) = geometry
                .vertices
                .par_chunks_exact(3)
                .map(|chunk| (chunk[0], chunk[1]))
                .reduce(
                    || (0.0, 0.0),
                    |acc, point| (acc.0 + point.0, acc.1 + point.1),
                );

            let center = (
                center_x / vertex_count as f32,
                center_y / vertex_count as f32,
            );
            (geometry, center)
        })
        .collect();

    // Group geometries by spatial proximity
    let mut groups: Vec<Vec<BufferGeometry>> = Vec::new();

    for (geometry, center) in geometry_centers {
        // Find the closest group or create a new one
        let mut added_to_group = false;
        for group in &mut groups {
            if let Some(first_geom) = group.first() {
                // Calculate center of first geometry in group
                let group_vertex_count = first_geom.vertices.len() / 3;
                let (group_center_x, group_center_y) = first_geom
                    .vertices
                    .par_chunks_exact(3)
                    .map(|chunk| (chunk[0], chunk[1]))
                    .reduce(
                        || (0.0, 0.0),
                        |acc, point| (acc.0 + point.0, acc.1 + point.1),
                    );
                let group_center = (
                    group_center_x / group_vertex_count as f32,
                    group_center_y / group_vertex_count as f32,
                );

                // Check distance
                let distance = ((center.0 - group_center.0).powi(2)
                    + (center.1 - group_center.1).powi(2))
                .sqrt();
                if distance <= max_distance {
                    group.push(geometry.clone());
                    added_to_group = true;
                    break;
                }
            }
        }

        if !added_to_group {
            groups.push(vec![geometry]);
        }
    }

    // Merge each group in parallel
    let result: HashMap<String, BufferGeometry> = groups
        .into_par_iter()
        .enumerate()
        .filter_map(|(group_idx, group)| {
            if group.is_empty() {
                return None;
            }

            let mut union = CSGUnion::new();
            for geometry in group {
                union.add_geometry(&geometry);
            }

            let merged = union.finish();
            if merged.has_data {
                Some((format!("group_{}", group_idx), merged))
            } else {
                None
            }
        })
        .collect();

    result
}

pub fn rebuild_single_geometry(geometry: BufferGeometry) -> BufferGeometry {
    build_layer_union(vec![geometry])
}

/// Simple spatial optimization: merge nearby vertices to reduce geometry complexity
pub fn optimize_geometry(geometry: BufferGeometry, tolerance: f32) -> BufferGeometry {
    if !geometry.has_data || geometry.vertices.len() < 9 {
        return geometry;
    }

    let vertex_count = geometry.vertices.len() / 3;
    let mut merged_vertices = Vec::new();
    let mut merged_normals = Vec::new();
    let mut merged_colors = Vec::new();
    let mut vertex_map: HashMap<usize, usize> = HashMap::new();

    // Merge vertices within tolerance
    for i in 0..vertex_count {
        let v1_idx = i * 3;
        let v1 = [
            geometry.vertices[v1_idx],
            geometry.vertices[v1_idx + 1],
            geometry.vertices[v1_idx + 2],
        ];

        // Check if this vertex is close to any existing merged vertex
        let mut found_match = false;
        for (existing_idx, &merged_idx) in &vertex_map {
            if *existing_idx >= i {
                continue;
            }

            let existing_v_idx = existing_idx * 3;
            let existing_v = [
                geometry.vertices[existing_v_idx],
                geometry.vertices[existing_v_idx + 1],
                geometry.vertices[existing_v_idx + 2],
            ];

            let distance_sq = (v1[0] - existing_v[0]).powi(2)
                + (v1[1] - existing_v[1]).powi(2)
                + (v1[2] - existing_v[2]).powi(2);

            if distance_sq <= tolerance * tolerance {
                vertex_map.insert(i, merged_idx);
                found_match = true;
                break;
            }
        }

        if !found_match {
            // Add new merged vertex
            let new_merged_idx = merged_vertices.len() / 3;
            vertex_map.insert(i, new_merged_idx);

            merged_vertices.extend_from_slice(&v1);

            // Add corresponding normal and color
            if let Some(ref normals) = geometry.normals {
                if normals.len() > v1_idx + 2 {
                    merged_normals.extend_from_slice(&normals[v1_idx..v1_idx + 3]);
                }
            }

            if let Some(ref colors) = geometry.colors {
                if colors.len() > v1_idx + 2 {
                    merged_colors.extend_from_slice(&colors[v1_idx..v1_idx + 3]);
                }
            }
        }
    }

    // Remap indices
    let new_indices: Vec<u32> = if let Some(ref indices) = geometry.indices {
        indices
            .iter()
            .map(|&idx| vertex_map.get(&(idx as usize)).copied().unwrap_or(0) as u32)
            .collect()
    } else {
        (0..merged_vertices.len() as u32 / 3).collect()
    };

    let has_data = !merged_vertices.is_empty();
    BufferGeometry {
        vertices: merged_vertices,
        normals: if merged_normals.is_empty() {
            None
        } else {
            Some(merged_normals)
        },
        colors: if merged_colors.is_empty() {
            None
        } else {
            Some(merged_colors)
        },
        indices: if new_indices.is_empty() {
            None
        } else {
            Some(new_indices)
        },
        uvs: None,
        has_data: has_data,
        properties: geometry.properties,
    }
}
