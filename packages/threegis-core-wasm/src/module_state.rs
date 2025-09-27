use lazy_static::lazy_static;
use parking_lot::ReentrantMutex;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
// Removed JsValue import: storing JSON strings instead

// We need JsValue for caching objects
use crate::vectortile::ParsedMvtTile;

// Import the console_log macro
#[allow(unused_imports)]

// Cache size limit
#[allow(dead_code)]
pub const CACHE_SIZE_LIMIT: usize = 100;

// Define the tile data structure
#[derive(Clone, Serialize, Deserialize)]
pub struct TileData {
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
    pub z: u32,
    pub data: Vec<u8>,
    pub timestamp: f64,  // For cache invalidation
    pub key: String,     // For identification
    pub buffer: Vec<u8>, // Raw tile data
    pub parsed_layers: Option<HashMap<String, Vec<crate::vectortile::Feature>>>, // Legacy parsed vector tile layers
    pub rust_parsed_mvt: Option<Vec<u8>>, // Raw MVT data as parsed by Rust MVT parser
}

// Define a key for the tile cache
#[derive(PartialEq, Eq, Hash, Clone, Debug)]
pub struct TileKey {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

// Vector tile data for a bbox
#[derive(Clone, Serialize, Deserialize)]
pub struct VectorTileData {
    pub bbox_key: String,
    pub timestamp: f64,
    pub tiles: Vec<serde_json::Value>, // Store the tiles with their associated data
}

// Elevation data for a bbox
#[derive(Clone, Serialize, Deserialize)]
pub struct ElevationData {
    pub bbox_key: String,
    pub elevation_grid: Vec<Vec<f64>>,
    pub grid_width: u32,
    pub grid_height: u32,
    pub min_elevation: f64,
    pub max_elevation: f64,
    pub timestamp: f64,
}

// Feature data for a layer
#[derive(Clone, Serialize, Deserialize)]
pub struct FeatureData {
    pub source_layer: String,
    pub bbox_key: String,
    pub features: Vec<crate::geojson_features::GeometryData>,
    pub timestamp: f64,
}

// Module state to keep cached resources
pub struct ModuleState {
    // Cache for raster DEM tiles
    pub raster_tiles: HashMap<TileKey, TileData>,

    // Cache for vector tiles
    pub vector_tiles: HashMap<TileKey, Vec<VectorTileData>>,

    // Cache for processed data like elevation grids
    pub elevation_grids: HashMap<String, Vec<Vec<f64>>>,

    // Process-based cache for vector tile data: process_id -> tiles
    pub process_vector_tiles: HashMap<String, Vec<TileData>>,

    // Cache for parsed vector tiles (ParsedMvtTile) keyed by "z/x/y"
    pub mvt_parsed_tiles: HashMap<String, ParsedMvtTile>,

    // Process-based cache for extracted feature data: process_id -> data_key -> JSON string
    pub process_feature_data: HashMap<String, HashMap<String, String>>,

    // Configuration for cache limits
    pub max_raster_tiles: usize,
    pub max_vector_tiles: usize,

    // Stats
    pub cache_hits: usize,
    pub cache_misses: usize,
}

// Create a global static instance of the module state
lazy_static! {
    static ref MODULE_STATE: ReentrantMutex<RefCell<ModuleState>> =
        ReentrantMutex::new(RefCell::new(ModuleState::new()));
}

impl ModuleState {
    pub fn new() -> Self {
        ModuleState {
            raster_tiles: HashMap::new(),
            vector_tiles: HashMap::new(),
            elevation_grids: HashMap::new(),
            process_vector_tiles: HashMap::new(),
            mvt_parsed_tiles: HashMap::new(),
            process_feature_data: HashMap::new(),
            max_raster_tiles: 100,
            max_vector_tiles: 50,
            cache_hits: 0,
            cache_misses: 0,
        }
    }

    pub fn with_mut<F, R>(f: F) -> R
    where
        F: FnOnce(&mut ModuleState) -> R,
    {
        let guard = MODULE_STATE.lock();
        let mut borrow = guard.borrow_mut();
        f(&mut borrow)
    }

    pub fn with<F, R>(f: F) -> R
    where
        F: FnOnce(&ModuleState) -> R,
    {
        let guard = MODULE_STATE.lock();
        let borrow = guard.borrow();
        f(&borrow)
    }

    // Add a raster tile to the cache
    pub fn add_raster_tile(&mut self, key: TileKey, data: TileData) {
        // If we're at capacity, remove the oldest tile
        if self.raster_tiles.len() >= self.max_raster_tiles && !self.raster_tiles.contains_key(&key)
        {
            let oldest_key = self
                .raster_tiles
                .iter()
                .min_by(|a, b| a.1.timestamp.partial_cmp(&b.1.timestamp).unwrap())
                .map(|(k, _)| k.clone());

            if let Some(oldest) = oldest_key {
                self.raster_tiles.remove(&oldest);
            }
        }

        self.raster_tiles.insert(key, data);
    }

    // Get a raster tile from the cache
    pub fn get_raster_tile(&mut self, key: &TileKey) -> Option<&TileData> {
        if self.raster_tiles.contains_key(key) {
            self.cache_hits += 1;
            self.raster_tiles.get(key)
        } else {
            self.cache_misses += 1;
            None
        }
    }

    // Add a vector tile to the cache
    #[allow(dead_code)] // Public API method for future use
    pub fn add_vector_tile(&mut self, key: TileKey, features: Vec<VectorTileData>) {
        // If we're at capacity, remove a random tile (simple strategy)
        if self.vector_tiles.len() >= self.max_vector_tiles && !self.vector_tiles.contains_key(&key)
        {
            if let Some(first_key) = self.vector_tiles.keys().next().cloned() {
                self.vector_tiles.remove(&first_key);
            }
        }

        self.vector_tiles.insert(key, features);
    }

    // Get a vector tile from the cache
    #[allow(dead_code)] // Public API method for future use
    pub fn get_vector_tile(&mut self, key: &TileKey) -> Option<&Vec<VectorTileData>> {
        if self.vector_tiles.contains_key(key) {
            self.cache_hits += 1;
            self.vector_tiles.get(key)
        } else {
            self.cache_misses += 1;
            None
        }
    }

    // Store a processed elevation grid
    pub fn store_elevation_grid(&mut self, key: String, grid: Vec<Vec<f64>>) {
        self.elevation_grids.insert(key, grid);
    }

    // Get a processed elevation grid
    pub fn get_elevation_grid(&self, key: &str) -> Option<&Vec<Vec<f64>>> {
        self.elevation_grids.get(key)
    }

    // Get a cached parsed vector tile by cache key
    pub fn get_parsed_mvt_tile(&self, key: &str) -> Option<ParsedMvtTile> {
        if let Some(tile) = self.mvt_parsed_tiles.get(key) {
            Some(tile.clone())
        } else {
            None
        }
    }

    // Store a parsed vector tile in cache by cache key
    pub fn set_parsed_mvt_tile(&mut self, key: &str, tile: ParsedMvtTile) {
        self.mvt_parsed_tiles.insert(key.to_string(), tile);
    }

    // Store fetched vector tiles under bbox_key
    #[allow(dead_code)]
    pub fn store_vector_tiles(
        &mut self,
        bbox_key: &str,
        results: &[crate::vectortile::VectorTileResult],
    ) {
        let mut tile_list = Vec::with_capacity(results.len());
        for r in results {
            let key = format!("{}/{}/{}", r.tile.z, r.tile.x, r.tile.y);
            let data_vec = r.data.clone();
            let tile_data = TileData {
                width: 256,
                height: 256,
                x: r.tile.x,
                y: r.tile.y,
                z: r.tile.z,
                data: data_vec.clone(),
                timestamp: js_sys::Date::now(),
                key: key.clone(),
                buffer: data_vec.clone(),
                parsed_layers: None,
                rust_parsed_mvt: Some(data_vec.clone()),
            };
            tile_list.push(tile_data);
        }
        // Legacy method - storing in process cache instead
        self.process_vector_tiles
            .insert(bbox_key.to_string(), tile_list);
    }

    // Retrieve cached vector tiles by bbox_key
    pub fn get_vector_tiles(&self, bbox_key: &str) -> Option<&Vec<TileData>> {
        if let Some(tiles) = self.process_vector_tiles.get(bbox_key) {
            Some(tiles)
        } else {
            None
        }
    }

    // Get cached geometry data for a specific layer and bbox key
    #[allow(dead_code)] // Public API method for future use
    pub fn get_cached_geometry_data(
        &self,
        bbox_key: &str,
        source_layer: &str,
    ) -> Option<Vec<crate::polygon_geometry::GeometryData>> {
        // Get data using the proper bbox_key format used throughout the app

        // Try to get vector tiles for this bbox_key - using the same format as extract_features_from_vector_tiles
        if let Some(vector_tiles) = self.get_vector_tiles(bbox_key) {
            // Extract features from the vector tiles for the specified source layer
            let mut features = Vec::new();

            for tile in vector_tiles {
                // Check if this tile has parsed layers
                if let Some(ref parsed_layers) = tile.parsed_layers {
                    // Check if this tile has the requested source layer
                    if let Some(layer_features) = parsed_layers.get(source_layer) {
                        // Convert vectortile::Feature to polygon_geometry::GeometryData
                        for feature in layer_features {
                            // Extract height property
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
                                .unwrap_or(0.0);

                            // Process based on geometry type
                            if let Ok(coords) = serde_json::from_value::<Vec<Vec<f64>>>(
                                feature.geometry.coordinates.clone(),
                            ) {
                                // This is a simplified conversion - in a real implementation,
                                // you'd handle different geometry types appropriately
                                features.push(crate::polygon_geometry::GeometryData {
                                    geometry: coords,
                                    r#type: Some(feature.geometry.r#type.clone()),
                                    height: Some(height),
                                    layer: Some(source_layer.to_string()),
                                    label: None,
                                    tags: None,
                                    properties: Some(feature.properties.clone()),
                                });
                            }
                        }
                    }
                }
            }

            if !features.is_empty() {
                return Some(features);
            }
        }

        None
    }

    // ========== Process-based cache methods ==========

    /// Store vector tiles for a specific process
    pub fn store_process_vector_tiles(&mut self, process_id: &str, tiles: Vec<TileData>) {
        self.process_vector_tiles
            .insert(process_id.to_string(), tiles);
    }

    /// Retrieve vector tiles for a specific process
    pub fn get_process_vector_tiles(&self, process_id: &str) -> Option<&Vec<TileData>> {
        self.process_vector_tiles.get(process_id)
    }

    /// Store extracted feature data for a specific process
    pub fn add_process_feature_data(&mut self, process_id: &str, data_key: &str, json: String) {
        let entry = self
            .process_feature_data
            .entry(process_id.to_string())
            .or_insert_with(HashMap::new);
        entry.insert(data_key.to_string(), json);
    }

    /// Retrieve feature data for a specific process
    pub fn get_process_feature_data(&self, process_id: &str, data_key: &str) -> Option<JsValue> {
        self.process_feature_data
            .get(process_id)
            .and_then(|inner| inner.get(data_key).cloned())
            .map(|s| JsValue::from_str(&s))
    }

    /// Clear all data for a specific process
    pub fn clear_process_data(&mut self, process_id: &str) {
        self.process_vector_tiles.remove(process_id);
        self.process_feature_data.remove(process_id);
    }

    /// Get list of cached process IDs
    pub fn get_cached_process_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.process_vector_tiles.keys().cloned().collect();
        ids.extend(self.process_feature_data.keys().cloned());
        ids.sort();
        ids.dedup();
        ids
    }

    // ========== Legacy bbox-based methods (deprecated) ==========

    /// Store extracted feature data under a bbox_key and inner_key as JSON string
    #[deprecated(note = "Use add_process_feature_data instead")]
    #[allow(dead_code)]
    pub fn add_feature_data(&mut self, bbox_key: &str, inner_key: &str, json: String) {
        // Redirect to process-based caching
        self.add_process_feature_data(bbox_key, inner_key, json);
    }

    /// Retrieve stored feature data by bbox_key and inner_key
    #[allow(dead_code)]
    pub fn get_feature_data(&self, bbox_key: &str, inner_key: &str) -> Option<JsValue> {
        // Redirect to process-based caching
        self.get_process_feature_data(bbox_key, inner_key)
    }

    /// Clear all feature data entries for a given bbox_key
    #[allow(dead_code)]
    pub fn clear_feature_data_for_bbox(&mut self, bbox_key: &str) {
        // Redirect to process-based clearing
        self.clear_process_data(bbox_key);
    }

    // Get cache statistics
    pub fn get_stats(&self) -> (usize, usize, usize, usize, usize, usize) {
        (
            self.raster_tiles.len(),
            self.vector_tiles.len(),
            self.elevation_grids.len(),
            self.max_raster_tiles,
            self.max_vector_tiles,
            self.cache_hits + self.cache_misses,
        )
    }

    // Clear all caches
    pub fn clear_all_caches(&mut self) {
        self.raster_tiles.clear();
        self.vector_tiles.clear();
        self.elevation_grids.clear();
        self.process_vector_tiles.clear();
        self.mvt_parsed_tiles.clear();
        self.process_feature_data.clear();
        // Reset stats
        self.cache_hits = 0;
        self.cache_misses = 0;
    }
}

// Wrapper functions to interact with the module state from wasm-bindgen exports

// Create a tile key from x, y, z, and source
pub fn create_tile_key(x: u32, y: u32, z: u32) -> TileKey {
    TileKey { x, y, z }
}
