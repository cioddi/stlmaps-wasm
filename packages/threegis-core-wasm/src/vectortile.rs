use flate2::read::GzDecoder;
use geozero::mvt::tile::{GeomType, Value};
use geozero::mvt::{Message, Tile};
use js_sys::{Date, Math, Uint8Array};
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
    pub r#type: String,          // Geometry type (e.g., "Polygon", "LineString")
    pub height: f64,             // Feature height
    pub base_elevation: f64,     // Elevation at geometry position
}

// Input for extracting features from vector tiles
#[derive(Serialize, Deserialize)]
pub struct ExtractFeaturesInput {
    pub bbox: Vec<f64>,                   // [minLng, minLat, maxLng, maxLat]
    pub vtDataSet: VtDataSet,             // Configuration for the layer
    pub bboxKey: String,                  // Cache key for vector tiles
    pub elevationBBoxKey: Option<String>, // ID to find cached elevation data
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
fn evaluate_filter(_filter: &serde_json::Value, _feature: &Feature) -> bool {
    // This is a simplified filter evaluation - you may need to implement a more comprehensive
    // filter system based on your application's needs

    // For now, just assume true if there's no filter
    // In a real implementation, you'd parse and evaluate the filter expression
    true // TODO: Implement actual filter logic if needed
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
    let vt_dataset = &input.vtDataSet;

    // Compute consistent bbox_key using central function
    let bbox_key = cache_keys::make_bbox_key(min_lng, min_lat, max_lng, max_lat);

    // Log if input.bbox_key was in a non-standard format
    if input.bboxKey != bbox_key {
        console_log!(
            "Converting non-standard key to standard bbox_key format: {} -> {}",
            input.bboxKey,
            bbox_key
        );
    }

    console_log!(
        "Starting feature extraction for layer '{}' using cache key: {}",
        vt_dataset.sourceLayer,
        bbox_key
    );

    // Retrieve module state (mutable for parsed tile cache)
    let module_state_mutex = ModuleState::get_instance();
    let mut module_state = module_state_mutex.lock().unwrap();

    // Try to access cached vector tile data using the provided bbox_key
    console_log!("🔍 DEBUG: Looking for vector tiles with key: {}", bbox_key);
    let vector_tiles_data = match module_state.get_vector_tiles(&bbox_key) {
        Some(tiles) => {
            console_log!(
                "🔍 DEBUG: Found {} cached vector tiles with key: {}",
                tiles.len(),
                bbox_key
            );
            tiles
        }
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
    let elevation_data = match &input.elevationBBoxKey {
        Some(key) => {
            console_log!("Using elevationBBoxKey for elevation data lookup: {}", key);
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
                console_log!("  Tile {}/{}/{} has no raw MVT data (rust_parsed_mvt is None), using buffer field.", tile_z, tile_x, tile_y);
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
        console_log!("🔍 Checking parsed tile cache with key: {}", cache_key);
        let parsed_tile = if let Some(cached) = module_state.get_parsed_mvt_tile(&cache_key) {
            console_log!("  ♻️ Using cached parsed tile for {}", cache_key);
            cached
        } else {
            console_log!("  ❌ no parsed mvt tile found for {}", cache_key);
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
        let layer = match parsed_tile.layers.get(&vt_dataset.sourceLayer) {
            Some(layer_data) => {
                console_log!(
                    "  Found layer '{}' with {} features in tile {}/{}/{}",
                    vt_dataset.sourceLayer,
                    layer_data.features.len(),
                    tile_z,
                    tile_x,
                    tile_y
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

        // Process each feature in the layer
        for feature in &layer.features {
            feature_count += 1;
            // console_log!("  Processing feature ID {:?} (Type: {})...", feature.id, feature.geometry_type);

            // --- Filtering (Example - needs refinement based on actual filter structure) ---
            // Filter by subclass if specified (Example property: "class" or "subclass")
            // if let Some(ref sub_classes) = vt_dataset.subClass {
            //     if let Some(feature_class) = feature.properties.get("class").or_else(|| feature.properties.get("subclass")) {
            //         if let Some(class_str) = feature_class.as_str() {
            //             if !sub_classes.iter().any(|s| s == class_str) {
            //                  console_log!("    Skipping feature: subclass '{}' not in {:?}", class_str, sub_classes);
            //                 continue; // Skip if subclass doesn't match
            //             }
            //         }
            //     } else {
            //          console_log!("    Skipping feature: subclass filter active, but feature has no subclass property.");
            //         continue; // Skip if filter requires subclass but feature doesn't have it
            //     }
            // }

            // Apply filter expression if provided (Requires evaluate_filter implementation)
            // if let Some(ref filter) = vt_dataset.filter {
            //     // Need to convert MvtFeature properties to a structure evaluate_filter expects, if necessary
            //     // Or adapt evaluate_filter to work with HashMap<String, serde_json::Value>
            //     // let filterable_feature = Feature { /* ... construct if needed ... */ };
            //     console_log!("    Applying filter: {:?}", filter);
            //     // if !evaluate_filter(filter, &filterable_feature) { // Assuming evaluate_filter is adapted
            //     //     console_log!("    Skipping feature: Filter evaluated to false.");
            //     //     continue;
            //     // }
            // }

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
            // console_log!("    [vectortile] Feature ID {}: extracted height = {}", feature.id.unwrap_or(0), height);

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
                            // console_log!("    Transformed Polygon ring with {} vertices.", transformed_ring.len());
                            let base_elevation = calculate_base_elevation(
                                &transformed_ring,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                elev_min_lng,
                                elev_min_lat,
                                elev_max_lng,
                                elev_max_lat, // Use elevation bbox
                            );
                            // console_log!("    Calculated base elevation: {}", base_elevation);

                            transformed_geometry_parts.push(GeometryData {
                                geometry: transformed_ring, // Store transformed coords
                                r#type: "Polygon".to_string(),
                                height,
                                base_elevation,
                            });
                        }
                    }
                }
                "LineString" => {
                    // feature.geometry structure: Vec<Vec<Vec<f64>>> where outer is lines, inner is points [px, py]
                    // Assuming single line per feature for simplicity here based on structure
                    if let Some(line_tile_coords) = feature.geometry.get(0) {
                        let mut transformed_line: Vec<Vec<f64>> =
                            Vec::with_capacity(line_tile_coords.len());
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
                        if !transformed_line.is_empty() {
                            // console_log!("    Transformed LineString with {} vertices.", transformed_line.len());
                            let base_elevation = calculate_base_elevation(
                                &transformed_line,
                                &elevation_grid,
                                grid_size.0 as usize,
                                grid_size.1 as usize,
                                elev_min_lng,
                                elev_min_lat,
                                elev_max_lng,
                                elev_max_lat,
                            );
                            // console_log!("    Calculated base elevation: {}", base_elevation);

                            transformed_geometry_parts.push(GeometryData {
                                geometry: transformed_line,
                                r#type: "LineString".to_string(),
                                height, // Height might not be typical for lines, but include if present
                                base_elevation,
                            });
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
                                // console_log!("    Transformed Point: {:?}", transformed_point);

                                let base_elevation = calculate_base_elevation(
                                    &vec![transformed_point.clone()], // Pass as vec of points
                                    &elevation_grid,
                                    grid_size.0 as usize,
                                    grid_size.1 as usize,
                                    elev_min_lng,
                                    elev_min_lat,
                                    elev_max_lng,
                                    elev_max_lat,
                                );
                                // console_log!("    Calculated base elevation: {}", base_elevation);

                                transformed_geometry_parts.push(GeometryData {
                                    geometry: vec![transformed_point], // Store as [[lng, lat]]
                                    r#type: "Point".to_string(),
                                    height, // Height might represent magnitude for points
                                    base_elevation,
                                });
                            }
                        }
                    }
                }
                _ => {
                    // console_log!("  Skipping unhandled geometry type: {}", geometry_type_str);
                }
            }
            // Filter out any geometries whose points are outside the requested bbox
            let filtered_parts: Vec<GeometryData> = transformed_geometry_parts
                .into_iter()
                .filter(|geom| {
                    geom.geometry.iter().any(|coord| {
                        let lon = coord[0];
                        let lat = coord[1];
                        lon >= min_lng && lon <= max_lng && lat >= min_lat && lat <= max_lat
                    })
                })
                .collect();
            geometry_data_list.extend(filtered_parts);
        }
    }

    //console_log!("✅ Finished extraction. Processed {} raw features. Extracted {} geometries from source layer '{}' for key '{}'",
    //    feature_count, geometry_data_list.len(), vt_dataset.sourceLayer, bbox_key);

    // Cache the extracted feature data for later use
    {
        // Build inner cache key using central function
        let filter_str = ""; // TODO: use actual filter string if available
        let inner_key = cache_keys::make_inner_key(&vt_dataset.sourceLayer, filter_str);
        let cached_value_str = serde_json::to_string(&geometry_data_list).map_err(|e| JsValue::from(e.to_string()))?;
        module_state.add_feature_data(&bbox_key, &inner_key, cached_value_str);
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
                // console_log!("Converting non-standard key to standard bbox_key format: {} -> {}", key, standard_bbox_key);
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
                .map_err(|e| {
                    console_log!("❌ Failed to extract rawData from fetch result: {:?}", e);
                    JsValue::from_str("Failed to extract rawData from fetch result")
                })?;

            // Verify we actually got a valid Uint8Array from the rawData property
            if raw_data_value.is_undefined() || raw_data_value.is_null() {
                console_log!("❌ rawData property is undefined or null!");
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
                console_log!("Detected gzipped tile, decompressing...");
                let mut decoder = GzDecoder::new(&data_vec[..]);
                let mut decompressed_data = Vec::new();
                decoder.read_to_end(&mut decompressed_data).map_err(|e| {
                    console_log!("Failed to decompress gzipped tile: {}", e);
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
            console_log!("🔍 DEBUG: Total tile data size: {} bytes", data_vec.len());

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
                    let layer_count = parsed.layers.len();
                    let layer_names: Vec<String> = parsed.layers.keys().cloned().collect();
                    console_log!("Found {} layers: {:?}", layer_count, layer_names);

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
                Err(e) => {
                    console_log!("Failed to parse MVT data: {}", e);
                    None
                }
            };

            // Debug: Print detailed info about the data being stored
            console_log!(
                "🔍 WASM DEBUG: Raw data length received from JS: {} bytes",
                data_vec.len()
            );

            // Create a hex dump of a small sample of the raw data
            let hex_sample = if data_vec.len() > 32 {
                format!("{:02X?}", &data_vec[0..32])
            } else {
                format!("{:02X?}", &data_vec)
            };
            console_log!("🔍 WASM DEBUG: Raw data sample (hex): {}", hex_sample);

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
    let raw_preview = if tile_data.len() >= 32 {
        format!("{:02X?}", &tile_data[0..32])
    } else {
        format!("{:02X?}", &tile_data)
    };
    console_log!("🔍 RAW DATA PREVIEW: First bytes: {}", raw_preview);

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
        // console_log!("🔍 SCANNING FOR PROTOBUF FIELDS:");
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
    let preview = if data.len() >= 32 {
        format!("{:02X?}", &data[0..32])
    } else {
        format!("{:02X?}", &data)
    };
    console_log!("🔍 DEBUG: MVT data preview: {}", preview);

    // Try to decode the MVT data using the Message trait implementation
    match Tile::decode(&*data) {
        Ok(mvt_tile) => {
            console_log!("✅ Successfully decoded MVT data using Tile::decode");
            console_log!("📊 MVT contains {} layers", mvt_tile.layers.len());

            // If no layers found, this could indicate a potential issue with the data format
            if mvt_tile.layers.is_empty() {
                console_log!(
                    "⚠️ WARNING: No layers found in the decoded MVT data. This might indicate:"
                );
                console_log!("   1. The tile is empty (valid but contains no data)");
                console_log!("   2. Data format mismatch (not a standard MVT)");
                console_log!("   3. Decoder issue with this particular tile format");

                // Let's try an alternate approach: attempt to detect the protobuf structure manually
                // This is a basic check to see if the data at least looks like a protobuf message
                if data.len() > 2 {
                    console_log!("🔍 Performing basic protobuf structure check:");
                    let mut offset = 0;
                    while offset < data.len() - 1 {
                        if offset >= 100 {
                            console_log!("   Checked first 100 bytes, stopping manual inspection");
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
                let extent = 4096; // layer.extent seems unavailable in mvt crate API here

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
                        // console_log!("Skipping feature ID {:?} due to empty geometry after decoding.", feature.id);
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
                        // console_log!("Warning: Malformed MoveTo command sequence.");
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
                            // console_log!("Warning: LineTo command encountered without preceding MoveTo.");
                        } else {
                            current_part.push(vec![cursor_x as f64, cursor_y as f64]);
                        }
                    } else {
                        // console_log!("Warning: Malformed LineTo command sequence.");
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
                    // console_log!("Warning: ClosePath encountered without preceding MoveTo/LineTo.");
                }
                // MVT Spec: A ClosePath command is followed by a MoveTo command
                // We don't need to push `current_part` here; the next MoveTo will handle it
            }
            _ => {
                // Unknown command, skip parameters
                // console_log!("Warning: Unknown MVT command ID: {}", cmd_id);
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
