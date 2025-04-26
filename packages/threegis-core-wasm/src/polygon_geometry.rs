use serde::{Serialize, Deserialize};
use csgrs::csg::CSG;
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
    
    // Handle empty result
    if clipped_csg.polygons.is_empty() {
        console_log!("CSG intersection resulted in empty geometry");
        return Vec::new();
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
    
    // Clean up the clipped points
    clean_polygon_footprint(&clipped)
}

// Improved simple triangulation fallback when earcutr fails
fn simple_triangulate_polygon(points: &[Vector2]) -> Vec<u32> {
    if points.len() < 3 {
        return Vec::new();
    }
    
    // Simple fan triangulation from the first point
    let mut indices = Vec::with_capacity((points.len() - 2) * 3);
    
    for i in 1..(points.len() - 1) {
        indices.push(0);           // Center point
        indices.push(i as u32);    // Current point
        indices.push((i + 1) as u32); // Next point
    }
    
    indices
}

// REVISED: Improved implementation of an extruded shape with robust triangulation
fn create_extruded_shape(
    unique_shape_points: &[Vector2],
    height: f64,
    z_offset: f64
) -> BufferGeometry {
    // Basic validation
    if height < MIN_HEIGHT || unique_shape_points.len() < 3 {
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
    
    // Preprocess points for triangulation - scale to avoid precision issues
    // This helps earcutr handle coordinates with very small differences
    let mut min_x = std::f64::MAX;
    let mut min_y = std::f64::MAX;
    let mut max_x = std::f64::MIN;
    let mut max_y = std::f64::MIN;
    
    // Find the bounding box
    for point in unique_shape_points {
        min_x = min_x.min(point.x);
        min_y = min_y.min(point.y);
        max_x = max_x.max(point.x);
        max_y = max_y.max(point.y);
    }
    
    let width = max_x - min_x;
    let height_bbox = max_y - min_y;
    
    // Prepare scaled coordinates for triangulation
    let mut flat_coords: Vec<f64> = Vec::with_capacity(unique_points_count * 2);
    for point in unique_shape_points {
        // Normalize to 0-1 range then scale to 0-1000 for better precision
        if width > EPSILON && height_bbox > EPSILON {
            let scaled_x = ((point.x - min_x) / width) * 1000.0;
            let scaled_y = ((point.y - min_y) / height_bbox) * 1000.0;
            flat_coords.push(scaled_x);
            flat_coords.push(scaled_y);
        } else {
            // If the polygon is too small or flat, use original coordinates
            flat_coords.push(point.x);
            flat_coords.push(point.y);
        }
    }
    
    let ring_starts = vec![0];
    
    // Attempt earcut triangulation with fallback
    let indices_2d = match earcutr::earcut(&flat_coords, &ring_starts, 2) {
        Ok(indices) => {
            if indices.is_empty() {
                // If earcutr returns empty indices, use fallback
                console_log!("Earcutr returned empty indices, using simple triangulation");
                simple_triangulate_polygon(unique_shape_points)
            } else {
                // Convert from usize to u32
                indices.into_iter().map(|i| i as u32).collect()
            }
        },
        Err(err) => {
            // If earcutr fails with an error, use fallback
            console_log!("Earcutr failed with error: {:?}, using simple triangulation", err);
            
            // Let's check what might be wrong with the input data
            if flat_coords.is_empty() {
                console_log!("Flat coordinates array is empty");
            } else if flat_coords.len() % 2 != 0 {
                console_log!("Flat coordinates array has odd length: {}", flat_coords.len());
            } else if flat_coords.len() < 6 { // Need at least 3 points (6 coordinates) for a triangle
                console_log!("Not enough points for triangulation: {} points", flat_coords.len() / 2);
            } else {
                // Check for any NaN or infinite values
                let has_invalid = flat_coords.iter().any(|&val| val.is_nan() || val.is_infinite());
                if has_invalid {
                    console_log!("Flat coordinates contain NaN or infinite values");
                }
                
                // Check for duplicate points
                let mut has_duplicates = false;
                for i in 0..(flat_coords.len() / 2 - 1) {
                    let ix = i * 2;
                    let iy = ix + 1;
                    for j in (i + 1)..(flat_coords.len() / 2) {
                        let jx = j * 2;
                        let jy = jx + 1;
                        if (flat_coords[ix] - flat_coords[jx]).abs() < EPSILON && 
                           (flat_coords[iy] - flat_coords[jy]).abs() < EPSILON {
                            console_log!("Found duplicate points at indices {} and {}", i, j);
                            has_duplicates = true;
                            break;
                        }
                    }
                    if has_duplicates {
                        break;
                    }
                }
            }
            
            simple_triangulate_polygon(unique_shape_points)
        }
    };
    
    if indices_2d.is_empty() {
        console_log!("Both earcutr and fallback triangulation failed");
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        };
    }
    
    // Generate 3D vertices
    let mut vertices: Vec<f32> = Vec::with_capacity(unique_points_count * 2 * 3);
    
    // Add bottom face vertices
    for point in unique_shape_points {
        vertices.push(point.x as f32);
        vertices.push(point.y as f32);
        vertices.push(z_offset as f32);
    }
    
    // Add top face vertices
    for point in unique_shape_points {
        vertices.push(point.x as f32);
        vertices.push(point.y as f32);
        vertices.push((z_offset + height) as f32);
    }
    
    // Generate 3D indices
    let top_vertex_offset = unique_points_count as u32;
    let mut indices = Vec::with_capacity(indices_2d.len() * 2 + unique_points_count * 6);
    
    // Bottom face (flip winding)
    for i in (0..indices_2d.len()).step_by(3) {
        indices.push(indices_2d[i]);
        indices.push(indices_2d[i+2]);
        indices.push(indices_2d[i+1]);
    }
    
    // Top face
    for i in (0..indices_2d.len()).step_by(3) {
        indices.push(indices_2d[i] + top_vertex_offset);
        indices.push(indices_2d[i+1] + top_vertex_offset);
        indices.push(indices_2d[i+2] + top_vertex_offset);
    }
    
    // Side walls
    for i in 0..unique_points_count {
        let next = (i + 1) % unique_points_count;
        
        let bottom_current = i as u32;
        let bottom_next = next as u32;
        let top_current = bottom_current + top_vertex_offset;
        let top_next = bottom_next + top_vertex_offset;
        
        // First triangle
        indices.push(bottom_current);
        indices.push(bottom_next);
        indices.push(top_next);
        
        // Second triangle
        indices.push(bottom_current);
        indices.push(top_next);
        indices.push(top_current);
    }
    
    // Generate normals
    let normals = compute_vertex_normals(&vertices, Some(&indices));
    
    BufferGeometry {
        vertices,
        indices: Some(indices),
        normals: Some(normals),
        colors: None,
        uvs: None,
        hasData: true,
    }
}

// Process the polygon geometry input and produce a buffer geometry output
pub fn create_polygon_geometry(input_json: &str) -> Result<String, String> {
    // Parse the input JSON
    let input: PolygonGeometryInput = match serde_json::from_str(input_json) {
        Ok(data) => data,
        Err(e) => return Err(format!("Failed to parse input JSON: {}", e)),
    };
    
    console_log!("Processing polygon geometry with {} polygons", input.polygons.len());
    
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
        
        // Get height for extrusion
        let height = polygon_data.height.unwrap_or(10.0);
        if height <= 0.0 {
            continue; // Skip flat polygons
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
        
        // Create 3D extruded shape
        let z_offset = input.vtDataSet.zOffset.unwrap_or(0.0);
        let geometry = create_extruded_shape(&cleaned_points, height, z_offset);
        
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
