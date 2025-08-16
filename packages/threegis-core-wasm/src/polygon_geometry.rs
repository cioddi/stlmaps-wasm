use crate::console_log;
use crate::module_state::ModuleState;
use crate::bbox_filter::polygon_intersects_bbox;
use crate::extrude;
use serde::{Serialize, Deserialize};
use csgrs::csg::CSG;
use js_sys::{Object, Array, Float32Array};
use wasm_bindgen::prelude::JsValue;
use serde_wasm_bindgen::{from_value, to_value};


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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub filter: Option<serde_json::Value>,
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
    // Optionally override CSG clipping for this request
    pub csgClipping: Option<bool>,
}

// Output struct for the polygon geometry
#[derive(Serialize, Debug)]
pub struct BufferGeometry {
    pub vertices: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub colors: Option<Vec<f32>>,
    pub indices: Option<Vec<u32>>,
    pub uvs: Option<Vec<f32>>,
    #[serde(rename = "hasData")]
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
    
    // Calculate meters per unit of mesh (mesh size is 200 units, as per transform_to_mesh_coordinates)
    const TERRAIN_SIZE: f64 = 200.0; // Mesh size in visualization units
    // Calculate real-world dimensions in meters (1km = 1000m)
    let width_m = width_km * 1000.0;
    let height_m = height_km * 1000.0;
    
    // The average meters per unit
    let meters_per_unit = ((width_m / TERRAIN_SIZE) + (height_m / TERRAIN_SIZE)) / 2.0;
    
    // Elevation range in meters
    let elev_range_m = (max_elevation - min_elevation).abs().max(10.0);
    
    // Calculate how many visualization units we need for a meter of height
    // to maintain proper scale with geographic extent
    let units_per_meter = 1.0 / meters_per_unit;
    
    // Apply scaling based on area to adjust for zoom level
    let area_scale_factor = if area_km2 < 1.0 {
        // For very small areas, increase the height to make it more visible
        1.5
    } else if area_km2 < 10.0 {
        // Medium small areas
        1.2
    } else if area_km2 < 100.0 {
        // Standard area
        1.0
    } else if area_km2 < 1000.0 {
        // Larger areas, reduce height to avoid massive structures
        0.7
    } else {
        // Very large areas, further reduce height
        0.5
    };
    
    // Final scaling factor that converts real-world meters to visualization units
    // with area-based adjustment
    let scale_factor = units_per_meter * area_scale_factor;
    
    // Clamp to reasonable bounds
    scale_factor.clamp(0.05, 5.0)
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
        console_log!("Cleaned: Polygon has less than 3 unique vertices after cleaning ({})", cleaned.len());
        return Vec::new();
    }
    
    // Ensure counter-clockwise winding for consistent triangulation
    if is_clockwise(&cleaned) {
        cleaned.reverse();
    }
    
    // Validate the final polygon
    if !is_valid_polygon(&cleaned) {
        console_log!("Polygon validation failed after cleaning");
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
    
    // Continue with CSG clipping
    let bbox_width = bbox_max_x - bbox_min_x;
    let bbox_height = bbox_max_y - bbox_min_y;
    let bbox_center_x = bbox_min_x + bbox_width * 0.5;
    let bbox_center_y = bbox_min_y + bbox_height * 0.5;
    
    // Try to create a CSG square for the bbox - this should always succeed
    let bbox_csg: CSG<f64> = CSG::square(
        bbox_width as f64, 
        bbox_height as f64, 
        None
    ).translate(
        bbox_center_x as f64,
        bbox_center_y as f64,
        0.0
    );
    
    // Make sure polygon points are counter-clockwise
    let mut ccw_points = unique_shape_points.to_vec();
    if is_clockwise(&ccw_points) {
        ccw_points.reverse();
    }
    
    // Create the CSG polygon from the cleaned points (2D XY only)
    let points2d: Vec<[f64; 2]> = ccw_points.iter().map(|p| [p.x, p.y]).collect();
    let poly_csg = match CSG::polygon(&points2d[..], None) {
        csg if csg.polygons.is_empty() => {
            console_log!("Failed to create CSG polygon - trying simple clipping");
            // Fall back to simple clipping
            return simple_clip_polygon(&ccw_points, mesh_bbox_coords);
        },
        csg => csg,
    };
    
    // Perform intersection to clip the polygon to the bbox
    let clipped_csg = poly_csg.intersection(&bbox_csg);
    
    // Handle empty result - if CSG intersection fails, fall back to simple clipping
    if clipped_csg.polygons.is_empty() {
        console_log!("CSG intersection resulted in empty geometry - using simple clipping fallback");
        return simple_clip_polygon(&ccw_points, mesh_bbox_coords);
    }
    
    // Find the polygon with the largest area
    let mut largest_poly_idx = 0;
    let mut largest_area = 0.0;
    let mut areas = Vec::new();
    for (i, polygon) in clipped_csg.polygons.iter().enumerate() {
        let vertices = &polygon.vertices;
        if vertices.len() < 3 {
            continue; // Skip degenerate polygons
        }
        // Calculate area
        let mut area = 0.0;
        for j in 0..vertices.len() {
            let v0 = &vertices[j].pos.coords;
            let v1 = &vertices[(j + 1) % vertices.len()].pos.coords;
            area += (v0.x * v1.y) - (v1.x * v0.y);
        }
        area = (area / 2.0_f64).abs();
        if area > largest_area {
            largest_area = area;
            largest_poly_idx = i;
        }
        areas.push(area);
    }
    // Return the largest polygon as Vec<Vector2>
    let largest_poly = &clipped_csg.polygons[largest_poly_idx];
    let result: Vec<Vector2> = largest_poly.vertices.iter().map(|v| {
        let c = &v.pos.coords;
        Vector2 { x: c.x, y: c.y }
    }).collect();
    return result;
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
    
    // Check if the polygon intersects with the bbox at all
    let mut bbox_intersected = false;
    
    // Check if any point is inside the bbox
    for pt in points {
        if pt.x >= min_x && pt.x <= max_x && pt.y >= min_y && pt.y <= max_y {
            bbox_intersected = true;
            break;
        }
    }
    
    // If no points are inside, check if any edges intersect the bbox
    if !bbox_intersected {
        for i in 0..points.len() {
            let p1 = points[i];
            let p2 = points[(i + 1) % points.len()];
            
            // Check all 4 bbox edges for intersections
            if (p1.x < min_x && p2.x > min_x) || (p1.x > min_x && p2.x < min_x) ||
               (p1.x < max_x && p2.x > max_x) || (p1.x > max_x && p2.x < max_x) ||
               (p1.y < min_y && p2.y > min_y) || (p1.y > min_y && p2.y < min_y) ||
               (p1.y < max_y && p2.y > max_y) || (p1.y > max_y && p2.y < max_y) {
                bbox_intersected = true;
                break;
            }
        }
    }
    
    // If there's no intersection at all, return empty
    if !bbox_intersected {
        return Vec::new();
    }
    
    let mut clipped = Vec::new();
    
    // Simple clipping - just keep points inside the bbox
    // and add intersection points with the bbox edges
    for i in 0..points.len() {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.len()];
        
        // Add p1 if inside
        if p1.x >= min_x && p1.x <= max_x && p1.y >= min_y && p1.y <= max_y {
            clipped.push(p1);
        }
        
        // Check if line segment crosses any bbox edge and add intersection points
        // Left edge
        if (p1.x < min_x && p2.x >= min_x) || (p1.x >= min_x && p2.x < min_x) {
            let t = (min_x - p1.x) / (p2.x - p1.x);
            if t >= 0.0 && t <= 1.0 {
                let y = p1.y + t * (p2.y - p1.y);
                if y >= min_y && y <= max_y {
                    clipped.push(Vector2 { x: min_x, y });
                }
            }
        }
        
        // Right edge
        if (p1.x < max_x && p2.x >= max_x) || (p1.x >= max_x && p2.x < max_x) {
            let t = (max_x - p1.x) / (p2.x - p1.x);
            if t >= 0.0 && t <= 1.0 {
                let y = p1.y + t * (p2.y - p1.y);
                if y >= min_y && y <= max_y {
                    clipped.push(Vector2 { x: max_x, y });
                }
            }
        }
        
        // Bottom edge
        if (p1.y < min_y && p2.y >= min_y) || (p1.y >= min_y && p2.y < min_y) {
            let t = (min_y - p1.y) / (p2.y - p1.y);
            if t >= 0.0 && t <= 1.0 {
                let x = p1.x + t * (p2.x - p1.x);
                if x >= min_x && x <= max_x {
                    clipped.push(Vector2 { x, y: min_y });
                }
            }
        }
        
        // Top edge
        if (p1.y < max_y && p2.y >= max_y) || (p1.y >= max_y && p2.y < max_y) {
            let t = (max_y - p1.y) / (p2.y - p1.y);
            if t >= 0.0 && t <= 1.0 {
                let x = p1.x + t * (p2.x - p1.x);
                if x >= min_x && x <= max_x {
                    clipped.push(Vector2 { x, y: max_y });
                }
            }
        }
    }
    
    // Special handling for empty results or cases with just 1-2 points
    if clipped.len() < 3 {
        // Check if the polygon overlaps the bbox corners
        let corner_points = vec![
            Vector2 { x: min_x, y: min_y },
            Vector2 { x: max_x, y: min_y },
            Vector2 { x: max_x, y: max_y },
            Vector2 { x: min_x, y: max_y }
        ];
        
        // Add bbox corners that are inside the original polygon
        // This handles the case where the polygon completely contains the bbox
        for corner in &corner_points {
            let mut inside = false;
            let mut j = points.len() - 1;
            
            for i in 0..points.len() {
                let pi = points[i];
                let pj = points[j];
                
                if ((pi.y > corner.y) != (pj.y > corner.y)) &&
                   (corner.x < (pj.x - pi.x) * (corner.y - pi.y) / (pj.y - pi.y) + pi.x) {
                    inside = !inside;
                }
                
                j = i;
            }
            
            if inside {
                clipped.push(*corner);
            }
        }
        
        // If we've added corners, add the first corner again to close the polygon
        if clipped.len() >= 3 && clipped.len() <= 4 {
            clipped.push(clipped[0]);
        }
    }
    
    // Clean up the clipped points and ensure they form a valid polygon
    let cleaned = clean_polygon_footprint(&clipped);
    
    // If we still don't have a valid polygon after all this, try to return a minimal
    // valid polygon that represents the clipped area
    if cleaned.len() < 3 && clipped.len() > 0 {
        // Create a minimal valid polygon from the points we have
        let mut fallback = clipped.clone();
        
        // Add necessary points to form a triangle at minimum
        if fallback.len() == 1 {
            // If we have just one point, add two more to make a small triangle
            let pt = fallback[0];
            let epsilon = 0.01; // Small offset
            fallback.push(Vector2 { x: pt.x + epsilon, y: pt.y });
            fallback.push(Vector2 { x: pt.x, y: pt.y + epsilon });
        } else if fallback.len() == 2 {
            // If we have two points, add a third to make a triangle
            let p1 = fallback[0];
            let p2 = fallback[1];
            let mid_x = (p1.x + p2.x) / 2.0;
            let mid_y = (p1.y + p2.y) / 2.0;
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            // Create a point perpendicular to the line
            fallback.push(Vector2 { 
                x: mid_x - dy * 0.01, 
                y: mid_y + dx * 0.01 
            });
        }
        
        return fallback;
    }
    
    cleaned
}


// REVISED: Improved implementation of an extruded shape using the extrude_geometry function
fn create_extruded_shape(
    unique_shape_points: &[Vector2],
    height: f64,
    z_offset: f64
) -> BufferGeometry {
    // Basic validation
    if height < MIN_HEIGHT {
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        };
    }
    
    // Ensure we have enough points to form a valid polygon
    if unique_shape_points.len() < 3 {
        // For debugging purposes
        console_log!("Warning: Attempting to extrude a shape with fewer than 3 points: {}", unique_shape_points.len());
        
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
            return create_extruded_shape(&square_points, height, z_offset);
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
                    hasData: false,
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
            return create_extruded_shape(&rect_points, height, z_offset);
        }
        
        // If we somehow get here with no points, return empty geometry
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        };
    }
    
    let unique_points_count = unique_shape_points.len();
    // console_log!("Extruding polygon with {} points using extrude_geometry", unique_points_count);
    // console_log!("Extrusion height: {}", height);
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
    let shapes_js = match to_value(&shapes) {
        Ok(val) => val,
        Err(e) => {
            console_log!("Failed to convert shapes to JsValue: {:?}", e);
            return BufferGeometry {
                vertices: Vec::new(),
                normals: None,
                colors: None,
                indices: None,
                uvs: None,
                hasData: false,
            };
        }
    };
    
    let options_js = match to_value(&options) {
        Ok(val) => val,
        Err(e) => {
            console_log!("Failed to convert options to JsValue: {:?}", e);
            return BufferGeometry {
                vertices: Vec::new(),
                normals: None,
                colors: None,
                indices: None,
                uvs: None,
                hasData: false,
            };
        }
    };
    
    // Call the extrude_shape function with native Rust types
    let extruded_js = match extrude::extrude_shape(shapes, height, 1) {
        Ok(val) => val,
        Err(e) => {
            console_log!("Error during extrusion: {:?}", e);
            return BufferGeometry {
                vertices: Vec::new(),
                normals: None,
                colors: None,
                indices: None,
                uvs: None,
                hasData: false,
            };
        }
    };
    
    // Apply z_offset to the vertices
    if z_offset != 0.0 {
        // Get position array from extruded_js
        let position_js = js_sys::Reflect::get(&extruded_js, &JsValue::from_str("position")).unwrap_or(JsValue::null());
        if position_js.is_null() {
            console_log!("Failed to get position from extrusion result");
            return BufferGeometry {
                vertices: Vec::new(),
                normals: None,
                colors: None,
                indices: None,
                uvs: None,
                hasData: false,
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
    
    // Check if we have any vertices before constructing the result
    let has_data = !vertices.is_empty();
    
    // Create and return the BufferGeometry
    BufferGeometry {
        vertices,
        normals: if normals.is_empty() { None } else { Some(normals) },
        indices: if indices.is_empty() { None } else { Some(indices) },
        colors: None,
        uvs: if uvs.is_empty() { None } else { Some(uvs) },
        hasData: has_data,
    }
}

// Process the polygon geometry input and produce a buffer geometry output
pub fn create_polygon_geometry(input_json: &str) -> Result<String, String> {
    // console_log!("create_polygon_geometry raw input: {:?}", input_json);
    // Parse the input JSON
    let input: PolygonGeometryInput = match serde_json::from_str(input_json) {
        Ok(data) => data,
        Err(e) => return Err(format!("Failed to parse input JSON: {}", e)),
    };

    // Debug log full input and specific dataset config
    // console_log!("create_polygon_geometry input: {:?}", input);
    // console_log!("create_polygon_geometry vtDataSet config: {:?}", input.vtDataSet);
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
                &input.elevationGrid, &input.gridSize,
                &input.bbox, input.minElevation, input.maxElevation,
            );
            dataset_lowest_z = dataset_lowest_z.min(elev);
            dataset_highest_z = dataset_highest_z.max(elev);
        }
    }
    let dataset_range = dataset_highest_z - dataset_lowest_z + 0.1;
    let use_same_z_offset = input.useSameZOffset;

    console_log!("Processing polygon geometry with {} polygons", input.polygons.len());
    // Dataset terrain extremes for fallback and shared Z offset
    let dataset_lowest_z = input.minElevation;
    let dataset_highest_z = input.maxElevation;
    let dataset_range = dataset_highest_z - dataset_lowest_z + 0.1;
    let use_same_z_offset = input.useSameZOffset;
    
    if input.polygons.is_empty() {
        console_log!("No polygons to process");
        return Ok(serde_json::to_string(&BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        }).unwrap());
    }
    
    // Convert all polygons to Vector2 format
    let mut all_geometries: Vec<BufferGeometry> = Vec::new();
    
    for (i, polygon_data) in input.polygons.iter().enumerate() {
        if i % 1000 == 0 && i > 0 {
            console_log!("Processed {} out of {} polygons", i, input.polygons.len());
        }
        
        // Extract and validate polygon points
        let points: Vec<Vector2> = polygon_data.geometry.iter()
            .filter_map(|point| {
                if point.len() >= 2 {
                    Some(Vector2 { x: point[0], y: point[1] })
                } else {
                    None
                }
            })
            .collect();
        
        if points.len() < 3 {
            continue; // Skip invalid polygons
        }
        
        // Determine extrusion height: vtDataSet.extrusionDepth first, then feature height, else dataset range
        let dataset_range = dataset_highest_z - dataset_lowest_z + 0.1;
        let mut height = if let Some(d) = input.vtDataSet.extrusionDepth {
            d
        } else if let Some(h) = polygon_data.height.filter(|h| *h > 0.0) {
            h
        } else {
            dataset_range
        };
        // Enforce minimum extrusion depth
        if let Some(min_d) = input.vtDataSet.minExtrusionDepth {
            if height < min_d {
                height = min_d;
            }
        }
        // Clamp to reasonable bounds
        height = height.clamp(MIN_HEIGHT, MAX_HEIGHT);
        // Apply adaptive scale first, then heightScaleFactor
        if input.vtDataSet.useAdaptiveScaleFactor.unwrap_or(false) {
            height *= calculate_adaptive_scale_factor(
                input.bbox[0], input.bbox[1], input.bbox[2], input.bbox[3],
                input.minElevation, input.maxElevation,
            );
        }
        if let Some(factor) = input.vtDataSet.heightScaleFactor {
            height *= factor;
        }
        if height <= 0.0 {
            continue; // Skip flat geometry
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
            continue; // Skip invalid polygon after cleaning
        }

        // Determine if CSG clipping should be used
        let use_csg = input.csgClipping
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
            continue;
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
                continue;
            }
        } else {
            clipped_points
        };

        // Compute per-polygon terrain extremes for base alignment
        let mut lowest_terrain_z = f64::INFINITY;
        let mut highest_terrain_z = f64::NEG_INFINITY;
        for pt in &points {
            let tz = sample_terrain_elevation_at_point(
                pt.x, pt.y, &input.elevationGrid, &input.gridSize,
                &input.bbox, input.minElevation, input.maxElevation,
            );
            lowest_terrain_z = lowest_terrain_z.min(tz);
            highest_terrain_z = highest_terrain_z.max(tz);
        }
        // Optionally use dataset-wide extremes
        if use_same_z_offset {
            lowest_terrain_z = dataset_lowest_z;
            highest_terrain_z = dataset_highest_z;
        }
        // Base z offset: position bottom face at terrain surface minus submerge
        let z_offset = lowest_terrain_z + input.vtDataSet.zOffset.unwrap_or(0.0) - BUILDING_SUBMERGE_OFFSET;
        // Create extruded shape with base aligned to terrain
        let mut geometry = create_extruded_shape(&final_points, height, z_offset);
        
        if geometry.hasData {
            all_geometries.push(geometry);
        }
    }
    
    console_log!("Created {} valid 3D geometries", all_geometries.len());
    
    // Merge all geometries into one if we have any
    if all_geometries.is_empty() {
        console_log!("No valid geometries were created");
        return Ok(serde_json::to_string(&BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        }).unwrap());
    }
    
    // If there's just one geometry, return it directly
    if all_geometries.len() == 1 {
        let result = all_geometries.remove(0);
        console_log!("Returning a single geometry with {} vertices", result.vertices.len() / 3);
        return Ok(serde_json::to_string(&result).unwrap());
    }
    
    // Merge multiple geometries
    let mut merged_vertices: Vec<f32> = Vec::new();
    let mut merged_normals: Vec<f32> = Vec::new();
    let mut merged_indices: Vec<u32> = Vec::new();
    
    let mut vertex_offset: u32 = 0;
    
    for geometry in all_geometries {
        // Add vertices
        merged_vertices.extend_from_slice(&geometry.vertices);
        
        // Add normals if present
        if let Some(normals) = &geometry.normals {
            merged_normals.extend_from_slice(normals);
        }
        
        // Add indices with offset if present
        if let Some(indices) = &geometry.indices {
            for &index in indices {
                merged_indices.push(index + vertex_offset);
            }
        }
        
        // Update vertex offset for next geometry
        vertex_offset += (geometry.vertices.len() / 3) as u32;
    }
    
    // Create the merged buffer geometry
    let merged_geometry = BufferGeometry {
        vertices: merged_vertices,
        normals: if merged_normals.is_empty() { None } else { Some(merged_normals) },
        indices: if merged_indices.is_empty() { None } else { Some(merged_indices) },
        colors: None,
        uvs: None,
        hasData: true,
    };
    
    console_log!("Returning merged geometry with {} vertices", merged_geometry.vertices.len() / 3);
    
    // Serialize the output to JSON
    match serde_json::to_string(&merged_geometry) {
        Ok(json) => Ok(json),
        Err(e) => Err(format!("Failed to serialize output: {}", e)),
    }
}
