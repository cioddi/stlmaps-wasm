use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use wasm_bindgen::prelude::*;

// Simple LRU cache implementation
#[allow(dead_code)]
struct LruCache<T> {
    capacity: usize,
    data: HashMap<String, (T, u64)>, // value, timestamp
}

#[allow(dead_code)]
impl<T> LruCache<T> {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            data: HashMap::new(),
        }
    }

    fn get(&mut self, key: &str) -> Option<&T> {
        if let Some((value, timestamp)) = self.data.get_mut(key) {
            // Update timestamp for LRU
            *timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            Some(value)
        } else {
            None
        }
    }

    fn insert(&mut self, key: String, value: T) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Evict oldest entries if at capacity
        if self.data.len() >= self.capacity && !self.data.contains_key(&key) {
            self.evict_oldest();
        }

        self.data.insert(key, (value, timestamp));
    }

    fn evict_oldest(&mut self) {
        if let Some(oldest_key) = self
            .data
            .iter()
            .min_by_key(|(_, (_, timestamp))| *timestamp)
            .map(|(k, _)| k.clone())
        {
            self.data.remove(&oldest_key);
        }
    }

    fn clear(&mut self) {
        self.data.clear();
    }
}

#[allow(dead_code)]
pub struct CacheGroup {
    elevation_grid_cache: LruCache<Vec<Vec<f64>>>,
    vector_tile_cache: LruCache<Vec<u8>>,
    geometry_cache: LruCache<Vec<u8>>, // Pre-processed geometry data
}

#[allow(dead_code)]
impl CacheGroup {
    pub fn new() -> Self {
        Self {
            elevation_grid_cache: LruCache::new(50), // Cache 50 elevation grids
            vector_tile_cache: LruCache::new(200),   // Cache 200 vector tiles
            geometry_cache: LruCache::new(100),      // Cache 100 processed geometries
        }
    }

    pub fn store_elevation_grid(&mut self, key: String, grid: Vec<Vec<f64>>) {
        self.elevation_grid_cache.insert(key, grid);
    }

    pub fn get_elevation_grid(&mut self, key: &str) -> Option<&Vec<Vec<f64>>> {
        self.elevation_grid_cache.get(key)
    }

    pub fn store_vector_tile(&mut self, key: String, tile: Vec<u8>) {
        self.vector_tile_cache.insert(key, tile);
    }

    pub fn get_vector_tile(&mut self, key: &str) -> Option<&Vec<u8>> {
        self.vector_tile_cache.get(key)
    }

    pub fn store_geometry(&mut self, key: String, geometry: Vec<u8>) {
        self.geometry_cache.insert(key, geometry);
    }

    pub fn get_geometry(&mut self, key: &str) -> Option<&Vec<u8>> {
        self.geometry_cache.get(key)
    }

    pub fn clear_all(&mut self) {
        self.elevation_grid_cache.clear();
        self.vector_tile_cache.clear();
        self.geometry_cache.clear();
    }
}

pub struct CacheManager {
    groups: HashMap<String, CacheGroup>,
}

#[allow(dead_code)]
impl CacheManager {
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
        }
    }

    pub fn register_group(&mut self, group_id: &str) {
        self.groups
            .entry(group_id.to_string())
            .or_insert_with(CacheGroup::new);
    }

    pub fn get_group_mut(&mut self, group_id: &str) -> Option<&mut CacheGroup> {
        self.groups.get_mut(group_id)
    }

    pub fn clear_all(&mut self) {
        for group in self.groups.values_mut() {
            group.clear_all();
        }
    }

    pub fn free_group(&mut self, group_id: &str) {
        self.groups.remove(group_id);
    }
}

lazy_static! {
    static ref GLOBAL_CACHE_MANAGER: Mutex<CacheManager> = Mutex::new(CacheManager::new());
}

#[wasm_bindgen]
pub fn register_group_js(group_id: &str) -> Result<(), JsValue> {
    let mut mgr = GLOBAL_CACHE_MANAGER
        .lock()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    mgr.register_group(group_id);
    Ok(())
}

#[wasm_bindgen]
pub fn free_group_js(group_id: &str) -> Result<(), JsValue> {
    let mut mgr = GLOBAL_CACHE_MANAGER
        .lock()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    mgr.free_group(group_id);
    Ok(())
}

#[wasm_bindgen]
pub fn free_cache_by_id(group_id: &str) -> Result<(), JsValue> {
    let mut mgr = GLOBAL_CACHE_MANAGER
        .lock()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    mgr.free_group(group_id);
    Ok(())
}
