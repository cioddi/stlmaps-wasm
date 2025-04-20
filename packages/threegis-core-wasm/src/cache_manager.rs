use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use std::sync::Mutex;
use lazy_static::lazy_static;

pub struct CacheGroup {
    elevation_grid_cache: HashMap<String, Vec<Vec<f64>>>,
    vector_tile_cache: HashMap<String, Vec<u8>>,
}

impl CacheGroup {
    pub fn new() -> Self {
        Self {
            elevation_grid_cache: HashMap::new(),
            vector_tile_cache: HashMap::new(),
        }
    }

    pub fn store_elevation_grid(&mut self, key: String, grid: Vec<Vec<f64>>) {
        self.elevation_grid_cache.insert(key, grid);
    }

    pub fn get_elevation_grid(&self, key: &str) -> Option<&Vec<Vec<f64>>> {
        self.elevation_grid_cache.get(key)
    }

    pub fn store_vector_tile(&mut self, key: String, tile: Vec<u8>) {
        self.vector_tile_cache.insert(key, tile);
    }

    pub fn get_vector_tile(&self, key: &str) -> Option<&Vec<u8>> {
        self.vector_tile_cache.get(key)
    }
}

pub struct CacheManager {
    groups: HashMap<String, CacheGroup>,
}

impl CacheManager {
    pub fn new() -> Self {
        Self { groups: HashMap::new() }
    }

    pub fn register_group(&mut self, group_id: &str) {
        self.groups.entry(group_id.to_string()).or_insert_with(CacheGroup::new);
    }

    pub fn get_group_mut(&mut self, group_id: &str) -> Option<&mut CacheGroup> {
        self.groups.get_mut(group_id)
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
    let mut mgr = GLOBAL_CACHE_MANAGER.lock().map_err(|e| JsValue::from_str(&e.to_string()))?;
    mgr.register_group(group_id);
    Ok(())
}

#[wasm_bindgen]
pub fn free_group_js(group_id: &str) -> Result<(), JsValue> {
    let mut mgr = GLOBAL_CACHE_MANAGER.lock().map_err(|e| JsValue::from_str(&e.to_string()))?;
    mgr.free_group(group_id);
    Ok(())
}

#[wasm_bindgen]
pub fn free_cache_by_id(group_id: &str) -> Result<(), JsValue> {
    let mut mgr = GLOBAL_CACHE_MANAGER.lock().map_err(|e| JsValue::from_str(&e.to_string()))?;
    mgr.free_group(group_id);
    Ok(())
}
