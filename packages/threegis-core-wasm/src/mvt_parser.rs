use geozero::mvt::{Message, Tile};
use geozero::mvt::vector_tile;
use geozero::{GeomProcessor, ToGeo};
use geo_types::{Geometry, Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon};
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, Reflect};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use crate::module_state::{get_module_state, CACHE_SIZE_LIMIT};

/// Represents a parsed MVT feature with geometry and properties
#[derive(Serialize, Deserialize, Clone)]
pub struct ParsedFeature {
    pub geometry_type: String,
    pub geometry: Geometry,
    pub properties: HashMap<String, serde_json::Value>,
}

/// Represents a fully parsed MVT layer with its name and features
#[derive(Serialize, Deserialize, Clone)]
pub struct ParsedLayer {
    pub name: String,
    pub features: Vec<ParsedFeature>,
}

/// Represents a fully parsed MVT tile with all its layers
#[derive(Serialize, Deserialize, Clone)]
pub struct ParsedMvt {
    pub layers: Vec<ParsedLayer>,
}

/// Convert tile coordinates to longitude/latitude
fn convert_tile_coords_to_lnglat(
    x: f64, 
    y: f64, 
    extent: u32, 
    zoom_level: u8, 
    tile_x: u32, 
    tile_y: u32
) -> (f64, f64) {
    // Calculate the number of tiles at this zoom level
    let n = 2_u32.pow(zoom_level as u32) as f64;
    
    // Convert tile coordinates to normalized coordinates (0-1)
    let normalized_x = (tile_x as f64 + x / extent as f64) / n;
    let normalized_y = (tile_y as f64 + y / extent as f64) / n;
    
    // Convert to longitude/latitude
    let lng = normalized_x * 360.0 - 180.0;
    let lat = (180.0 / std::f64::consts::PI) * 
              ((1.0 - 2.0 * normalized_y).asinh());
    
    (lng, lat)
}

/// Parse MVT data from a buffer
#[wasm_bindgen(js_name = parseMvtData)]
pub fn parse_mvt_data(
    data: &[u8], 
    zoom_level: u8, 
    tile_x: u32, 
    tile_y: u32, 
    key: &str
) -> Result<(), JsValue> {
    // Parse MVT tile
    let tile = match Tile::decode(data) {
        Ok(tile) => tile,
        Err(e) => return Err(JsValue::from_str(&format!("Failed to decode MVT tile: {}", e))),
    };
    
    // Create parsed MVT structure
    let mut parsed_mvt = ParsedMvt { layers: Vec::new() };
    
    // Process each layer in the tile
    for layer in &tile.layers {
        let extent = layer.extent;
        let mut parsed_layer = ParsedLayer {
            name: layer.name.clone(),
            features: Vec::new(),
        };
        
        // Process each feature in the layer
        for feature in &layer.features {
            // Get geometry type
            let geometry_type = match feature.r#type {
                vector_tile::Tile_GeomType::POINT => "Point",
                vector_tile::Tile_GeomType::LINESTRING => "LineString",
                vector_tile::Tile_GeomType::POLYGON => "Polygon",
                _ => "Unknown",
            };
            
            // Convert geometry to geo-types Geometry
            let geo_geometry = match feature.to_geo() {
                Ok(geo) => geo,
                Err(e) => {
                    // Skip features with invalid geometry
                    continue;
                }
            };
            
            // Convert to transformed geometry (longitude/latitude)
            let transformed_geometry = transform_geometry(
                &geo_geometry, extent, zoom_level, tile_x, tile_y
            );
            
            // Parse properties
            let mut properties = HashMap::new();
            for (key_index, value_index) in feature.tags.chunks_exact(2).map(|chunk| (chunk[0], chunk[1])) {
                if let (Some(key), Some(value)) = (
                    layer.keys.get(key_index as usize),
                    layer.values.get(value_index as usize)
                ) {
                    // Convert value to serde_json::Value
                    let json_value = match value {
                        vector_tile::Tile_Value { string_value: Some(s), .. } => 
                            serde_json::Value::String(s.clone()),
                        vector_tile::Tile_Value { int_value: Some(i), .. } => 
                            serde_json::Value::Number(serde_json::Number::from(*i)),
                        vector_tile::Tile_Value { uint_value: Some(i), .. } => 
                            serde_json::Value::Number(serde_json::Number::from(*i)),
                        vector_tile::Tile_Value { float_value: Some(f), .. } => {
                            if let Some(n) = serde_json::Number::from_f64(*f as f64) {
                                serde_json::Value::Number(n)
                            } else {
                                serde_json::Value::Null
                            }
                        },
                        vector_tile::Tile_Value { double_value: Some(d), .. } => {
                            if let Some(n) = serde_json::Number::from_f64(*d) {
                                serde_json::Value::Number(n)
                            } else {
                                serde_json::Value::Null
                            }
                        },
                        vector_tile::Tile_Value { bool_value: Some(b), .. } => 
                            serde_json::Value::Bool(*b),
                        _ => serde_json::Value::Null,
                    };
                    
                    properties.insert(key.clone(), json_value);
                }
            }
            
            // Add parsed feature to layer
            parsed_layer.features.push(ParsedFeature {
                geometry_type: geometry_type.to_string(),
                geometry: transformed_geometry,
                properties,
            });
        }
        
        // Add parsed layer to MVT
        parsed_mvt.layers.push(parsed_layer);
    }
    
    // Store parsed MVT in module state
    let mut state = get_module_state();
    
    // Check if we need to clear space in the cache
    if state.mvt_cache.len() >= CACHE_SIZE_LIMIT {
        // Remove oldest entry
        if let Some(oldest_key) = state.mvt_cache_keys.pop_front() {
            state.mvt_cache.remove(&oldest_key);
        }
    }
    
    // Add new entry to cache
    state.mvt_cache.insert(key.to_string(), parsed_mvt);
    state.mvt_cache_keys.push_back(key.to_string());
    
    Ok(())
}

/// Transform a geometry from tile coordinates to longitude/latitude
fn transform_geometry(
    geom: &Geometry, 
    extent: u32, 
    zoom_level: u8, 
    tile_x: u32, 
    tile_y: u32
) -> Geometry {
    match geom {
        Geometry::Point(point) => {
            let (lng, lat) = convert_tile_coords_to_lnglat(
                point.x(), point.y(), extent, zoom_level, tile_x, tile_y
            );
            Geometry::Point(Point::new(lng, lat))
        },
        Geometry::LineString(line) => {
            let coords: Vec<_> = line.coords()
                .map(|c| {
                    let (lng, lat) = convert_tile_coords_to_lnglat(
                        c.x, c.y, extent, zoom_level, tile_x, tile_y
                    );
                    (lng, lat).into()
                })
                .collect();
            Geometry::LineString(LineString::new(coords))
        },
        Geometry::Polygon(poly) => {
            let exterior: Vec<_> = poly.exterior().coords()
                .map(|c| {
                    let (lng, lat) = convert_tile_coords_to_lnglat(
                        c.x, c.y, extent, zoom_level, tile_x, tile_y
                    );
                    (lng, lat).into()
                })
                .collect();
            
            let interiors: Vec<_> = poly.interiors()
                .map(|ring| {
                    let coords: Vec<_> = ring.coords()
                        .map(|c| {
                            let (lng, lat) = convert_tile_coords_to_lnglat(
                                c.x, c.y, extent, zoom_level, tile_x, tile_y
                            );
                            (lng, lat).into()
                        })
                        .collect();
                    LineString::new(coords)
                })
                .collect();
            
            Geometry::Polygon(Polygon::new(LineString::new(exterior), interiors))
        },
        Geometry::MultiPoint(points) => {
            let new_points: Vec<_> = points.iter()
                .map(|point| {
                    let (lng, lat) = convert_tile_coords_to_lnglat(
                        point.x(), point.y(), extent, zoom_level, tile_x, tile_y
                    );
                    Point::new(lng, lat)
                })
                .collect();
            Geometry::MultiPoint(MultiPoint::new(new_points))
        },
        Geometry::MultiLineString(lines) => {
            let new_lines: Vec<_> = lines.iter()
                .map(|line| {
                    let coords: Vec<_> = line.coords()
                        .map(|c| {
                            let (lng, lat) = convert_tile_coords_to_lnglat(
                                c.x, c.y, extent, zoom_level, tile_x, tile_y
                            );
                            (lng, lat).into()
                        })
                        .collect();
                    LineString::new(coords)
                })
                .collect();
            Geometry::MultiLineString(MultiLineString::new(new_lines))
        },
        Geometry::MultiPolygon(polys) => {
            let new_polys: Vec<_> = polys.iter()
                .map(|poly| {
                    let exterior: Vec<_> = poly.exterior().coords()
                        .map(|c| {
                            let (lng, lat) = convert_tile_coords_to_lnglat(
                                c.x, c.y, extent, zoom_level, tile_x, tile_y
                            );
                            (lng, lat).into()
                        })
                        .collect();
                    
                    let interiors: Vec<_> = poly.interiors()
                        .map(|ring| {
                            let coords: Vec<_> = ring.coords()
                                .map(|c| {
                                    let (lng, lat) = convert_tile_coords_to_lnglat(
                                        c.x, c.y, extent, zoom_level, tile_x, tile_y
                                    );
                                    (lng, lat).into()
                                })
                                .collect();
                            LineString::new(coords)
                        })
                        .collect();
                    
                    Polygon::new(LineString::new(exterior), interiors)
                })
                .collect();
            Geometry::MultiPolygon(MultiPolygon::new(new_polys))
        },
        _ => geom.clone(),
    }
}

/// Extract features from MVT data for a specified layer
#[wasm_bindgen(js_name = extractFeaturesFromVectorTiles)]
pub fn extract_features_from_vector_tiles(
    tile_key: &str,
    layer_name: &str
) -> Result<JsValue, JsValue> {
    // Get module state
    let state = get_module_state();
    
    // Check if we have parsed data for this tile
    if let Some(parsed_mvt) = state.mvt_cache.get(tile_key) {
        // Find the requested layer
        if let Some(layer) = parsed_mvt.layers.iter().find(|l| l.name == layer_name) {
            // Create a GeoJSON FeatureCollection
            let features_array = Array::new();
            
            for feature in &layer.features {
                let geojson_feature = Object::new();
                
                // Set type
                Reflect::set(
                    &geojson_feature,
                    &JsValue::from_str("type"),
                    &JsValue::from_str("Feature")
                )?;
                
                // Set geometry
                let geometry_obj = match &feature.geometry {
                    Geometry::Point(point) => {
                        let geom = Object::new();
                        Reflect::set(
                            &geom,
                            &JsValue::from_str("type"),
                            &JsValue::from_str("Point")
                        )?;
                        
                        let coords = Array::new();
                        coords.push(&JsValue::from_f64(point.x()));
                        coords.push(&JsValue::from_f64(point.y()));
                        
                        Reflect::set(
                            &geom,
                            &JsValue::from_str("coordinates"),
                            &coords
                        )?;
                        
                        geom
                    },
                    Geometry::LineString(line) => {
                        let geom = Object::new();
                        Reflect::set(
                            &geom,
                            &JsValue::from_str("type"),
                            &JsValue::from_str("LineString")
                        )?;
                        
                        let coords_array = Array::new();
                        for coord in line.coords() {
                            let point = Array::new();
                            point.push(&JsValue::from_f64(coord.x));
                            point.push(&JsValue::from_f64(coord.y));
                            coords_array.push(&point);
                        }
                        
                        Reflect::set(
                            &geom,
                            &JsValue::from_str("coordinates"),
                            &coords_array
                        )?;
                        
                        geom
                    },
                    Geometry::Polygon(poly) => {
                        let geom = Object::new();
                        Reflect::set(
                            &geom,
                            &JsValue::from_str("type"),
                            &JsValue::from_str("Polygon")
                        )?;
                        
                        let rings_array = Array::new();
                        
                        // Exterior ring
                        let exterior_array = Array::new();
                        for coord in poly.exterior().coords() {
                            let point = Array::new();
                            point.push(&JsValue::from_f64(coord.x));
                            point.push(&JsValue::from_f64(coord.y));
                            exterior_array.push(&point);
                        }
                        rings_array.push(&exterior_array);
                        
                        // Interior rings
                        for interior in poly.interiors() {
                            let interior_array = Array::new();
                            for coord in interior.coords() {
                                let point = Array::new();
                                point.push(&JsValue::from_f64(coord.x));
                                point.push(&JsValue::from_f64(coord.y));
                                interior_array.push(&point);
                            }
                            rings_array.push(&interior_array);
                        }
                        
                        Reflect::set(
                            &geom,
                            &JsValue::from_str("coordinates"),
                            &rings_array
                        )?;
                        
                        geom
                    },
                    // Add support for other geometry types as needed
                    _ => {
                        // Skip unsupported geometry types
                        continue;
                    }
                };
                
                Reflect::set(
                    &geojson_feature,
                    &JsValue::from_str("geometry"),
                    &geometry_obj
                )?;
                
                // Set properties
                let properties_obj = Object::new();
                for (key, value) in &feature.properties {
                    let js_value = match value {
                        serde_json::Value::String(s) => JsValue::from_str(s),
                        serde_json::Value::Number(n) => {
                            if let Some(i) = n.as_i64() {
                                JsValue::from_f64(i as f64)
                            } else if let Some(f) = n.as_f64() {
                                JsValue::from_f64(f)
                            } else {
                                JsValue::NULL
                            }
                        },
                        serde_json::Value::Bool(b) => JsValue::from_bool(*b),
                        serde_json::Value::Null => JsValue::NULL,
                        _ => JsValue::NULL, // Skip arrays and objects for simplicity
                    };
                    
                    Reflect::set(
                        &properties_obj,
                        &JsValue::from_str(key),
                        &js_value
                    )?;
                }
                
                Reflect::set(
                    &geojson_feature,
                    &JsValue::from_str("properties"),
                    &properties_obj
                )?;
                
                features_array.push(&geojson_feature);
            }
            
            // Create the FeatureCollection
            let feature_collection = Object::new();
            Reflect::set(
                &feature_collection,
                &JsValue::from_str("type"),
                &JsValue::from_str("FeatureCollection")
            )?;
            Reflect::set(
                &feature_collection,
                &JsValue::from_str("features"),
                &features_array
            )?;
            
            return Ok(feature_collection.into());
        } else {
            return Err(JsValue::from_str(&format!("Layer '{}' not found in tile", layer_name)));
        }
    } else {
        return Err(JsValue::from_str(&format!("No parsed data found for tile key: {}", tile_key)));
    }
}
