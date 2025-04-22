use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use js_sys::{Array, Float32Array, Object};
use web_sys::console;
use std::collections::HashMap;
use crate::console_log;
use crate::module_state::ModuleState;

// Constants ported from TypeScript
const BUILDING_SUBMERGE_OFFSET: f64 = 0.01;
const MIN_HEIGHT: f64 = 0.5;
const MAX_HEIGHT: f64 = 500.0;
const TERRAIN_SIZE: f64 = 200.0;

// Struct to represent a 2D point
#[derive(Debug, Clone, Copy)]
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
    pub sourceLayer: String,
    pub color: String,
    pub extrusionDepth: Option<f64>,
    pub minExtrusionDepth: Option<f64>,
    pub heightScaleFactor: Option<f64>,
    pub useAdaptiveScaleFactor: Option<bool>,
    pub zOffset: Option<f64>,
    pub alignVerticesToTerrain: Option<bool>,
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

// Simplistic implementation of an extruded shape
fn create_extruded_shape(shape_points: &[Vector2], height: f64, z_offset: f64) -> BufferGeometry {
    let point_count = shape_points.len();
    if point_count < 3 {
        // Need at least 3 points for a valid shape
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        };
    }
    
    // Triangulate the top face (simple fan triangulation - works for convex shapes)
    let mut vertices = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    
    // Add bottom face vertices
    for i in 0..point_count {
        let p = shape_points[i];
        vertices.push(p.x as f32);
        vertices.push(p.y as f32);
        vertices.push(z_offset as f32);
    }
    
    // Add top face vertices
    for i in 0..point_count {
        let p = shape_points[i];
        vertices.push(p.x as f32);
        vertices.push(p.y as f32);
        vertices.push((z_offset + height) as f32);
    }
    
    // Create triangles for top and bottom faces using triangle fan
    for i in 1..(point_count - 1) {
        // Bottom face (need to reverse winding order)
        indices.push(0);
        indices.push(i as u32 + 1);
        indices.push(i as u32);
        
        // Top face
        indices.push(point_count as u32);
        indices.push(point_count as u32 + i as u32);
        indices.push(point_count as u32 + i as u32 + 1);
    }
    
    // Create side quads
    for i in 0..point_count {
        let next = (i + 1) % point_count;
        
        // First triangle of the quad
        indices.push(i as u32);
        indices.push(i as u32 + point_count as u32);
        indices.push(next as u32);
        
        // Second triangle of the quad
        indices.push(next as u32);
        indices.push(i as u32 + point_count as u32);
        indices.push(next as u32 + point_count as u32);
    }
    
    // Generate normals
    let normals = compute_vertex_normals(&vertices, Some(&indices));
    
    BufferGeometry {
        vertices,
        indices: Some(indices),
        normals: Some(normals),
        colors: None,  // Will be added later
        uvs: None,     // Not used
        hasData: true,
    }
}

// The main function for creating polygon geometry
#[wasm_bindgen]
pub fn create_polygon_geometry(input_json: &str) -> Result<JsValue, JsValue> {
    console_log!("Starting create_polygon_geometry in Rust");
    
    // Parse the input JSON
    let input: PolygonGeometryInput = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;
    
    let min_lng = input.bbox[0];
    let min_lat = input.bbox[1];
    let max_lng = input.bbox[2];
    let max_lat = input.bbox[3];
    
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
    
    // Create a clipping box for all geometries
    let mut clip_box = Box3::new();
    clip_box.set_from_center_and_size(
        Vector3 { x: 0.0, y: 0.0, z: -10.0 },
        Vector3 { x: TERRAIN_SIZE, y: TERRAIN_SIZE, z: TERRAIN_SIZE * 5.0 }
    );
    
    // Create a clipping box for all geometries
    let mut clip_box = Box3::new();
    clip_box.set_from_center_and_size(
        Vector3 { x: 0.0, y: 0.0, z: -10.0 },
        Vector3 { x: TERRAIN_SIZE, y: TERRAIN_SIZE, z: TERRAIN_SIZE * 5.0 }
    );
    
    // Calculate a dataset-wide terrain elevation offset by sampling multiple points
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
    
    // Process each polygon
    let mut buffer_geometries: Vec<BufferGeometry> = Vec::new();
    
    for (poly_index, poly) in polygons.iter().enumerate() {
        // Get or calculate height
        let mut height = input.vtDataSet.extrusionDepth
            .or(poly.height)
            .unwrap_or(dataset_highest_z - dataset_lowest_z + 0.1);
        
        // Apply minimum extrusion depth if specified
        if let Some(min_extrusion_depth) = input.vtDataSet.minExtrusionDepth {
            if height < min_extrusion_depth {
                height = min_extrusion_depth;
            }
        }
        
        let footprint = &poly.geometry;
        
        if footprint.len() < 3 {
            continue;
        }
        
        // Convert footprint to Vector2 points and ensure clockwise orientation
        let mut path2d: Vec<Vector2> = footprint
            .iter()
            .map(|point| Vector2 { x: point[0], y: point[1] })
            .collect();
        
        if !is_clockwise(&path2d) {
            path2d.reverse();
        }
        
        // Calculate terrain elevation for this specific polygon
        let mut lowest_terrain_z = f64::INFINITY;
        let mut highest_terrain_z = f64::NEG_INFINITY;
        let mut mesh_coords: Vec<[f64; 2]> = Vec::new();
        
        for vec2 in &path2d {
            let lng = vec2.x;
            let lat = vec2.y;
            let terrain_z = sample_terrain_elevation_at_point(
                lng,
                lat,
                &input.elevationGrid,
                &input.gridSize,
                &input.bbox,
                input.minElevation,
                input.maxElevation
            );
            lowest_terrain_z = lowest_terrain_z.min(terrain_z);
            highest_terrain_z = highest_terrain_z.max(terrain_z);
            mesh_coords.push(transform_to_mesh_coordinates(lng, lat, &input.bbox));
        }
        
        // Use dataset-wide elevation if requested
        if input.useSameZOffset {
            lowest_terrain_z = dataset_lowest_z;
            highest_terrain_z = dataset_highest_z;
        }
        
        // Validate and adjust height
        let mut validated_height = height.min(MAX_HEIGHT).max(MIN_HEIGHT);
        
        // Apply adaptive scale factor if needed
        if input.vtDataSet.useAdaptiveScaleFactor.unwrap_or(false) {
            let adaptive_scale_factor = calculate_adaptive_scale_factor(
                min_lng,
                min_lat,
                max_lng,
                max_lat,
                input.minElevation,
                input.maxElevation
            );
            validated_height *= adaptive_scale_factor;
        }
        
        // Apply height scale factor if provided
        if let Some(height_scale_factor) = input.vtDataSet.heightScaleFactor {
            validated_height *= height_scale_factor;
        }
        
        // Calculate z-offset (bottom) position
        let z_offset = lowest_terrain_z + 
            input.vtDataSet.zOffset.unwrap_or(0.0) - 
            BUILDING_SUBMERGE_OFFSET;
        
        // Convert mesh_coords to Vector2 for geometry creation
        let shape_points: Vec<Vector2> = mesh_coords
            .iter()
            .map(|coord| Vector2 { x: coord[0], y: coord[1] })
            .collect();
        
        // Create the extruded geometry
        let mut geometry = create_extruded_shape(&shape_points, validated_height, z_offset);
        
        // Add color attribute
        let color = parse_color(&input.vtDataSet.color);
        let mut colors = Vec::new();
        
        for _ in 0..(geometry.vertices.len() / 3) {
            colors.push(color.r);
            colors.push(color.g);
            colors.push(color.b);
        }
        
        geometry.colors = Some(colors);
        
        // Skip empty geometries
        if geometry.vertices.len() > 0 {
            buffer_geometries.push(geometry);
        }
    }
    
    console_log!("Merging {} buffer geometries", buffer_geometries.len());
    
    // If we have no geometries, return an empty one
    if buffer_geometries.is_empty() {
        let empty_geometry = BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            hasData: false,
        };
        return Ok(serde_wasm_bindgen::to_value(&empty_geometry)?);
    }
    
    // If we have only one geometry, return it directly
    if buffer_geometries.len() == 1 {
        return Ok(serde_wasm_bindgen::to_value(&buffer_geometries[0])?);
    }
    
    // Merge all geometries
    let mut merged_vertices = Vec::new();
    let mut merged_normals = Vec::new();
    let mut merged_colors = Vec::new();
    let mut merged_indices = Vec::new();
    let mut vertex_offset = 0;
    
    for geometry in buffer_geometries {
        // Add vertices
        merged_vertices.extend_from_slice(&geometry.vertices);
        
        // Add normals if present
        if let Some(normals) = geometry.normals {
            merged_normals.extend_from_slice(&normals);
        }
        
        // Add colors if present
        if let Some(colors) = geometry.colors {
            merged_colors.extend_from_slice(&colors);
        }
        
        // Add indices with offset
        if let Some(indices) = geometry.indices {
            let offset_indices: Vec<u32> = indices.iter()
                .map(|&idx| idx + vertex_offset)
                .collect();
            merged_indices.extend_from_slice(&offset_indices);
        }
        
        // Update vertex offset for next geometry
        vertex_offset += (geometry.vertices.len() / 3) as u32;
    }
    
    // Create the final merged geometry
    let merged_geometry = BufferGeometry {
        vertices: merged_vertices,
        normals: if !merged_normals.is_empty() { Some(merged_normals) } else { None },
        colors: if !merged_colors.is_empty() { Some(merged_colors) } else { None },
        indices: if !merged_indices.is_empty() { Some(merged_indices) } else { None },
        uvs: None,
        hasData: true,
    };
    
    console_log!(
        "Merged geometry created with {} vertices",
        merged_geometry.vertices.len() / 3
    );
    
    Ok(serde_wasm_bindgen::to_value(&merged_geometry)?)
}
