use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use js_sys::{Array, Float32Array, Object};
use web_sys::console;
use std::collections::HashMap;

// Simplified geo imports to fix compatibility issues
use geo_types::{Coord, LineString, Polygon as GeoPolygon, Rect};
use geo::algorithm::area::Area;
use geo::algorithm::contains::Contains;
use geo::algorithm::intersects::Intersects;
use geo::algorithm::bounding_rect::BoundingRect;
use csgrs::csg::CSG;
use csgrs::polygon::Polygon as CsgPolygon;
use csgrs::vertex::Vertex as CsgVertex;
use csgrs::plane::Plane;
use nalgebra::{Point3, Vector3 as NVector3};

use crate::console_log;
use crate::module_state::ModuleState;
use crate::bbox_filter::polygon_intersects_bbox;

// Constants ported from TypeScript
const BUILDING_SUBMERGE_OFFSET: f64 = 0.01;
const MIN_HEIGHT: f64 = 0.01; // Avoid zero or negative height for robust geometry
const MAX_HEIGHT: f64 = 500.0;
const TERRAIN_SIZE: f64 = 200.0;
const EPSILON: f64 = 1e-9; // Small value for float comparisons

// Struct to represent a 2D point
#[derive(Debug, Clone, Copy, PartialEq)]
struct Vector2 {
    x: f64,
    y: f64,
}

// Struct to represent a 3D point
#[derive(Debug, Clone, Copy)]
struct Vector3 {
    x: f64,
    y: f64, 
    z: f64,
}

// Struct to represent a 3D box for clipping
#[derive(Debug, Clone)]
struct Box3 {
    min: Vector3,
    max: Vector3,
}

impl Box3 {
    fn new() -> Self {
        Box3 {
            min: Vector3 { x: f64::INFINITY, y: f64::INFINITY, z: f64::INFINITY },
            max: Vector3 { x: f64::NEG_INFINITY, y: f64::NEG_INFINITY, z: f64::NEG_INFINITY },
        }
    }

    // Set box from center position and size
    fn set_from_center_and_size(&mut self, center: Vector3, size: Vector3) {
        let half_size = Vector3 {
            x: size.x * 0.5,
            y: size.y * 0.5,
            z: size.z * 0.5,
        };

        self.min = Vector3 {
            x: center.x - half_size.x,
            y: center.y - half_size.y,
            z: center.z - half_size.z,
        };

        self.max = Vector3 {
            x: center.x + half_size.x,
            y: center.y + half_size.y,
            z: center.z + half_size.z,
        };
    }

    // Check if this box intersects with another box
    fn intersects_box(&self, other: &Box3) -> bool {
        // If any dimension doesn't overlap, they don't intersect
        !(other.max.x < self.min.x || other.min.x > self.max.x ||
          other.max.y < self.min.y || other.min.y > self.max.y ||
          other.max.z < self.min.z || other.min.z > self.max.z)
    }
}

// Struct to represent a color
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

// Deserializable struct matching GeometryData from TypeScript
#[derive(Debug, Clone, Deserialize)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>,  // Array of [lng, lat] points
    pub height: Option<f64>,
    pub layer: Option<String>,
    pub tags: Option<serde_json::Value>,
}

// Struct to match GridSize from TypeScript
#[derive(Debug, Clone, Deserialize)]
pub struct GridSize {
    pub width: u32,
    pub height: u32,
}

// Struct to match VtDataSet from TypeScript
#[derive(Debug, Clone, Deserialize)]
pub struct VtDataSet {
    #[serde(default)]
    pub sourceLayer: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub extrusionDepth: Option<f64>,
    pub minExtrusionDepth: Option<f64>,
    pub heightScaleFactor: Option<f64>,
    pub useAdaptiveScaleFactor: Option<bool>,
    pub zOffset: Option<f64>,
    pub alignVerticesToTerrain: Option<bool>,
}

// Default color function for VtDataSet
fn default_color() -> String {
    "#4B85AA".to_string() // Default blue color for water
}

// Input for the polygon geometry processing function
#[derive(Debug, Deserialize)]
pub struct PolygonGeometryInput {
    pub bbox: Vec<f64>,  // [minLng, minLat, maxLng, maxLat]
    pub polygons: Vec<GeometryData>,
    pub terrainBaseHeight: f64,
    pub elevationGrid: Vec<Vec<f64>>,
    pub gridSize: GridSize,
    pub minElevation: f64,
    pub maxElevation: f64,
    pub vtDataSet: VtDataSet,
    #[serde(default)]
    pub useSameZOffset: bool,
    pub bbox_key: String,
}

// Output struct for the polygon geometry
#[derive(Serialize, Debug)]
pub struct BufferGeometry {
    pub vertices: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub colors: Option<Vec<f32>>,
    pub indices: Option<Vec<u32>>,
    pub uvs: Option<Vec<f32>>,
    pub hasData: bool,
}

// Sample a terrain elevation at a specific geographic point
fn sample_terrain_elevation_at_point(
    lng: f64,
    lat: f64,
    elevation_grid: &[Vec<f64>],
    grid_size: &GridSize,
    bbox: &[f64],
    min_elevation: f64,
    max_elevation: f64,
) -> f64 {
    let minLng = bbox[0];
    let minLat = bbox[1];
    let maxLng = bbox[2];
    let maxLat = bbox[3];
    
    // Normalize coordinates to 0-1 range within the grid
    let nx = (lng - minLng) / (maxLng - minLng);
    let ny = (lat - minLat) / (maxLat - minLat);
    
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
    
    // Normalize the elevation to the actual terrain height range
    if max_elevation > min_elevation {
        return elevation;
    } else {
        // Fallback if elevation range is invalid
        return (min_elevation + max_elevation) / 2.0;
    }
}

// Transform geographic coordinates to mesh coordinates
fn transform_to_mesh_coordinates(lng: f64, lat: f64, bbox: &[f64]) -> [f64; 2] {
    let minLng = bbox[0];
    let minLat = bbox[1];
    let maxLng = bbox[2];
    let maxLat = bbox[3];
    
    // Convert from geographic coords to normalized 0-1 space
    let normalized_x = (lng - minLng) / (maxLng - minLng);
    let normalized_y = (lat - minLat) / (maxLat - minLat);
    
    // Convert to mesh coordinates (assuming mesh is 200x200 units centered at origin)
    let mesh_size = 200.0;
    let mesh_x = (normalized_x * mesh_size) - (mesh_size / 2.0);
    let mesh_y = (normalized_y * mesh_size) - (mesh_size / 2.0);
    
    [mesh_x, mesh_y]
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

// Calculate an adaptive scale factor based on the extent and elevation range
fn calculate_adaptive_scale_factor(
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
    min_elevation: f64,
    max_elevation: f64,
) -> f64 {
    // Geographic extent in km
    let R = 6371.0; // Earth radius in km
    let lat_extent_rad = (max_lat - min_lat) * std::f64::consts::PI / 180.0;
    let lat_center_rad = ((min_lat + max_lat) / 2.0) * std::f64::consts::PI / 180.0;
    let lng_extent_rad = (max_lng - min_lng) * std::f64::consts::PI / 180.0;
    
    let width_km = R * lng_extent_rad * lat_center_rad.cos();
    let height_km = R * lat_extent_rad;
    
    // Area in km^2
    let area_km2 = width_km * height_km;
    
    // Elevation range in meters
    let elev_range_m = (max_elevation - min_elevation).abs().max(10.0);
    
    // Base scale is 1.0 for a "standard" area (100km²) and elevation range (1000m)
    let standard_area = 100.0;
    let standard_elev_range = 1000.0;
    
    // Calculate area-based scaling factor
    let area_factor = (area_km2 / standard_area).sqrt();
    
    // Calculate elevation-based scaling factor
    let elev_factor = standard_elev_range / elev_range_m;
    
    // Combine factors, with limits to prevent extreme values
    let combined_factor = (area_factor * elev_factor).clamp(0.1, 10.0);
    
    combined_factor
}

// Compute vertex normals for a mesh
fn compute_vertex_normals(
    positions: &[f32],
    indices: Option<&[u32]>,
) -> Vec<f32> {
    let vertex_count = positions.len() / 3;
    let mut normals = vec![0.0f32; positions.len()];
    
    if let Some(idx) = indices {
        // Use indexed geometry
        let face_count = idx.len() / 3;
        
        for f in 0..face_count {
            let i = (f * 3) as usize;
            let a = idx[i] as usize;
            let b = idx[i + 1] as usize;
            let c = idx[i + 2] as usize;
            
            // Calculate face normal using cross product
            let ax = positions[a * 3] as f32;
            let ay = positions[a * 3 + 1] as f32;
            let az = positions[a * 3 + 2] as f32;
            
            let bx = positions[b * 3] as f32;
            let by = positions[b * 3 + 1] as f32;
            let bz = positions[b * 3 + 2] as f32;
            
            let cx = positions[c * 3] as f32;
            let cy = positions[c * 3 + 1] as f32;
            let cz = positions[c * 3 + 2] as f32;
            
            // Vectors for sides of the triangle
            let v1x = bx - ax;
            let v1y = by - ay;
            let v1z = bz - az;
            
            let v2x = cx - ax;
            let v2y = cy - ay;
            let v2z = cz - az;
            
            // Cross product to get normal
            let nx = v1y * v2z - v1z * v2y;
            let ny = v1z * v2x - v1x * v2z;
            let nz = v1x * v2y - v1y * v2x;
            
            // Normalize
            let len = (nx*nx + ny*ny + nz*nz).sqrt();
            let nnx = if len > 0.0 { nx / len } else { 0.0 };
            let nny = if len > 0.0 { ny / len } else { 0.0 };
            let nnz = if len > 0.0 { nz / len } else { 1.0 };
            
            // Add this normal to each vertex
            normals[a * 3] += nnx;
            normals[a * 3 + 1] += nny;
            normals[a * 3 + 2] += nnz;
            
            normals[b * 3] += nnx;
            normals[b * 3 + 1] += nny;
            normals[b * 3 + 2] += nnz;
            
            normals[c * 3] += nnx;
            normals[c * 3 + 1] += nny;
            normals[c * 3 + 2] += nnz;
        }
    } else {
        // Non-indexed geometry
        let face_count = vertex_count / 3;
        
        for f in 0..face_count {
            let i = (f * 9) as usize;
            
            let ax = positions[i];
            let ay = positions[i + 1];
            let az = positions[i + 2];
            
            let bx = positions[i + 3];
            let by = positions[i + 4];
            let bz = positions[i + 5];
            
            let cx = positions[i + 6];
            let cy = positions[i + 7];
            let cz = positions[i + 8];
            
            // Vectors for sides of the triangle
            let v1x = bx - ax;
            let v1y = by - ay;
            let v1z = bz - az;
            
            let v2x = cx - ax;
            let v2y = cy - ay;
            let v2z = cz - az;
            
            // Cross product to get normal
            let nx = v1y * v2z - v1z * v2y;
            let ny = v1z * v2x - v1x * v2z;
            let nz = v1x * v2y - v1y * v2x;
            
            // Normalize
            let len = (nx*nx + ny*ny + nz*nz).sqrt();
            let nnx = if len > 0.0 { nx / len } else { 0.0 };
            let nny = if len > 0.0 { ny / len } else { 0.0 };
            let nnz = if len > 0.0 { nz / len } else { 1.0 };
            
            // Add this normal to each vertex
            normals[i] += nnx;
            normals[i + 1] += nny;
            normals[i + 2] += nnz;
            
            normals[i + 3] += nnx;
            normals[i + 4] += nny;
            normals[i + 5] += nnz;
            
            normals[i + 6] += nnx;
            normals[i + 7] += nny;
            normals[i + 8] += nnz;
        }
    }
    
    // Normalize all vertex normals
    for v in 0..vertex_count {
        let i = v * 3;
        let nx = normals[i];
        let ny = normals[i + 1];
        let nz = normals[i + 2];
        
        let len = (nx*nx + ny*ny + nz*nz).sqrt();
        
        if len > 0.0 {
            normals[i] = nx / len;
            normals[i + 1] = ny / len;
            normals[i + 2] = nz / len;
        } else {
            normals[i] = 0.0;
            normals[i + 1] = 0.0;
            normals[i + 2] = 1.0;
        }
    }
    
    normals
}

// Parse a color string in hex format (#RRGGBB)
fn parse_color(color_str: &str) -> Color {
    if color_str.starts_with('#') && color_str.len() >= 7 {
        let r = u8::from_str_radix(&color_str[1..3], 16).unwrap_or(255);
        let g = u8::from_str_radix(&color_str[3..5], 16).unwrap_or(255);
        let b = u8::from_str_radix(&color_str[5..7], 16).unwrap_or(255);
        
        Color {
            r: r as f32 / 255.0,
            g: g as f32 / 255.0,
            b: b as f32 / 255.0,
        }
    } else {
        // Default to gray
        Color { r: 0.7, g: 0.7, b: 0.7 }
    }
}

// --- NEW: Polygon Cleaning Function ---
// Removes duplicate consecutive points and ensures the polygon is closed.
// Returns a list of UNIQUE vertices suitable for extrusion.
fn clean_polygon_footprint(points: &[Vector2]) -> Vec<Vector2> {
    if points.len() < 2 {
        return Vec::new(); // Cannot form a polygon
    }

    let mut cleaned: Vec<Vector2> = Vec::with_capacity(points.len());
    cleaned.push(points[0]); // Start with the first point

    // Remove consecutive duplicates
    for i in 1..points.len() {
        let current_point = points[i];
        // Safe unwrap: cleaned always has at least one element here
        let last_added_point = *cleaned.last().unwrap();

        if (current_point.x - last_added_point.x).abs() > EPSILON ||
           (current_point.y - last_added_point.y).abs() > EPSILON {
            cleaned.push(current_point);
        }
    }

    // Check if the first and last points are duplicates *after* cleaning consecutive ones
    if cleaned.len() > 1 {
        let first_point = cleaned[0];
        let last_point = *cleaned.last().unwrap();
        if (first_point.x - last_point.x).abs() < EPSILON &&
           (first_point.y - last_point.y).abs() < EPSILON {
            cleaned.pop(); // Remove the last point, it's a duplicate of the first
        }
    }

    // Final check: need at least 3 unique vertices for a polygon
    if cleaned.len() < 3 {
        console_log!("Cleaned: Polygon has less than 3 unique vertices after cleaning ({})", cleaned.len());
        return Vec::new();
    }

    cleaned // Return the list of unique vertices
}

// --- REVISED: Clipping function using simple geometric operations ---
fn clip_polygon_to_bbox_2d(
    unique_shape_points: &[Vector2], // Input should be CLEANED unique vertices
    mesh_bbox_coords: &[f64; 4], // [minX, minY, maxX, maxY] in MESH coordinates
) -> Vec<Vector2> {
    if unique_shape_points.len() < 3 {
        return Vec::new(); // Cannot clip if not a polygon
    }

    // Create a CSG square for the bbox
    let bbox_min_x = mesh_bbox_coords[0];
    let bbox_min_y = mesh_bbox_coords[1];
    let bbox_max_x = mesh_bbox_coords[2];
    let bbox_max_y = mesh_bbox_coords[3];
    
    let bbox_width = bbox_max_x - bbox_min_x;
    let bbox_height = bbox_max_y - bbox_min_y;
    let bbox_center_x = bbox_min_x + bbox_width * 0.5;
    let bbox_center_y = bbox_min_y + bbox_height * 0.5;
    
    let bbox_csg: CSG<()> = CSG::square(
        bbox_width as f64, 
        bbox_height as f64, 
        None
    ).translate(
        bbox_center_x as f64,
        bbox_center_y as f64,
        0.0
    );
    
    // Create points for the input polygon
    let points: Vec<[f64; 2]> = unique_shape_points.iter()
        .map(|p| [p.x, p.y])
        .collect();
    
    // Create a CSG polygon from the input points
    let poly_csg: CSG<()> = match CSG::polygon(&points, None) {
        csg if csg.polygons.is_empty() => {
            console_log!("Failed to create polygon from points");
            return unique_shape_points.to_vec(); // Return original if we can't create a CSG polygon
        },
        csg => csg,
    };
    
    // Perform intersection to clip the polygon to the bbox
    let clipped_csg = poly_csg.intersection(&bbox_csg);
    
    // Extract the vertices from the clipped geometry
    let mut clipped_points = Vec::new();
    
    // Handle possible case where clipping results in multiple polygons
    if clipped_csg.polygons.is_empty() {
        console_log!("Clipping resulted in empty geometry");
        return Vec::new(); // Return empty vector if no geometry remains after clipping
    }
    
    // Find the polygon with the largest area
    let mut largest_poly_idx = 0;
    let mut largest_area = 0.0;
    
    for (i, polygon) in clipped_csg.polygons.iter().enumerate() {
        // Calculate approximate area using vertices
        let mut area = 0.0;
        let vertices = &polygon.vertices;
        let n = vertices.len();
        
        if n < 3 {
            continue; // Skip degenerate polygons
        }
        
        for j in 0..n {
            let k = (j + 1) % n;
            area += vertices[j].pos.x * vertices[k].pos.y;
            area -= vertices[j].pos.y * vertices[k].pos.x;
        }
        
        area = (area / 2.0).abs();
        
        if area > largest_area {
            largest_area = area;
            largest_poly_idx = i;
        }
    }
    
    // Extract vertices from the largest polygon
    for vertex in &clipped_csg.polygons[largest_poly_idx].vertices {
        clipped_points.push(Vector2 {
            x: vertex.pos.x,
            y: vertex.pos.y,
        });
    }
    
    // Final cleaning to ensure valid polygon
    let result = clean_polygon_footprint(&clipped_points);
    if result.len() >= 3 {
        result
    } else {
        Vec::new() // Return empty if the result is invalid
    }
}

// --- REVISED: Improved implementation of an extruded shape using earcutr ---
fn create_extruded_shape(
    unique_shape_points: &[Vector2], // Expects CLEANED, UNIQUE vertices
    height: f64,
    z_offset: f64
) -> BufferGeometry {
    // **Robustness Check 1: Valid Height**
    if height < MIN_HEIGHT {
        return BufferGeometry { vertices: Vec::new(), normals: None, colors: None, indices: None, uvs: None, hasData: false };
    }

    // **Robustness Check 2: Ensure enough unique points**
    let unique_points_count = unique_shape_points.len();
    if unique_points_count < 3 {
        return BufferGeometry { vertices: Vec::new(), normals: None, colors: None, indices: None, uvs: None, hasData: false };
    }

    // 1. Prepare data for earcutr: Needs closed polygon coordinates flattened
    // Create the closed coordinate list specifically for earcutr
    let mut closed_coords: Vec<Coord<f64>> = unique_shape_points.iter()
        .map(|p| Coord { x: p.x, y: p.y })
        .collect();
    closed_coords.push(closed_coords[0]); // Close it

    let mut flat_coords: Vec<f64> = Vec::with_capacity(closed_coords.len() * 2);
    for coord in &closed_coords {
        flat_coords.push(coord.x);
        flat_coords.push(coord.y);
    }

    // Define where each ring starts (only exterior ring for now)
    let ring_starts: Vec<usize> = vec![0]; // Holes would need changes here

    // **Robustness Check 3: Attempt triangulation with earcutr**
    let indices_2d = match earcutr::earcut(&flat_coords, &ring_starts, 2) {
        Ok(indices) => {
            // Check if earcutr succeeded but returned no triangles (can happen for degenerate inputs)
            if indices.is_empty() && unique_points_count >= 3 {
                 console_log!("Warning: earcutr returned empty indices for {} unique vertices. Polygon might be degenerate (sliver, self-intersecting?). Skipping.", unique_points_count);
                 return BufferGeometry { vertices: Vec::new(), normals: None, colors: None, indices: None, uvs: None, hasData: false };
            }
            indices
        },
        Err(err) => {
            console_log!("Earcutr triangulation failed: {:?}. Skipping polygon.", err);
            return BufferGeometry { vertices: Vec::new(), normals: None, colors: None, indices: None, uvs: None, hasData: false };
        }
    };

    // If no triangles were generated (e.g., collinear points), exit early
    if indices_2d.is_empty() {
         return BufferGeometry { vertices: Vec::new(), normals: None, colors: None, indices: None, uvs: None, hasData: false };
    }

    // 2. Generate the 3D vertices
    let mut vertices: Vec<f32> = Vec::with_capacity(unique_points_count * 2 * 3); // top + bottom
    let mut indices: Vec<u32> = Vec::with_capacity(indices_2d.len() * 2 + unique_points_count * 6); // caps + sides

    // Add bottom face vertices (using the unique points)
    for point in unique_shape_points {
        vertices.push(point.x as f32);
        vertices.push(point.y as f32);
        vertices.push(z_offset as f32);
    }

    // Add top face vertices (using the unique points)
    let top_vertex_offset = unique_points_count as u32;
    for point in unique_shape_points {
        vertices.push(point.x as f32);
        vertices.push(point.y as f32);
        vertices.push((z_offset + height) as f32);
    }

    // 3. Generate indices

    // Add bottom face indices (ensure Clockwise when viewed from outside/below)
    // Earcutr outputs CCW triangles. For bottom face viewed from outside, we need CW.
    for i in (0..indices_2d.len()).step_by(3) {
        // Map earcutr indices (which refer to the flat_coords array positions)
        // to our unique_shape_points indices (which are 0 to unique_points_count-1)
        let i0 = indices_2d[i] as u32;
        let i1 = indices_2d[i+1] as u32;
        let i2 = indices_2d[i+2] as u32;

        // Check if indices are within the valid range (paranoia check)
        if i0 < top_vertex_offset && i1 < top_vertex_offset && i2 < top_vertex_offset {
             indices.push(i0); // vertex 0
             indices.push(i2); // vertex 2
             indices.push(i1); // vertex 1 (CW order)
        } else {
            console_log!("Warning: Invalid index found during bottom face creation: {} {} {}", i0, i1, i2);
        }
    }

    // Add top face indices (ensure Counter-Clockwise when viewed from outside/above)
    // Use the same earcutr order, just offset indices to top vertices.
    for i in (0..indices_2d.len()).step_by(3) {
         let i0 = indices_2d[i] as u32;
         let i1 = indices_2d[i+1] as u32;
         let i2 = indices_2d[i+2] as u32;

         if i0 < top_vertex_offset && i1 < top_vertex_offset && i2 < top_vertex_offset {
             indices.push(i0 + top_vertex_offset); // vertex 0' (top)
             indices.push(i1 + top_vertex_offset); // vertex 1' (top)
             indices.push(i2 + top_vertex_offset); // vertex 2' (top) (CCW order)
         } else {
              console_log!("Warning: Invalid index found during top face creation: {} {} {}", i0, i1, i2);
         }
    }

    // Create side walls (using unique_points_count)
    for i in 0..unique_points_count {
        let current = i as u32;
        let next = ((i + 1) % unique_points_count) as u32; // Wrap around

        let bottom_current = current;
        let bottom_next = next;
        let top_current = current + top_vertex_offset;
        let top_next = next + top_vertex_offset;

        // First triangle of the side quad (bottom_current, bottom_next, top_next) - CCW from outside
        indices.push(bottom_current);
        indices.push(bottom_next);
        indices.push(top_next);

        // Second triangle of the side quad (bottom_current, top_next, top_current) - CCW from outside
        indices.push(bottom_current);
        indices.push(top_next);
        indices.push(top_current);
    }

    // 4. Generate normals (smooth normals)
    let normals = compute_vertex_normals(&vertices, Some(&indices));

    BufferGeometry {
        vertices,
        indices: Some(indices),
        normals: Some(normals),
        colors: None, // Will be added later
        uvs: None,    // Not used
        hasData: true,
    }
}

// The main function for creating polygon geometry
#[wasm_bindgen]
pub fn create_polygon_geometry(input_json: &str) -> Result<JsValue, JsValue> {
    console_log!("RUST: Starting create_polygon_geometry (Robust)");
    
    // Parse the input JSON
    let input: PolygonGeometryInput = match serde_json::from_str(input_json) {
        Ok(parsed) => parsed,
        Err(e) => {
            console_log!("RUST: JSON parse error: {}", e);
            return Err(JsValue::from_str(&format!("Failed to parse input: {}", e)));
        }
    };
    
    let min_lng = input.bbox[0];
    let min_lat = input.bbox[1];
    let max_lng = input.bbox[2];
    let max_lat = input.bbox[3];
    let geo_bbox = input.bbox.clone(); // Keep original bbox for geo transformations

    // Calculate mesh coordinate bounding box ONCE
    let [mesh_min_x, mesh_min_y] = transform_to_mesh_coordinates(min_lng, min_lat, &geo_bbox);
    let [mesh_max_x, mesh_max_y] = transform_to_mesh_coordinates(max_lng, max_lat, &geo_bbox);
    let mesh_bbox: [f64; 4] = [mesh_min_x, mesh_min_y, mesh_max_x, mesh_max_y];
    
    console_log!(
        "Processing polygons for {} using bbox_key: {}",
        input.vtDataSet.sourceLayer,
        input.bbox_key
    );
    
    // Get polygons from module state cache using the bbox_key
    let state = ModuleState::global();
    let state = state.lock().unwrap();
    
    // Try to get the cached geometry data
    let polygons = match state.get_cached_geometry_data(&input.bbox_key, &input.vtDataSet.sourceLayer) {
        Some(cached_polygons) => {
            console_log!("Using {} cached geometry features for {}", cached_polygons.len(), input.vtDataSet.sourceLayer);
            cached_polygons
        },
        None => {
            // If not found in cache, use the provided polygons
            console_log!("No cached geometry data found, using provided polygons");
            input.polygons.clone()
        }
    };
    
    // Calculate dataset-wide terrain elevation offset by sampling multiple points
    let mut dataset_lowest_z = f64::INFINITY;
    let mut dataset_highest_z = f64::NEG_INFINITY;
    let sample_count = 10; // Number of points to sample per dataset
    
    // Sample evenly across the dataset bounds
    for i in 0..sample_count {
        let sample_lng = min_lng + (max_lng - min_lng) * (i as f64 / (sample_count - 1) as f64);
        for j in 0..sample_count {
            let sample_lat = min_lat + (max_lat - min_lat) * (j as f64 / (sample_count - 1) as f64);
            let elevation_z = sample_terrain_elevation_at_point(
                sample_lng,
                sample_lat,
                &input.elevationGrid,
                &input.gridSize,
                &input.bbox,
                input.minElevation,
                input.maxElevation
            );
            dataset_lowest_z = dataset_lowest_z.min(elevation_z);
            dataset_highest_z = dataset_highest_z.max(elevation_z);
        }
    }
    
    console_log!(
        "Dataset elevation range: {} - {}",
        dataset_lowest_z,
        dataset_highest_z
    );
    
    // Process each polygon, but only if it intersects with the bbox
    let mut buffer_geometries: Vec<BufferGeometry> = Vec::new();
    
    console_log!("Processing {} input polygons for layer {}", polygons.len(), input.vtDataSet.sourceLayer);
    let mut processed_count = 0;
    let mut skipped_count = 0;
    
    for (poly_index, poly) in polygons.iter().enumerate() {
        let footprint_geo = &poly.geometry; // Vec<[lng, lat]>
        
        if footprint_geo.len() < 3 {
            skipped_count += 1;
            continue;
        }
        
        // --- Convert to Mesh Coordinates & Calculate Polygon Elevation ---
        let mut path2d_mesh: Vec<Vector2> = Vec::with_capacity(footprint_geo.len());
        let mut lowest_terrain_z = f64::INFINITY;
        let mut polygon_contains_nan = false;
        
        for point_geo in footprint_geo {
            let lng = point_geo[0];
            let lat = point_geo[1];
            
            // Basic check for invalid coordinates before processing
            if lng.is_nan() || lat.is_nan() {
                console_log!("RUST: Poly {}: Skipped - NaN coordinate found ({}, {})", poly_index, lng, lat);
                polygon_contains_nan = true;
                break;
            }
            
            let [mesh_x, mesh_y] = transform_to_mesh_coordinates(lng, lat, &geo_bbox);
            path2d_mesh.push(Vector2 { x: mesh_x, y: mesh_y });
            
            // Sample terrain only if needed (avoid if using dataset Z)
            if !input.useSameZOffset {
                let terrain_z = sample_terrain_elevation_at_point(
                    lng, lat, &input.elevationGrid, &input.gridSize,
                    &geo_bbox, input.minElevation, input.maxElevation
                );
                if terrain_z.is_nan() {
                    console_log!("RUST: Poly {}: Skipped - NaN terrain elevation sampled at ({}, {})", poly_index, lng, lat);
                    polygon_contains_nan = true;
                    break;
                }
                lowest_terrain_z = lowest_terrain_z.min(terrain_z);
            }
        }
        
        if polygon_contains_nan {
            skipped_count += 1;
            continue;
        }
        
        // --- Clean the Mesh Polygon ---
        let unique_mesh_points = clean_polygon_footprint(&path2d_mesh);
        if unique_mesh_points.is_empty() {
            skipped_count += 1;
            continue;
        }
        
        // --- Clip the Cleaned Mesh Polygon ---
        let clipped_mesh_points = clip_polygon_to_bbox_2d(&unique_mesh_points, &mesh_bbox);
        if clipped_mesh_points.is_empty() {
            skipped_count += 1;
            continue;
        }
        
        // --- Determine Height and Z Offset ---
        let mut height = input.vtDataSet.extrusionDepth
            .or(poly.height)
            .unwrap_or(MIN_HEIGHT * 10.0); // Fallback height
        
        if let Some(min_extrusion_depth) = input.vtDataSet.minExtrusionDepth {
            height = height.max(min_extrusion_depth);
        }
        
        let mut validated_height = height.clamp(MIN_HEIGHT, MAX_HEIGHT); // Clamp between MIN/MAX
        
        if input.vtDataSet.useAdaptiveScaleFactor.unwrap_or(false) {
            let adaptive_scale_factor = calculate_adaptive_scale_factor(
                min_lng, min_lat, max_lng, max_lat, input.minElevation, input.maxElevation);
            validated_height *= adaptive_scale_factor;
        }
        
        if let Some(scale_factor) = input.vtDataSet.heightScaleFactor {
            validated_height *= scale_factor;
        }
        
        // Ensure height didn't become invalid after scaling
        validated_height = validated_height.max(MIN_HEIGHT);
        
        let z_offset = if input.useSameZOffset {
            dataset_lowest_z // Use pre-calculated dataset minimum Z
        } else {
            lowest_terrain_z // Use polygon-specific minimum Z
        } + input.vtDataSet.zOffset.unwrap_or(0.0) - BUILDING_SUBMERGE_OFFSET;
        
        // --- Create Extruded Geometry ---
        let mut geometry = create_extruded_shape(
            &clipped_mesh_points, // Use the final clipped & cleaned points
            validated_height,
            z_offset
        );
        
        if geometry.hasData {
            // Add color attribute
            let color = parse_color(&input.vtDataSet.color);
            let mut colors = Vec::with_capacity(geometry.vertices.len()); // Same size as vertices
            for _ in 0..(geometry.vertices.len() / 3) {
                colors.push(color.r);
                colors.push(color.g);
                colors.push(color.b);
            }
            geometry.colors = Some(colors);
            
            buffer_geometries.push(geometry);
            processed_count += 1;
        } else {
            skipped_count += 1;
        }
    }
    
    console_log!("RUST: Processed {} polygons successfully, skipped {}.", processed_count, skipped_count);
    
    // --- Merge Geometries ---
    if buffer_geometries.is_empty() {
        console_log!("RUST: No geometries generated.");
        let empty_geometry = BufferGeometry { vertices: Vec::new(), normals: None, colors: None, indices: None, uvs: None, hasData: false };
        return Ok(serde_wasm_bindgen::to_value(&empty_geometry)?);
    }
    
    if buffer_geometries.len() == 1 {
        console_log!("RUST: Returning single geometry.");
        return Ok(serde_wasm_bindgen::to_value(&buffer_geometries[0])?);
    }
    
    // Merge all valid geometries
    console_log!("RUST: Merging {} buffer geometries.", buffer_geometries.len());
    let mut merged_vertices = Vec::new();
    let mut merged_normals = Vec::new();
    let mut merged_colors = Vec::new();
    let mut merged_indices = Vec::new();
    let mut vertex_offset = 0;
    
    for geometry in buffer_geometries {
        // Ensure all necessary buffers exist before extending
        if geometry.hasData && geometry.indices.is_some() && geometry.normals.is_some() && geometry.colors.is_some() {
            let current_vertex_count = (geometry.vertices.len() / 3) as u32;
            merged_vertices.extend_from_slice(&geometry.vertices);
            merged_normals.extend_from_slice(geometry.normals.as_ref().unwrap());
            merged_colors.extend_from_slice(geometry.colors.as_ref().unwrap());
            
            let offset_indices: Vec<u32> = geometry.indices.unwrap().iter()
                .map(|&idx| idx + vertex_offset)
                .collect();
            merged_indices.extend_from_slice(&offset_indices);
            
            vertex_offset += current_vertex_count;
        } else {
            console_log!("RUST: Warning - Skipping geometry during merge due to missing buffers.");
        }
    }
    
    let merged_geometry = BufferGeometry {
        vertices: merged_vertices,
        normals: if merged_normals.is_empty() { None } else { Some(merged_normals) },
        colors: if merged_colors.is_empty() { None } else { Some(merged_colors) },
        indices: if merged_indices.is_empty() { None } else { Some(merged_indices) },
        uvs: None,
        hasData: vertex_offset > 0,
    };
    
    console_log!(
        "RUST: Merged geometry created with {} vertices, {} indices.",
        merged_geometry.vertices.len() / 3,
        merged_geometry.indices.as_ref().map_or(0, |v| v.len())
    );
    
    match serde_wasm_bindgen::to_value(&merged_geometry) {
        Ok(js_value) => {
            console_log!("RUST: Successfully serialized merged geometry to JsValue.");
            Ok(js_value)
        },
        Err(e) => {
            console_log!("RUST: Failed to serialize merged geometry: {}", e);
            Err(JsValue::from_str(&format!("Failed to serialize merged geometry: {}", e)))
        }
    }
}
