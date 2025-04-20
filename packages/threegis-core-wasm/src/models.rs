// This is the models module containing shared data structures
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CacheStats {
    pub raster_tiles_count: usize,
    pub vector_tiles_count: usize,
    pub elevation_grids_count: usize,
    pub max_raster_tiles: usize,
    pub max_vector_tiles: usize,
    pub total_requests: usize,
    pub hit_rate: f64,
}

#[derive(Serialize, Deserialize)]
pub struct RustResponse {
    pub message: String,
    pub value: i32,
}
