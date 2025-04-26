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

// Import MVT parser types
use crate::mvt_parser::ParsedMvt;
use std::collections::VecDeque;

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
    
    // Cache for parsed MVT data
    pub mvt_cache: HashMap<String, ParsedMvt>,
    // Cache for parsed vector tiles (ParsedMvtTile) keyed by "z/x/y"
    pub mvt_parsed_tiles: HashMap<String, crate::vectortile::ParsedMvtTile>,
    pub mvt_cache_keys: VecDeque<String>,
    
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
            bbox_vector_tiles: HashMap::new(),
            mvt_cache: HashMap::new(),
            mvt_parsed_tiles: HashMap::new(),
            mvt_cache_keys: VecDeque::new(),
            max_raster_tiles: 100, // Default limits
            max_vector_tiles: 50,
            cache_hits: 0,
            cache_misses: 0,
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
    
    // Store vector tiles for a process ID or bbox_key
    pub fn store_vector_tiles(&mut self, key: &str, tiles: &Vec<crate::vectortile::VectorTileResult>) {
        // Log detailed information about what we're trying to store
        console_log!("🔍 DEBUG: store_vector_tiles called with key: {}", key);
        console_log!("🔍 DEBUG: Storing {} vector tiles", tiles.len());
        
        // Actually store the tiles this time
        let mut tile_data_vec = Vec::new();
        
        for tile_result in tiles {
            // Create TileData for each tile
            let tile_data = TileData {
                width: 256, // Default tile size for vector tiles
                height: 256,
                x: tile_result.tile.x,
                y: tile_result.tile.y,
                z: tile_result.tile.z,
                data: tile_result.data.clone(),
                timestamp: js_sys::Date::now(),
                key: format!("{}/{}/{}", tile_result.tile.z, tile_result.tile.x, tile_result.tile.y),
                buffer: tile_result.data.clone(),
                parsed_layers: None, // Will be parsed on demand
                rust_parsed_mvt: Some(tile_result.data.clone()), // Store the raw MVT data for Rust parsing
            };
            
            // Add to our collection
            tile_data_vec.push(tile_data);
        }
        
        // Store in the HashMap using the provided key
        if !tile_data_vec.is_empty() {
            console_log!("🔍 DEBUG: Actually storing {} vector tiles with key: {}", 
                        tile_data_vec.len(), key);
            self.bbox_vector_tiles.insert(key.to_string(), tile_data_vec);
        }
        
        // In a real implementation, we would also parse the vector tiles and extract layers
        console_log!("🔍 DEBUG: Vector tiles stored successfully with key: {}", key);
    }
    
    // Get vector tiles for a process ID or bbox_key
    pub fn get_vector_tiles(&self, id: &str) -> Option<Vec<TileData>> {
        // Parse the id - if it's a bbox key (contains underscores), use it directly
        // If it's not in standard format, convert it to the standard format
        let lookup_key = if id.contains('_') {
            // This is already a bbox_key in the format min_lng_min_lat_max_lng_max_lat
            id.to_string()
        } else {
            // This is not in the standard format, need to convert it
            // For now, we'll just use the id directly and log the issue
            console_log!("Warning: Using non-standard key instead of standard bbox_key format: {}", id);
            id.to_string()
        };
        
        console_log!("🔍 DEBUG: Looking for vector tiles with key: {}", lookup_key);
        
        // Actually retrieve the tile data from our cache
        match self.bbox_vector_tiles.get(&lookup_key) {
            Some(tiles) => {
                console_log!("🔍 DEBUG: Found {} cached vector tiles with key: {}", 
                            tiles.len(), lookup_key);
                Some(tiles.clone())
            },
            None => {
                console_log!("🔍 DEBUG: No cached vector tiles found with key: {}", lookup_key);
                None
            }
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
