use std::collections::HashMap;
use std::sync::Mutex;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
// Removed JsValue import: storing JSON strings instead

// We need JsValue for caching objects
use js_sys::Uint8Array;
use crate::vectortile::ParsedMvtTile;

// Import the console_log macro
#[allow(unused_imports)]
use crate::console_log;

// Cache size limit
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
    pub timestamp: f64, // For cache invalidation
    pub key: String,    // For identification
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
    
    // Cache for vector tile data by bbox_key
    pub bbox_vector_tiles: HashMap<String, Vec<TileData>>,
    
    // Cache for parsed vector tiles (ParsedMvtTile) keyed by "z/x/y"
    pub mvt_parsed_tiles: HashMap<String, ParsedMvtTile>,
    
    // Configuration for cache limits
    pub max_raster_tiles: usize,
    pub max_vector_tiles: usize,
    
    // Stats
    pub cache_hits: usize,
    pub cache_misses: usize,
    // Cache for extracted feature data: maps bbox_key -> inner_key -> JSON string
    pub feature_data_cache: HashMap<String, HashMap<String, String>>,
}

// Create a global static instance of the module state
lazy_static! {
    static ref MODULE_STATE: Mutex<ModuleState> = Mutex::new(ModuleState::new());
}

impl ModuleState {
    pub fn new() -> Self {
        ModuleState {
            raster_tiles: HashMap::new(),
            vector_tiles: HashMap::new(),
            elevation_grids: HashMap::new(),
            bbox_vector_tiles: HashMap::new(),
            mvt_parsed_tiles: HashMap::new(),
            max_raster_tiles: 100, // Default limits
            max_vector_tiles: 50,
            cache_hits: 0,
            cache_misses: 0,
            feature_data_cache: HashMap::new(),
        }
    }
    
    // Get the singleton instance
    pub fn get_instance() -> &'static Mutex<Self> {
        &MODULE_STATE
    }

    // Get the global module state
    pub fn global() -> &'static Mutex<ModuleState> {
        &MODULE_STATE
    }
    
    // Add a raster tile to the cache
    pub fn add_raster_tile(&mut self, key: TileKey, data: TileData) {
        // If we're at capacity, remove the oldest tile
        if self.raster_tiles.len() >= self.max_raster_tiles && !self.raster_tiles.contains_key(&key) {
            let oldest_key = self.raster_tiles.iter()
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
    pub fn add_vector_tile(&mut self, key: TileKey, features: Vec<VectorTileData>) {
        // If we're at capacity, remove a random tile (simple strategy)
        if self.vector_tiles.len() >= self.max_vector_tiles && !self.vector_tiles.contains_key(&key) {
            if let Some(first_key) = self.vector_tiles.keys().next().cloned() {
                self.vector_tiles.remove(&first_key);
            }
        }
        
        self.vector_tiles.insert(key, features);
    }
    
    // Get a vector tile from the cache
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
    
    // Get tile data from cache
    pub fn get_tile_data(&self, key: &str) -> Option<TileData> {
        // For now, just return None to make the compiler happy
        // In a real implementation, this would retrieve the tile from a HashMap
        console_log!("Looking for tile with key: {}", key);
        None
    }
    
    // Set tile data in cache
    pub fn set_tile_data(&mut self, key: &str, tile_data: TileData) {
        // In a real implementation, this would store the tile in a HashMap
        console_log!("Storing tile with key: {}", key);
    }
    
    // Get a cached parsed vector tile by cache key
    pub fn get_parsed_mvt_tile(&self, key: &str) -> Option<ParsedMvtTile> {
        console_log!("🔍 CACHE: Checking parsed tile cache for key: {}", key);
        if let Some(tile) = self.mvt_parsed_tiles.get(key) {
            console_log!("✅ CACHE HIT: Parsed tile cache for key: {}", key);
            Some(tile.clone())
        } else {
            console_log!("❌ CACHE MISS: Parsed tile cache for key: {}", key);
            None
        }
    }

    // Store a parsed vector tile in cache by cache key
    pub fn set_parsed_mvt_tile(&mut self, key: &str, tile: ParsedMvtTile) {
        console_log!("🔒 CACHE STORE: Storing parsed tile for key: {}", key);
        self.mvt_parsed_tiles.insert(key.to_string(), tile);
    }

    // Store fetched vector tiles under bbox_key
    pub fn store_vector_tiles(&mut self, bbox_key: &str, results: &[crate::vectortile::VectorTileResult]) {
        console_log!("🔒 CACHE STORE: Storing {} tiles under key {}", results.len(), bbox_key);
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
        self.bbox_vector_tiles.insert(bbox_key.to_string(), tile_list);
    }

    // Retrieve cached vector tiles by bbox_key
    pub fn get_vector_tiles(&self, bbox_key: &str) -> Option<&Vec<TileData>> {
        console_log!("🔍 CACHE: Looking for vector tiles under key {}", bbox_key);
        if let Some(tiles) = self.bbox_vector_tiles.get(bbox_key) {
            console_log!("✅ CACHE HIT: Found {} tiles under key {}", tiles.len(), bbox_key);
            Some(tiles)
        } else {
            console_log!("❌ CACHE MISS: No tiles under key {}", bbox_key);
            None
        }
    }
    
    // Get elevation data for a process ID
    pub fn get_elevation_data(&self, bbox_key: &str) -> Option<ElevationData> {
        // In a real implementation, this would retrieve the elevation data from a HashMap
        console_log!("Looking for elevation data with bbox_key: {}", bbox_key);
        
        // Return dummy elevation data for testing
        Some(ElevationData {
            bbox_key: bbox_key.to_string(),
            elevation_grid: vec![vec![0.0; 2]; 2],
            grid_width: 2,
            grid_height: 2,
            min_elevation: 0.0,
            max_elevation: 0.0,
            timestamp: 0.0,
        })
    }
    
    // Get cached geometry data for a specific layer and bbox key
    pub fn get_cached_geometry_data(&self, bbox_key: &str, source_layer: &str) -> Option<Vec<crate::polygon_geometry::GeometryData>> {
        // Get data using the proper bbox_key format used throughout the app
        console_log!("Looking for cached geometry data for layer: {} with bbox_key: {}", source_layer, bbox_key);
        
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
                            let height = feature.properties.get("height")
                                .and_then(|v| v.as_f64())
                                .or_else(|| feature.properties.get("render_height").and_then(|v| v.as_f64()))
                                .unwrap_or(0.0);
                            
                            // Process based on geometry type
                            if let Ok(coords) = serde_json::from_value::<Vec<Vec<f64>>>(feature.geometry.coordinates.clone()) {
                                // This is a simplified conversion - in a real implementation, 
                                // you'd handle different geometry types appropriately
                                features.push(crate::polygon_geometry::GeometryData {
                                    geometry: coords,
                                    height: Some(height),
                                    layer: Some(source_layer.to_string()),
                                    tags: None,
                                });
                            }
                        }
                    }
                }
            }
            
            if !features.is_empty() {
                console_log!("Found {} cached features for layer: {}", features.len(), source_layer);
                return Some(features);
            }
        }
        
        None
    }
    
    // Add a cached object (for general-purpose caching)
    pub fn add_cached_object(&mut self, key: &str, value: JsValue) {
        // In a real implementation, you would store this in a HashMap<String, JsValue>
        // For now, we'll just log it since we're not implementing the full cache
        console_log!("Caching object with key: {}", key);
    }
    
    // Get a cached object
    pub fn get_cached_object(&self, key: &str) -> Option<JsValue> {
        // In a real implementation, you would retrieve from a HashMap<String, JsValue>
        // For now, we'll just return None
        None
    }
    
    /// Store extracted feature data under a bbox_key and inner_key as JSON string
    pub fn add_feature_data(&mut self, bbox_key: &str, inner_key: &str, json: String) {
        let entry = self.feature_data_cache
            .entry(bbox_key.to_string())
            .or_insert_with(HashMap::new);
        entry.insert(inner_key.to_string(), json);
        console_log!("Stored feature data for bbox_key: {} inner_key: {}", bbox_key, inner_key);
    }
    
    /// Retrieve stored feature data by bbox_key and inner_key
    pub fn get_feature_data(&self, bbox_key: &str, inner_key: &str) -> Option<JsValue> {
        self.feature_data_cache
            .get(bbox_key)
            .and_then(|inner| inner.get(inner_key).cloned())
            .map(|s| JsValue::from_str(&s))
    }
    
    /// Clear all feature data entries for a given bbox_key
    pub fn clear_feature_data_for_bbox(&mut self, bbox_key: &str) {
        if self.feature_data_cache.remove(bbox_key).is_some() {
            console_log!("Cleared feature data cache for bbox_key: {}", bbox_key);
        }
    }
    
    // Get cache statistics
    pub fn get_stats(&self) -> (usize, usize, usize, usize, usize, usize) {
        (
            self.raster_tiles.len(),
            self.vector_tiles.len(),
            self.elevation_grids.len(),
            self.max_raster_tiles,
            self.max_vector_tiles,
            self.cache_hits + self.cache_misses
        )
    }
    
    // Clear all caches
    pub fn clear_all_caches(&mut self) {
        self.raster_tiles.clear();
        self.vector_tiles.clear();
        self.elevation_grids.clear();
        self.bbox_vector_tiles.clear();
        self.feature_data_cache.clear();
        // Reset stats
        self.cache_hits = 0;
        self.cache_misses = 0;
    }
}

// Wrapper functions to interact with the module state from wasm-bindgen exports

// Create a tile key from x, y, z, and source
pub fn create_tile_key(x: u32, y: u32, z: u32) -> TileKey {
    TileKey {
        x,
        y,
        z,
    }
}
