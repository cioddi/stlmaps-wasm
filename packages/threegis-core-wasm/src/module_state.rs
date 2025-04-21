// filepath: /home/tobi/project/stlmaps/packages/threegis-core-wasm/src/module_state.rs
use std::collections::HashMap;
use std::sync::Mutex;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// We need JsValue for caching objects
use js_sys::{Array, Uint8Array};

// Import the console_log macro
#[allow(unused_imports)]
use crate::console_log;

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
    pub process_id: String,
    pub timestamp: f64,
    pub tiles: Vec<serde_json::Value>, // Store the tiles with their associated data
}

// Elevation data for a bbox
#[derive(Clone, Serialize, Deserialize)]
pub struct ElevationData {
    pub process_id: String,
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
    pub process_id: String,
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
    
    // Configuration for cache limits
    pub max_raster_tiles: usize,
    pub max_vector_tiles: usize,
    
    // Stats
    pub cache_hits: usize,
    pub cache_misses: usize,
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
            max_raster_tiles: 100, // Default limits
            max_vector_tiles: 50,
            cache_hits: 0,
            cache_misses: 0,
        }
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
