use crate::bbox_filter::polygon_intersects_bbox;
use crate::extrude;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
// Sequential processing for WASM compatibility
// use csgrs::csg::CSG; // Temporarily commented out - CSG functionality disabled
use js_sys::{Array, Float32Array};
use wasm_bindgen::prelude::JsValue;
use serde_wasm_bindgen::to_value;

// Import console_log macro for logging
use crate::{console_log};


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

// Deserializable struct matching GeometryData from TypeScript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>,  // Array of [lng, lat] points
    pub r#type: Option<String>,   // Geometry type (e.g., "Polygon", "LineString")
    pub height: Option<f64>,
    pub layer: Option<String>,    // Source layer for processing
    pub label: Option<String>,    // Display label for grouping
    pub tags: Option<serde_json::Value>,
    pub properties: Option<serde_json::Value>, // Original properties from MVT
}

// Helper functions for GeometryData
impl GeometryData {
    #[allow(dead_code)]
    pub fn get_label(&self) -> &str {
        self.label.as_deref().unwrap_or(self.layer.as_deref().unwrap_or("unknown"))
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
    #[serde(rename = "heightScaleFactor")]
    pub height_scale_factor: Option<f64>,
    #[serde(rename = "useAdaptiveScaleFactor")]
    pub use_adaptive_scale_factor: Option<bool>,
    #[serde(rename = "zOffset")]
    pub z_offset: Option<f64>,
    #[serde(rename = "alignVerticesToTerrain")]
    pub align_vertices_to_terrain: Option<bool>,
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
        if let Some(scale) = self.height_scale_factor {
            if scale <= 0.0 {
                return Err("height_scale_factor must be positive".to_string());
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
    pub bbox: Vec<f64>,  // [minLng, minLat, maxLng, maxLat]
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
    
    // Apply the same scaling as terrain generation (must match terrain.rs exactly)
    let elevation_range = f64::max(1.0, max_elevation - min_elevation);
    let normalized_elevation = (elevation - min_elevation) / elevation_range;
    let base_box_height = terrain_base_height; // Use terrain base height as box height (no magic numbers)
    let elevation_variation = normalized_elevation * vertical_exaggeration; // Direct application like terrain.rs
    
    // Return the scaled terrain height (same formula as terrain generation)
    base_box_height + elevation_variation
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

// Calculate conversion factor from meters to visualization units
fn calculate_meters_to_units_scale(
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
) -> f64 {
    // Geographic extent calculation
    let r = 6371.0; // Earth radius in km
    let lat_extent_rad = (max_lat - min_lat) * std::f64::consts::PI / 180.0;
    let lat_center_rad = ((min_lat + max_lat) / 2.0) * std::f64::consts::PI / 180.0;
    let lng_extent_rad = (max_lng - min_lng) * std::f64::consts::PI / 180.0;
    
    let width_km = r * lng_extent_rad * lat_center_rad.cos();
    let height_km = r * lat_extent_rad;
    
    // Calculate real-world dimensions in meters
    let width_m = width_km * 1000.0;
    let height_m = height_km * 1000.0;
    
    // Average real-world size in meters
    let avg_size_m = (width_m + height_m) / 2.0;
    
    // Mesh size is 200 visualization units
    const TERRAIN_SIZE: f64 = 200.0;
    
    // Calculate how many visualization units per meter
    // This should decrease for larger areas (larger meter/unit ratio)
    let units_per_meter = TERRAIN_SIZE / avg_size_m;
    
    // Clamp to reasonable bounds to prevent extreme scaling
    units_per_meter.clamp(0.001, 1.0)
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
    mesh_bbox_coords: &[f64; 4]
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
        if point.x >= bbox_min_x && point.x <= bbox_max_x && 
           point.y >= bbox_min_y && point.y <= bbox_max_y {
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
            if (p1.x < bbox_min_x && p2.x > bbox_min_x) || (p1.x > bbox_min_x && p2.x < bbox_min_x) ||
               (p1.x < bbox_max_x && p2.x > bbox_max_x) || (p1.x > bbox_max_x && p2.x < bbox_max_x) ||
               (p1.y < bbox_min_y && p2.y > bbox_min_y) || (p1.y > bbox_min_y && p2.y < bbox_min_y) ||
               (p1.y < bbox_max_y && p2.y > bbox_max_y) || (p1.y > bbox_max_y && p2.y < bbox_max_y) {
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
    let polygon_coords: Vec<Vec<f64>> = points.iter()
        .map(|p| vec![p.x, p.y])
        .collect();
    
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
                        if let Some(intersection) = compute_intersection(prev, curr, clip_value, edge_type) {
                            new_clipped.push(intersection);
                        }
                    }
                    // Add current point
                    new_clipped.push(curr);
                } else if prev_inside {
                    // Leaving the clipping area - add intersection point
                    if let Some(intersection) = compute_intersection(prev, curr, clip_value, edge_type) {
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
fn compute_intersection(p1: Vector2, p2: Vector2, clip_value: f64, edge_type: i32) -> Option<Vector2> {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    
    match edge_type {
        0 | 1 => { // Left or Right edge (vertical)
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
        2 | 3 => { // Bottom or Top edge (horizontal)
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
        
        if ((pi.y > point.y) != (pj.y > point.y)) &&
           (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x) {
            inside = !inside;
        }
    }
    
    inside
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
    source_layer: Option<&str>
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
                Vector2 { x: pt.x - size, y: pt.y - size },
                Vector2 { x: pt.x + size, y: pt.y - size },
                Vector2 { x: pt.x + size, y: pt.y + size },
                Vector2 { x: pt.x - size, y: pt.y + size },
            ];
            return create_extruded_shape(&square_points, height, z_offset, None, false, None, None, None, None, None, None, None, None);
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
                Vector2 { x: p1.x + px * width, y: p1.y + py * width },
                Vector2 { x: p2.x + px * width, y: p2.y + py * width },
                Vector2 { x: p2.x - px * width, y: p2.y - py * width },
                Vector2 { x: p1.x - px * width, y: p1.y - py * width },
            ];
            return create_extruded_shape(&rect_points, height, z_offset, None, false, None, None, None, None, None, None, None, None);
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
    // Skip bottom faces for buildings to avoid duplicate geometry
    let skip_bottom_face = source_layer == Some("building");
    let extruded_js = match extrude::extrude_shape_with_options(shapes, height, 1, skip_bottom_face) {
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
    
    // Apply z_offset to the vertices
    if z_offset != 0.0 {
        // Get position array from extruded_js
        let position_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("position")).unwrap_or(JsValue::null());
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
    let position_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("position")).unwrap_or(JsValue::null());
    let normal_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("normal")).unwrap_or(JsValue::null());
    let index_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("index")).unwrap_or(JsValue::null());
    let uv_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("uv")).unwrap_or(JsValue::null());
    
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
    
    // Apply terrain alignment if enabled, or ensure minimum terrain height positioning
    if align_vertices_to_terrain {
        if let (Some(elev_grid), Some(grid_sz), Some(bbox_arr), Some(min_elev), Some(max_elev), Some(vert_exag), Some(base_height)) = 
            (elevation_grid, grid_size, bbox, min_elevation, max_elevation, vertical_exaggeration, terrain_base_height) {
            
            // Apply terrain alignment to vertices
            // Bottom vertices align to terrain surface, top vertices maintain relative height
            for i in (0..vertices.len()).step_by(3) {
                // Get vertex position in mesh coordinates
                let mesh_x = vertices[i] as f64;
                let mesh_y = vertices[i + 1] as f64;
                let current_z = vertices[i + 2] as f64;
                
                // Convert mesh coordinates (-100 to +100) to geographic coordinates
                let mesh_size = 200.0;
                let half_size = mesh_size / 2.0;
                
                // Normalize to 0-1 range
                let norm_x = (mesh_x + half_size) / mesh_size;
                let norm_y = (mesh_y + half_size) / mesh_size;
                
                // Convert to geographic coordinates
                let lng = bbox_arr[0] + (bbox_arr[2] - bbox_arr[0]) * norm_x;
                let lat = bbox_arr[1] + (bbox_arr[3] - bbox_arr[1]) * norm_y;
                
                // Get terrain height at this position
                let terrain_height = sample_terrain_elevation_at_point(
                    lng, lat, elev_grid, grid_sz, bbox_arr, min_elev, max_elev,
                    vert_exag, base_height
                );
                
                // Determine if this is a bottom or top vertex based on its Z position relative to z_offset
                let vertex_height_above_base = current_z - z_offset;
                
                if vertex_height_above_base <= 0.01 {
                    // This is a bottom vertex - align to terrain surface
                    vertices[i + 2] = terrain_height as f32;
                } else {
                    // This is a top vertex - align to terrain surface + original height above bottom
                    vertices[i + 2] = (terrain_height + vertex_height_above_base) as f32;
                }
            }
        }
    } else {
        // Even when terrain alignment is disabled, ensure layers are positioned above terrain base height
        // This handles cases where alignVerticesToTerrain is false but we still want proper Z positioning
        if let (Some(base_height), Some(_vert_exag)) = (terrain_base_height, vertical_exaggeration) {
            // Terrain extends from 0 to base_height + elevation_variation, so minimum is base_height
            let minimum_terrain_height = base_height;
            
            // Ensure all vertices are at least at the minimum terrain height
            for i in (2..vertices.len()).step_by(3) {
                if vertices[i] < minimum_terrain_height as f32 {
                    let vertex_height_above_original = vertices[i] as f64 - z_offset;
                    vertices[i] = (minimum_terrain_height + vertex_height_above_original) as f32;
                }
            }
        }
    }
    
    // Check if we have any vertices before constructing the result
    let has_data = !vertices.is_empty();
    
    // Create and return the BufferGeometry
    BufferGeometry {
        vertices,
        normals: if normals.is_empty() { None } else { Some(normals) },
        indices: if indices.is_empty() { None } else { Some(indices) },
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
    // Only log for very large datasets to avoid performance overhead
    if total_polygons > 2000 {
        console_log!("Processing {} polygons for layer: {}", total_polygons, input.vt_data_set.source_layer);
    } 
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
                sample_lng, sample_lat,
                &input.elevation_grid, &input.grid_size,
                &input.bbox, input.min_elevation, input.max_elevation,
                input.vertical_exaggeration, input.terrain_base_height
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
        }).unwrap());
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

    // Only log for very large datasets
    if total_polygons > 2000 {
        console_log!("Processing {} polygons in {} chunks of max {} polygons each",
            total_polygons, chunk_count, MAX_CHUNK_SIZE);
    }

    for (chunk_index, chunk) in input.polygons.chunks(MAX_CHUNK_SIZE).enumerate() {
        // Remove per-chunk logging to improve performance

        let chunk_start = chunk_index * MAX_CHUNK_SIZE;
        let geometries_result: Result<Vec<_>, String> = chunk
            .iter()
            .enumerate()
            .map(|(chunk_i, polygon_data)| -> Result<Option<BufferGeometry>, String> {
            let i = chunk_start + chunk_i; // Global polygon index
        
        // No filtering - process all geometries within bbox as requested
        // As requested by user: "I want everything that is inside the bbox with at least one vertex"
        
        // Debug: log the first few polygon properties to see what's available
        if i < 3 {
        }
        
        // Debug: Track primary and secondary roads specifically
        if let Some(ref props) = polygon_data.properties {
            if let serde_json::Value::Object(obj) = props {
                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                    if class == "primary" || class == "secondary" {
                    }
                }
            }
        }
        
        // Calculate if this is a major road (for logging purposes)
        let is_major_road = if let Some(ref props) = polygon_data.properties {
            if let serde_json::Value::Object(obj) = props {
                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                    class == "primary" || class == "secondary" || class == "motorway" || class == "trunk"
                } else { false }
            } else { false }
        } else { false };
        
        // Handle both Polygon and LineString geometries
        let points: Vec<Vector2> = if polygon_data.r#type.as_deref() == Some("LineString") {
            // Extract transportation class for better debugging
            let _transportation_class = if let Some(ref props) = polygon_data.properties {
                if let serde_json::Value::Object(obj) = props {
                    if let Some(serde_json::Value::String(class)) = obj.get("class") {
                        class.clone()
                    } else { "unknown".to_string() }
                } else { "no_props".to_string() }
            } else { "no_props".to_string() };
            
            
            // COMPLETE SOLUTION: Process all segments of LineString for complete road/footway rendering
            if polygon_data.geometry.len() >= 2 {
                // Create complete buffered polygon from all LineString segments
                let mut buffered_points = Vec::new();

                // Use buffer size from layer configuration, with fallback to reasonable defaults
                let config_buffer_size = input.vt_data_set.buffer_size.unwrap_or(if is_major_road { 2.0 } else { 1.5 });
                // Convert buffer size to appropriate coordinate scale (assuming meter-like units)
                let buffer_distance = config_buffer_size * 0.00001; // Scale factor for coordinate space

                // Create offset points for the entire LineString
                let mut left_side = Vec::new();
                let mut right_side = Vec::new();

                // Process all segments to create complete road geometry
                for window in polygon_data.geometry.windows(2) {
                    if window.len() == 2 && window[0].len() >= 2 && window[1].len() >= 2 {
                        let p1 = Vector2 { x: window[0][0], y: window[0][1] };
                        let p2 = Vector2 { x: window[1][0], y: window[1][1] };

                        // Calculate perpendicular offset
                        let dx = p2.x - p1.x;
                        let dy = p2.y - p1.y;
                        let length = (dx * dx + dy * dy).sqrt();

                        if length > 0.0 {
                            let norm_x = -dy / length * buffer_distance;
                            let norm_y = dx / length * buffer_distance;

                            // Add offset points for this segment
                            if left_side.is_empty() {
                                left_side.push(Vector2 { x: p1.x + norm_x, y: p1.y + norm_y });
                            }
                            left_side.push(Vector2 { x: p2.x + norm_x, y: p2.y + norm_y });

                            if right_side.is_empty() {
                                right_side.push(Vector2 { x: p1.x - norm_x, y: p1.y - norm_y });
                            }
                            right_side.push(Vector2 { x: p2.x - norm_x, y: p2.y - norm_y });
                        }
                    }
                }

                // Combine left and right sides to form complete polygon
                buffered_points.extend(left_side);
                buffered_points.extend(right_side.into_iter().rev()); // Reverse right side for proper winding

                buffered_points
            } else {
                Vec::new()
            }
        } else {
            // For Polygons, extract points normally
            polygon_data.geometry.iter()
                .filter_map(|point| {
                    if point.len() >= 2 {
                        Some(Vector2 { x: point[0], y: point[1] })
                    } else {
                        None
                    }
                })
                .collect()
        };
        
        if points.len() < 3 {
            // Debug: Track why geometries might be skipped - THIS IS A MAJOR FILTER
            let transportation_class = if let Some(ref props) = polygon_data.properties {
                if let serde_json::Value::Object(obj) = props {
                    if let Some(serde_json::Value::String(class)) = obj.get("class") {
                        class.clone()
                    } else { "unknown".to_string() }
                } else { "no_props".to_string() }
            } else { "no_props".to_string() };
            
            web_sys::console::log_1(&format!("Skipping geometry with {} points for class: {}", points.len(), transportation_class).into());
            return Ok(None); // Skip invalid polygons
        }
        
        // Determine extrusion height based on geometry type and available data
        let mut height = if let Some(d) = input.vt_data_set.extrusion_depth {
            // Use explicitly set extrusion depth
            web_sys::console::log_1(&format!("Using explicit extrusion depth: {}", d).into());
            d
        } else if let Some(h) = polygon_data.height.filter(|h| *h > 0.0) {
            // Use feature-specific height (typically for buildings from OSM data)
            // This ensures building height variation is preserved
            web_sys::console::log_1(&format!("Using feature height: {}", h).into());
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
                    web_sys::console::log_1(&format!("Using default building height: 25.0 for class: {}", geometry_class).into());
                    25.0
                },
                
                // Unknown types get small fixed height to avoid scaling issues
                _ => 0.2
            }
        };
        // Enforce minimum extrusion depth
        if let Some(min_d) = input.vt_data_set.min_extrusion_depth {
            if height < min_d {
                height = min_d;
            }
        }
        // Clamp to reasonable bounds
        height = height.clamp(MIN_HEIGHT, MAX_HEIGHT);
        // Apply meter-based scaling to convert from meters to visualization units
        if input.vt_data_set.use_adaptive_scale_factor.unwrap_or(false) {
            // Get the meters-to-units conversion factor
            let meters_to_units = calculate_meters_to_units_scale(
                input.bbox[0], input.bbox[1], input.bbox[2], input.bbox[3]
            );
            
            // Get geometry class for logging
            let _geometry_class = if let Some(ref props) = polygon_data.properties {
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
            
            // Apply the conversion - height is assumed to be in meters
            let _original_height = height;
            height *= meters_to_units;
            
            // Debug logging for height scaling
        }
        
        // Apply heightScaleFactor as a multiplier (if provided)
        if let Some(scale_factor) = input.vt_data_set.height_scale_factor {
            height *= scale_factor;
        }
        if height <= 0.0 {
            let _transportation_class = if let Some(ref props) = polygon_data.properties {
                if let serde_json::Value::Object(obj) = props {
                    if let Some(serde_json::Value::String(class)) = obj.get("class") {
                        class.clone()
                    } else { "unknown".to_string() }
                } else { "no_props".to_string() }
            } else { "no_props".to_string() };
            
            return Ok(None); // Skip flat geometry
        }
        
        // Apply mesh coordinates transform
        let mesh_points: Vec<Vector2> = points.iter()
            .map(|p| {
                let [mx, my] = transform_to_mesh_coordinates(p.x, p.y, &input.bbox);
                Vector2 { x: mx, y: my }
            })
            .collect();
        
        // Clean and validate the polygon
        let cleaned_points = clean_polygon_footprint(&mesh_points);
        if cleaned_points.is_empty() {
            let _transportation_class = if let Some(ref props) = polygon_data.properties {
                if let serde_json::Value::Object(obj) = props {
                    if let Some(serde_json::Value::String(class)) = obj.get("class") {
                        class.clone()
                    } else { "unknown".to_string() }
                } else { "no_props".to_string() }
            } else { "no_props".to_string() };
            
            return Ok(None); // Skip invalid polygon after cleaning
        }

        // Determine if CSG clipping should be used
        let use_csg = input.csg_clipping
            .unwrap_or(false);

        // Clip against the overall terrain tile bounds (include any shape that overlaps)
        let half_tile = TERRAIN_SIZE * 0.5;
        
        // Always ensure points are properly clipped to the terrain bounds
        let clipped_points = if use_csg {
            // CSG-based clipping for smoother results
            clip_polygon_to_bbox_2d(&cleaned_points, &[
                -half_tile, -half_tile,
                half_tile,  half_tile,
            ])
        } else {
            // Simple clipping when CSG is not enabled
            simple_clip_polygon(&cleaned_points, &[
                -half_tile, -half_tile,
                half_tile,  half_tile,
            ])
        };
        
        // Skip polygons that truly have no valid representation after clipping
        if clipped_points.is_empty() {
            let _transportation_class = if let Some(ref props) = polygon_data.properties {
                if let serde_json::Value::Object(obj) = props {
                    if let Some(serde_json::Value::String(class)) = obj.get("class") {
                        class.clone()
                    } else { "unknown".to_string() }
                } else { "no_props".to_string() }
            } else { "no_props".to_string() };
            
            return Ok(None);
        }
        
        // For polygons with insufficient points, try to reuse the original cleaned points
        // if they might be partially visible within the bbox
        let final_points = if clipped_points.len() < 3 {
            // Check if the original polygon should visibly intersect the bbox
            let half_tile_with_margin = half_tile * 1.05; // 5% margin
            let bbox_with_margin = [
                -half_tile_with_margin, -half_tile_with_margin,
                half_tile_with_margin, half_tile_with_margin,
            ];
            
            // Check if original polygon has any points near the bbox
            let potentially_visible = cleaned_points.iter().any(|pt| {
                pt.x >= bbox_with_margin[0] && pt.x <= bbox_with_margin[2] &&
                pt.y >= bbox_with_margin[1] && pt.y <= bbox_with_margin[3]
            });
            
            if potentially_visible {
                // Use a simple fallback approach to clip against the actual boundary
                let fallback = simple_clip_polygon(&cleaned_points, &[
                    -half_tile, -half_tile,
                    half_tile, half_tile,
                ]);
                
                if fallback.len() >= 3 {
                    fallback
                } else {
                    // Last chance: If we're dealing with a very large polygon that extends
                    // far beyond the bounds, just use the bbox corners to ensure we show something
                    vec![
                        Vector2 { x: -half_tile, y: -half_tile },
                        Vector2 { x: half_tile, y: -half_tile },
                        Vector2 { x: half_tile, y: half_tile },
                        Vector2 { x: -half_tile, y: half_tile },
                    ]
                }
            } else {
                // Not visible, skip
                let _transportation_class = if let Some(ref props) = polygon_data.properties {
                    if let serde_json::Value::Object(obj) = props {
                        if let Some(serde_json::Value::String(class)) = obj.get("class") {
                            class.clone()
                        } else { "unknown".to_string() }
                    } else { "no_props".to_string() }
                } else { "no_props".to_string() };
                
                return Ok(None);
            }
        } else {
            clipped_points
        };

        // SUCCESS: This geometry made it through all filters
        let _transportation_class = if let Some(ref props) = polygon_data.properties {
            if let serde_json::Value::Object(obj) = props {
                if let Some(serde_json::Value::String(class)) = obj.get("class") {
                    class.clone()
                } else { "unknown".to_string() }
            } else { "no_props".to_string() }
        } else { "no_props".to_string() };
        

        // Compute per-polygon terrain extremes for base alignment
        let mut lowest_terrain_z = f64::INFINITY;
        let mut _highest_terrain_z = f64::NEG_INFINITY;
        for pt in &points {
            let tz = sample_terrain_elevation_at_point(
                pt.x, pt.y, &input.elevation_grid, &input.grid_size,
                &input.bbox, input.min_elevation, input.max_elevation,
                input.vertical_exaggeration, input.terrain_base_height
            );
            lowest_terrain_z = lowest_terrain_z.min(tz);
            _highest_terrain_z = _highest_terrain_z.max(tz);
        }
        // Optionally use dataset-wide extremes
        if use_same_z_offset {
            lowest_terrain_z = dataset_lowest_z;
            _highest_terrain_z = dataset_highest_z;
        }
        // Base z offset: position bottom face at terrain surface minus submerge
        let z_offset = lowest_terrain_z + input.vt_data_set.z_offset.unwrap_or(0.0) - BUILDING_SUBMERGE_OFFSET;
        
        // Extract properties from polygon_data for attaching to geometry
        let properties = if let Some(ref props) = polygon_data.properties {
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
        
        let geometry = create_extruded_shape(
            &final_points, 
            height, 
            z_offset, 
            properties.clone(),
            input.vt_data_set.align_vertices_to_terrain.unwrap_or(false),
            Some(&input.elevation_grid),
            Some(&input.grid_size),
            Some(&input.bbox),
            Some(input.min_elevation),
            Some(input.max_elevation),
            Some(input.vertical_exaggeration),
            Some(input.terrain_base_height),
            Some(&input.vt_data_set.source_layer)
        );
        
        if geometry.has_data {
            Ok(Some(geometry))
        } else {
            Ok(None)
        }
            })
            .collect();

        // Handle chunk processing results
        let chunk_geometries = geometries_result.map_err(|e| format!("Chunk {} processing error: {}", chunk_index + 1, e))?;
        let chunk_valid_geometries: Vec<BufferGeometry> = chunk_geometries
            .into_iter()
            .filter_map(|opt| opt)
            .collect();

        // Add chunk geometries to the overall collection
        all_geometries.extend(chunk_valid_geometries);
    }

    // Only log final count for large datasets
    if total_polygons > 2000 {
        console_log!("Final geometry count for layer {}: {} geometries",
            input.vt_data_set.source_layer, all_geometries.len());
    }
    
    
    // Apply CSG union only for layers that benefit from it (buildings)
    if all_geometries.is_empty() {
        return Ok(serde_json::to_string(&Vec::<BufferGeometry>::new()).unwrap());
    }

    // Apply CSG union for ALL layers as requested, but optimize the process
    let merged_geometries = if all_geometries.len() > 1 {
        // Use CSG union for all layers but optimize the tolerance based on layer type
        let tolerance = match input.vt_data_set.source_layer.as_str() {
            "transportation" => 0.001, // Smaller tolerance for roads for better detail
            _ => 0.01 // Standard tolerance for other layers
        };

        let layer_merged = crate::csg_union::merge_geometries_by_layer(all_geometries);

        let mut final_geometries = Vec::new();
        for (_layer_name, geometry) in layer_merged {
            let optimized = crate::csg_union::optimize_geometry(geometry, tolerance);
            if optimized.has_data {
                final_geometries.push(optimized);
            }
        }
        final_geometries
    } else {
        // Single geometry, just optimize it
        if let Some(geometry) = all_geometries.into_iter().next() {
            let tolerance = match input.vt_data_set.source_layer.as_str() {
                "transportation" => 0.001,
                _ => 0.01
            };
            let optimized = crate::csg_union::optimize_geometry(geometry, tolerance);
            if optimized.has_data {
                vec![optimized]
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    };
    
    // Serialize merged and optimized geometries
    match serde_json::to_string(&merged_geometries) {
        Ok(json) => Ok(json),
        Err(e) => Err(format!("Failed to serialize output: {}", e)),
    }
}
