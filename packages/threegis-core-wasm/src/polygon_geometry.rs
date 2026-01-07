use crate::bbox_filter::polygon_intersects_bbox;
use crate::extrude;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use js_sys::{Array, Float32Array};
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::JsValue;



// Import GPU elevation processing functions (for future use)
#[allow(unused_imports)]
use crate::gpu_elevation::align_vertices_to_terrain_gpu;

// Constants ported from TypeScript
const BUILDING_SUBMERGE_OFFSET: f64 = 0.05; // How far buildings are embedded into terrain (small to avoid artifacts)
const MIN_HEIGHT: f64 = 0.01; // Avoid zero or negative height for robust geometry
const MAX_HEIGHT: f64 = 500.0;
const MIN_CLEARANCE: f64 = 0.1; // Minimum clearance above terrain to avoid z-fighting and mesh intersections
// Scale factor to make vertical exaggeration values more visible (must match terrain_mesh_gen.rs)
const EXAGGERATION_SCALE_FACTOR: f64 = 5.0;
// Maximum edge length for subdivision (ensures terrain-aligned geometries follow terrain properly)
// TERRAIN_SIZE is 200.0, so 5.0 means roughly 40 segments across the full terrain
const MAX_EDGE_LENGTH: f64 = 5.0;

// Helper function to decode base64 string to f32 vector
fn decode_base64_to_f32_vec(base64_data: &str) -> Result<Vec<f32>, String> {
    // For now, we'll implement a simple base64 decoder
    // In a real implementation, you'd use a proper base64 library
    // This is a placeholder implementation that assumes the data was properly encoded

    // Simple approach: split by comma and parse as floats (assuming CSV format)
    if base64_data.contains(',') {
        let result: Result<Vec<f32>, _> = base64_data
            .split(',')
            .map(|s| s.trim().parse::<f32>())
            .collect();
        result.map_err(|e| format!("Failed to parse CSV data: {}", e))
    } else {
        // Empty or invalid data
        Ok(Vec::new())
    }
}
const TERRAIN_SIZE: f64 = 200.0;
const EPSILON: f64 = 1e-9; // Small value for float comparisons

// Struct to represent a 2D point
#[derive(Debug, Clone, Copy, PartialEq)]
struct Vector2 {
    x: f64,
    y: f64,
}

// Deserializable struct matching GeometryData from TypeScript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>, // Array of [lng, lat] points
    pub r#type: Option<String>,  // Geometry type (e.g., "Polygon", "LineString")
    pub height: Option<f64>,
    pub layer: Option<String>, // Source layer for processing
    pub label: Option<String>, // Display label for grouping
    pub tags: Option<serde_json::Value>,
    pub properties: Option<serde_json::Value>, // Original properties from MVT
}

// Helper functions for GeometryData
impl GeometryData {
    #[allow(dead_code)]
    pub fn get_label(&self) -> &str {
        self.label
            .as_deref()
            .unwrap_or(self.layer.as_deref().unwrap_or("unknown"))
    }

    #[allow(dead_code)]
    pub fn validate(&self) -> Result<(), String> {
        if self.geometry.is_empty() {
            return Err("geometry cannot be empty".to_string());
        }
        for point in &self.geometry {
            if point.len() < 2 {
                return Err("geometry points must have at least 2 coordinates".to_string());
            }
            let lng = point[0];
            let lat = point[1];
            if lng < -180.0 || lng > 180.0 {
                return Err(format!("invalid longitude: {}", lng));
            }
            if lat < -90.0 || lat > 90.0 {
                return Err(format!("invalid latitude: {}", lat));
            }
        }
        if let Some(h) = self.height {
            if h < 0.0 || h > MAX_HEIGHT {
                return Err(format!("invalid height: {} (must be 0-{})", h, MAX_HEIGHT));
            }
        }
        Ok(())
    }
}

// Struct to match GridSize from TypeScript
#[derive(Debug, Clone, Deserialize)]
pub struct GridSize {
    pub width: u32,
    pub height: u32,
}

// Struct to match VtDataSet from TypeScript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VtDataSet {
    #[serde(default, rename = "sourceLayer")]
    pub source_layer: String,
    #[serde(default, rename = "label")]
    pub label: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(rename = "bufferSize")]
    pub buffer_size: Option<f64>,
    #[serde(rename = "extrusionDepth")]
    pub extrusion_depth: Option<f64>,
    #[serde(rename = "minExtrusionDepth")]
    pub min_extrusion_depth: Option<f64>,
    #[serde(rename = "zOffset")]
    pub z_offset: Option<f64>,
    #[serde(rename = "alignVerticesToTerrain")]
    pub align_vertices_to_terrain: Option<bool>,
    #[serde(rename = "applyMedianHeight")]
    pub apply_median_height: Option<bool>,
    #[serde(rename = "addTerrainDifferenceToHeight")]
    pub add_terrain_difference_to_height: Option<bool>,
    pub filter: Option<serde_json::Value>,
}

// Helper function to get display label for a VtDataSet
impl VtDataSet {
    pub fn get_label(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.source_layer)
    }

    #[allow(dead_code)]
    pub fn validate(&self) -> Result<(), String> {
        if self.source_layer.is_empty() {
            return Err("source_layer cannot be empty".to_string());
        }
        if let Some(depth) = self.extrusion_depth {
            if depth < 0.0 {
                return Err("extrusion_depth cannot be negative".to_string());
            }
        }
        Ok(())
    }
}

// Default color function for VtDataSet
fn default_color() -> String {
    "#4B85AA".to_string() // Default blue color for water
}

// Input for the polygon geometry processing function
#[derive(Debug, Deserialize)]
pub struct PolygonGeometryInput {
    pub bbox: Vec<f64>, // [minLng, minLat, maxLng, maxLat]
    pub polygons: Vec<GeometryData>,
    #[allow(dead_code)] // Part of public API structure
    #[serde(rename = "terrainBaseHeight")]
    pub terrain_base_height: f64,
    #[allow(dead_code)] // Part of public API structure
    #[serde(rename = "verticalExaggeration")]
    pub vertical_exaggeration: f64,
    #[serde(rename = "elevationGrid")]
    pub elevation_grid: Vec<Vec<f64>>,
    #[serde(rename = "gridSize")]
    pub grid_size: GridSize,
    #[serde(rename = "minElevation")]
    pub min_elevation: f64,
    #[serde(rename = "maxElevation")]
    pub max_elevation: f64,
    // Terrain mesh data as base64-encoded strings to avoid serialization issues
    #[serde(rename = "terrainVerticesBase64", default)]
    pub terrain_vertices_base64: String,
    #[serde(rename = "terrainIndicesBase64", default)]
    pub terrain_indices_base64: String,
    #[serde(rename = "vtDataSet")]
    pub vt_data_set: VtDataSet,
    #[serde(default, rename = "useSameZOffset")]
    pub use_same_z_offset: bool,
    #[allow(dead_code)] // Part of public API structure
    #[serde(rename = "processId")]
    pub process_id: String,
    // Optionally override CSG clipping for this request
    #[serde(rename = "csgClipping")]
    pub csg_clipping: Option<bool>,
}

// Output struct for the polygon geometry
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BufferGeometry {
    pub vertices: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub colors: Option<Vec<f32>>,
    pub indices: Option<Vec<u32>>,
    pub uvs: Option<Vec<f32>>,
    #[serde(rename = "hasData")]
    pub has_data: bool,
    // Add properties from MVT data for debugging and interaction
    pub properties: Option<std::collections::HashMap<String, serde_json::Value>>,
}

// Sample terrain elevation using the EXACT same method as terrain mesh generation
// This ensures perfect alignment with the terrain mesh vertices by replicating terrain_mesh_gen.rs algorithm
fn sample_terrain_mesh_height_at_point(
    mesh_x: f64,
    mesh_y: f64,
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
    _bbox: &[f64],
    min_elevation: f64,
    max_elevation: f64,
    vertical_exaggeration: f64,
    terrain_base_height: f64,
) -> f64 {
    // Replicate the EXACT same algorithm used in terrain_mesh_gen.rs
    // Convert mesh coordinates to normalized terrain grid coordinates (0.0 to 1.0)
    // Mesh coordinates range from -100 to +100 (TERRAIN_SIZE = 200)
    let half_size = TERRAIN_SIZE / 2.0;
    let normalized_x = ((mesh_x + half_size) / TERRAIN_SIZE).clamp(0.0, 1.0);
    let normalized_y = ((mesh_y + half_size) / TERRAIN_SIZE).clamp(0.0, 1.0);

    // Sample elevation using bilinear interpolation from the grid
    let elevation = sample_elevation_from_grid(normalized_x, normalized_y, elevation_grid, grid_size);

    // Apply the EXACT same scaling as terrain_mesh_gen.rs
    let elevation_range = f64::max(1.0, max_elevation - min_elevation);
    let normalized_elevation = ((elevation - min_elevation) / elevation_range).clamp(0.0, 1.0);
    let scaled_exaggeration = vertical_exaggeration * EXAGGERATION_SCALE_FACTOR;
    let elevation_variation = normalized_elevation * scaled_exaggeration;

    // Calculate final terrain height: base + elevation variation
    let new_z = terrain_base_height + elevation_variation;

    // Apply the same minimum constraint as terrain mesh generation
    const MIN_TERRAIN_THICKNESS: f64 = 0.3;
    new_z.max(MIN_TERRAIN_THICKNESS)
}

// Helper function to sample elevation from grid (same logic as terrain mesh generation)
fn sample_elevation_from_grid(
    normalized_x: f64,
    normalized_y: f64,
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
) -> f64 {
    let source_width = grid_size.width as usize;
    let source_height = grid_size.height as usize;

    let src_x = normalized_x * (source_width - 1) as f64;
    let src_y = normalized_y * (source_height - 1) as f64;

    let x0 = src_x.floor() as usize;
    let y0 = src_y.floor() as usize;
    let x1 = (x0 + 1).min(source_width - 1);
    let y1 = (y0 + 1).min(source_height - 1);

    let dx = src_x - x0 as f64;
    let dy = src_y - y0 as f64;

    // Bilinear interpolation of elevation values
    let v00 = elevation_grid[y0][x0];
    let v10 = elevation_grid[y0][x1];
    let v01 = elevation_grid[y1][x0];
    let v11 = elevation_grid[y1][x1];

    let v0 = v00 * (1.0 - dx) + v10 * dx;
    let v1 = v01 * (1.0 - dx) + v11 * dx;

    v0 * (1.0 - dy) + v1 * dy
}

/// Subdivide polygon edges to ensure no edge is longer than max_length.
/// This is important for terrain-aligned geometries to follow terrain properly.
fn subdivide_polygon_edges(points: &[Vector2], max_length: f64) -> Vec<Vector2> {
    if points.len() < 2 {
        return points.to_vec();
    }
    
    let mut result = Vec::with_capacity(points.len() * 2);
    
    for i in 0..points.len() {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.len()];
        
        // Calculate edge length
        let dx = p2.x - p1.x;
        let dy = p2.y - p1.y;
        let edge_length = (dx * dx + dy * dy).sqrt();
        
        // Always add the start point
        result.push(p1);
        
        // If edge is longer than max_length, subdivide it
        if edge_length > max_length {
            let num_segments = (edge_length / max_length).ceil() as usize;
            for j in 1..num_segments {
                let t = j as f64 / num_segments as f64;
                result.push(Vector2 {
                    x: p1.x + dx * t,
                    y: p1.y + dy * t,
                });
            }
        }
    }
    
    result
}

/// Clip a polygon against a plane using Sutherland-Hodgman algorithm
fn clip_polygon_against_plane(
    polygon: &[(f64, f64, f64)],
    plane_normal: (f64, f64, f64),
    plane_point: (f64, f64, f64),
) -> Vec<(f64, f64, f64)> {
    if polygon.is_empty() {
        return Vec::new();
    }

    let mut output = Vec::new();
    
    for i in 0..polygon.len() {
        let current = polygon[i];
        let next = polygon[(i + 1) % polygon.len()];
        
        // Calculate signed distance to plane
        let current_dist = (current.0 - plane_point.0) * plane_normal.0
            + (current.1 - plane_point.1) * plane_normal.1
            + (current.2 - plane_point.2) * plane_normal.2;
        let next_dist = (next.0 - plane_point.0) * plane_normal.0
            + (next.1 - plane_point.1) * plane_normal.1
            + (next.2 - plane_point.2) * plane_normal.2;
        
        let current_inside = current_dist >= -1e-10;
        let next_inside = next_dist >= -1e-10;
        
        if current_inside {
            output.push(current);
        }
        
        // If edge crosses plane, add intersection point
        if current_inside != next_inside {
            let t = current_dist / (current_dist - next_dist);
            let intersection = (
                current.0 + t * (next.0 - current.0),
                current.1 + t * (next.1 - current.1),
                current.2 + t * (next.2 - current.2),
            );
            output.push(intersection);
        }
    }
    
    output
}

/// Clip a 3D mesh to a bounding box using polygon clipping algorithm.
/// This produces clean cut edges and watertight geometry with cap faces.
/// Returns (clipped_vertices, clipped_indices)
fn clip_mesh_to_bbox_3d(
    vertices: &[f32],
    indices: &[u32],
    bbox_min_x: f64,
    bbox_min_y: f64,
    bbox_max_x: f64,
    bbox_max_y: f64,
) -> (Vec<f32>, Vec<u32>) {
    if indices.is_empty() || vertices.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let mut new_vertices = Vec::new();
    let mut new_indices = Vec::new();
    let mut vertex_map: HashMap<(i64, i64, i64), u32> = HashMap::new();
    
    // Track edges for cap generation: edge -> count
    let mut edge_count: HashMap<(u32, u32), usize> = HashMap::new();
    
    // Process each triangle
    for tri in indices.chunks(3) {
        if tri.len() != 3 {
            continue;
        }

        let i0 = tri[0] as usize * 3;
        let i1 = tri[1] as usize * 3;
        let i2 = tri[2] as usize * 3;

        if i0 + 2 >= vertices.len() || i1 + 2 >= vertices.len() || i2 + 2 >= vertices.len() {
            continue;
        }

        // Get triangle vertices
        let mut polygon = vec![
            (vertices[i0] as f64, vertices[i0 + 1] as f64, vertices[i0 + 2] as f64),
            (vertices[i1] as f64, vertices[i1 + 1] as f64, vertices[i1 + 2] as f64),
            (vertices[i2] as f64, vertices[i2 + 1] as f64, vertices[i2 + 2] as f64),
        ];

        // Clip against all 4 bounding box planes
        // Left plane (X = min_x)
        polygon = clip_polygon_against_plane(&polygon, (1.0, 0.0, 0.0), (bbox_min_x, 0.0, 0.0));
        if polygon.is_empty() { continue; }
        
        // Right plane (X = max_x)
        polygon = clip_polygon_against_plane(&polygon, (-1.0, 0.0, 0.0), (bbox_max_x, 0.0, 0.0));
        if polygon.is_empty() { continue; }
        
        // Bottom plane (Y = min_y)
        polygon = clip_polygon_against_plane(&polygon, (0.0, 1.0, 0.0), (0.0, bbox_min_y, 0.0));
        if polygon.is_empty() { continue; }
        
        // Top plane (Y = max_y)
        polygon = clip_polygon_against_plane(&polygon, (0.0, -1.0, 0.0), (0.0, bbox_max_y, 0.0));
        if polygon.is_empty() { continue; }

        // Triangulate the clipped polygon (fan triangulation)
        if polygon.len() < 3 {
            continue;
        }

        for i in 1..(polygon.len() - 1) {
            let v0 = polygon[0];
            let v1 = polygon[i];
            let v2 = polygon[i + 1];

            // Quantize for deduplication
            let key0 = (
                (v0.0 * 1000.0).round() as i64,
                (v0.1 * 1000.0).round() as i64,
                (v0.2 * 1000.0).round() as i64,
            );
            let key1 = (
                (v1.0 * 1000.0).round() as i64,
                (v1.1 * 1000.0).round() as i64,
                (v1.2 * 1000.0).round() as i64,
            );
            let key2 = (
                (v2.0 * 1000.0).round() as i64,
                (v2.1 * 1000.0).round() as i64,
                (v2.2 * 1000.0).round() as i64,
            );

            let idx0 = *vertex_map.entry(key0).or_insert_with(|| {
                let idx = (new_vertices.len() / 3) as u32;
                new_vertices.push(v0.0 as f32);
                new_vertices.push(v0.1 as f32);
                new_vertices.push(v0.2 as f32);
                idx
            });

            let idx1 = *vertex_map.entry(key1).or_insert_with(|| {
                let idx = (new_vertices.len() / 3) as u32;
                new_vertices.push(v1.0 as f32);
                new_vertices.push(v1.1 as f32);
                new_vertices.push(v1.2 as f32);
                idx
            });

            let idx2 = *vertex_map.entry(key2).or_insert_with(|| {
                let idx = (new_vertices.len() / 3) as u32;
                new_vertices.push(v2.0 as f32);
                new_vertices.push(v2.1 as f32);
                new_vertices.push(v2.2 as f32);
                idx
            });

            new_indices.push(idx0);
            new_indices.push(idx1);
            new_indices.push(idx2);
            
            // Track edges (store in canonical order: smaller index first)
            let edges = [
                (idx0.min(idx1), idx0.max(idx1)),
                (idx1.min(idx2), idx1.max(idx2)),
                (idx2.min(idx0), idx2.max(idx0)),
            ];
            
            for edge in &edges {
                *edge_count.entry(*edge).or_insert(0) += 1;
            }
        }
    }
    
    // Find boundary edges (edges that appear only once - these are open edges)
    let boundary_edges: Vec<(u32, u32)> = edge_count
        .iter()
        .filter(|(_, &count)| count == 1)
        .map(|(&edge, _)| edge)
        .collect();
    
    // Collect boundary vertices on each bbox plane and create cap polygons
    if !boundary_edges.is_empty() {
        let tolerance = 0.1;
        
        // Separate boundary edges by which plane they're on
        let mut edges_on_min_x = Vec::new();
        let mut edges_on_max_x = Vec::new();
        let mut edges_on_min_y = Vec::new();
        let mut edges_on_max_y = Vec::new();
        
        for &(idx0, idx1) in &boundary_edges {
            let x0 = new_vertices[idx0 as usize * 3] as f64;
            let y0 = new_vertices[idx0 as usize * 3 + 1] as f64;
            
            let x1 = new_vertices[idx1 as usize * 3] as f64;
            let y1 = new_vertices[idx1 as usize * 3 + 1] as f64;
            
            // Check if both vertices are on a boundary plane
            if (x0 - bbox_min_x).abs() < tolerance && (x1 - bbox_min_x).abs() < tolerance {
                edges_on_min_x.push((idx0, idx1));
            } else if (x0 - bbox_max_x).abs() < tolerance && (x1 - bbox_max_x).abs() < tolerance {
                edges_on_max_x.push((idx0, idx1));
            } else if (y0 - bbox_min_y).abs() < tolerance && (y1 - bbox_min_y).abs() < tolerance {
                edges_on_min_y.push((idx0, idx1));
            } else if (y0 - bbox_max_y).abs() < tolerance && (y1 - bbox_max_y).abs() < tolerance {
                edges_on_max_y.push((idx0, idx1));
            }
        }
        
        // Helper to build chains and triangulate caps for one boundary plane
        // Can have multiple disconnected chains (e.g., when linestring exits and re-enters bbox)
        let mut build_cap = |edges: &[(u32, u32)]| {
            if edges.is_empty() { return; }
            
            let mut used = vec![false; edges.len()];
            
            // Process all chains on this boundary
            loop {
                // Find first unused edge to start a new chain
                let start_idx = used.iter().position(|&u| !u);
                if start_idx.is_none() { break; }
                let start_idx = start_idx.unwrap();
                
                // Build ordered chain of vertices starting from this edge
                let mut chain = Vec::new();
                chain.push(edges[start_idx].0);
                chain.push(edges[start_idx].1);
                used[start_idx] = true;
                
                // Keep adding connected edges
                let mut changed = true;
                while changed {
                    changed = false;
                    for i in 0..edges.len() {
                        if used[i] { continue; }
                        
                        let last = *chain.last().unwrap();
                        if edges[i].0 == last {
                            chain.push(edges[i].1);
                            used[i] = true;
                            changed = true;
                        } else if edges[i].1 == last {
                            chain.push(edges[i].0);
                            used[i] = true;
                            changed = true;
                        }
                    }
                }
                
                // Remove duplicates
                chain.dedup();
                
                if chain.len() < 3 { continue; }
                
                // Triangulate the boundary contour using fan triangulation
                // This creates a cap face that fills the hole
                let first_idx = chain[0];
                for i in 1..(chain.len() - 1) {
                    let idx1 = chain[i];
                    let idx2 = chain[i + 1];
                    
                    // Add triangle (first, i, i+1)
                    new_indices.push(first_idx);
                    new_indices.push(idx1);
                    new_indices.push(idx2);
                }
            }
        };
        
        build_cap(&edges_on_min_x);
        build_cap(&edges_on_max_x);
        build_cap(&edges_on_min_y);
        build_cap(&edges_on_max_y);
    }

    (new_vertices, new_indices)
}

// Sample a terrain elevation at a specific geographic point with proper scaling
fn sample_terrain_elevation_at_point(
    lng: f64,
    lat: f64,
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
    bbox: &[f64],
    min_elevation: f64,
    max_elevation: f64,
    vertical_exaggeration: f64,
    terrain_base_height: f64,
) -> f64 {
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];

    // Normalize coordinates to 0-1 range within the grid
    let nx = (lng - min_lng) / (max_lng - min_lng);
    let ny = (lat - min_lat) / (max_lat - min_lat);

    // Convert to grid indices
    let grid_width = grid_size.width as usize;
    let grid_height = grid_size.height as usize;

    let x = (nx * (grid_width as f64 - 1.0)).clamp(0.0, (grid_width as f64) - 1.001);
    let y = (ny * (grid_height as f64 - 1.0)).clamp(0.0, (grid_height as f64) - 1.001);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(grid_width - 1);
    let y1 = (y0 + 1).min(grid_height - 1);

    let dx = x - x0 as f64;
    let dy = y - y0 as f64;

    // Bilinear interpolation of elevation values
    let v00 = elevation_grid[y0][x0];
    let v10 = elevation_grid[y0][x1];
    let v01 = elevation_grid[y1][x0];
    let v11 = elevation_grid[y1][x1];

    let v0 = v00 * (1.0 - dx) + v10 * dx;
    let v1 = v01 * (1.0 - dx) + v11 * dx;

    let elevation = v0 * (1.0 - dy) + v1 * dy;

    // Apply the same scaling as terrain generation (must match terrain_mesh_gen.rs exactly)
    let elevation_range = f64::max(1.0, max_elevation - min_elevation);
    let normalized_elevation = (elevation - min_elevation) / elevation_range;
    let base_box_height = terrain_base_height; // Use terrain base height as box height (no magic numbers)
    let scaled_exaggeration = vertical_exaggeration * EXAGGERATION_SCALE_FACTOR;
    let elevation_variation = normalized_elevation * scaled_exaggeration; // Apply scale factor like terrain.rs


    // Calculate final terrain height
    let final_height = base_box_height + elevation_variation;

    // SAFETY: Ensure terrain height never goes below base height
    let safe_height = final_height.max(base_box_height);


    safe_height
}

/// Sample raw elevation (in meters) at a geographic point WITHOUT vertical exaggeration.
/// Used for computing elevation differences for building height adjustments.
fn sample_raw_elevation_at_point(
    lng: f64,
    lat: f64,
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
    bbox: &[f64],
) -> f64 {
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];

    // Normalize coordinates to 0-1 range within the grid
    let nx = (lng - min_lng) / (max_lng - min_lng);
    let ny = (lat - min_lat) / (max_lat - min_lat);

    // Convert to grid indices
    let grid_width = grid_size.width as usize;
    let grid_height = grid_size.height as usize;

    let x = (nx * (grid_width as f64 - 1.0)).clamp(0.0, (grid_width as f64) - 1.001);
    let y = (ny * (grid_height as f64 - 1.0)).clamp(0.0, (grid_height as f64) - 1.001);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(grid_width - 1);
    let y1 = (y0 + 1).min(grid_height - 1);

    let dx = x - x0 as f64;
    let dy = y - y0 as f64;

    // Bilinear interpolation of elevation values (raw meters)
    let v00 = elevation_grid[y0][x0];
    let v10 = elevation_grid[y0][x1];
    let v01 = elevation_grid[y1][x0];
    let v11 = elevation_grid[y1][x1];

    let v0 = v00 * (1.0 - dx) + v10 * dx;
    let v1 = v01 * (1.0 - dx) + v11 * dx;

    // Return raw elevation in meters (no exaggeration applied)
    v0 * (1.0 - dy) + v1 * dy
}

// Sample elevation from processed elevation grid (no additional scaling needed)
fn sample_processed_terrain_elevation(
    lng: f64,
    lat: f64,
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
    bbox: &[f64],
) -> f64 {
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];

    // Normalize coordinates to 0-1 range within the grid
    let nx = (lng - min_lng) / (max_lng - min_lng);
    let ny = (lat - min_lat) / (max_lat - min_lat);

    // Convert to grid indices
    let grid_width = grid_size.width as usize;
    let grid_height = grid_size.height as usize;

    let x = (nx * (grid_width as f64 - 1.0)).clamp(0.0, (grid_width as f64) - 1.001);
    let y = (ny * (grid_height as f64 - 1.0)).clamp(0.0, (grid_height as f64) - 1.001);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(grid_width - 1);
    let y1 = (y0 + 1).min(grid_height - 1);

    let dx = x - x0 as f64;
    let dy = y - y0 as f64;

    // Bilinear interpolation of processed elevation values (already scaled)
    let v00 = elevation_grid[y0][x0];
    let v10 = elevation_grid[y0][x1];
    let v01 = elevation_grid[y1][x0];
    let v11 = elevation_grid[y1][x1];

    let v0 = v00 * (1.0 - dx) + v10 * dx;
    let v1 = v01 * (1.0 - dx) + v11 * dx;

    // Return the interpolated processed elevation (no scaling needed)
    v0 * (1.0 - dy) + v1 * dy
}

// Transform geographic coordinates to mesh coordinates
fn transform_to_mesh_coordinates(lng: f64, lat: f64, bbox: &[f64]) -> [f64; 2] {
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];

    // Convert from geographic coords to normalized 0-1 space
    let normalized_x = (lng - min_lng) / (max_lng - min_lng);
    let normalized_y = (lat - min_lat) / (max_lat - min_lat);

    // Convert to mesh coordinates (terrain is 200x200 units centered at origin)
    let mesh_x = (normalized_x * TERRAIN_SIZE) - (TERRAIN_SIZE / 2.0);
    let mesh_y = (normalized_y * TERRAIN_SIZE) - (TERRAIN_SIZE / 2.0);

    [mesh_x, mesh_y]
}

// Calculate scaling factor to convert real-world meters to terrain units
fn calculate_meters_to_terrain_units(bbox: &[f64]) -> f64 {
    // Calculate the real-world dimensions of the bbox in meters
    let lat_center = (bbox[1] + bbox[3]) / 2.0;
    let lat_rad = lat_center.to_radians();

    // Earth's radius in meters
    const EARTH_RADIUS_M: f64 = 6_371_000.0;

    // Calculate width and height in meters
    let lng_diff = bbox[2] - bbox[0];
    let lat_diff = bbox[3] - bbox[1];

    let width_m = lng_diff.to_radians() * EARTH_RADIUS_M * lat_rad.cos();
    let height_m = lat_diff.to_radians() * EARTH_RADIUS_M;

    // Use average dimension for consistent scaling
    let avg_dimension_m = (width_m + height_m) / 2.0;

    // Return terrain units per meter
    TERRAIN_SIZE / avg_dimension_m
}

// Check if points are ordered clockwise
fn is_clockwise(points: &[Vector2]) -> bool {
    // Implementation of the "shoelace formula" (also called the surveyor's formula)
    let mut sum = 0.0;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
    }
    sum > 0.0
}

// Calculate the area of a polygon using the shoelace formula (unused - commented out)
#[allow(dead_code)]
fn calculate_polygon_area(coordinates: &[Vec<f64>]) -> f64 {
    if coordinates.len() < 3 {
        return 0.0;
    }

    let mut area = 0.0;
    for i in 0..coordinates.len() {
        let j = (i + 1) % coordinates.len();
        if coordinates[i].len() >= 2 && coordinates[j].len() >= 2 {
            area += coordinates[i][0] * coordinates[j][1];
            area -= coordinates[j][0] * coordinates[i][1];
        }
    }
    (area / 2.0).abs()
}

// Enhanced polygon validation to catch degenerate cases
fn is_valid_polygon(points: &[Vector2]) -> bool {
    if points.len() < 3 {
        return false;
    }

    // Check if all points are collinear (degenerate polygon)
    if points.len() >= 3 {
        let p0 = points[0];
        let p1 = points[1];

        // Calculate direction vector for first edge
        let dx = p1.x - p0.x;
        let dy = p1.y - p0.y;

        // Check if all points are on the same line
        let mut all_collinear = true;
        for i in 2..points.len() {
            let p = points[i];

            // Cross product should be near zero if collinear
            let cross = (p.y - p0.y) * dx - (p.x - p0.x) * dy;
            if cross.abs() > 1e-4 {
                all_collinear = false;
                break;
            }
        }

        if all_collinear {
            return false;
        }
    }

    // Calculate area to check if polygon is too small
    let mut area = 0.0;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        area += points[i].x * points[j].y;
        area -= points[i].y * points[j].x;
    }
    area = (area / 2.0).abs();

    // Check if area is too small (degenerate)
    if area < 1e-6 {
        return false;
    }

    true
}

// Enhanced polygon cleaning that also ensures correct winding
fn clean_polygon_footprint(points: &[Vector2]) -> Vec<Vector2> {
    if points.len() < 3 {
        return Vec::new(); // Cannot form a polygon
    }

    let mut cleaned: Vec<Vector2> = Vec::with_capacity(points.len());
    cleaned.push(points[0]); // Start with the first point

    // Remove consecutive duplicates
    for i in 1..points.len() {
        let current_point = points[i];
        // Safe unwrap: cleaned always has at least one element here
        let last_added_point = *cleaned.last().unwrap();

        if (current_point.x - last_added_point.x).abs() > EPSILON
            || (current_point.y - last_added_point.y).abs() > EPSILON
        {
            cleaned.push(current_point);
        }
    }

    // Check if the first and last points are duplicates *after* cleaning consecutive ones
    if cleaned.len() > 1 {
        let first_point = cleaned[0];
        let last_point = *cleaned.last().unwrap();
        if (first_point.x - last_point.x).abs() < EPSILON
            && (first_point.y - last_point.y).abs() < EPSILON
        {
            cleaned.pop(); // Remove the last point, it's a duplicate of the first
        }
    }

    // Final check: need at least 3 unique vertices for a polygon
    if cleaned.len() < 3 {
        return Vec::new();
    }

    // Ensure counter-clockwise winding for consistent triangulation
    if is_clockwise(&cleaned) {
        cleaned.reverse();
    }

    // Validate the final polygon
    if !is_valid_polygon(&cleaned) {
        return Vec::new();
    }

    cleaned // Return the list of unique vertices
}

// Modified clipping function with better error handling
fn clip_polygon_to_bbox_2d(
    unique_shape_points: &[Vector2],
    mesh_bbox_coords: &[f64; 4],
) -> Vec<Vector2> {
    if unique_shape_points.len() < 3 {
        return Vec::new();
    }

    // Simple containment check - if all points are outside the bbox, return empty
    let bbox_min_x = mesh_bbox_coords[0];
    let bbox_min_y = mesh_bbox_coords[1];
    let bbox_max_x = mesh_bbox_coords[2];
    let bbox_max_y = mesh_bbox_coords[3];

    let mut all_points_outside = true;
    for point in unique_shape_points {
        if point.x >= bbox_min_x
            && point.x <= bbox_max_x
            && point.y >= bbox_min_y
            && point.y <= bbox_max_y
        {
            all_points_outside = false;
            break;
        }
    }

    if all_points_outside {
        // Do a more detailed check - see if any edges intersect the bbox
        let mut has_intersection = false;
        for i in 0..unique_shape_points.len() {
            let j = (i + 1) % unique_shape_points.len();
            let p1 = unique_shape_points[i];
            let p2 = unique_shape_points[j];

            // Line segment intersects with any of the four bbox edges?
            if (p1.x < bbox_min_x && p2.x > bbox_min_x)
                || (p1.x > bbox_min_x && p2.x < bbox_min_x)
                || (p1.x < bbox_max_x && p2.x > bbox_max_x)
                || (p1.x > bbox_max_x && p2.x < bbox_max_x)
                || (p1.y < bbox_min_y && p2.y > bbox_min_y)
                || (p1.y > bbox_min_y && p2.y < bbox_min_y)
                || (p1.y < bbox_max_y && p2.y > bbox_max_y)
                || (p1.y > bbox_max_y && p2.y < bbox_max_y)
            {
                has_intersection = true;
                break;
            }
        }

        if !has_intersection {
            return Vec::new(); // Completely outside
        }
    }

    // Since CSG is removed, use simple clipping directly
    let mut ccw_points = unique_shape_points.to_vec();
    if is_clockwise(&ccw_points) {
        ccw_points.reverse();
    }

    // Use simple clipping instead of CSG
    return simple_clip_polygon(&ccw_points, mesh_bbox_coords);
}

// Simple clipping fallback when CSG fails
fn simple_clip_polygon(points: &[Vector2], bbox: &[f64; 4]) -> Vec<Vector2> {
    let min_x = bbox[0];
    let min_y = bbox[1];
    let max_x = bbox[2];
    let max_y = bbox[3];

    // Early return if there's nothing to clip
    if points.len() < 3 {
        return Vec::new();
    }

    // Convert Vector2 points to format expected by polygon_intersects_bbox
    let polygon_coords: Vec<Vec<f64>> = points.iter().map(|p| vec![p.x, p.y]).collect();

    let bbox_array = [min_x, min_y, max_x, max_y];

    // Use the robust polygon-bbox intersection check
    if !polygon_intersects_bbox(&polygon_coords, &bbox_array) {
        return Vec::new();
    }

    // Sutherland-Hodgman polygon clipping algorithm
    let mut clipped = points.to_vec();

    // Clip against each edge of the bounding box
    let clip_edges = [
        (min_x, 0), // Left edge
        (max_x, 1), // Right edge
        (min_y, 2), // Bottom edge
        (max_y, 3), // Top edge
    ];

    for (clip_value, edge_type) in clip_edges {
        if clipped.is_empty() {
            break;
        }

        let mut new_clipped = Vec::new();

        if !clipped.is_empty() {
            let mut prev = clipped[clipped.len() - 1];

            for &curr in &clipped {
                let prev_inside = match edge_type {
                    0 => prev.x >= clip_value, // Left
                    1 => prev.x <= clip_value, // Right
                    2 => prev.y >= clip_value, // Bottom
                    3 => prev.y <= clip_value, // Top
                    _ => false,
                };

                let curr_inside = match edge_type {
                    0 => curr.x >= clip_value, // Left
                    1 => curr.x <= clip_value, // Right
                    2 => curr.y >= clip_value, // Bottom
                    3 => curr.y <= clip_value, // Top
                    _ => false,
                };

                if curr_inside {
                    if !prev_inside {
                        // Entering the clipping area - add intersection point
                        if let Some(intersection) =
                            compute_intersection(prev, curr, clip_value, edge_type)
                        {
                            new_clipped.push(intersection);
                        }
                    }
                    // Add current point
                    new_clipped.push(curr);
                } else if prev_inside {
                    // Leaving the clipping area - add intersection point
                    if let Some(intersection) =
                        compute_intersection(prev, curr, clip_value, edge_type)
                    {
                        new_clipped.push(intersection);
                    }
                }

                prev = curr;
            }
        }

        clipped = new_clipped;
    }

    // Clean up the clipped points and ensure they form a valid polygon
    let cleaned = clean_polygon_footprint(&clipped);

    // If we still don't have enough points, but the original polygon intersects the bbox,
    // create a minimal representation
    if cleaned.len() < 3 && clipped.len() > 0 {
        // Check if the bbox is completely inside the polygon
        let bbox_corners = vec![
            Vector2 { x: min_x, y: min_y },
            Vector2 { x: max_x, y: min_y },
            Vector2 { x: max_x, y: max_y },
            Vector2 { x: min_x, y: max_y },
        ];

        // Use ray casting to check if bbox corners are inside the polygon
        let mut inside_corners = Vec::new();
        for corner in &bbox_corners {
            if is_point_inside_polygon(*corner, points) {
                inside_corners.push(*corner);
            }
        }

        if inside_corners.len() >= 3 {
            // The bbox is (mostly) inside the polygon
            return inside_corners;
        }

        // Fallback: create a minimal triangle if we have any valid points
        if clipped.len() >= 1 {
            let mut fallback = clipped.clone();

            // Ensure we have at least 3 points for a valid polygon
            while fallback.len() < 3 && fallback.len() > 0 {
                let last_point = fallback[fallback.len() - 1];
                let epsilon = 0.001;
                fallback.push(Vector2 {
                    x: (last_point.x + epsilon).clamp(min_x, max_x),
                    y: (last_point.y + epsilon).clamp(min_y, max_y),
                });
            }

            return clean_polygon_footprint(&fallback);
        }
    }

    cleaned
}

// Helper function to compute intersection point for Sutherland-Hodgman clipping
fn compute_intersection(
    p1: Vector2,
    p2: Vector2,
    clip_value: f64,
    edge_type: i32,
) -> Option<Vector2> {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;

    match edge_type {
        0 | 1 => {
            // Left or Right edge (vertical)
            if dx.abs() < 1e-10 {
                return None; // Line is parallel to clip edge
            }
            let t = (clip_value - p1.x) / dx;
            if t >= 0.0 && t <= 1.0 {
                Some(Vector2 {
                    x: clip_value,
                    y: p1.y + t * dy,
                })
            } else {
                None
            }
        }
        2 | 3 => {
            // Bottom or Top edge (horizontal)
            if dy.abs() < 1e-10 {
                return None; // Line is parallel to clip edge
            }
            let t = (clip_value - p1.y) / dy;
            if t >= 0.0 && t <= 1.0 {
                Some(Vector2 {
                    x: p1.x + t * dx,
                    y: clip_value,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

// Helper function to check if a point is inside a polygon using ray casting
fn is_point_inside_polygon(point: Vector2, polygon: &[Vector2]) -> bool {
    let mut inside = false;
    let n = polygon.len();

    for i in 0..n {
        let j = (i + 1) % n;
        let pi = polygon[i];
        let pj = polygon[j];

        if ((pi.y > point.y) != (pj.y > point.y))
            && (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x)
        {
            inside = !inside;
        }
    }

    inside
}

/// Calculate the signed area of a polygon (positive = counter-clockwise, negative = clockwise)
fn signed_polygon_area(points: &[Vector2]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    let n = points.len();
    for i in 0..n {
        let j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    area * 0.5
}

/// Maximum edge length for polygon subdivision before triangulation
/// Smaller values = more triangles but slower processing
const MAX_POLYGON_EDGE_LENGTH: f64 = 1.0; // In mesh coordinates - balanced value

/// Clean a polygon for triangulation - validates, subdivides edges, and returns points if valid
fn clean_polygon_for_triangulation(points: &[Vector2]) -> Option<Vec<Vector2>> {
    if points.len() < 3 {
        return None;
    }
    
    // Check for minimum area - very small polygons cause triangulation issues
    let area = signed_polygon_area(points).abs();
    if area < EPSILON * EPSILON * 100.0 {
        return None;
    }
    
    // Subdivide edges to create more perimeter vertices
    // This helps earcut create smaller triangles
    let subdivided = subdivide_polygon_edges(points, MAX_POLYGON_EDGE_LENGTH);
    
    Some(subdivided)
}

/// Create extruded geometry from a pre-triangulated quad strip (for terrain-aligned roads)
/// This bypasses earcut entirely, creating geometry with small quads that follow terrain well
fn create_extruded_shape_from_quad_strip(
    quad_mesh: &LineStringMesh,
    height: f64,
    bbox: &[f64],
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
    min_elevation: f64,
    max_elevation: f64,
    vertical_exaggeration: f64,
    terrain_base_height: f64,
    _terrain_vertices_base64: &str,
    _terrain_indices_base64: &str,
    properties: Option<std::collections::HashMap<String, serde_json::Value>>,
) -> BufferGeometry {
    let num_2d_verts = quad_mesh.vertices.len() / 2;
    if num_2d_verts < 4 || quad_mesh.indices.is_empty() {
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            has_data: false,
            properties,
        };
    }

    // Transform 2D vertices to mesh coordinates and sample terrain elevation
    let mut bottom_verts: Vec<[f32; 3]> = Vec::with_capacity(num_2d_verts);
    let mut top_verts: Vec<[f32; 3]> = Vec::with_capacity(num_2d_verts);

    for i in 0..num_2d_verts {
        let geo_x = quad_mesh.vertices[i * 2];
        let geo_y = quad_mesh.vertices[i * 2 + 1];

        // Transform to mesh coordinates
        let [mesh_x, mesh_y] = transform_to_mesh_coordinates(geo_x, geo_y, bbox);

        // Sample terrain elevation at this point using grid-based method
        let terrain_z = sample_terrain_mesh_height_at_point(
            mesh_x,
            mesh_y,
            elevation_grid,
            grid_size,
            bbox,
            min_elevation,
            max_elevation,
            vertical_exaggeration,
            terrain_base_height,
        ) as f32;

        // Small offset to embed bottom slightly into terrain
        let bottom_z = terrain_z - 0.05;
        let top_z = terrain_z + height as f32;

        bottom_verts.push([mesh_x as f32, mesh_y as f32, bottom_z]);
        top_verts.push([mesh_x as f32, mesh_y as f32, top_z]);
    }

    // Build vertex buffer: bottom vertices followed by top vertices
    let mut vertices: Vec<f32> = Vec::with_capacity((num_2d_verts * 2) * 3);
    for v in &bottom_verts {
        vertices.push(v[0]);
        vertices.push(v[1]);
        vertices.push(v[2]);
    }
    for v in &top_verts {
        vertices.push(v[0]);
        vertices.push(v[1]);
        vertices.push(v[2]);
    }

    // Build index buffer
    let mut indices: Vec<u32> = Vec::new();
    let top_offset = num_2d_verts as u32;

    // Bottom face (reverse winding for outward normals)
    for tri in quad_mesh.indices.chunks(3) {
        if tri.len() == 3 {
            indices.push(tri[0]);
            indices.push(tri[2]);
            indices.push(tri[1]);
        }
    }

    // Top face (normal winding)
    for tri in quad_mesh.indices.chunks(3) {
        if tri.len() == 3 {
            indices.push(top_offset + tri[0]);
            indices.push(top_offset + tri[1]);
            indices.push(top_offset + tri[2]);
        }
    }

    // Side walls - create quads between bottom and top for each edge
    // We need to find the boundary edges and create walls for them
    // For a quad strip, the boundary is the left and right edges plus the ends
    
    // Build side walls by iterating through pairs
    let num_pairs = num_2d_verts / 2;
    
    // Left side (even indices: 0, 2, 4, ...)
    for i in 0..(num_pairs - 1) {
        let b0 = (i * 2) as u32;       // bottom left[i]
        let b1 = ((i + 1) * 2) as u32; // bottom left[i+1]
        let t0 = top_offset + b0;       // top left[i]
        let t1 = top_offset + b1;       // top left[i+1]
        
        // Quad as two triangles (outward facing on left side)
        indices.push(b0);
        indices.push(t0);
        indices.push(b1);
        
        indices.push(t0);
        indices.push(t1);
        indices.push(b1);
    }

    // Right side (odd indices: 1, 3, 5, ...)
    for i in 0..(num_pairs - 1) {
        let b0 = (i * 2 + 1) as u32;       // bottom right[i]
        let b1 = ((i + 1) * 2 + 1) as u32; // bottom right[i+1]
        let t0 = top_offset + b0;           // top right[i]
        let t1 = top_offset + b1;           // top right[i+1]
        
        // Quad as two triangles (outward facing on right side - reversed winding)
        indices.push(b0);
        indices.push(b1);
        indices.push(t0);
        
        indices.push(t0);
        indices.push(b1);
        indices.push(t1);
    }

    // Start cap (first pair)
    {
        let bl = 0u32;                // bottom left[0]
        let br = 1u32;                // bottom right[0]
        let tl = top_offset;          // top left[0]
        let tr = top_offset + 1;      // top right[0]
        
        // Quad as two triangles
        indices.push(bl);
        indices.push(br);
        indices.push(tl);
        
        indices.push(tl);
        indices.push(br);
        indices.push(tr);
    }

    // End cap (last pair)
    {
        let last_pair = num_pairs - 1;
        let bl = (last_pair * 2) as u32;     // bottom left[last]
        let br = (last_pair * 2 + 1) as u32; // bottom right[last]
        let tl = top_offset + bl;             // top left[last]
        let tr = top_offset + br;             // top right[last]
        
        // Quad as two triangles (reversed winding)
        indices.push(bl);
        indices.push(tl);
        indices.push(br);
        
        indices.push(tl);
        indices.push(tr);
        indices.push(br);
    }

    BufferGeometry {
        vertices,
        normals: None,
        colors: None,
        indices: Some(indices),
        uvs: None,
        has_data: true,
        properties,
    }
}

// REVISED: Improved implementation of an extruded shape using the extrude_geometry function
fn create_extruded_shape(
    unique_shape_points: &[Vector2],
    height: f64,
    z_offset: f64,
    properties: Option<std::collections::HashMap<String, serde_json::Value>>,
    align_vertices_to_terrain: bool,
    elevation_grid: Option<&[Vec<f64>]>,
    grid_size: Option<&GridSize>,
    bbox: Option<&[f64]>,
    min_elevation: Option<f64>,
    max_elevation: Option<f64>,
    vertical_exaggeration: Option<f64>,
    terrain_base_height: Option<f64>,
    _source_layer: Option<&str>,
    terrain_vertices_base64: Option<&str>,
    terrain_indices_base64: Option<&str>,
) -> BufferGeometry {
    // Basic validation
    if height < MIN_HEIGHT {
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            has_data: false,
            properties,
        };
    }

    // Ensure we have enough points to form a valid polygon
    if unique_shape_points.len() < 3 {
        // For debugging purposes

        // Not enough points to form a polygon, create a simple fallback shape
        if unique_shape_points.len() == 1 {
            // For a single point, create a small square around it
            let pt = unique_shape_points[0];
            let size = 0.1; // Small size to make it visible but not obtrusive
            let square_points = vec![
                Vector2 {
                    x: pt.x - size,
                    y: pt.y - size,
                },
                Vector2 {
                    x: pt.x + size,
                    y: pt.y - size,
                },
                Vector2 {
                    x: pt.x + size,
                    y: pt.y + size,
                },
                Vector2 {
                    x: pt.x - size,
                    y: pt.y + size,
                },
            ];
            return create_extruded_shape(
                &square_points,
                height,
                z_offset,
                None,
                false,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            );
        } else if unique_shape_points.len() == 2 {
            // For two points, create a thin rectangle along the line
            let p1 = unique_shape_points[0];
            let p2 = unique_shape_points[1];
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let length = (dx * dx + dy * dy).sqrt();

            // Skip if the points are too close
            if length < 0.001 {
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

            // Normalize direction vector
            let nx = dx / length;
            let ny = dy / length;

            // Perpendicular vector
            let px = -ny;
            let py = nx;

            // Width of the rectangle
            let width = 0.05;

            // Create a thin rectangle
            let rect_points = vec![
                Vector2 {
                    x: p1.x + px * width,
                    y: p1.y + py * width,
                },
                Vector2 {
                    x: p2.x + px * width,
                    y: p2.y + py * width,
                },
                Vector2 {
                    x: p2.x - px * width,
                    y: p2.y - py * width,
                },
                Vector2 {
                    x: p1.x - px * width,
                    y: p1.y - py * width,
                },
            ];
            return create_extruded_shape(
                &rect_points,
                height,
                z_offset,
                None,
                false,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            );
        }

        // If we somehow get here with no points, return empty geometry
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

    let _unique_points_count = unique_shape_points.len();
    //
    //
    // Convert the points to the format expected by extrude_geometry
    // The extrude function expects a list of shapes, each shape is an array of rings
    // First ring is the contour, any additional rings are holes (not used here)
    let mut shape_points = Vec::new();
    for point in unique_shape_points {
        shape_points.push([point.x, point.y]);
    }

    // Create the shape array (rings array)
    let shape_with_rings = vec![shape_points];

    // Create an array of shapes (only one shape for now)
    let shapes = vec![shape_with_rings];

    // Create options for extrusion
    let options = serde_json::json!({
        "depth": height,
        "steps": 1,
    });

    // Convert inputs to JsValue
    let _shapes_js = match to_value(&shapes) {
        Ok(val) => val,
        Err(_e) => {
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
    };

    let _options_js = match to_value(&options) {
        Ok(val) => val,
        Err(_e) => {
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
    };

    // Call the extrude_shape function with native Rust types
    // Always include bottom faces for manifold geometry (required for 3D printing)
    let skip_bottom_face = false; // Always generate bottom faces for manifold geometry
    let extruded_js = match extrude::extrude_shape_with_options(shapes, height, 1, skip_bottom_face)
    {
        Ok(val) => val,
        Err(_e) => {
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
    };

    // Apply z_offset to the vertices ONLY if NOT using per-vertex terrain alignment
    // When align_vertices_to_terrain is true, we'll handle Z positioning per-vertex later
    if z_offset != 0.0 && !align_vertices_to_terrain {
        // Get position array from extruded_js
        let position_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("position"))
            .unwrap_or(JsValue::null());
        if position_js.is_null() {
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

        let position_array = Float32Array::from(position_js);
        let mut vertices = vec![0.0; position_array.length() as usize];
        position_array.copy_to(&mut vertices);

        // Apply z_offset to each z value (every 3rd element)
        for i in (2..vertices.len()).step_by(3) {
            vertices[i] += z_offset as f32;
        }

        // Replace the position array in the result
        let new_position = Float32Array::from(vertices.as_slice());
        js_sys::Reflect::set(&extruded_js, &JsValue::from_str("position"), &new_position).unwrap();
    }

    // Convert the extrusion result to our BufferGeometry struct
    let position_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("position"))
        .unwrap_or(JsValue::null());
    let normal_js =
        js_sys::Reflect::get(&extruded_js, &JsValue::from_str("normal")).unwrap_or(JsValue::null());
    let index_js =
        js_sys::Reflect::get(&extruded_js, &JsValue::from_str("index")).unwrap_or(JsValue::null());
    let uv_js =
        js_sys::Reflect::get(&extruded_js, &JsValue::from_str("uv")).unwrap_or(JsValue::null());

    let mut vertices = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();
    let mut uvs = Vec::new();

    // Extract position
    if !position_js.is_null() {
        let position_array = Float32Array::from(position_js);
        vertices = vec![0.0; position_array.length() as usize];
        position_array.copy_to(&mut vertices);
    }

    // Extract normals
    if !normal_js.is_null() {
        let normal_array = Float32Array::from(normal_js);
        normals = vec![0.0; normal_array.length() as usize];
        normal_array.copy_to(&mut normals);
    }

    // Extract indices
    if !index_js.is_null() {
        let index_array = Array::from(&index_js);
        indices = Vec::with_capacity(index_array.length() as usize);
        for i in 0..index_array.length() {
            let value = index_array.get(i);
            indices.push(value.as_f64().unwrap_or(0.0) as u32);
        }
    }

    // Extract uvs
    if !uv_js.is_null() {
        let uv_array = Float32Array::from(uv_js);
        uvs = vec![0.0; uv_array.length() as usize];
        uv_array.copy_to(&mut uvs);
    }

    // Apply per-vertex terrain alignment if enabled
    // This aligns each vertex's Z coordinate to the terrain height at that specific X,Y position
    if align_vertices_to_terrain {
        // Check if we have elevation data for proper terrain alignment
        let has_elevation_data = elevation_grid.is_some() 
            && grid_size.is_some() 
            && bbox.is_some()
            && min_elevation.is_some()
            && max_elevation.is_some()
            && vertical_exaggeration.is_some()
            && terrain_base_height.is_some();

        if has_elevation_data {
            let elev_grid = elevation_grid.unwrap();
            let g_size = grid_size.unwrap();
            let b_box = bbox.unwrap();
            let min_elev = min_elevation.unwrap();
            let max_elev = max_elevation.unwrap();
            let vert_exag = vertical_exaggeration.unwrap();
            let base_height = terrain_base_height.unwrap();

            // Find the original geometry's min and max Z to determine the extrusion height
            let mut original_min_z = f32::INFINITY;
            let mut original_max_z = f32::NEG_INFINITY;
            for i in (0..vertices.len()).step_by(3) {
                let z = vertices[i + 2];
                original_min_z = original_min_z.min(z);
                original_max_z = original_max_z.max(z);
            }
            let extrusion_height = (original_max_z - original_min_z) as f64;

            // Process EVERY vertex individually - sample terrain at each vertex's X,Y position
            let vertex_count = vertices.len() / 3;
            
            for vertex_idx in 0..vertex_count {
                let base_idx = vertex_idx * 3;
                
                // Get this vertex's X, Y position in mesh coordinates
                let mesh_x = vertices[base_idx] as f64;
                let mesh_y = vertices[base_idx + 1] as f64;
                let current_z = vertices[base_idx + 2];

                // Sample the terrain height at THIS SPECIFIC X,Y position
                let terrain_height_at_this_point = sample_terrain_mesh_height_at_point(
                    mesh_x,
                    mesh_y,
                    elev_grid,
                    g_size,
                    b_box,
                    min_elev,
                    max_elev,
                    vert_exag,
                    base_height,
                );

                // Determine if this is a bottom or top vertex based on original Z
                // Bottom vertices are at original_min_z (typically 0 from extrusion)
                // Top vertices are at original_max_z (extrusion height)
                let is_bottom_vertex = (current_z - original_min_z).abs() < 0.1;
                
                // Set the new Z for this vertex based on terrain at THIS position
                if is_bottom_vertex {
                    // Bottom vertex: align to terrain surface at this X,Y + small clearance
                    vertices[base_idx + 2] = (terrain_height_at_this_point + MIN_CLEARANCE) as f32;
                } else {
                    // Top vertex: terrain height at this X,Y + clearance + extrusion height
                    vertices[base_idx + 2] = (terrain_height_at_this_point + MIN_CLEARANCE + extrusion_height) as f32;
                }
            }
        }
    }

    // Check if we have any vertices before constructing the result
    let has_data = !vertices.is_empty();

    // Create and return the BufferGeometry
    BufferGeometry {
        vertices,
        normals: if normals.is_empty() {
            None
        } else {
            Some(normals)
        },
        indices: if indices.is_empty() {
            None
        } else {
            Some(indices)
        },
        colors: None,
        uvs: if uvs.is_empty() { None } else { Some(uvs) },
        has_data: has_data,
        properties,
    }
}

// Process the polygon geometry input and produce a buffer geometry output
// Constants for performance optimization
const MAX_CHUNK_SIZE: usize = 250; // Smaller chunks for better progress and prevent timeouts
#[allow(dead_code)]
const MIN_AREA_THRESHOLD: f64 = 0.0001; // Skip very small polygons for performance

pub fn create_polygon_geometry(input_json: &str) -> Result<String, String> {
    // Parse the input JSON
    let input: PolygonGeometryInput = match serde_json::from_str(input_json) {
        Ok(data) => data,
        Err(e) => return Err(format!("Failed to parse input JSON: {}", e)),
    };

    // Early exit for very large datasets - implement chunked processing
    let total_polygons = input.polygons.len();
    // Skip logging to improve performance for large datasets
    // Compute dataset terrain extremes by sampling the elevation grid
    const SAMPLE_COUNT: usize = 10;
    let mut dataset_lowest_z = f64::INFINITY;
    let mut dataset_highest_z = f64::NEG_INFINITY;
    for i in 0..SAMPLE_COUNT {
        let t_i = i as f64 / ((SAMPLE_COUNT - 1) as f64);
        let sample_lng = input.bbox[0] + (input.bbox[2] - input.bbox[0]) * t_i;
        for j in 0..SAMPLE_COUNT {
            let t_j = j as f64 / ((SAMPLE_COUNT - 1) as f64);
            let sample_lat = input.bbox[1] + (input.bbox[3] - input.bbox[1]) * t_j;
            let elev = sample_terrain_elevation_at_point(
                sample_lng,
                sample_lat,
                &input.elevation_grid,
                &input.grid_size,
                &input.bbox,
                input.min_elevation,
                input.max_elevation,
                input.vertical_exaggeration,
                input.terrain_base_height,
            );
            dataset_lowest_z = dataset_lowest_z.min(elev);
            dataset_highest_z = dataset_highest_z.max(elev);
        }
    }
    let _dataset_range = dataset_highest_z - dataset_lowest_z + 0.1;

    // Use the correctly calculated dataset terrain extremes (don't overwrite with raw elevation)
    // dataset_lowest_z and dataset_highest_z are already correctly calculated above
    let _dataset_range = dataset_highest_z - dataset_lowest_z + 0.1;

    if input.polygons.is_empty() {
        return Ok(serde_json::to_string(&BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            has_data: false,
            properties: None,
        })
        .unwrap());
    }

    // Convert all polygons to Vector2 format
    let _all_geometries: Vec<BufferGeometry> = Vec::new();

    // Debug: Log geometry types for transportation layer
    if input.vt_data_set.source_layer == "transportation" {
        let mut geometry_types = HashMap::new();
        for feature in &input.polygons {
            let geom_type = feature.r#type.as_deref().unwrap_or("unknown");
            *geometry_types.entry(geom_type).or_insert(0) += 1;
        }
    }

    let _total_polygons = input.polygons.len();
    let use_same_z_offset = input.use_same_z_offset;

    // Implement chunked processing to prevent timeouts on large datasets
    let mut all_geometries: Vec<BufferGeometry> = Vec::new();
    let chunk_count = (total_polygons + MAX_CHUNK_SIZE - 1) / MAX_CHUNK_SIZE; // Ceiling division

    // Process polygons in chunks to prevent timeouts

    for (chunk_index, chunk) in input.polygons.chunks(MAX_CHUNK_SIZE).enumerate() {
        // Remove per-chunk logging to improve performance

        let chunk_start = chunk_index * MAX_CHUNK_SIZE;
        let geometries_result: Result<Vec<_>, String> = chunk
            .iter()
            .enumerate()
            .map(
                |(chunk_i, polygon_data)| -> Result<Option<BufferGeometry>, String> {
                    let i = chunk_start + chunk_i; // Global polygon index

                    // No filtering - process all geometries within bbox as requested
                    // As requested by user: "I want everything that is inside the bbox with at least one vertex"

                    // Debug: log the first few polygon properties to see what's available
                    if i < 3 {}

                    // Debug: Track primary and secondary roads specifically
                    if let Some(ref props) = polygon_data.properties {
                        if let serde_json::Value::Object(obj) = props {
                            if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                if class == "primary" || class == "secondary" {}
                            }
                        }
                    }

                    // Calculate if this is a major road (for logging purposes)
                    let is_major_road = if let Some(ref props) = polygon_data.properties {
                        if let serde_json::Value::Object(obj) = props {
                            if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                class == "primary"
                                    || class == "secondary"
                                    || class == "motorway"
                                    || class == "trunk"
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    };

                    // SPECIAL PATH: For terrain-aligned LineStrings, use quad-strip mesh for better terrain following
                    let is_terrain_aligned_linestring = polygon_data.r#type.as_deref() == Some("LineString")
                        && input.vt_data_set.align_vertices_to_terrain.unwrap_or(false);

                    if is_terrain_aligned_linestring && polygon_data.geometry.len() >= 2 {
                        // Use buffer size from layer configuration
                        let config_buffer_size = input
                            .vt_data_set
                            .buffer_size
                            .unwrap_or(if is_major_road { 2.0 } else { 1.5 });
                        let buffer_distance = config_buffer_size * 0.00001;

                        // Create quad-strip mesh for this linestring
                        if let Some(quad_mesh) = create_linestring_quad_strip(
                            &polygon_data.geometry,
                            buffer_distance,
                            &input.bbox,
                            None,
                        ) {
                            // Extract properties
                            let mut properties: Option<std::collections::HashMap<String, serde_json::Value>> = 
                                if let Some(ref tags) = polygon_data.tags {
                                    if let serde_json::Value::Object(obj) = tags {
                                        let mut map = std::collections::HashMap::new();
                                        for (k, v) in obj.iter() {
                                            map.insert(k.clone(), v.clone());
                                        }
                                        Some(map)
                                    } else { None }
                                } else { None };

                            // Add layer metadata
                            let layer_name = input.vt_data_set.source_layer.clone();
                            match properties {
                                Some(ref mut props) => {
                                    props.entry("__sourceLayer".to_string())
                                        .or_insert(serde_json::Value::String(layer_name.clone()));
                                }
                                None => {
                                    let mut map = std::collections::HashMap::new();
                                    map.insert("__sourceLayer".to_string(), serde_json::Value::String(layer_name.clone()));
                                    properties = Some(map);
                                }
                            }

                            // Get height from layer config
                            let height = input.vt_data_set.extrusion_depth.unwrap_or(0.3);
                            let meters_to_units = calculate_meters_to_terrain_units(&input.bbox);
                            let scaled_height = (height * meters_to_units).clamp(MIN_HEIGHT, MAX_HEIGHT);

                            // Create geometry directly from quad strip mesh
                            let mut geometry = create_extruded_shape_from_quad_strip(
                                &quad_mesh,
                                scaled_height,
                                &input.bbox,
                                &input.elevation_grid,
                                &input.grid_size,
                                input.min_elevation,
                                input.max_elevation,
                                input.vertical_exaggeration,
                                input.terrain_base_height,
                                &input.terrain_vertices_base64,
                                &input.terrain_indices_base64,
                                properties,
                            );

                            // Clip the 3D mesh to the bounding box
                            if geometry.has_data {
                                if let Some(ref indices) = geometry.indices {
                                    let half_tile = TERRAIN_SIZE / 2.0;
                                    let (clipped_vertices, clipped_indices) = clip_mesh_to_bbox_3d(
                                        &geometry.vertices,
                                        indices,
                                        -half_tile,
                                        -half_tile,
                                        half_tile,
                                        half_tile,
                                    );
                                    
                                    if !clipped_indices.is_empty() {
                                        geometry.vertices = clipped_vertices;
                                        geometry.indices = Some(clipped_indices);
                                        // Clear normals as they need recalculation after clipping
                                        geometry.normals = None;
                                        return Ok(Some(geometry));
                                    }
                                }
                            }
                        }
                        // Fall through to regular processing if quad strip fails
                    }

                    // Handle both Polygon and LineString geometries
                    let points: Vec<Vector2> = if polygon_data.r#type.as_deref()
                        == Some("LineString")
                    {
                        // Extract transportation class for better debugging
                        let _transportation_class = if let Some(ref props) = polygon_data.properties
                        {
                            if let serde_json::Value::Object(obj) = props {
                                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                    class.clone()
                                } else {
                                    "unknown".to_string()
                                }
                            } else {
                                "no_props".to_string()
                            }
                        } else {
                            "no_props".to_string()
                        };

                        // COMPLETE SOLUTION: Process all segments of LineString for complete road/footway rendering
                        if polygon_data.geometry.len() >= 2 {
                            // Create complete buffered polygon from all LineString segments
                            let mut buffered_points = Vec::new();

                            // Use buffer size from layer configuration, with fallback to reasonable defaults
                            let config_buffer_size = input
                                .vt_data_set
                                .buffer_size
                                .unwrap_or(if is_major_road { 2.0 } else { 1.5 });
                            // Convert buffer size to appropriate coordinate scale (assuming meter-like units)
                            let buffer_distance = config_buffer_size * 0.00001; // Scale factor for coordinate space

                            // Use robust linestring buffering algorithm with bbox for subdivision
                            buffered_points =
                                create_linestring_buffer(&polygon_data.geometry, buffer_distance, &input.bbox);

                            buffered_points
                        } else {
                            Vec::new()
                        }
                    } else {
                        // For Polygons, extract points normally
                        polygon_data
                            .geometry
                            .iter()
                            .filter_map(|point| {
                                if point.len() >= 2 {
                                    Some(Vector2 {
                                        x: point[0],
                                        y: point[1],
                                    })
                                } else {
                                    None
                                }
                            })
                            .collect()
                    };

                    if points.len() < 3 {
                        // Debug: Track why geometries might be skipped - THIS IS A MAJOR FILTER
                        let transportation_class = if let Some(ref props) = polygon_data.properties
                        {
                            if let serde_json::Value::Object(obj) = props {
                                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                    class.clone()
                                } else {
                                    "unknown".to_string()
                                }
                            } else {
                                "no_props".to_string()
                            }
                        } else {
                            "no_props".to_string()
                        };

                        return Ok(None); // Skip invalid polygons
                    }

                    // Determine extrusion height based on geometry type and available data
                    let mut height = if let Some(d) = input.vt_data_set.extrusion_depth {
                        // Use explicitly set extrusion depth
                        d
                    } else if let Some(h) = polygon_data.height.filter(|h| *h > 0.0) {
                        // Use feature-specific height (typically for buildings from OSM data)
                        // This ensures building height variation is preserved
                        h
                    } else {
                        // Determine height based on geometry type/class
                        let geometry_class = if let Some(ref props) = polygon_data.properties {
                            if let serde_json::Value::Object(obj) = props {
                                obj.get("class")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown")
                            } else {
                                "unknown"
                            }
                        } else {
                            "unknown"
                        };

                        // Use appropriate default heights based on geometry type
                        match geometry_class {
                            // Transportation features should have small, fixed heights
                            "motorway" | "trunk" | "primary" | "secondary" | "tertiary" => 0.3,
                            "residential" | "service" | "unclassified" | "track" => 0.2,
                            "footway" | "cycleway" | "path" | "pedestrian" => 0.1,
                            "railway" | "subway" => 0.4,
                            "runway" | "taxiway" => 0.2,

                            // Water features should be flat or slightly below ground
                            "water" | "ocean" | "lake" | "river" | "stream" => 0.05,

                            // Natural/landuse features with small fixed heights
                            "park" | "forest" | "grass" | "meadow" | "farmland" => 0.1,
                            "sand" | "beach" => 0.05,
                            "rock" | "bare_rock" => 0.3,

                            // Building-like structures should have reasonable default heights in meters
                            "building" | "residential_building" | "commercial" | "industrial" => {
                                // Default building height: 25 meters (reasonable for 6-8 story building)
                                25.0
                            }

                            // Unknown types get small fixed height to avoid scaling issues
                            _ => 0.2,
                        }
                    };
                    // Enforce minimum extrusion depth
                    if let Some(min_d) = input.vt_data_set.min_extrusion_depth {
                        if height < min_d {
                            height = min_d;
                        }
                    }
                    // Ensure positive height values
                    if height <= 0.0 {
                        let _transportation_class = if let Some(ref props) = polygon_data.properties
                        {
                            if let serde_json::Value::Object(obj) = props {
                                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                    class.clone()
                                } else {
                                    "unknown".to_string()
                                }
                            } else {
                                "no_props".to_string()
                            }
                        } else {
                            "no_props".to_string()
                        };

                        return Ok(None); // Skip flat geometry
                    }

                    // Apply mesh coordinates transform
                    let mesh_points: Vec<Vector2> = points
                        .iter()
                        .map(|p| {
                            let [mx, my] = transform_to_mesh_coordinates(p.x, p.y, &input.bbox);
                            Vector2 { x: mx, y: my }
                        })
                        .collect();

                    // Clean and validate the polygon
                    let cleaned_points = clean_polygon_footprint(&mesh_points);
                    if cleaned_points.is_empty() {
                        let _transportation_class = if let Some(ref props) = polygon_data.properties
                        {
                            if let serde_json::Value::Object(obj) = props {
                                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                    class.clone()
                                } else {
                                    "unknown".to_string()
                                }
                            } else {
                                "no_props".to_string()
                            }
                        } else {
                            "no_props".to_string()
                        };

                        return Ok(None); // Skip invalid polygon after cleaning
                    }

                    // Clip against the overall terrain tile bounds (include any shape that overlaps)
                    let half_tile = TERRAIN_SIZE * 0.5;

                    // Apply clipping to all polygons
                    let use_csg = input.csg_clipping.unwrap_or(false);

                    let clipped_points = if use_csg {
                        // CSG-based clipping for smoother results
                        clip_polygon_to_bbox_2d(
                            &cleaned_points,
                            &[-half_tile, -half_tile, half_tile, half_tile],
                        )
                    } else {
                        // Simple clipping when CSG is not enabled
                        simple_clip_polygon(
                            &cleaned_points,
                            &[-half_tile, -half_tile, half_tile, half_tile],
                        )
                    };

                    // Skip polygons that truly have no valid representation after clipping
                    if clipped_points.is_empty() {
                        return Ok(None);
                    }

                    // For polygons with insufficient points, try fallback
                    let final_points = if clipped_points.len() < 3 {
                        let half_tile_with_margin = half_tile * 1.05;
                        let potentially_visible = cleaned_points.iter().any(|pt| {
                            pt.x >= -half_tile_with_margin && pt.x <= half_tile_with_margin &&
                            pt.y >= -half_tile_with_margin && pt.y <= half_tile_with_margin
                        });

                        if potentially_visible {
                            let fallback = simple_clip_polygon(
                                &cleaned_points,
                                &[-half_tile, -half_tile, half_tile, half_tile],
                            );

                            if fallback.len() >= 3 {
                                fallback
                            } else {
                                return Ok(None);
                            }
                        } else {
                            return Ok(None);
                        }
                    } else {
                        clipped_points
                    };

                    // Check if this is a buffered linestring
                    let _is_buffered_linestring = polygon_data.r#type.as_deref() == Some("LineString");

                    // Subdivide edges for terrain-aligned layers to ensure smooth terrain following
                    // Now applies to ALL geometry types including buffered linestrings
                    let final_points = if input.vt_data_set.align_vertices_to_terrain.unwrap_or(false) {
                        subdivide_polygon_edges(&final_points, MAX_EDGE_LENGTH)
                    } else {
                        final_points
                    };

                    // SUCCESS: This geometry made it through all filters
                    let _transportation_class = if let Some(ref props) = polygon_data.properties {
                        if let serde_json::Value::Object(obj) = props {
                            if let Some(serde_json::Value::String(class)) = obj.get("class") {
                                class.clone()
                            } else {
                                "unknown".to_string()
                            }
                        } else {
                            "no_props".to_string()
                        }
                    } else {
                        "no_props".to_string()
                    };

                    // Compute per-polygon terrain extremes for base alignment
                    // Sample at vertices AND interior points to capture full terrain variation
                    let mut lowest_terrain_z = f64::INFINITY;
                    let mut highest_terrain_z = f64::NEG_INFINITY;
                    
                    // Helper to sample and update min/max
                    // Note: final_points are already in MESH coordinates after transform_to_mesh_coordinates
                    let mut sample_point = |mesh_x: f64, mesh_y: f64| {
                        let tz = sample_terrain_mesh_height_at_point(
                            mesh_x,
                            mesh_y,
                            &input.elevation_grid,
                            &input.grid_size,
                            &input.bbox,
                            input.min_elevation,
                            input.max_elevation,
                            input.vertical_exaggeration,
                            input.terrain_base_height,
                        );
                        lowest_terrain_z = lowest_terrain_z.min(tz);
                        highest_terrain_z = highest_terrain_z.max(tz);
                    };
                    
                    // Sample at all polygon vertices
                    for pt in &final_points {
                        sample_point(pt.x, pt.y);
                    }
                    
                    // Calculate polygon centroid and sample there too
                    if !final_points.is_empty() {
                        let mut cx = 0.0;
                        let mut cy = 0.0;
                        for pt in &final_points {
                            cx += pt.x;
                            cy += pt.y;
                        }
                        cx /= final_points.len() as f64;
                        cy /= final_points.len() as f64;
                        sample_point(cx, cy);
                        
                        // Also sample at midpoints of edges for better coverage
                        for i in 0..final_points.len() {
                            let j = (i + 1) % final_points.len();
                            let mx = (final_points[i].x + final_points[j].x) / 2.0;
                            let my = (final_points[i].y + final_points[j].y) / 2.0;
                            sample_point(mx, my);
                        }
                        
                        // Sample points between centroid and each vertex (interior sampling)
                        for pt in &final_points {
                            let ix = (cx + pt.x) / 2.0;
                            let iy = (cy + pt.y) / 2.0;
                            sample_point(ix, iy);
                        }
                    }
                    
                    // Calculate per-polygon terrain Z difference BEFORE applying dataset-wide z_offset
                    // This is the terrain slope under THIS specific building polygon
                    let polygon_terrain_z_difference = (highest_terrain_z - lowest_terrain_z).max(0.0);
                    
                    // Optionally use dataset-wide extremes for Z positioning (not for height adjustment)
                    if use_same_z_offset {
                        lowest_terrain_z = dataset_lowest_z;
                        // Note: we keep polygon_terrain_z_difference as the per-polygon value
                    }
                    
                    // Base z offset: position bottom face relative to the LOWEST terrain point
                    let user_z_offset = input.vt_data_set.z_offset.unwrap_or(0.0);
                    
                    // For buildings (non-terrain-aligned), submerge slightly INTO the ground
                    // For terrain-aligned layers, add clearance to prevent z-fighting
                    let is_building = !input.vt_data_set.align_vertices_to_terrain.unwrap_or(false);
                    let z_offset = if is_building {
                        // Buildings: position at lowest terrain point, applying user offset and submerge
                        // user_z_offset is typically negative (e.g., -0.01) to push buildings down
                        // We ADD user_z_offset (which adds a negative, i.e., subtracts) and subtract submerge
                        lowest_terrain_z + user_z_offset - BUILDING_SUBMERGE_OFFSET
                    } else {
                        // Other layers: add clearance above terrain
                        lowest_terrain_z + user_z_offset + MIN_CLEARANCE
                    };

                    // Extract properties from polygon_data for attaching to geometry
                    let mut properties = if let Some(ref props) = polygon_data.properties {
                        // Convert serde_json::Value to HashMap<String, serde_json::Value>
                        if let serde_json::Value::Object(obj) = props {
                            let mut hashmap = std::collections::HashMap::new();
                            for (key, value) in obj.iter() {
                                hashmap.insert(key.clone(), value.clone());
                            }
                            Some(hashmap)
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    // Ensure layer metadata is available for downstream grouping
                    let layer_name = input.vt_data_set.source_layer.clone();
                    match properties {
                        Some(ref mut props) => {
                            props
                                .entry("__sourceLayer".to_string())
                                .or_insert(serde_json::Value::String(layer_name.clone()));
                        }
                        None => {
                            let mut map = std::collections::HashMap::new();
                            map.insert(
                                "__sourceLayer".to_string(),
                                serde_json::Value::String(layer_name.clone()),
                            );
                            properties = Some(map);
                        }
                    }

                    // Validate polygon before triangulation
                    // Self-intersecting polygons (common in buffered linestrings at sharp turns)
                    // cause earcut triangulation to produce corrupt geometry
                    let cleaned_points = match clean_polygon_for_triangulation(&final_points) {
                        Some(points) => points,
                        None => {
                            // Polygon is too small or self-intersecting, skip it
                            return Ok(None);
                        }
                    };

                    // Calculate scaling factor from meters to terrain units
                    let meters_to_units = calculate_meters_to_terrain_units(&input.bbox);

                    // Scale height for extrusion (building heights need scaling)
                    height *= meters_to_units;
                    
                    // ALWAYS add per-polygon terrain Z difference to height for buildings on slopes
                    // This ensures buildings extend from the lowest terrain point up past the highest
                    // terrain point UNDER THIS SPECIFIC BUILDING (not the entire dataset)
                    // This is required to prevent floating or submerged buildings on sloped terrain
                    let is_building = !input.vt_data_set.align_vertices_to_terrain.unwrap_or(false);
                    if is_building && polygon_terrain_z_difference > 0.01 {
                        // polygon_terrain_z_difference is the terrain slope under this building only
                        height += polygon_terrain_z_difference;
                    }

                    // Final clamp in terrain units
                    height = height.clamp(MIN_HEIGHT, MAX_HEIGHT);

                    // For terrain alignment, pass RAW (unscaled) vertical_exaggeration and terrain_base_height
                    // The sample_terrain_mesh_height_at_point function will apply EXAGGERATION_SCALE_FACTOR
                    // to match exactly what terrain_mesh_gen.rs does
                    let geometry = create_extruded_shape(
                        &cleaned_points,

                        height,
                        z_offset,
                        properties,
                        input.vt_data_set.align_vertices_to_terrain.unwrap_or(false),
                        Some(&input.elevation_grid),
                        Some(&input.grid_size),
                        Some(&input.bbox),
                        Some(input.min_elevation),
                        Some(input.max_elevation),
                        Some(input.vertical_exaggeration),  // RAW value, not scaled by meters_to_units
                        Some(input.terrain_base_height),    // RAW value, not scaled by meters_to_units
                        Some(&input.vt_data_set.source_layer),
                        Some(&input.terrain_vertices_base64),
                        Some(&input.terrain_indices_base64),
                    );

                    if geometry.has_data {
                        Ok(Some(geometry))
                    } else {
                        Ok(None)
                    }
                },
            )
            .collect();

        // Handle chunk processing results
        let chunk_geometries = geometries_result
            .map_err(|e| format!("Chunk {} processing error: {}", chunk_index + 1, e))?;
        let chunk_valid_geometries: Vec<BufferGeometry> =
            chunk_geometries.into_iter().filter_map(|opt| opt).collect();

        // Add chunk geometries to the overall collection
        all_geometries.extend(chunk_valid_geometries);
    }

    // Processing complete

    if all_geometries.is_empty() {
        return Ok(serde_json::to_string(&Vec::<BufferGeometry>::new()).unwrap());
    }

    // Check if this layer uses per-vertex terrain alignment
    let uses_terrain_alignment = input.vt_data_set.align_vertices_to_terrain.unwrap_or(false);

    // IMPORTANT: Skip geometry merging for terrain-aligned layers!
    // The merge_geometries_by_layer function uses union_via_footprints which re-extrudes
    // geometries with uniform Z values, destroying the per-vertex terrain alignment.
    if uses_terrain_alignment {
        // For terrain-aligned layers, return geometries as-is without merging
        // Each geometry preserves its per-vertex Z values from terrain alignment
        match serde_json::to_string(&all_geometries) {
            Ok(json) => return Ok(json),
            Err(e) => return Err(format!("Failed to serialize output: {}", e)),
        }
    }

    let tolerance = if input.vt_data_set.source_layer == "transportation" {
        0.001
    } else {
        0.01
    };

    let layer_merged = crate::csg_union::merge_geometries_by_layer(all_geometries);

    let mut merged_geometries = Vec::new();
    for (_layer_name, geometry) in layer_merged {
        let optimized = crate::csg_union::optimize_geometry(geometry, tolerance);
        if optimized.has_data {
            merged_geometries.push(optimized);
        }
    }

    // Serialize merged and optimized geometries
    match serde_json::to_string(&merged_geometries) {
        Ok(json) => Ok(json),
        Err(e) => Err(format!("Failed to serialize output: {}", e)),
    }
}

// GPU-accelerated linestring buffering with CPU fallback
async fn create_linestring_buffer_gpu_fallback(linestring: &[Vec<f64>], buffer_distance: f64) -> Vec<Vector2> {
    let use_gpu = std::env::var("WASM_GPU_POLYGON_DISABLE").is_err();

    if use_gpu && linestring.len() >= 4 { // Only use GPU for reasonably large linestrings
        // Convert to format expected by GPU function
        let points: Vec<[f64; 2]> = linestring
            .iter()
            .filter_map(|p| if p.len() >= 2 { Some([p[0], p[1]]) } else { None })
            .collect();

        if points.len() >= 2 {
            match crate::gpu_polygon::buffer_linestring_gpu(&points, buffer_distance).await {
                Ok(gpu_result) => {
                    return gpu_result.into_iter().map(|p| Vector2 { x: p[0], y: p[1] }).collect();
                }
                Err(e) => {
                    // GPU fallback failed, continue with CPU implementation
                }
            }
        }
    }

    // CPU fallback
    create_linestring_buffer(linestring, buffer_distance, &[0.0, 0.0, 1.0, 1.0]) // Default bbox for GPU fallback
}

// Create a proper buffered polygon from a linestring with even width throughout
fn create_linestring_buffer(linestring: &[Vec<f64>], buffer_distance: f64, bbox: &[f64]) -> Vec<Vector2> {
    if linestring.len() < 2 {
        return Vec::new();
    }

    // Calculate max segment length in the input coordinate space (geographic degrees)
    // Target: segments of ~5 mesh units after transformation to mesh coords (TERRAIN_SIZE = 200)
    // Mesh coords range is -100 to +100 (200 units total)
    // For terrain alignment, we want segments of ~5 mesh units = 2.5% of tile
    let bbox_width = if bbox.len() >= 4 { (bbox[2] - bbox[0]).abs() } else { 0.01 };
    let bbox_height = if bbox.len() >= 4 { (bbox[3] - bbox[1]).abs() } else { 0.01 };
    
    // 5 mesh units = 5/200 = 2.5% of tile dimension
    // Using the smaller dimension to ensure sufficient subdivision
    let max_segment_length = f64::min(bbox_width, bbox_height) * 0.025;

    // Convert to Vector2 points and filter invalid points
    let raw_points: Vec<Vector2> = linestring
        .iter()
        .filter_map(|p| {
            if p.len() >= 2 && p[0].is_finite() && p[1].is_finite() {
                Some(Vector2 { x: p[0], y: p[1] })
            } else {
                None
            }
        })
        .collect();

    if raw_points.len() < 2 {
        return Vec::new();
    }

    // Subdivide long segments to ensure enough points for smooth curves and terrain alignment
    let mut subdivided_points: Vec<Vector2> = Vec::new();
    for i in 0..raw_points.len() {
        let current = raw_points[i];
        
        if i > 0 {
            let prev = raw_points[i - 1];
            let dx = current.x - prev.x;
            let dy = current.y - prev.y;
            let segment_length = (dx * dx + dy * dy).sqrt();
            
            if segment_length > max_segment_length && max_segment_length > EPSILON {
                // Subdivide this segment
                let num_subdivisions = (segment_length / max_segment_length).ceil() as usize;
                for j in 1..num_subdivisions {
                    let t = j as f64 / num_subdivisions as f64;
                    subdivided_points.push(Vector2 {
                        x: prev.x + dx * t,
                        y: prev.y + dy * t,
                    });
                }
            }
        }
        
        subdivided_points.push(current);
    }

    // Remove duplicate consecutive points (which cause zero-length segments)
    let mut points: Vec<Vector2> = Vec::with_capacity(subdivided_points.len());
    for pt in subdivided_points {
        if let Some(last) = points.last() {
            let dx = pt.x - last.x;
            let dy = pt.y - last.y;
            let dist_sq = dx * dx + dy * dy;
            // Skip if too close to previous point
            if dist_sq < EPSILON * EPSILON {
                continue;
            }
        }
        points.push(pt);
    }

    if points.len() < 2 {
        return Vec::new();
    }

    let mut polygon_points = Vec::new();

    // Generate parallel offset lines for left and right sides
    let left_offsets = create_offset_line(&points, buffer_distance);
    let right_offsets = create_offset_line(&points, -buffer_distance);

    if left_offsets.is_empty() || right_offsets.is_empty() {
        return Vec::new();
    }

    // Validate that all offset points are finite
    let all_left_valid = left_offsets.iter().all(|p| p.x.is_finite() && p.y.is_finite());
    let all_right_valid = right_offsets.iter().all(|p| p.x.is_finite() && p.y.is_finite());
    
    if !all_left_valid || !all_right_valid {
        return Vec::new();
    }

    // Simple polygon construction: left side + right side (reversed) - no end caps
    // Add left side
    polygon_points.extend(left_offsets);

    // Add right side (reversed) - this creates a simple closed polygon
    polygon_points.extend(right_offsets.into_iter().rev());

    // Final validation: ensure we have enough points for a valid polygon
    if polygon_points.len() < 3 {
        return Vec::new();
    }

    polygon_points
}

// Create offset line with bevel joins at sharp angles to prevent self-intersections
fn create_offset_line(points: &[Vector2], offset_distance: f64) -> Vec<Vector2> {
    if points.len() < 2 {
        return Vec::new();
    }

    // Miter limit - when angle is sharper than this, use bevel instead of miter
    // cos(60°) = 0.5, meaning angles sharper than 120° will use bevel
    const MITER_LIMIT_COS: f64 = 0.5;

    let mut offsets = Vec::new();

    for i in 0..points.len() {
        if i == 0 {
            // First point - offset perpendicular to first segment
            let dx = points[1].x - points[0].x;
            let dy = points[1].y - points[0].y;
            let length = (dx * dx + dy * dy).sqrt();

            if length >= EPSILON {
                let perp_x = -dy / length * offset_distance;
                let perp_y = dx / length * offset_distance;
                offsets.push(Vector2 {
                    x: points[0].x + perp_x,
                    y: points[0].y + perp_y,
                });
            }
        } else if i == points.len() - 1 {
            // Last point - offset perpendicular to last segment
            let dx = points[i].x - points[i - 1].x;
            let dy = points[i].y - points[i - 1].y;
            let length = (dx * dx + dy * dy).sqrt();

            if length >= EPSILON {
                let perp_x = -dy / length * offset_distance;
                let perp_y = dx / length * offset_distance;
                offsets.push(Vector2 {
                    x: points[i].x + perp_x,
                    y: points[i].y + perp_y,
                });
            }
        } else {
            // Middle point - check angle and decide between miter and bevel
            let prev_dx = points[i].x - points[i - 1].x;
            let prev_dy = points[i].y - points[i - 1].y;
            let prev_len = (prev_dx * prev_dx + prev_dy * prev_dy).sqrt();

            let next_dx = points[i + 1].x - points[i].x;
            let next_dy = points[i + 1].y - points[i].y;
            let next_len = (next_dx * next_dx + next_dy * next_dy).sqrt();

            if prev_len < EPSILON || next_len < EPSILON {
                continue;
            }

            // Normalize directions
            let prev_norm_x = prev_dx / prev_len;
            let prev_norm_y = prev_dy / prev_len;
            let next_norm_x = next_dx / next_len;
            let next_norm_y = next_dy / next_len;

            // Calculate dot product to determine angle
            let dot = prev_norm_x * next_norm_x + prev_norm_y * next_norm_y;

            // Calculate perpendiculars
            let prev_perp_x = -prev_norm_y;
            let prev_perp_y = prev_norm_x;
            let next_perp_x = -next_norm_y;
            let next_perp_y = next_norm_x;

            if dot < MITER_LIMIT_COS {
                // Sharp angle - use bevel join (add both perpendicular points)
                // This prevents self-intersection by not extending to the miter point
                offsets.push(Vector2 {
                    x: points[i].x + prev_perp_x * offset_distance,
                    y: points[i].y + prev_perp_y * offset_distance,
                });
                offsets.push(Vector2 {
                    x: points[i].x + next_perp_x * offset_distance,
                    y: points[i].y + next_perp_y * offset_distance,
                });
            } else {
                // Gentle angle - use miter join (single bisector point)
                let bisector_x = prev_perp_x + next_perp_x;
                let bisector_y = prev_perp_y + next_perp_y;
                let bisector_len = (bisector_x * bisector_x + bisector_y * bisector_y).sqrt();

                if bisector_len < EPSILON {
                    // Nearly 180 degree turn
                    offsets.push(Vector2 {
                        x: points[i].x + prev_perp_x * offset_distance,
                        y: points[i].y + prev_perp_y * offset_distance,
                    });
                } else {
                    // Calculate proper miter distance
                    let angle_factor = (1.0 / ((1.0 + dot) * 0.5).sqrt()).min(2.0);
                    let scale = offset_distance * angle_factor;
                    offsets.push(Vector2 {
                        x: points[i].x + (bisector_x / bisector_len) * scale,
                        y: points[i].y + (bisector_y / bisector_len) * scale,
                    });
                }
            }
        }
    }

    offsets
}

// Calculate simple perpendicular offset
fn calculate_simple_offset(p1: Vector2, p2: Vector2, offset_distance: f64) -> Vector2 {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    let length = (dx * dx + dy * dy).sqrt();

    if length < EPSILON {
        return p2;
    }

    // Calculate perpendicular vector (90 degrees counterclockwise)
    let perp_x = -dy / length;
    let perp_y = dx / length;

    Vector2 {
        x: p2.x + perp_x * offset_distance,
        y: p2.y + perp_y * offset_distance,
    }
}
/// Result of creating a linestring road mesh as a quad strip
/// This bypasses earcut triangulation for better terrain alignment
#[derive(Debug, Clone)]
pub struct LineStringMesh {
    /// Vertices as flat array [x0, y0, x1, y1, ...]
    pub vertices: Vec<f64>,
    /// Triangle indices
    pub indices: Vec<u32>,
}

/// Create a linestring road mesh as a quad strip for terrain alignment
/// Returns vertices and indices ready for extrusion, bypassing earcut
fn create_linestring_quad_strip(
    linestring: &[Vec<f64>], 
    buffer_distance: f64, 
    bbox: &[f64],
    max_segment_length_override: Option<f64>,
) -> Option<LineStringMesh> {
    if linestring.len() < 2 {
        return None;
    }

    // Calculate max segment length based on terrain requirements
    // We want dense vertices for terrain alignment
    let bbox_width = if bbox.len() >= 4 { (bbox[2] - bbox[0]).abs() } else { 0.01 };
    let bbox_height = if bbox.len() >= 4 { (bbox[3] - bbox[1]).abs() } else { 0.01 };
    
    // Target: segments of ~2 mesh units for good terrain following
    // 2 mesh units = 2/200 = 1% of tile dimension
    let max_segment_length = max_segment_length_override
        .unwrap_or(f64::min(bbox_width, bbox_height) * 0.01);

    // Convert to Vector2 points and filter invalid points
    let raw_points: Vec<Vector2> = linestring
        .iter()
        .filter_map(|p| {
            if p.len() >= 2 && p[0].is_finite() && p[1].is_finite() {
                Some(Vector2 { x: p[0], y: p[1] })
            } else {
                None
            }
        })
        .collect();

    if raw_points.len() < 2 {
        return None;
    }

    // Aggressively subdivide to ensure dense vertices for terrain alignment
    let mut subdivided_points: Vec<Vector2> = Vec::new();
    for i in 0..raw_points.len() {
        let current = raw_points[i];
        
        if i > 0 {
            let prev = raw_points[i - 1];
            let dx = current.x - prev.x;
            let dy = current.y - prev.y;
            let segment_length = (dx * dx + dy * dy).sqrt();
            
            if segment_length > max_segment_length && max_segment_length > EPSILON {
                let num_subdivisions = (segment_length / max_segment_length).ceil() as usize;
                for j in 1..num_subdivisions {
                    let t = j as f64 / num_subdivisions as f64;
                    subdivided_points.push(Vector2 {
                        x: prev.x + dx * t,
                        y: prev.y + dy * t,
                    });
                }
            }
        }
        
        subdivided_points.push(current);
    }

    // Remove duplicate consecutive points
    let mut points: Vec<Vector2> = Vec::with_capacity(subdivided_points.len());
    for pt in subdivided_points {
        if let Some(last) = points.last() {
            let dx = pt.x - last.x;
            let dy = pt.y - last.y;
            if dx * dx + dy * dy < EPSILON * EPSILON {
                continue;
            }
        }
        points.push(pt);
    }

    if points.len() < 2 {
        return None;
    }

    // Generate left and right offset points
    let left_offsets = create_offset_line(&points, buffer_distance);
    let right_offsets = create_offset_line(&points, -buffer_distance);

    if left_offsets.len() < 2 || right_offsets.len() < 2 {
        return None;
    }

    // Ensure left and right have same length (they should from create_offset_line)
    let num_points = left_offsets.len().min(right_offsets.len());
    if num_points < 2 {
        return None;
    }

    // Build vertices: interleave left and right for quad strip
    // Layout: [left0, right0, left1, right1, left2, right2, ...]
    let mut vertices: Vec<f64> = Vec::with_capacity(num_points * 4);
    for i in 0..num_points {
        let left = &left_offsets[i];
        let right = &right_offsets[i];
        
        if !left.x.is_finite() || !left.y.is_finite() || !right.x.is_finite() || !right.y.is_finite() {
            continue;
        }
        
        vertices.push(left.x);
        vertices.push(left.y);
        vertices.push(right.x);
        vertices.push(right.y);
    }

    let actual_pairs = vertices.len() / 4;
    if actual_pairs < 2 {
        return None;
    }

    // Build triangle indices for quad strip
    // Each quad (4 vertices) becomes 2 triangles
    let mut indices: Vec<u32> = Vec::with_capacity((actual_pairs - 1) * 6);
    for i in 0..(actual_pairs - 1) {
        let base = (i * 2) as u32;
        // Vertices: base = left[i], base+1 = right[i], base+2 = left[i+1], base+3 = right[i+1]
        
        // Triangle 1: left[i], right[i], left[i+1]
        indices.push(base);
        indices.push(base + 1);
        indices.push(base + 2);
        
        // Triangle 2: right[i], right[i+1], left[i+1]
        indices.push(base + 1);
        indices.push(base + 3);
        indices.push(base + 2);
    }

    Some(LineStringMesh { vertices, indices })
}