// filepath: /home/tobi/project/stlmaps/packages/threegis-core-wasm/src/elevation.rs
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use js_sys::{Promise, Uint8Array, Array};
use wasm_bindgen_futures::JsFuture;
use serde_wasm_bindgen::{to_value, from_value};

// External JavaScript functions we'll call from Rust
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    
    // JavaScript function to fetch tile data from URL
    #[wasm_bindgen(js_namespace = wasmJsHelpers)]
    fn fetch_tile(z: u32, x: u32, y: u32) -> Promise;
    
    // JavaScript function to process image data from a blob
    #[wasm_bindgen(js_namespace = wasmJsHelpers)]
    fn process_image_data(data: Uint8Array) -> Promise;
}

// Helper macro for logging
macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

// Data structures required for elevation processing

#[derive(Serialize, Deserialize)]
pub struct Tile {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

#[derive(Serialize, Deserialize)]
pub struct TileData {
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
    pub z: u32,
    pub pixel_data: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
pub struct GridSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize)]
pub struct ElevationProcessingResult {
    pub elevation_grid: Vec<Vec<f64>>,
    pub grid_size: GridSize,
    pub min_elevation: f64,
    pub max_elevation: f64,
}

#[derive(Serialize, Deserialize)]
pub struct ProcessElevationInput {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64,
    pub max_lat: f64,
    pub tiles: Vec<Tile>,
}

// Function to download a single tile
#[wasm_bindgen]
pub async fn download_tile(z: u32, x: u32, y: u32) -> Result<JsValue, JsValue> {
    console_log!("WASM: Downloading tile: {}/{}/{}", z, x, y);
    
    let promise = fetch_tile(z, x, y);
    let result = JsFuture::from(promise).await?;
    
    // Assuming result is already properly structured from JS
    Ok(result)
}

// Process elevation data from multiple tiles
#[wasm_bindgen]
pub async fn process_elevation_data(input_json: &str) -> Result<JsValue, JsValue> {
    console_log!("WASM: Starting elevation data processing");
    
    // Parse the input JSON
    let input: ProcessElevationInput = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;
    
    let min_lng = input.min_lng;
    let min_lat = input.min_lat;
    let max_lng = input.max_lng;
    let max_lat = input.max_lat;
    
    console_log!("WASM: Processing area: [{}, {}] to [{}, {}]", 
                min_lng, min_lat, max_lng, max_lat);
    
    // Define grid size for the final model
    let grid_size = GridSize { 
        width: 200, 
        height: 200 
    };
    
    // Download all tiles in parallel
    let mut tile_data_array: Vec<TileData> = vec![];
    
    for tile in input.tiles.iter() {
        let tile_result = download_tile(tile.z, tile.x, tile.y).await?;
        let tile_data: TileData = from_value(tile_result)
            .map_err(|e| JsValue::from_str(&format!("Failed to convert tile data: {}", e)))?;
        
        tile_data_array.push(tile_data);
    }
    
    // Process the downloaded tiles
    let result = process_tiles(
        &tile_data_array,
        &input.tiles,
        min_lng,
        min_lat,
        max_lng,
        max_lat,
        grid_size.clone()
    );
    
    // Convert result to JS
    let js_result = to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to convert result to JS: {}", e)))?;
    
    Ok(js_result)
}

// Helper function to process all tiles and create elevation grid
fn process_tiles(
    tile_data: &[TileData],
    tiles: &[Tile],
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
    grid_size: GridSize
) -> ElevationProcessingResult {
    console_log!("WASM: Processing {} tiles", tile_data.len());
    
    // Initialize elevation grid to store processed data
    let mut elevation_grid: Vec<Vec<f64>> = vec![vec![0.0; grid_size.width as usize]; grid_size.height as usize];
    let mut coverage_map: Vec<Vec<f64>> = vec![vec![0.0; grid_size.width as usize]; grid_size.height as usize];
    
    // Find min/max elevation across all tiles
    let mut min_elevation = f64::INFINITY;
    let mut max_elevation = f64::NEG_INFINITY;
    
    // First pass: find global min/max elevation
    for tile in tile_data {
        // Iterate through all pixels and decode elevations
        for y in 0..tile.height {
            for x in 0..tile.width {
                let pixel_index = ((y * tile.width) + x) as usize * 4;
                
                if pixel_index + 2 >= tile.pixel_data.len() {
                    continue; // Skip if index out of bounds
                }
                
                let r = tile.pixel_data[pixel_index] as f64;
                let g = tile.pixel_data[pixel_index + 1] as f64;
                let b = tile.pixel_data[pixel_index + 2] as f64;
                
                // Decode elevation using RGB encoding (-10000 + (r*65536 + g*256 + b) * 0.1)
                let elevation = -10000.0 + (r * 65536.0 + g * 256.0 + b) * 0.1;
                
                if elevation.is_finite() && !elevation.is_nan() {
                    min_elevation = min_elevation.min(elevation);
                    max_elevation = max_elevation.max(elevation);
                }
            }
        }
    }
    
    console_log!("WASM: Elevation range: {}m - {}m", min_elevation, max_elevation);
    
    // Second pass: map tile data to the output grid
    for (i, tile) in tile_data.iter().enumerate() {
        let tile_info = &tiles[i];
        let z = tile_info.z;
        let tile_x = tile_info.x;
        let tile_y = tile_info.y;
        
        // Calculate tile bounds in geographic coordinates
        let n = 2.0_f64.powi(z as i32);
        let tile_min_lng = (tile_x as f64 / n) * 360.0 - 180.0;
        let tile_max_lng = ((tile_x + 1) as f64 / n) * 360.0 - 180.0;
        
        // In web mercator, y=0 is at the top (north pole)
        let tile_max_lat = ((std::f64::consts::PI * (1.0 - (2.0 * tile_y as f64) / n))
                        .sinh()
                        .atan() * 180.0) / std::f64::consts::PI;
        let tile_min_lat = ((std::f64::consts::PI * (1.0 - (2.0 * (tile_y + 1) as f64) / n))
                        .sinh()
                        .atan() * 180.0) / std::f64::consts::PI;
        
        // For each point in our output grid
        for y in 0..grid_size.height {
            for x in 0..grid_size.width {
                // Calculate lat/lng for this grid point
                let lng = min_lng + (max_lng - min_lng) * (x as f64 / (grid_size.width - 1) as f64);
                let lat = min_lat + ((max_lat - min_lat) * y as f64) / (grid_size.height - 1) as f64;
                
                // Skip if this point is outside the current tile's bounds
                if lng < tile_min_lng || lng > tile_max_lng || lat < tile_min_lat || lat > tile_max_lat {
                    continue;
                }
                
                // Convert geographic coordinates to pixel coordinates in the tile
                // For longitude: simple linear mapping from tileMinLng-tileMaxLng to 0-(width-1)
                let frac_x = ((lng - tile_min_lng) / (tile_max_lng - tile_min_lng)) * (tile.width - 1) as f64;
                
                // For latitude: account for Mercator projection (y increases downward in the image)
                let frac_y = (1.0 - (lat - tile_min_lat) / (tile_max_lat - tile_min_lat)) * (tile.height - 1) as f64;
                
                // Get integer pixel coordinates
                let pixel_x = frac_x.floor() as usize;
                let pixel_y = frac_y.floor() as usize;
                
                // Constrain to valid pixel coordinates
                if pixel_x >= (tile.width - 1) as usize || pixel_y >= (tile.height - 1) as usize {
                    continue;
                }
                
                // Bilinear interpolation factors
                let dx = frac_x - pixel_x as f64;
                let dy = frac_y - pixel_y as f64;
                
                // Sample the 4 surrounding pixels
                let mut elevations: Vec<f64> = Vec::new();
                let mut has_invalid_elevation = false;
                
                for j in 0..=1 {
                    for i in 0..=1 {
                        let px = pixel_x + i;
                        let py = pixel_y + j;
                        
                        if px < tile.width as usize && py < tile.height as usize {
                            let pixel_index = ((py * tile.width as usize) + px) * 4;
                            
                            if pixel_index + 2 >= tile.pixel_data.len() {
                                has_invalid_elevation = true;
                                break;
                            }
                            
                            let r = tile.pixel_data[pixel_index] as f64;
                            let g = tile.pixel_data[pixel_index + 1] as f64;
                            let b = tile.pixel_data[pixel_index + 2] as f64;
                            
                            // Decode elevation
                            let elevation = -10000.0 + (r * 65536.0 + g * 256.0 + b) * 0.1;
                            
                            if !elevation.is_finite() || elevation.is_nan() {
                                has_invalid_elevation = true;
                                break;
                            }
                            
                            elevations.push(elevation);
                        } else {
                            has_invalid_elevation = true;
                            break;
                        }
                    }
                    if has_invalid_elevation {
                        break;
                    }
                }
                
                if has_invalid_elevation || elevations.len() != 4 {
                    continue;
                }
                
                // Bilinear interpolation
                let top_left = elevations[0];
                let top_right = elevations[1];
                let bottom_left = elevations[2];
                let bottom_right = elevations[3];
                
                let top = top_left * (1.0 - dx) + top_right * dx;
                let bottom = bottom_left * (1.0 - dx) + bottom_right * dx;
                let elevation = top * (1.0 - dy) + bottom * dy;
                
                // Calculate edge distance for weighting
                // This creates a weight that's 1.0 in the center and gradually decreases to 0.3 at the edges
                let dist_from_center_x = ((lng - tile_min_lng) / (tile_max_lng - tile_min_lng) - 0.5).abs() * 2.0;
                let dist_from_center_y = ((lat - tile_min_lat) / (tile_max_lat - tile_min_lat) - 0.5).abs() * 2.0;
                let max_dist = dist_from_center_x.max(dist_from_center_y);
                
                // Smoother falloff at edges - gradient starts earlier
                let edge_weight = 1.0 - max_dist.powi(2) * 0.7;
                
                // Accumulate weighted elevation value
                let y_idx = y as usize;
                let x_idx = x as usize;
                elevation_grid[y_idx][x_idx] += elevation * edge_weight;
                coverage_map[y_idx][x_idx] += edge_weight;
            }
        }
    }
    
    // Normalize by coverage and ensure valid data everywhere
    let mut missing_data_points = 0;
    
    for y in 0..grid_size.height as usize {
        for x in 0..grid_size.width as usize {
            if coverage_map[y][x] > 0.0 {
                elevation_grid[y][x] /= coverage_map[y][x];
            } else {
                missing_data_points += 1;
                
                // For missing data, use nearest valid point or average
                elevation_grid[y][x] = (min_elevation + max_elevation) / 2.0;
            }
        }
    }
    
    console_log!("WASM: Filled {} missing data points", missing_data_points);
    
    // Apply multiple smoothing passes for better results
    let mut smoothed_grid = elevation_grid.clone();
    let smoothing_passes = 2;
    
    for _ in 0..smoothing_passes {
        smoothed_grid = smooth_elevation_grid(&smoothed_grid, &grid_size);
    }
    
    // Return the result
    ElevationProcessingResult {
        elevation_grid: smoothed_grid,
        grid_size,
        min_elevation,
        max_elevation,
    }
}

// Helper function to smooth the elevation grid
fn smooth_elevation_grid(grid: &[Vec<f64>], grid_size: &GridSize) -> Vec<Vec<f64>> {
    let width = grid_size.width as usize;
    let height = grid_size.height as usize;
    let mut result = vec![vec![0.0; width]; height];
    
    // Larger kernel for better smoothing
    let kernel_size = 5;
    let kernel_radius = kernel_size / 2;
    
    // Apply a gaussian smoothing kernel
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0.0;
            let mut total_weight = 0.0;
            
            for ky in -(kernel_radius as isize)..=kernel_radius as isize {
                for kx in -(kernel_radius as isize)..=kernel_radius as isize {
                    let ny = y as isize + ky;
                    let nx = x as isize + kx;
                    
                    if nx >= 0 && nx < width as isize && ny >= 0 && ny < height as isize {
                        // Gaussian weight based on distance
                        let dist = ((kx * kx + ky * ky) as f64).sqrt();
                        // Sigma = kernelRadius/2 for a nice falloff
                        let weight = (-(dist * dist) / (2.0 * (kernel_radius as f64).powi(2))).exp();
                        
                        sum += grid[ny as usize][nx as usize] * weight;
                        total_weight += weight;
                    }
                }
            }
            
            if total_weight > 0.0 {
                result[y][x] = sum / total_weight;
            } else {
                result[y][x] = grid[y][x];
            }
        }
    }
    
    result
}
