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
use crate::{cache_keys, fetch};

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
    // Process reference for consistent resource management
    pub process_id: String,
}

// Result structure compatible with JS expectations
#[derive(Serialize, Deserialize, Clone)]
pub struct VectorTileResult {
    pub tile: TileRequest,
    pub data: Vec<u8>, // Vector tile binary data
}

// Structure for the GeometryData that we extract from vector tiles
#[derive(Serialize, Deserialize, Clone)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>, // Represents a geometry's coordinates (exterior ring for polygons)
    #[serde(default)]
    pub holes: Option<Vec<Vec<Vec<f64>>>>, // Array of holes (inner rings) for polygon geometries
    pub r#type: Option<String>,  // Geometry type (e.g., "Polygon", "LineString")
    pub height: Option<f64>,     // Feature height
    pub layer: Option<String>,   // Source layer name
    pub label: Option<String>,   // Display label for grouping
    pub tags: Option<serde_json::Value>, // Tags/attributes from the tile
    pub properties: Option<serde_json::Value>, // Feature properties from MVT
}

// Input for extracting features from vector tiles
#[derive(Serialize, Deserialize)]
pub struct ExtractFeaturesInput {
    pub bbox: Vec<f64>, // [minLng, minLat, maxLng, maxLat]
    #[serde(rename = "vtDataSet")]
    pub vt_data_set: VtDataSet, // Configuration for the layer
    #[serde(rename = "processId")]
    pub process_id: String, // Process reference for resource management
    #[serde(rename = "elevationProcessId")]
    pub elevation_process_id: Option<String>, // Process ID to find cached elevation data
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
                expected_value
                    .as_str()
                    .map_or(false, |v| v == geometry_type)
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
                    if filter_array[i]
                        .as_str()
                        .map_or(false, |v| v == geometry_type)
                    {
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
                    if filter_array[i]
                        .as_str()
                        .map_or(false, |v| v == geometry_type)
                    {
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
                feature
                    .properties
                    .as_object()
                    .map_or(false, |obj| obj.contains_key(key))
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
                feature
                    .properties
                    .as_object()
                    .map_or(true, |obj| !obj.contains_key(key))
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
                        (actual_value.as_f64(), expected_value.as_f64())
                    {
                        match operator {
                            "<" => actual_num < expected_num,
                            ">" => actual_num > expected_num,
                            "<=" => actual_num <= expected_num,
                            ">=" => actual_num >= expected_num,
                            _ => true,
                        }
                    } else if let (Some(actual_str), Some(expected_str)) =
                        (actual_value.as_str(), expected_value.as_str())
                    {
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

    // Starting feature extraction

    // Try to access cached vector tile data using the provided process_id
    let vector_tiles_data = match ModuleState::with(|state| {
        state.get_process_vector_tiles(&input.process_id).cloned()
    }) {
        Some(tiles) => tiles,
        None => {
            // No cached vector tiles found
            // Return empty array instead of error, as fetching might happen separately
            return Ok(to_value(&Vec::<GeometryData>::new())?);
        }
    };

    // Get cached elevation data if available
    // Use the specific elevation_process_id provided in the input
    let elevation_grid_data: Option<Vec<Vec<f64>>> = match &input
        .elevation_process_id
    {
        Some(elevation_process_id) => {
            // Try the specified elevation process ID first
            let result = ModuleState::with(|state| {
                state.get_elevation_grid(elevation_process_id).cloned()
            });

            if result.is_some() {
                result
            } else {
                // Fallback: try to find any available elevation grid
                ModuleState::with(|state| {
                    // Get all available elevation grids and use the first one
                    for (_key, grid) in &state.elevation_grids {
                        // Using fallback elevation grid from different process
                        return Some(grid.clone());
                    }
                    None
                })
            }
        }
        None => {
            // No elevation_process_id provided, try using main process_id as fallback
            let result = ModuleState::with(|state| {
                state.get_elevation_grid(&input.process_id).cloned()
            });

            if result.is_some() {
                result
            } else {
                // Fallback: try to find any available elevation grid
                ModuleState::with(|state| {
                    for (_key, grid) in &state.elevation_grids {
                        // Using fallback elevation grid from different process
                        return Some(grid.clone());
                    }
                    None
                })
            }
        }
    };

    let (elevation_grid, grid_size, elev_min_lng, elev_min_lat, elev_max_lng, elev_max_lat) =
        match elevation_grid_data {
            Some(elev_grid) => {
                // Found cached elevation grid
                let grid_height = elev_grid.len();
                let grid_width = if grid_height > 0 { elev_grid[0].len() } else { 0 };
                web_sys::console::log_1(&format!("WASM: Found elevation grid {}x{} for layer processing",
                    grid_width, grid_height).into());
                (
                    elev_grid,
                    (grid_width as u32, grid_height as u32),
                    min_lng,
                    min_lat,
                    max_lng,
                    max_lat,
                )
            }
            None => {
                // No cached elevation data found, using flat elevation
                // Note: This is expected when not using DEM-based terrain alignment
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

        // Processing tile data

        // The raw MVT data should be stored in rust_parsed_mvt or buffer
        let raw_mvt_data = match vt_tile_data.rust_parsed_mvt {
            Some(ref data) => data,
            None => {
                &vt_tile_data.buffer // Fallback to buffer if rust_parsed_mvt is missing
            }
        };

        if raw_mvt_data.is_empty() {
            // Skipping tile due to empty raw data
            continue;
        }

        // Use cached parsed MVT tile if available, otherwise parse and cache it
        let cache_key = format!("{}/{}/{}", tile_z, tile_x, tile_y);
        let parsed_tile = if let Some(cached) =
            ModuleState::with(|state| state.get_parsed_mvt_tile(&cache_key))
        {
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
                Err(_e) => {
                    // Failed to parse MVT data for tile
                    continue; // Skip this tile if parsing fails
                }
            }
        };

        // Find the requested layer in the newly parsed tile
        let layer = match parsed_tile.layers.get(&vt_dataset.source_layer) {
            Some(layer_data) => {
                // Found layer data

                // Count features by class for this tile
                let mut class_counts: std::collections::HashMap<String, usize> =
                    std::collections::HashMap::new();
                for feature in &layer_data.features {
                    let class_value = feature
                        .properties
                        .get("class")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    *class_counts.entry(class_value.to_string()).or_insert(0) += 1;
                }

                // Format the class counts for logging
                let mut class_stats: Vec<String> = class_counts
                    .iter()
                    .map(|(class, count)| format!("{} ({})", class, count))
                    .collect();
                class_stats.sort(); // Sort alphabetically for consistent output

                // Class statistics computed

                layer_data
            }
            None => {
                //    vt_dataset.source_layer, tile_z, tile_x, tile_y, parsed_tile.layers.keys());
                continue; // Skip this tile if the layer isn't present
            }
        };

        // Get extent for coordinate transformation (default to 4096 if not specified somehow in mvt crate result)
        // Note: The `mvt` crate's `Layer` struct doesn't seem to expose extent directly after parsing.
        // We have to rely on the default MVT extent.
        let extent = 4096; // Standard MVT extent

        // Statistics tracking for features per class
        let mut class_stats: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();

        // First pass: collect statistics
        for feature in &layer.features {
            let class_value = feature
                .properties
                .get("class")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            *class_stats.entry(class_value.to_string()).or_insert(0) += 1;
        }

        // Log statistics for this layer

        for (_class, _count) in &class_stats {}

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
                        coordinates: serde_json::to_value(&feature.geometry)
                            .unwrap_or(serde_json::Value::Null),
                    },
                    properties: serde_json::to_value(&feature.properties)
                        .unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
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
            // Check hide_3d property first - skip buildings marked as hidden
            if let Some(hide_3d) = feature.properties.get("hide_3d") {
                if hide_3d.as_bool().unwrap_or(false) {
                    continue; // Skip this building entirely
                }
            }

            // Extract height, treating render_height=5 as "no height data"
            let height = feature
                .properties
                .get("height")
                .and_then(|v| v.as_f64())
                .filter(|&h| h > 0.0) // Only use positive heights
                .or_else(|| {
                    // Check render_height - all positive values are valid
                    feature
                        .properties
                        .get("render_height")
                        .and_then(|v| v.as_f64())
                        .filter(|&h| h > 0.0) // Accept all positive heights including 5.0
                })
                .or_else(|| {
                    feature
                        .properties
                        .get("ele")
                        .and_then(|v| v.as_f64())
                        .filter(|&h| h > 0.0)
                });

            // Convert Option<f64> to the expected format for further processing
            let height_value = height.unwrap_or(0.0);
            // Debug: log extracted height for each feature
            //

            // --- Geometry Processing & Transformation ---
            let geometry_type_str = feature.geometry_type.as_str();
            let mut transformed_geometry_parts: Vec<GeometryData> = Vec::new();

            match geometry_type_str {
                "Polygon" => {
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where outer is polygon, next is rings, inner is points [px, py]
                    // First ring is exterior, subsequent rings are holes
                    // We need to group them together into a single polygon with holes
                    
                    let mut exterior_ring: Option<Vec<Vec<f64>>> = None;
                    let mut hole_rings: Vec<Vec<Vec<f64>>> = Vec::new();
                    
                    for (ring_idx, ring_tile_coords) in feature.geometry.iter().enumerate() {
                        let mut transformed_ring: Vec<Vec<f64>> =
                            Vec::with_capacity(ring_tile_coords.len());
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
                            if ring_idx == 0 {
                                // First ring is the exterior
                                exterior_ring = Some(transformed_ring);
                            } else {
                                // Subsequent rings are holes
                                hole_rings.push(transformed_ring);
                            }
                        }
                    }
                    
                    // Create the polygon with holes if we have an exterior ring
                    if let Some(exterior) = exterior_ring {
                        let _base_elevation = calculate_base_elevation(
                            &exterior,
                            &elevation_grid,
                            grid_size.0 as usize,
                            grid_size.1 as usize,
                            elev_min_lng,
                            elev_min_lat,
                            elev_max_lng,
                            elev_max_lat,
                        );

                        let holes = if hole_rings.is_empty() {
                            None
                        } else {
                            Some(hole_rings)
                        };

                        transformed_geometry_parts.push(GeometryData {
                            geometry: exterior,
                            holes,
                            r#type: Some("Polygon".to_string()),
                            height: Some(height_value),
                            layer: Some(vt_dataset.source_layer.clone()),
                            label: vt_dataset.label.clone(),
                            tags: None,
                            properties: Some(
                                serde_json::to_value(&feature.properties)
                                    .unwrap_or(serde_json::Value::Null),
                            ),
                        });
                    }
                }
                "LineString" | "MultiLineString" => {
                    // UNIFIED PROCESSING for both LineString and MultiLineString
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where each Vec<Vec<f64>> represents a line
                    // For LineString: contains 1 line
                    // For MultiLineString: contains multiple lines

                    let _class_value = feature
                        .properties
                        .get("class")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");

                    for (_line_index, line_tile_coords) in feature.geometry.iter().enumerate() {
                        let mut transformed_line: Vec<Vec<f64>> =
                            Vec::with_capacity(line_tile_coords.len());

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
                                holes: None,
                                r#type: Some("LineString".to_string()),
                                height: Some(height_value),
                                layer: Some(vt_dataset.source_layer.clone()),
                                label: vt_dataset.label.clone(),
                                tags: None,
                                properties: Some(
                                    serde_json::to_value(&feature.properties)
                                        .unwrap_or(serde_json::Value::Null),
                                ),
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
                                    geometry: vec![transformed_point],
                                    holes: None,
                                    r#type: Some("Point".to_string()),
                                    height: Some(height_value),
                                    layer: Some(vt_dataset.source_layer.clone()),
                                    label: vt_dataset.label.clone(),
                                    tags: None,
                                    properties: Some(
                                        serde_json::to_value(&feature.properties)
                                            .unwrap_or(serde_json::Value::Null),
                                    ),
                                });
                            }
                        }
                    }
                }
                "MultiPolygon" => {
                    // Handle MultiPolygon geometries with proper hole support
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where outer Vec contains multiple polygon rings
                    // In MVT format, rings are ordered: exterior rings (clockwise) followed by holes (counter-clockwise)
                    // We group them into proper polygon structures with exterior + holes
                    
                    let mut current_exterior: Option<Vec<Vec<f64>>> = None;
                    let mut current_holes: Vec<Vec<Vec<f64>>> = Vec::new();
                    
                    for ring_tile_coords in &feature.geometry {
                        let mut transformed_ring: Vec<Vec<f64>> =
                            Vec::with_capacity(ring_tile_coords.len());
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
                        
                        if transformed_ring.is_empty() {
                            continue;
                        }

                        // Determine if this is an exterior ring (counter-clockwise) or hole (clockwise)
                        // using the shoelace formula for signed area
                        // GeoJSON/MVT spec: counter-clockwise = exterior, clockwise = hole
                        let is_exterior = {
                            let mut area = 0.0;
                            for i in 0..transformed_ring.len() {
                                let j = (i + 1) % transformed_ring.len();
                                area += transformed_ring[i][0] * transformed_ring[j][1];
                                area -= transformed_ring[j][0] * transformed_ring[i][1];
                            }
                            area < 0.0  // Negative area = counter-clockwise = exterior
                        };

                        if is_exterior {
                            // Save previous polygon if it exists
                            if let Some(exterior) = current_exterior.take() {
                                let holes = if current_holes.is_empty() {
                                    None
                                } else {
                                    Some(current_holes.clone())
                                };
                                
                                transformed_geometry_parts.push(GeometryData {
                                    geometry: exterior,
                                    holes,
                                    r#type: Some("Polygon".to_string()),
                                    height: Some(height_value),
                                    layer: Some(vt_dataset.source_layer.clone()),
                                    label: vt_dataset.label.clone(),
                                    tags: None,
                                    properties: Some(
                                        serde_json::to_value(&feature.properties)
                                            .unwrap_or(serde_json::Value::Null),
                                    ),
                                });
                                current_holes.clear();
                            }
                            
                            // Start new polygon with this exterior ring
                            current_exterior = Some(transformed_ring);
                        } else {
                            // This is a hole - add it to current polygon's holes
                            current_holes.push(transformed_ring);
                        }
                    }
                    
                    // Don't forget the last polygon
                    if let Some(exterior) = current_exterior {
                        let holes = if current_holes.is_empty() {
                            None
                        } else {
                            Some(current_holes)
                        };
                        
                        transformed_geometry_parts.push(GeometryData {
                            geometry: exterior,
                            holes,
                            r#type: Some("Polygon".to_string()),
                            height: Some(height_value),
                            layer: Some(vt_dataset.source_layer.clone()),
                            label: vt_dataset.label.clone(),
                            tags: None,
                            properties: Some(
                                serde_json::to_value(&feature.properties)
                                    .unwrap_or(serde_json::Value::Null),
                            ),
                        });
                    }
                }
                _ => {
                    // Skip unhandled geometry types
                }
            }

            let pre_bbox_count = transformed_geometry_parts.len();
            geometry_created += pre_bbox_count;

            // Apply smart bbox filtering with buffers for LineStrings
            let bbox_buffer = 0.001; // ~100m buffer for roads that cross boundaries
            let filtered_parts: Vec<GeometryData> = transformed_geometry_parts
                .into_iter()
                .filter(|geom| {
                    // Determine effective bbox based on geometry type
                    // LineStrings get a buffer to handle thickness/continuity
                    let is_line = geom.r#type.as_ref().map_or(false, |t| t == "LineString");
                    let bbox_buffer = 0.001; // ~100m buffer

                    let check_bbox = if is_line {
                        [
                            min_lng - bbox_buffer,
                            min_lat - bbox_buffer,
                            max_lng + bbox_buffer,
                            max_lat + bbox_buffer,
                        ]
                    } else {
                        [min_lng, min_lat, max_lng, max_lat]
                    };

                    // Use robust intersection check for both Polygons and LineStrings
                    // This correctly handles:
                    // 1. Points inside bbox
                    // 2. Edges crossing bbox
                    // 3. Polygon completely containing bbox (no points inside)
                    // 4. Bbox completely containing polygon
                    crate::bbox_filter::polygon_intersects_bbox(&geom.geometry, &check_bbox)
                })
                .collect();

            let post_bbox_count = filtered_parts.len();
            geometry_filtered_by_bbox += pre_bbox_count - post_bbox_count;

            geometry_data_list.extend(filtered_parts);
        }

        // Tile processing completed
    }

    // Feature extraction completed

    // Apply median height fallback for buildings without height data if enabled
    if vt_dataset.source_layer == "building" && vt_dataset.apply_median_height.unwrap_or(false) {
        apply_median_height_fallback(&mut geometry_data_list);
    }

    // Cache the extracted feature data for later use
    {
        // Build process cache key using the VtDataSet configuration
        let data_key = cache_keys::make_process_vtdataset_key(&input.process_id, &vt_dataset);
        let cached_value_str =
            serde_json::to_string(&geometry_data_list).map_err(|e| JsValue::from(e.to_string()))?;
        ModuleState::with_mut(|state| {
            state.add_process_feature_data(&input.process_id, &data_key, cached_value_str.clone());
        });
    }
    // Return undefined since data is cached at process level
    Ok(JsValue::undefined())
}

// Make this function available to JS
#[wasm_bindgen]
pub async fn fetch_vector_tiles(input_js: JsValue) -> Result<JsValue, JsValue> {
    // Parse input
    let input: VectortileProcessingInput = from_value(input_js)?;


    // Calculate tiles for the requested bounding box
    let tiles = get_tiles_for_bbox(
        input.min_lng,
        input.min_lat,
        input.max_lng,
        input.max_lat,
        input.zoom,
    );

    // Fetching vector tiles

    // Store the fetch results for later processing
    let mut tile_results = Vec::new();

    for tile in tiles {
        let tile_key = format!("{}/{}/{}", tile.z, tile.x, tile.y);

        // Fetch the tile - no caching for now
        let tile_data = {
            // Construct the appropriate URL for vector tiles
            // Using Mapbox Vector Tile format
            let url = format!(
                "https://wms.wheregroup.com/tileserver/tile/world-0-14/{}/{}/{}.pbf",
                tile.z, tile.x, tile.y
            );

            // Fetch the tile if not cached
            let fetch_promise = fetch(&url)?;
            let fetch_result = JsFuture::from(fetch_promise).await?;

            // Process fetch result

            // Extract the raw data array - we need to access the "rawData" property
            // since our JS helper function returns a TileFetchResponse object
            let raw_data_value = js_sys::Reflect::get(&fetch_result, &JsValue::from_str("rawData"))
                .map_err(|_e| JsValue::from_str("Failed to extract rawData from fetch result"))?;

            // Verify we actually got a valid Uint8Array from the rawData property
            if raw_data_value.is_undefined() || raw_data_value.is_null() {
                return Err(JsValue::from_str("rawData property is undefined or null"));
            }

            // Convert to Uint8Array and then to Rust Vec
            let data_array = Uint8Array::new(&raw_data_value);
            let mut data_vec = data_array.to_vec();

            // Data conversion completed

            // Check if the data is gzipped and decompress if necessary
            if data_vec.starts_with(&[0x1f, 0x8b]) {
                // Gzip magic number

                let mut decoder = GzDecoder::new(&data_vec[..]);
                let mut decompressed_data = Vec::new();
                decoder
                    .read_to_end(&mut decompressed_data)
                    .map_err(|_e| JsValue::from_str("Decompression error"))?;
                data_vec = decompressed_data;
            }

            // Debug: Print first few bytes to check data format
            // Data format checked
            // Debug info processed

            // Parse the MVT data using our enhanced Rust MVT parser
            let parsed_mvt = match enhanced_parse_mvt_data(&data_vec, &tile) {
                Ok(parsed) => {
                    // Cache the parsed MVTTile for later feature extraction
                    ModuleState::with_mut(|state| {
                        state.set_parsed_mvt_tile(&tile_key, parsed.clone());
                    });
                    // Successfully parsed MVT data
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
                Err(_e) => None,
            };

            // Processing raw data

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

            tile_data
        };

        // Add to results
        tile_results.push(VectorTileResult {
            tile: tile.clone(),
            data: tile_data.buffer,
        });
    }

    // Store tiles under the process ID for consistency
    // Storing vector tiles under process ID
    ModuleState::with_mut(|state| {
        state.store_process_vector_tiles(
            &input.process_id,
            tile_results
                .clone()
                .into_iter()
                .map(|vtr| TileData {
                    width: 256,
                    height: 256,
                    x: vtr.tile.x,
                    y: vtr.tile.y,
                    z: vtr.tile.z,
                    data: vtr.data.clone(),
                    timestamp: Date::now(),
                    key: format!("{}/{}/{}", vtr.tile.z, vtr.tile.x, vtr.tile.y),
                    buffer: vtr.data.clone(),
                    parsed_layers: None,
                    rust_parsed_mvt: Some(vtr.data.clone()),
                })
                .collect(),
        );
    });

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
    // Processing tile data

    // Print first 32 bytes of the raw data to verify what we're getting
    let _raw_preview = if tile_data.len() >= 32 {
        format!("{:02X?}", &tile_data[0..32])
    } else {
        format!("{:02X?}", &tile_data)
    };

    // Check MVT format
    if tile_data.len() >= 4 {
        // Process MVT header
    }

    // Try to detect protobuf structure directly
    if tile_data.len() > 10 {
        //
        for i in 0..10.min(tile_data.len()) {
            let byte = tile_data[i];
            let field_num = byte >> 3;
            let wire_type = byte & 0x7;

            if field_num > 0 && field_num < 20 && wire_type <= 5 {
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
        //      tile_data.len(), data.len());
    }

    // Starting MVT parsing

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
                // WARNING: No layers found in the decoded MVT data

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
                            // Valid protobuf field detected
                        }
                        offset += 1;
                    }
                }
            }

            // Process each layer in the tile
            for layer in mvt_tile.layers {
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

/// Apply median height fallback for buildings without height data
/// Uses the median of buildings with render_height > 5 and applies it to buildings with render_height < 6
fn apply_median_height_fallback(geometry_list: &mut Vec<GeometryData>) {
    // First pass: collect heights from buildings with render_height > 5
    let mut valid_heights: Vec<f64> = geometry_list
        .iter()
        .filter_map(|geom| geom.height)
        .filter(|&h| h > 5.0) // Only consider buildings with height > 5
        .collect();

    if valid_heights.is_empty() {
        // No buildings with height > 5 found, don't modify any heights
        return;
    }

    // Sort heights to calculate median
    valid_heights.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // Calculate median of all buildings with height > 5
    let median_height = if valid_heights.len() == 1 {
        valid_heights[0]
    } else if valid_heights.len() % 2 == 0 {
        // Even number of elements: average of middle two
        let mid = valid_heights.len() / 2;
        (valid_heights[mid - 1] + valid_heights[mid]) / 2.0
    } else {
        // Odd number of elements: middle element
        valid_heights[valid_heights.len() / 2]
    };

    // Second pass: apply median height to buildings with height < 6
    let mut updated_count = 0;
    for geometry in geometry_list.iter_mut() {
        if let Some(height) = geometry.height {
            if height < 6.0 {
                geometry.height = Some(median_height);
                updated_count += 1;
            }
        } else {
            // Also apply to buildings with no height data
            geometry.height = Some(median_height);
            updated_count += 1;
        }
    }

    if updated_count > 0 {
        // Applied median height to buildings without height data
    }
}
