use crate::polygon_geometry::BufferGeometry;
use std::collections::HashMap;
use rayon::prelude::*;

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
        if !geometry.hasData || geometry.vertices.is_empty() {
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
            normals: if self.normals.is_empty() { None } else { Some(self.normals) },
            colors: if self.colors.is_empty() { None } else { Some(self.colors) },
            indices: if self.indices.is_empty() { None } else { Some(self.indices) },
            uvs: None,
            hasData: has_data,
            properties: None,
        }
    }
}

/// Merge multiple geometries into a single unified geometry per layer
pub fn merge_geometries_by_layer(geometries: Vec<BufferGeometry>) -> HashMap<String, BufferGeometry> {
    if geometries.is_empty() {
        return HashMap::new();
    }
    
    // For buildings and similar features, merge all geometries into a single layer
    // This creates one unified mesh per source layer (e.g., all buildings become one mesh)
    let mut union = CSGUnion::new();
    let mut geometry_count = 0;
    
    for geometry in geometries.into_iter() {
        if !geometry.hasData {
            continue;
        }
        
        union.add_geometry(&geometry);
        geometry_count += 1;
    }
    
    if geometry_count == 0 {
        return HashMap::new();
    }
    
    // Create a single merged geometry with a default layer name
    let mut result = HashMap::new();
    let merged_geometry = union.finish();
    
    if merged_geometry.hasData {
        result.insert("merged_layer".to_string(), merged_geometry);
    }
    
    result
}

/// Merge geometries with more advanced spatial grouping using parallel processing
pub fn merge_geometries_with_spatial_grouping(geometries: Vec<BufferGeometry>, max_distance: f32) -> HashMap<String, BufferGeometry> {
    if geometries.is_empty() {
        return HashMap::new();
    }
    
    // Calculate geometry centers in parallel
    let geometry_centers: Vec<(BufferGeometry, (f32, f32))> = geometries
        .into_par_iter()
        .filter(|geometry| geometry.hasData && geometry.vertices.len() >= 9)
        .map(|geometry| {
            let vertex_count = geometry.vertices.len() / 3;
            let (center_x, center_y) = geometry.vertices
                .par_chunks_exact(3)
                .map(|chunk| (chunk[0], chunk[1]))
                .reduce(|| (0.0, 0.0), |acc, point| (acc.0 + point.0, acc.1 + point.1));
            
            let center = (center_x / vertex_count as f32, center_y / vertex_count as f32);
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
                let (group_center_x, group_center_y) = first_geom.vertices
                    .par_chunks_exact(3)
                    .map(|chunk| (chunk[0], chunk[1]))
                    .reduce(|| (0.0, 0.0), |acc, point| (acc.0 + point.0, acc.1 + point.1));
                let group_center = (group_center_x / group_vertex_count as f32, group_center_y / group_vertex_count as f32);
                
                // Check distance
                let distance = ((center.0 - group_center.0).powi(2) + (center.1 - group_center.1).powi(2)).sqrt();
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
            if merged.hasData {
                Some((format!("group_{}", group_idx), merged))
            } else {
                None
            }
        })
        .collect();
    
    result
}

/// Simple spatial optimization: merge nearby vertices to reduce geometry complexity
pub fn optimize_geometry(mut geometry: BufferGeometry, tolerance: f32) -> BufferGeometry {
    if !geometry.hasData || geometry.vertices.len() < 9 {
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
        let v1 = [geometry.vertices[v1_idx], geometry.vertices[v1_idx + 1], geometry.vertices[v1_idx + 2]];
        
        // Check if this vertex is close to any existing merged vertex
        let mut found_match = false;
        for (existing_idx, &merged_idx) in &vertex_map {
            if *existing_idx >= i { continue; }
            
            let existing_v_idx = existing_idx * 3;
            let existing_v = [
                geometry.vertices[existing_v_idx],
                geometry.vertices[existing_v_idx + 1], 
                geometry.vertices[existing_v_idx + 2]
            ];
            
            let distance_sq = (v1[0] - existing_v[0]).powi(2) + 
                              (v1[1] - existing_v[1]).powi(2) + 
                              (v1[2] - existing_v[2]).powi(2);
            
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
        indices.iter()
            .map(|&idx| vertex_map.get(&(idx as usize)).copied().unwrap_or(0) as u32)
            .collect()
    } else {
        (0..merged_vertices.len() as u32 / 3).collect()
    };
    
    let has_data = !merged_vertices.is_empty();
    BufferGeometry {
        vertices: merged_vertices,
        normals: if merged_normals.is_empty() { None } else { Some(merged_normals) },
        colors: if merged_colors.is_empty() { None } else { Some(merged_colors) },
        indices: if new_indices.is_empty() { None } else { Some(new_indices) },
        uvs: None,
        hasData: has_data,
        properties: geometry.properties,
    }
}