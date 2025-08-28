use flate2::read::GzDecoder;
use geozero::mvt::tile::Value;
use geozero::mvt::{Message, Tile};
use js_sys::{Date, Uint8Array};
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::{from_value, to_value};
use std::collections::HashMap;
use std::io::Read;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::module_state::{ModuleState, TileData};
use crate::polygon_geometry::VtDataSet;
use crate::{console_log, fetch, cache_keys};

// Reuse the TileRequest struct from elevation.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TileRequest {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

// Input for vectortile processing
#[derive(Serialize, Deserialize, Clone)]
pub struct VectortileProcessingInput {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64,
    pub max_lat: f64,
    pub zoom: u32,
    pub grid_width: u32,
    pub grid_height: u32,
    // Bbox key for consistent caching across the application
    pub bbox_key: Option<String>,
}

// Result structure compatible with JS expectations
#[derive(Serialize, Deserialize)]
pub struct VectorTileResult {
    pub tile: TileRequest,
    pub data: Vec<u8>, // Vector tile binary data
}

// Structure for the GeometryData that we extract from vector tiles
#[derive(Serialize, Deserialize, Clone)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>, // Represents a geometry's coordinates
    pub r#type: Option<String>,  // Geometry type (e.g., "Polygon", "LineString")
    pub height: Option<f64>,     // Feature height
    pub layer: Option<String>,   // Source layer name
    pub tags: Option<serde_json::Value>, // Tags/attributes from the tile
    pub properties: Option<serde_json::Value>, // Feature properties from MVT
}

// Input for extracting features from vector tiles
#[derive(Serialize, Deserialize)]
pub struct ExtractFeaturesInput {
    pub bbox: Vec<f64>,                   // [minLng, minLat, maxLng, maxLat]
    pub vt_data_set: VtDataSet,             // Configuration for the layer
    pub bbox_key: String,                  // Cache key for vector tiles
    pub elevation_bbox_key: Option<String>, // ID to find cached elevation data
}

// Feature geometry types
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub enum GeometryType {
    Point,
    LineString,
    Polygon,
    MultiPoint,
    MultiLineString,
    MultiPolygon,
}

// GeoJSON-like feature structure
#[derive(Serialize, Deserialize, Clone)]
pub struct Feature {
    pub geometry: FeatureGeometry,
    pub properties: serde_json::Value,
}

// Geometry part of a feature
#[derive(Serialize, Deserialize, Clone)]
pub struct FeatureGeometry {
    pub r#type: String,
    pub coordinates: serde_json::Value, // Using Value for flexibility with different geometry types
}

// Convert latitude to tile Y coordinate
fn lat_to_tile_y(lat: f64, zoom: u32) -> u32 {
    let lat_rad = lat.to_radians();
    let n = 2.0_f64.powi(zoom as i32);
    let y = ((1.0 - ((lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / std::f64::consts::PI)) / 2.0 * n)
        .floor();
    y as u32
}

// Convert longitude to tile X coordinate
fn lng_to_tile_x(lng: f64, zoom: u32) -> u32 {
    let n = 2.0_f64.powi(zoom as i32);
    let x = ((lng + 180.0) / 360.0 * n).floor();
    x as u32
}

// Calculate the tiles needed to cover a bounding box
fn get_tiles_for_bbox(
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
    zoom: u32,
) -> Vec<TileRequest> {
    // Convert bbox to tile coordinates
    let min_x = lng_to_tile_x(min_lng, zoom);
    let min_y = lat_to_tile_y(max_lat, zoom); // Note: y is inverted in tile coordinates
    let max_x = lng_to_tile_x(max_lng, zoom);
    let max_y = lat_to_tile_y(min_lat, zoom);

    // Generate list of tiles
    let mut tiles = Vec::new();
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            tiles.push(TileRequest { x, y, z: zoom });
        }
    }

    tiles
}

// Calculate the number of tiles that would be needed
#[allow(dead_code)]
pub fn calculate_tile_count(
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
    zoom: u32,
) -> usize {
    let min_x = lng_to_tile_x(min_lng, zoom);
    let min_y = lat_to_tile_y(max_lat, zoom);
    let max_x = lng_to_tile_x(max_lng, zoom);
    let max_y = lat_to_tile_y(min_lat, zoom);

    ((max_x - min_x + 1) * (max_y - min_y + 1)) as usize
}

// Calculate base elevation for a geometry based on its position relative to elevation grid
fn calculate_base_elevation(
    coordinates: &[Vec<f64>],
    elevation_grid: &[Vec<f64>],
    grid_width: usize,
    grid_height: usize,
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
) -> f64 {
    // Calculate centroid of the coordinates
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let point_count = coordinates.len();

    if point_count == 0 {
        return 0.0;
    }

    for point in coordinates {
        if point.len() >= 2 {
            sum_x += point[0];
            sum_y += point[1];
        }
    }

    let centroid_lng = sum_x / point_count as f64;
    let centroid_lat = sum_y / point_count as f64;

    // Map centroid to grid coordinates
    let grid_x = ((centroid_lng - min_lng) / (max_lng - min_lng).max(f64::EPSILON))
        * (grid_width as f64 - 1.0);
    let grid_y = ((centroid_lat - min_lat) / (max_lat - min_lat).max(f64::EPSILON))
        * (grid_height as f64 - 1.0);

    let grid_x_floor = grid_x.floor() as usize;
    let grid_y_floor = grid_y.floor() as usize;

    // Ensure we're within bounds
    if grid_x_floor < grid_width && grid_y_floor < grid_height {
        elevation_grid[grid_y_floor][grid_x_floor]
    } else {
        // If we're out of bounds, use the nearest valid grid point
        let nearest_x = grid_x_floor.min(grid_width - 1);
        let nearest_y = grid_y_floor.min(grid_height - 1);
        elevation_grid[nearest_y][nearest_x]
    }
}

// Evaluate if a feature matches a filter expression
fn evaluate_filter(filter: &serde_json::Value, feature: &Feature) -> bool {
    
    // If no filter, always pass
    if filter.is_null() {
        return true;
    }
    
    // Filters should be arrays where the first element is the operator
    let filter_array = match filter.as_array() {
        Some(arr) if !arr.is_empty() => arr,
        _ => return true, // Invalid filter format, default to pass
    };
    
    let operator = match filter_array[0].as_str() {
        Some(op) => op,
        None => return true, // Invalid operator, default to pass
    };
    
    match operator {
        // Logical operators
        "all" => {
            // All conditions must be true
            for i in 1..filter_array.len() {
                if !evaluate_filter(&filter_array[i], feature) {
                    return false;
                }
            }
            true
        }
        "any" => {
            // At least one condition must be true
            for i in 1..filter_array.len() {
                if evaluate_filter(&filter_array[i], feature) {
                    return true;
                }
            }
            false
        }
        "none" => {
            // None of the conditions should be true
            for i in 1..filter_array.len() {
                if evaluate_filter(&filter_array[i], feature) {
                    return false;
                }
            }
            true
        }
        
        // Equality operators
        "==" => {
            if filter_array.len() < 3 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            let expected_value = &filter_array[2];
            
            if key == "$type" {
                // Compare geometry type
                let geometry_type = match feature.geometry.r#type.as_str() {
                    "Point" => "Point",
                    "LineString" => "LineString", 
                    "Polygon" => "Polygon",
                    "MultiPoint" => "MultiPoint",
                    "MultiLineString" => "MultiLineString",
                    "MultiPolygon" => "MultiPolygon",
                    _ => "Unknown",
                };
                expected_value.as_str().map_or(false, |v| v == geometry_type)
            } else {
                // Compare property value
                match feature.properties.as_object().and_then(|obj| obj.get(key)) {
                    Some(actual_value) => actual_value == expected_value,
                    None => expected_value.is_null(),
                }
            }
        }
        "!=" => {
            if filter_array.len() < 3 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            let expected_value = &filter_array[2];
            
            if key == "$type" {
                // Compare geometry type
                let geometry_type = match feature.geometry.r#type.as_str() {
                    "Point" => "Point",
                    "LineString" => "LineString",
                    "Polygon" => "Polygon", 
                    "MultiPoint" => "MultiPoint",
                    "MultiLineString" => "MultiLineString",
                    "MultiPolygon" => "MultiPolygon",
                    _ => "Unknown",
                };
                expected_value.as_str().map_or(true, |v| v != geometry_type)
            } else {
                // Compare property value
                match feature.properties.as_object().and_then(|obj| obj.get(key)) {
                    Some(actual_value) => actual_value != expected_value,
                    None => !expected_value.is_null(),
                }
            }
        }
        
        // Membership operators
        "in" => {
            if filter_array.len() < 3 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            
            if key == "$type" {
                // Check if geometry type is in the list
                let geometry_type = match feature.geometry.r#type.as_str() {
                    "Point" => "Point",
                    "LineString" => "LineString",
                    "Polygon" => "Polygon",
                    "MultiPoint" => "MultiPoint", 
                    "MultiLineString" => "MultiLineString",
                    "MultiPolygon" => "MultiPolygon",
                    _ => "Unknown",
                };
                for i in 2..filter_array.len() {
                    if filter_array[i].as_str().map_or(false, |v| v == geometry_type) {
                        return true;
                    }
                }
                false
            } else {
                // Check if property value is in the list
                match feature.properties.as_object().and_then(|obj| obj.get(key)) {
                    Some(actual_value) => {
                        for i in 2..filter_array.len() {
                            if &filter_array[i] == actual_value {
                                return true;
                            }
                        }
                        false
                    }
                    None => {
                        // Check if null is in the list
                        for i in 2..filter_array.len() {
                            if filter_array[i].is_null() {
                                return true;
                            }
                        }
                        false
                    }
                }
            }
        }
        "!in" => {
            if filter_array.len() < 3 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            
            if key == "$type" {
                // Check if geometry type is NOT in the list
                let geometry_type = match feature.geometry.r#type.as_str() {
                    "Point" => "Point",
                    "LineString" => "LineString",
                    "Polygon" => "Polygon",
                    "MultiPoint" => "MultiPoint",
                    "MultiLineString" => "MultiLineString", 
                    "MultiPolygon" => "MultiPolygon",
                    _ => "Unknown",
                };
                for i in 2..filter_array.len() {
                    if filter_array[i].as_str().map_or(false, |v| v == geometry_type) {
                        return false;
                    }
                }
                true
            } else {
                // Check if property value is NOT in the list
                match feature.properties.as_object().and_then(|obj| obj.get(key)) {
                    Some(actual_value) => {
                        for i in 2..filter_array.len() {
                            if &filter_array[i] == actual_value {
                                return false;
                            }
                        }
                        true
                    }
                    None => {
                        // Check if null is NOT in the list
                        for i in 2..filter_array.len() {
                            if filter_array[i].is_null() {
                                return false;
                            }
                        }
                        true
                    }
                }
            }
        }
        
        // Existence operators
        "has" => {
            if filter_array.len() < 2 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            
            if key == "$type" {
                true // Geometry type always exists
            } else if key == "$id" {
                // Check if feature has an id
                true // For now, assume features always have some form of id
            } else {
                // Check if property exists
                feature.properties.as_object().map_or(false, |obj| obj.contains_key(key))
            }
        }
        "!has" => {
            if filter_array.len() < 2 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            
            if key == "$type" {
                false // Geometry type always exists
            } else if key == "$id" {
                false // For now, assume features always have some form of id
            } else {
                // Check if property does NOT exist
                feature.properties.as_object().map_or(true, |obj| !obj.contains_key(key))
            }
        }
        
        // Comparison operators
        "<" | ">" | "<=" | ">=" => {
            if filter_array.len() < 3 {
                return true; // Invalid format
            }
            let key = match filter_array[1].as_str() {
                Some(k) => k,
                None => return true,
            };
            let expected_value = &filter_array[2];
            
            // Only compare properties (not $type or $id for ordering)
            if key.starts_with('$') {
                return true; // Skip comparison for special keys
            }
            
            match feature.properties.as_object().and_then(|obj| obj.get(key)) {
                Some(actual_value) => {
                    // Try to compare as numbers first, then as strings
                    if let (Some(actual_num), Some(expected_num)) = 
                        (actual_value.as_f64(), expected_value.as_f64()) {
                        match operator {
                            "<" => actual_num < expected_num,
                            ">" => actual_num > expected_num,
                            "<=" => actual_num <= expected_num,
                            ">=" => actual_num >= expected_num,
                            _ => true,
                        }
                    } else if let (Some(actual_str), Some(expected_str)) = 
                        (actual_value.as_str(), expected_value.as_str()) {
                        match operator {
                            "<" => actual_str < expected_str,
                            ">" => actual_str > expected_str,
                            "<=" => actual_str <= expected_str,
                            ">=" => actual_str >= expected_str,
                            _ => true,
                        }
                    } else {
                        true // Can't compare different types
                    }
                }
                None => false, // Property doesn't exist
            }
        }
        
        // Default case for unsupported operators
        _ => {
            // Silently pass unsupported operators (could log in debug mode)
            true // Default to pass for unsupported operators
        }
    }
}

// Convert tile-local coordinates to longitude/latitude
fn convert_tile_coords_to_lnglat(
    px: f64,
    py: f64,
    extent: u32,
    tile_x: u32,
    tile_y: u32,
    tile_z: u32,
) -> (f64, f64) {
    let n = 2.0_f64.powi(tile_z as i32);
    let lon_deg = (tile_x as f64 + px / extent as f64) / n * 360.0 - 180.0;
    // Corrected latitude calculation using atan(sinh(pi - 2*pi*y)) formula
    let lat_rad = std::f64::consts::PI * (1.0 - 2.0 * (tile_y as f64 + py / extent as f64) / n);
    let lat_deg = lat_rad.sinh().atan().to_degrees();
    (lon_deg, lat_deg)
}

// Main function to extract features from vector tiles
#[wasm_bindgen]
pub async fn extract_features_from_vector_tiles(input_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse input
    let input: ExtractFeaturesInput = from_value(input_js)?;
    let bbox = &input.bbox;

    if bbox.len() != 4 {
        return Err(JsValue::from_str(
            "Invalid bbox: must contain [minLng, minLat, maxLng, maxLat]",
        ));
    }

    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];
    let vt_dataset = &input.vt_data_set;

    // Log VtDataSet to check if filter is arriving

    // Compute consistent bbox_key using central function
    let bbox_key = cache_keys::make_bbox_key(min_lng, min_lat, max_lng, max_lat);

    // Log if input.bbox_key was in a non-standard format
    if input.bbox_key != bbox_key {
        console_log!(
            "Converting non-standard key to standard bbox_key format: {} -> {}",
            input.bbox_key,
            bbox_key
        );
    }

    console_log!(
        "Starting feature extraction for layer '{}' using cache key: {}",
        vt_dataset.source_layer,
        bbox_key
    );

    // Retrieve module state (mutable for parsed tile cache)
    let module_state_mutex = ModuleState::get_instance();
    let mut module_state = module_state_mutex.lock().unwrap();

    // Try to access cached vector tile data using the provided bbox_key
    let vector_tiles_data = match module_state.get_vector_tiles(&bbox_key) {
        Some(tiles) => tiles,
        None => {
            console_log!(
                "❌ ERROR: No cached vector tiles found for key: {}. Cannot extract features.",
                bbox_key
            );
            // Return empty array instead of error, as fetching might happen separately
            return Ok(to_value(&Vec::<GeometryData>::new())?);
        }
    };

    // Get cached elevation data if available
    // Use the specific elevation_bbox_key provided in the input
    let elevation_data = match &input.elevation_bbox_key {
        Some(key) => {
            
            module_state.get_elevation_data(key)
        }
        None => {
            console_log!(
                "No elevation_bbox_key provided, using default bbox_key for elevation lookup: {}",
                bbox_key
            );
            module_state.get_elevation_data(&bbox_key) // Fallback to main bbox_key if specific one not given
        }
    };

    let (elevation_grid, grid_size, elev_min_lng, elev_min_lat, elev_max_lng, elev_max_lat) =
        match elevation_data {
            Some(elev_data) => {
                console_log!(
                    "✅ Found cached elevation data. Grid: {}x{}",
                    elev_data.grid_width,
                    elev_data.grid_height
                );
                // Assuming elevation data also stores its bounding box - needed for calculate_base_elevation
                // If not, we need to pass the original bbox from input. Let's assume we use original bbox for now.
                (
                    elev_data.elevation_grid,
                    (elev_data.grid_width, elev_data.grid_height),
                    min_lng,
                    min_lat,
                    max_lng,
                    max_lat,
                )
            }
            None => {
                console_log!(
                    "⚠️ No cached elevation data found for relevant key. Using flat elevation (0)."
                );
                // Create a small dummy grid if no elevation data available
                let dummy_grid = vec![vec![0.0; 2]; 2];
                (dummy_grid, (2, 2), min_lng, min_lat, max_lng, max_lat) // Use input bbox for dummy grid
            }
        };

    // Initialize result vector
    let mut geometry_data_list: Vec<GeometryData> = Vec::new();
    let mut feature_count = 0;

    // Process each vector tile found in the cache for the bbox_key
    // To avoid E0502, collect parsed tiles to cache after iteration
    let mut parsed_tiles_to_cache: Vec<(String, ParsedMvtTile)> = Vec::new();
    for vt_tile_data in vector_tiles_data {
        let tile_x = vt_tile_data.x;
        let tile_y = vt_tile_data.y;
        let tile_z = vt_tile_data.z;

        console_log!(
            "Processing tile data for {}/{}/{}...",
            tile_z,
            tile_x,
            tile_y
        );

        // The raw MVT data should be stored in rust_parsed_mvt or buffer
        let raw_mvt_data = match vt_tile_data.rust_parsed_mvt {
            Some(ref data) => data,
            None => {
                
                &vt_tile_data.buffer // Fallback to buffer if rust_parsed_mvt is missing
            }
        };

        if raw_mvt_data.is_empty() {
            console_log!(
                "  Skipping tile {}/{}/{} due to empty raw data.",
                tile_z,
                tile_x,
                tile_y
            );
            continue;
        }

        // Use cached parsed MVT tile if available, otherwise parse and cache it
        let cache_key = format!("{}/{}/{}", tile_z, tile_x, tile_y);
        let parsed_tile = if let Some(cached) = module_state.get_parsed_mvt_tile(&cache_key) {
            cached
        } else {
            match enhanced_parse_mvt_data(
                &raw_mvt_data,
                &TileRequest {
                    x: tile_x,
                    y: tile_y,
                    z: tile_z,
                },
            ) {
                Ok(parsed) => {
                    // Defer caching until after iteration
                    parsed_tiles_to_cache.push((cache_key.clone(), parsed.clone()));
                    parsed
                }
                Err(e) => {
                    console_log!(
                        "  ❌ Failed to parse MVT data for tile {}/{}/{}: {}",
                        tile_z,
                        tile_x,
                        tile_y,
                        e
                    );
                    continue; // Skip this tile if parsing fails
                }
            }
        };

        // Find the requested layer in the newly parsed tile
        let layer = match parsed_tile.layers.get(&vt_dataset.source_layer) {
            Some(layer_data) => {
                console_log!(
                    "📊 Layer '{}' received {} features from tile {}/{}/{}",
                    vt_dataset.source_layer,
                    layer_data.features.len(),
                    tile_z,
                    tile_x,
                    tile_y
                );
                
                // Count features by class for this tile
                let mut class_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
                for feature in &layer_data.features {
                    let class_value = feature.properties.get("class")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    *class_counts.entry(class_value.to_string()).or_insert(0) += 1;
                }
                
                // Format the class counts for logging
                let mut class_stats: Vec<String> = class_counts.iter()
                    .map(|(class, count)| format!("{} ({})", class, count))
                    .collect();
                class_stats.sort(); // Sort alphabetically for consistent output
                
                console_log!(
                    "📊 received Layer '{}' classes: {}",
                    vt_dataset.source_layer,
                    class_stats.join(", ")
                );
                
                layer_data
            }
            None => {
                // console_log!("  Source layer '{}' not found in tile {}/{}/{}. Available layers: {:?}",
                //    vt_dataset.source_layer, tile_z, tile_x, tile_y, parsed_tile.layers.keys());
                continue; // Skip this tile if the layer isn't present
            }
        };

        // Get extent for coordinate transformation (default to 4096 if not specified somehow in mvt crate result)
        // Note: The `mvt` crate's `Layer` struct doesn't seem to expose extent directly after parsing.
        // We have to rely on the default MVT extent.
        let extent = 4096; // Standard MVT extent

        // Statistics tracking for features per class
        let mut class_stats: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        
        // First pass: collect statistics
        for feature in &layer.features {
            let class_value = feature.properties.get("class")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            *class_stats.entry(class_value.to_string()).or_insert(0) += 1;
        }
        
        // Log statistics for this layer
        
        
        for (_class, _count) in &class_stats {
            
        }
        

        // Process each feature in the layer
        let mut filtered_by_expression = 0;
        let mut processed_features = 0;
        let mut geometry_created = 0;
        let mut geometry_filtered_by_bbox = 0;
        
        for feature in &layer.features {
            feature_count += 1;

            // Apply filter expression if provided
            if let Some(ref filter) = vt_dataset.filter {
                // Convert MvtFeature to Feature for filter evaluation
                let filterable_feature = Feature {
                    geometry: FeatureGeometry {
                        r#type: feature.geometry_type.clone(),
                        coordinates: serde_json::to_value(&feature.geometry).unwrap_or(serde_json::Value::Null),
                    },
                    properties: serde_json::to_value(&feature.properties).unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
                };
                
                // Debug: specifically track primary and secondary features (removed individual logging)
                // if let Some(class_value) = feature.properties.get("class") {
                //     if let Some(class_str) = class_value.as_str() {
                //         if class_str == "primary" || class_str == "secondary" {
                //             let filter_result = evaluate_filter(filter, &filterable_feature);
                //             if !filter_result {
                //                 
                //             }
                //         }
                //     }
                // }
                
                if !evaluate_filter(filter, &filterable_feature) {
                    filtered_by_expression += 1;
                    continue; // Skip features that don't pass the filter
                }
            }
            
            processed_features += 1;

            // --- Height Extraction ---
            let height = feature
                .properties
                .get("height")
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    feature
                        .properties
                        .get("render_height")
                        .and_then(|v| v.as_f64())
                })
                .or_else(|| feature.properties.get("ele").and_then(|v| v.as_f64())) // Check 'ele' too
                .unwrap_or(0.0);
            // Debug: log extracted height for each feature
            // 

            // --- Geometry Processing & Transformation ---
            let geometry_type_str = feature.geometry_type.as_str();
            let mut transformed_geometry_parts: Vec<GeometryData> = Vec::new();

            match geometry_type_str {
                "Polygon" => {
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where outer is polygon, next is rings, inner is points [px, py]
                    for ring_tile_coords in &feature.geometry {
                        // Iterate through rings (usually 1 outer, N inner)
                        let mut transformed_ring: Vec<Vec<f64>> =
                            Vec::with_capacity(ring_tile_coords.len());
                        for point_tile_coords in ring_tile_coords {
                            // Iterate through points in the ring
                            if point_tile_coords.len() >= 2 {
                                let (lng, lat) = convert_tile_coords_to_lnglat(
                                    point_tile_coords[0],
                                    point_tile_coords[1],
                                    extent,
                                    tile_x,
                                    tile_y,
                                    tile_z,
                                );
                                transformed_ring.push(vec![lng, lat]);
                            }
                        }

                        if !transformed_ring.is_empty() {
                            // 
                            let _base_elevation = calculate_base_elevation(
                                &transformed_ring,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                elev_min_lng,
                                elev_min_lat,
                                elev_max_lng,
                                elev_max_lat, // Use elevation bbox
                            );
                            // 

                            transformed_geometry_parts.push(GeometryData {
                                geometry: transformed_ring, // Store transformed coords
                                r#type: Some("Polygon".to_string()),
                                height: Some(height),
                                layer: Some(vt_dataset.source_layer.clone()),
                                tags: None,
                                properties: Some(serde_json::to_value(&feature.properties).unwrap_or(serde_json::Value::Null)),
                            });
                        }
                    }
                }
                "LineString" | "MultiLineString" => {
                    // UNIFIED PROCESSING for both LineString and MultiLineString
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where each Vec<Vec<f64>> represents a line
                    // For LineString: contains 1 line
                    // For MultiLineString: contains multiple lines
                    
                    let _class_value = feature.properties.get("class")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    
                    
                    for (_line_index, line_tile_coords) in feature.geometry.iter().enumerate() {
                        let mut transformed_line: Vec<Vec<f64>> = Vec::with_capacity(line_tile_coords.len());
                        
                        // Transform each point in the line from tile coordinates to lat/lng
                        for point_tile_coords in line_tile_coords {
                            if point_tile_coords.len() >= 2 {
                                let (lng, lat) = convert_tile_coords_to_lnglat(
                                    point_tile_coords[0],
                                    point_tile_coords[1],
                                    extent,
                                    tile_x,
                                    tile_y,
                                    tile_z,
                                );
                                transformed_line.push(vec![lng, lat]);
                            }
                        }
                        
                        // Only create geometry if we have a valid line with at least 2 points
                        if transformed_line.len() >= 2 {
                            let _base_elevation = calculate_base_elevation(
                                &transformed_line,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                elev_min_lng,
                                elev_min_lat,
                                elev_max_lng,
                                elev_max_lat,
                            );
                            

                            transformed_geometry_parts.push(GeometryData {
                                geometry: transformed_line,
                                r#type: Some("LineString".to_string()), // Always output as LineString
                                height: Some(height),
                                layer: Some(vt_dataset.source_layer.clone()),
                                tags: None,
                                properties: Some(serde_json::to_value(&feature.properties).unwrap_or(serde_json::Value::Null)),
                            });
                        } else {
                        }
                    }
                }
                "Point" => {
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where outer is points, inner should be single point [px, py]
                    // Assuming single point per feature
                    if let Some(point_group) = feature.geometry.get(0) {
                        if let Some(point_tile_coords) = point_group.get(0) {
                            if point_tile_coords.len() >= 2 {
                                let (lng, lat) = convert_tile_coords_to_lnglat(
                                    point_tile_coords[0],
                                    point_tile_coords[1],
                                    extent,
                                    tile_x,
                                    tile_y,
                                    tile_z,
                                );
                                let transformed_point = vec![lng, lat];
                                // 

                                let _base_elevation = calculate_base_elevation(
                                    &vec![transformed_point.clone()], // Pass as vec of points
                                    &elevation_grid,
                                    grid_size.0 as usize,
                                    grid_size.1 as usize,
                                    elev_min_lng,
                                    elev_min_lat,
                                    elev_max_lng,
                                    elev_max_lat,
                                );
                                // 

                                transformed_geometry_parts.push(GeometryData {
                                    geometry: vec![transformed_point], // Store as [[lng, lat]]
                                    r#type: Some("Point".to_string()),
                                    height: Some(height), // Height might represent magnitude for points
                                    layer: Some(vt_dataset.source_layer.clone()),
                                    tags: None,
                                    properties: Some(serde_json::to_value(&feature.properties).unwrap_or(serde_json::Value::Null)),
                                });
                            }
                        }
                    }
                }
                "MultiPolygon" => {
                    // Handle MultiPolygon geometries (multiple separate polygons)
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where outer Vec contains multiple polygon rings
                    // Note: This is a simplified approach - proper MultiPolygon handling would need to group rings by polygon
                    for ring_tile_coords in &feature.geometry {
                        let mut transformed_ring: Vec<Vec<f64>> = Vec::with_capacity(ring_tile_coords.len());
                        for point_tile_coords in ring_tile_coords {
                            if point_tile_coords.len() >= 2 {
                                let (lng, lat) = convert_tile_coords_to_lnglat(
                                    point_tile_coords[0],
                                    point_tile_coords[1],
                                    extent,
                                    tile_x,
                                    tile_y,
                                    tile_z,
                                );
                                transformed_ring.push(vec![lng, lat]);
                            }
                        }

                        if !transformed_ring.is_empty() {
                            let _base_elevation = calculate_base_elevation(
                                &transformed_ring,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                elev_min_lng,
                                elev_min_lat,
                                elev_max_lng,
                                elev_max_lat,
                            );

                            transformed_geometry_parts.push(GeometryData {
                                geometry: transformed_ring,
                                r#type: Some("Polygon".to_string()), // Convert MultiPolygon to individual Polygons
                                height: Some(height),
                                layer: Some(vt_dataset.source_layer.clone()),
                                tags: None,
                                properties: Some(serde_json::to_value(&feature.properties).unwrap_or(serde_json::Value::Null)),
                            });
                        }
                    }
                }
                _ => {
                    // LOG ALL UNHANDLED GEOMETRY TYPES - THIS IS CRITICAL FOR DEBUGGING
                    let class_value = feature.properties.get("class")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    console_log!("❌ SKIPPING UNHANDLED geometry type '{}' for feature class '{}' - THIS IS WHY FEATURES ARE MISSING!", 
                        geometry_type_str, class_value);
                }
            }
            
            let pre_bbox_count = transformed_geometry_parts.len();
            geometry_created += pre_bbox_count;
            
            // Apply smart bbox filtering with buffers for LineStrings
            let bbox_buffer = 0.001; // ~100m buffer for roads that cross boundaries
            let filtered_parts: Vec<GeometryData> = transformed_geometry_parts
                .into_iter()
                .filter(|geom| {
                    let (effective_min_lng, effective_max_lng, effective_min_lat, effective_max_lat) = 
                        if geom.r#type.as_ref().map_or(false, |t| t == "LineString") {
                            // Use buffered bbox for LineStrings (roads)
                            (min_lng - bbox_buffer, max_lng + bbox_buffer, min_lat - bbox_buffer, max_lat + bbox_buffer)
                        } else {
                            // Use strict bbox for Polygons (buildings)
                            (min_lng, max_lng, min_lat, max_lat)
                        };
                    
                    geom.geometry.iter().any(|coord| {
                        let lon = coord[0];
                        let lat = coord[1];
                        lon >= effective_min_lng && lon <= effective_max_lng && lat >= effective_min_lat && lat <= effective_max_lat
                    })
                })
                .collect();
            
            let post_bbox_count = filtered_parts.len();
            geometry_filtered_by_bbox += pre_bbox_count - post_bbox_count;
            
            geometry_data_list.extend(filtered_parts);
        }
        
        // Log the filtering statistics for this tile
        console_log!(
            "📊received  Tile {}/{}/{} stats: {} total, {} filtered by expression, {} processed, {} geometries created, {} filtered by bbox",
            tile_z, tile_x, tile_y,
            layer.features.len(),
            filtered_by_expression,
            processed_features,
            geometry_created,
            geometry_filtered_by_bbox
        );
    }

    console_log!(
        "📊 Layer '{}': {} features → {} geometries after filtering",
        vt_dataset.source_layer, 
        feature_count, 
        geometry_data_list.len()
    );

    // Cache the extracted feature data for later use
    {
        // Build inner cache key using central function
        let inner_key = cache_keys::make_inner_key_from_filter(&vt_dataset.source_layer, input.vt_data_set.filter.as_ref());
        let cached_value_str = serde_json::to_string(&geometry_data_list).map_err(|e| JsValue::from(e.to_string()))?;
        module_state.add_feature_data(&bbox_key, &inner_key, cached_value_str.clone());
    }
    // Return undefined since data is cached at bbox_key level
    Ok(JsValue::undefined())
}

// Make this function available to JS
#[wasm_bindgen]
pub async fn fetch_vector_tiles(input_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse input
    let input: VectortileProcessingInput = from_value(input_js)?;

    // Compute consistent bbox_key using central function
    let standard_bbox_key = cache_keys::make_bbox_key(
        input.min_lng, input.min_lat, input.max_lng, input.max_lat
    );

    // Use the standard bbox_key or override with input.bbox_key if provided and it matches the format
    let bbox_key = match &input.bbox_key {
        Some(key) => {
            if key.contains("{") || key.contains("}") {
                // 
                standard_bbox_key
            } else {
                key.clone()
            }
        }
        None => standard_bbox_key.clone(),
    };

    // Calculate tiles for the requested bounding box
    let tiles = get_tiles_for_bbox(
        input.min_lng,
        input.min_lat,
        input.max_lng,
        input.max_lat,
        input.zoom,
    );

    console_log!(
        "Fetching {} vector tiles for zoom level {}",
        tiles.len(),
        input.zoom
    );

    // Fetch tiles in parallel and store them
    let module_state = ModuleState::get_instance();
    let mut module_state_lock = module_state.lock().unwrap();

    // Store the fetch results for later processing
    let mut tile_results = Vec::new();

    for tile in tiles {
        let tile_key = format!("{}/{}/{}", tile.z, tile.x, tile.y);

        // Check if we already have this tile cached
        let tile_data = if let Some(existing_data) = module_state_lock.get_tile_data(&tile_key) {
            existing_data
        } else {
            // Construct the appropriate URL for vector tiles
            // Using Mapbox Vector Tile format
            let url = format!(
                "https://wms.wheregroup.com/tileserver/tile/world-0-14/{}/{}/{}.pbf",
                tile.z, tile.x, tile.y
            );

            // Fetch the tile if not cached
            let fetch_promise = fetch(&url)?;
            let fetch_result = JsFuture::from(fetch_promise).await?;

            // Debug: Check what type of data we're getting back from JS
            console_log!(
                "📦 WASM received fetch_result type: {:?}",
                js_sys::Object::get_prototype_of(&fetch_result)
                    .constructor()
                    .name()
            );

            // Extract the raw data array - we need to access the "rawData" property
            // since our JS helper function returns a TileFetchResponse object
            let raw_data_value = js_sys::Reflect::get(&fetch_result, &JsValue::from_str("rawData"))
                .map_err(|_e| {
                    
                    JsValue::from_str("Failed to extract rawData from fetch result")
                })?;

            // Verify we actually got a valid Uint8Array from the rawData property
            if raw_data_value.is_undefined() || raw_data_value.is_null() {
                
                return Err(JsValue::from_str("rawData property is undefined or null"));
            }

            // Convert to Uint8Array and then to Rust Vec
            let data_array = Uint8Array::new(&raw_data_value);
            let mut data_vec = data_array.to_vec();

            // Verify size after conversion
            console_log!(
                "📦 WASM data size after conversion: {} bytes",
                data_vec.len()
            );

            // Check if the data is gzipped and decompress if necessary
            if data_vec.starts_with(&[0x1f, 0x8b]) {
                // Gzip magic number
                
                let mut decoder = GzDecoder::new(&data_vec[..]);
                let mut decompressed_data = Vec::new();
                decoder.read_to_end(&mut decompressed_data).map_err(|_e| {
                    
                    JsValue::from_str("Decompression error")
                })?;
                data_vec = decompressed_data;
            }

            // Debug: Print first few bytes to check data format
            let debug_bytes = if data_vec.len() > 20 {
                &data_vec[0..20]
            } else {
                &data_vec
            };
            console_log!(
                "🔍 DEBUG: First bytes of tile data (hex): {:02X?}",
                debug_bytes
            );
            

            // Parse the MVT data using our enhanced Rust MVT parser
            let parsed_mvt = match enhanced_parse_mvt_data(&data_vec, &tile) {
                Ok(parsed) => {
                    // Cache the parsed MVTTile for later feature extraction
                    module_state_lock.set_parsed_mvt_tile(&tile_key, parsed.clone());
                    console_log!(
                        "Successfully parsed MVT data with Rust parser for tile {}/{}/{}",
                        tile.z,
                        tile.x,
                        tile.y
                    );
                    // Log the number of layers found
                    let _layer_count = parsed.layers.len();
                    let _layer_names: Vec<String> = parsed.layers.keys().cloned().collect();
                    

                    // Convert Rust-parsed features to the legacy format for compatibility
                    let mut legacy_layers = HashMap::new();
                    for (layer_name, layer) in &parsed.layers {
                        let mut features = Vec::new();
                        for mvt_feature in &layer.features {
                            let geometry_type = mvt_feature.geometry_type.clone();
                            let coordinates = match geometry_type.as_str() {
                                "Point" => {
                                    if !mvt_feature.geometry.is_empty()
                                        && !mvt_feature.geometry[0].is_empty()
                                    {
                                        serde_json::to_value(mvt_feature.geometry[0][0].clone())
                                            .unwrap_or(serde_json::Value::Null)
                                    } else {
                                        serde_json::Value::Null
                                    }
                                }
                                "LineString" => {
                                    if !mvt_feature.geometry.is_empty() {
                                        serde_json::to_value(mvt_feature.geometry[0].clone())
                                            .unwrap_or(serde_json::Value::Null)
                                    } else {
                                        serde_json::Value::Null
                                    }
                                }
                                "Polygon" => serde_json::to_value(mvt_feature.geometry.clone())
                                    .unwrap_or(serde_json::Value::Null),
                                _ => serde_json::Value::Null,
                            };

                            features.push(Feature {
                                geometry: FeatureGeometry {
                                    r#type: geometry_type,
                                    coordinates,
                                },
                                properties: serde_json::Value::Object(serde_json::Map::from_iter(
                                    mvt_feature.properties.clone().into_iter(),
                                )),
                            });
                        }
                        legacy_layers.insert(layer_name.clone(), features);
                    }

                    Some((parsed, legacy_layers))
                }
                Err(_e) => {
                    
                    None
                }
            };

            // Debug: Print detailed info about the data being stored
            console_log!(
                "🔍 WASM DEBUG: Raw data length received from JS: {} bytes",
                data_vec.len()
            );

            // Create a hex dump of a small sample of the raw data
            let _hex_sample = if data_vec.len() > 32 {
                format!("{:02X?}", &data_vec[0..32])
            } else {
                format!("{:02X?}", &data_vec)
            };
            

            // Create new tile data entry
            let tile_data = TileData {
                width: 256, // Default tile size
                height: 256,
                x: tile.x,
                y: tile.y,
                z: tile.z,
                data: data_vec.clone(),
                timestamp: Date::now(),
                key: tile_key.clone(),
                buffer: data_vec.clone(),
                parsed_layers: parsed_mvt
                    .as_ref()
                    .map(|(_, legacy_layers)| legacy_layers.clone()), // Store legacy format for compatibility
                rust_parsed_mvt: Some(data_vec.clone()), // Store the raw MVT data for Rust parsing
            };

            // Cache the tile
            module_state_lock.set_tile_data(&tile_key, tile_data.clone());
            tile_data
        };

        // Add to results
        tile_results.push(VectorTileResult {
            tile: tile.clone(),
            data: tile_data.buffer,
        });
    }

    // Only store tiles under the standard bbox_key format for consistency
    console_log!(
        "🔍 DEBUG: Storing {} vector tiles under bbox_key: {}",
        tile_results.len(),
        bbox_key
    );
    module_state_lock.store_vector_tiles(&bbox_key, &tile_results);

    // Return tile data that has been processed by Rust
    // We're still returning the VectorTileResult format for compatibility,
    // but we're now parsing the MVT data in Rust instead of JavaScript
    Ok(to_value(&tile_results)?)
}

// MVT-specific structures for Rust parsing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MvtLayer {
    pub name: String,
    pub features: Vec<MvtFeature>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MvtFeature {
    pub id: Option<u64>,
    pub properties: HashMap<String, serde_json::Value>,
    pub geometry_type: String,
    pub geometry: Vec<Vec<Vec<f64>>>, // Coordinates in [[[x, y],...],...]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedMvtTile {
    pub tile: TileRequest,
    pub layers: HashMap<String, MvtLayer>,
    pub raw_data: Vec<u8>,
}

// Function to detect if data is gzipped (checking for gzip magic number)
fn is_gzipped(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0x1F && data[1] == 0x8B
}

// Function to decompress gzipped data
fn decompress_gzip(data: &[u8]) -> Result<Vec<u8>, String> {
    if !is_gzipped(data) {
        return Ok(data.to_vec());
    }

    let mut decoder = GzDecoder::new(data);
    let mut decompressed_data = Vec::new();

    decoder
        .read_to_end(&mut decompressed_data)
        .map_err(|e| format!("Error decompressing gzip data: {}", e))?;

    Ok(decompressed_data)
}

// Enhanced function to parse MVT data with proper geometry decoding
fn enhanced_parse_mvt_data(
    tile_data: &[u8],
    tile_request: &TileRequest,
) -> Result<ParsedMvtTile, String> {
    // First, log the original data length before any processing
    console_log!(
        "🔍 RAW DATA: Original tile data length: {} bytes for tile {}/{}/{}",
        tile_data.len(),
        tile_request.z,
        tile_request.x,
        tile_request.y
    );

    // Print first 32 bytes of the raw data to verify what we're getting
    let _raw_preview = if tile_data.len() >= 32 {
        format!("{:02X?}", &tile_data[0..32])
    } else {
        format!("{:02X?}", &tile_data)
    };
    

    // Check for common MVT/PBF patterns in the raw data
    if tile_data.len() >= 4 {
        console_log!(
            "🔍 CHECKING MVT FORMAT: First few bytes in decimal: [{}, {}, {}, {}]",
            tile_data[0],
            tile_data[1],
            tile_data[2],
            tile_data[3]
        );
    }

    // Try to detect protobuf structure directly
    if tile_data.len() > 10 {
        // 
        for i in 0..10.min(tile_data.len()) {
            let byte = tile_data[i];
            let field_num = byte >> 3;
            let wire_type = byte & 0x7;

            if field_num > 0 && field_num < 20 && wire_type <= 5 {
                // console_log!(
                //     "  - Potential field at position {}: field_num={}, wire_type={}",
                //     i,
                //     field_num,
                //     wire_type
                // );
            }
        }
    }

    // Decompress if the data is gzipped
    let data = decompress_gzip(tile_data)?;

    // Log if decompression changed the data size
    if data.len() != tile_data.len() {
       //  console_log!("🔍 DECOMPRESSION: Data was compressed. Original size: {} bytes, Decompressed size: {} bytes", 
       //      tile_data.len(), data.len());
    }

    // Debug: Log raw data details
    console_log!(
        "🔍 DEBUG: Starting MVT parsing for tile {}/{}/{} (data size: {} bytes)",
        tile_request.z,
        tile_request.x,
        tile_request.y,
        data.len()
    );

    // Create the result structure
    let mut tile_result = ParsedMvtTile {
        tile: tile_request.clone(), // Use the passed TileRequest
        layers: HashMap::new(),
        raw_data: data.clone(), // Store decompressed data if needed later
    };

    // Show first 32 bytes for debugging
    let _preview = if data.len() >= 32 {
        format!("{:02X?}", &data[0..32])
    } else {
        format!("{:02X?}", &data)
    };
    

    // Try to decode the MVT data using the Message trait implementation
    match Tile::decode(&*data) {
        Ok(mvt_tile) => {
            
            

            // If no layers found, this could indicate a potential issue with the data format
            if mvt_tile.layers.is_empty() {
                console_log!(
                    "⚠️ WARNING: No layers found in the decoded MVT data. This might indicate:"
                );
                
                
                

                // Let's try an alternate approach: attempt to detect the protobuf structure manually
                // This is a basic check to see if the data at least looks like a protobuf message
                if data.len() > 2 {
                    
                    let mut offset = 0;
                    while offset < data.len() - 1 {
                        if offset >= 100 {
                            
                            break;
                        }

                        let tag_and_type = data[offset];
                        let field_number = tag_and_type >> 3;
                        let wire_type = tag_and_type & 0x7;

                        if field_number > 0 && field_number < 20 && wire_type <= 5 {
                            console_log!("   Found potential protobuf field: number={}, wire_type={} at offset={}", 
                                field_number, wire_type, offset);
                        }
                        offset += 1;
                    }
                }
            }

            // Process each layer in the tile
            for layer in mvt_tile.layers {
                //  console_log!("  - Layer: '{}' with {} features, extent: {}",
                //  layer.name, layer.features.len(), layer.extent.unwrap_or(4096));

                let mut mvt_layer = MvtLayer {
                    name: layer.name.clone(),
                    features: Vec::new(),
                };

                // Get the layer extent (usually 4096) - Use default if not available
                let _extent = 4096; // layer.extent seems unavailable in mvt crate API here

                // Process each feature in the layer
                for feature in layer.features {
                    // Determine geometry type using geozero::mvt::tile::GeomType
                    // Note: feature.r#type here is an Option<i32> representing the type
                    let geometry_type = match feature.r#type {
                        Some(1) => "Point",
                        Some(2) => "LineString",
                        Some(3) => "Polygon",
                        _ => "Unknown", // Handle any other case
                    };

                    // Convert MVT properties to standard JSON values
                    let mut properties = HashMap::new();
                    for (key_index, value_index) in feature
                        .tags
                        .chunks_exact(2)
                        .map(|chunk| (chunk[0], chunk[1]))
                    {
                        if let (Some(key), Some(value)) = (
                            layer.keys.get(key_index as usize),
                            layer.values.get(value_index as usize), // value is &geozero::mvt::tile::Value
                        ) {
                            let json_value = match value {
                                Value {
                                    string_value: Some(s),
                                    ..
                                } => serde_json::Value::String(s.clone()),
                                Value {
                                    float_value: Some(f),
                                    ..
                                } => {
                                    let val = *f as f64;
                                    serde_json::Number::from_f64(val)
                                        .map_or(serde_json::Value::Null, serde_json::Value::Number)
                                }
                                Value {
                                    double_value: Some(d),
                                    ..
                                } => serde_json::Number::from_f64(*d)
                                    .map_or(serde_json::Value::Null, serde_json::Value::Number),
                                Value {
                                    int_value: Some(i), ..
                                } => serde_json::Value::Number(serde_json::Number::from(*i as i64)),
                                Value {
                                    uint_value: Some(u),
                                    ..
                                } => serde_json::Value::Number(serde_json::Number::from(*u as u64)),
                                Value {
                                    sint_value: Some(s),
                                    ..
                                } => serde_json::Value::Number(serde_json::Number::from(*s as i64)),
                                Value {
                                    bool_value: Some(b),
                                    ..
                                } => serde_json::Value::Bool(*b),
                                _ => serde_json::Value::Null,
                            };
                            properties.insert(key.clone(), json_value);
                        }
                    }

                    // Decode MVT geometry commands *without* transforming coordinates here
                    // Transformation happens in extract_features_from_vector_tiles
                    let decoded_geometry_tile_coords =
                        decode_mvt_geometry_to_tile_coords(&feature.geometry, geometry_type);

                    // Skip if geometry decoding failed or resulted in empty geometry
                    if decoded_geometry_tile_coords.is_empty()
                        || decoded_geometry_tile_coords[0].is_empty()
                    {
                        // 
                        continue;
                    }

                    let mvt_feature = MvtFeature {
                        id: feature.id,
                        properties,
                        geometry_type: geometry_type.to_string(),
                        geometry: decoded_geometry_tile_coords, // Store TILE coordinates
                    };

                    mvt_layer.features.push(mvt_feature);
                }

                // Only insert layer if it has features
                if !mvt_layer.features.is_empty() {
                    tile_result.layers.insert(layer.name, mvt_layer);
                }
            }

            Ok(tile_result)
        }
        Err(e) => Err(format!(
            "Error decoding MVT tile {}/{}/{}: {:?}",
            tile_request.z, tile_request.x, tile_request.y, e
        )),
    }
}

// Decode MVT geometry commands to TILE coordinate arrays [px, py]
// This function likely works on raw command integers and might not need type changes
fn decode_mvt_geometry_to_tile_coords(commands: &[u32], geom_type_str: &str) -> Vec<Vec<Vec<f64>>> {
    let mut result: Vec<Vec<Vec<f64>>> = Vec::new(); // [ [ [px, py], ... ], ... ] structure
    let mut current_part: Vec<Vec<f64>> = Vec::new(); // For current ring or line
    let mut cursor_x: i32 = 0;
    let mut cursor_y: i32 = 0;
    let mut i = 0;

    while i < commands.len() {
        let command_int = commands[i];
        let cmd_id = command_int & 0x7; // Command ID (lowest 3 bits)
        let cmd_count = (command_int >> 3) as usize; // Number of parameter pairs
        i += 1; // Move past command integer

        match cmd_id {
            1 => {
                // MoveTo
                if !current_part.is_empty() {
                    // If MoveTo occurs mid-part (e.g., MultiPolygon inner ring), store the previous part
                    if geom_type_str == "Polygon" || geom_type_str == "LineString" {
                        result.push(current_part);
                    }
                    // For Point, MoveTo usually means a new point/feature part
                    if geom_type_str == "Point" && !result.is_empty() {
                        // MVT spec implies MoveTo for points is just coordinates
                        // Let's assume cmd_count > 1 means MultiPoint within one feature
                    }
                    current_part = Vec::new(); // Start a new part
                }

                // Process all MoveTo parameter pairs
                for _ in 0..cmd_count {
                    if i + 1 < commands.len() {
                        let param_x = commands[i] as i32;
                        let param_y = commands[i + 1] as i32;
                        i += 2;

                        // Decode zig-zag encoding
                        let dx = (param_x >> 1) ^ (-(param_x & 1));
                        let dy = (param_y >> 1) ^ (-(param_y & 1));

                        cursor_x += dx;
                        cursor_y += dy;

                        current_part.push(vec![cursor_x as f64, cursor_y as f64]);
                    } else {
                        // 
                        break; // Exit inner loop if data is short
                    }
                }
                // For Point geometry, each MoveTo command sequence often represents a separate point
                if geom_type_str == "Point" && !current_part.is_empty() {
                    result.push(current_part); // Store this point/multipoint part
                    current_part = Vec::new(); // Reset for next potential point
                }
            }
            2 => {
                // LineTo
                // Process all LineTo parameter pairs
                for _ in 0..cmd_count {
                    if i + 1 < commands.len() {
                        let param_x = commands[i] as i32;
                        let param_y = commands[i + 1] as i32;
                        i += 2;

                        // Decode zig-zag encoding
                        let dx = (param_x >> 1) ^ (-(param_x & 1));
                        let dy = (param_y >> 1) ^ (-(param_y & 1));

                        cursor_x += dx;
                        cursor_y += dy;

                        // Add the new point to the current part (ring or line)
                        if current_part.is_empty() {
                            // MVT spec v2: "A LineTo command must be preceded by a MoveTo command."
                            // If we encounter LineTo without a preceding MoveTo, it's likely an error or
                            // implies starting from (0,0), but safer to log/ignore.
                            // 
                        } else {
                            current_part.push(vec![cursor_x as f64, cursor_y as f64]);
                        }
                    } else {
                        // 
                        break; // Exit inner loop
                    }
                }
            }
            7 => {
                // ClosePath
                if !current_part.is_empty() {
                    // Check if already closed (last point == first point)
                    if current_part.first() != current_part.last() {
                        current_part.push(current_part[0].clone()); // Add first point to end
                    }
                    // ClosePath command has no parameters, so just continue
                } else {
                    // 
                }
                // MVT Spec: A ClosePath command is followed by a MoveTo command
                // We don't need to push `current_part` here; the next MoveTo will handle it
            }
            _ => {
                // Unknown command, skip parameters
                // 
                i += 2 * cmd_count;
            }
        }
    }

    // Add the last part if it's not empty and hasn't been added yet (e.g., unclosed LineString)
    if !current_part.is_empty() {
        result.push(current_part);
    }

    // MVT Polygons require winding order checks and area calculation to distinguish outer/inner rings.
    // This simplified decoder doesn't perform that; it returns all rings.
    // A more robust implementation would calculate area and potentially reorder rings.

    result // Return the structured tile coordinates
}
