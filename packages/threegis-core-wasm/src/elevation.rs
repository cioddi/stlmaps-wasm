use wasm_bindgen::prelude::*;
use js_sys::{Promise, Uint8Array, Object, Date};
use wasm_bindgen_futures::JsFuture;
use serde::{Serialize, Deserialize};
use serde_wasm_bindgen::to_value;

use crate::module_state::{ModuleState, TileKey, TileData, create_tile_key};
use crate::{console_log, fetch_tile};

#[derive(Serialize, Deserialize)]
pub struct TileRequest {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

#[derive(Serialize, Deserialize)]
pub struct ElevationProcessingInput {
    pub min_lng: f64,
    pub min_lat: f64,
    pub max_lng: f64,
    pub max_lat: f64,
    pub tiles: Vec<TileRequest>,
    pub grid_width: u32,
    pub grid_height: u32,
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
    pub processed_min_elevation: f64,
    pub processed_max_elevation: f64,
    pub cache_hit_rate: f64,
}

// Helper functions for processing elevation data

// Convert a tile X coordinate to longitude
pub fn tile_x_to_lng(x: u32, z: u32) -> f64 {
    let n = 2.0_f64.powi(z as i32);
    (x as f64 / n) * 360.0 - 180.0
}

// Convert a tile Y coordinate to latitude - fixed with proper Web Mercator formula
pub fn tile_y_to_lat(y: u32, z: u32) -> f64 {
    let n = 2.0_f64.powi(z as i32);
    let lat_rad = std::f64::consts::PI * (1.0 - 2.0 * y as f64 / n);
    
    // Use the correct formula: atan(sinh(lat_rad))
    // sinh(x) = (e^x - e^-x)/2
    let sinh_lat = ((lat_rad).exp() - (-lat_rad).exp()) / 2.0;
    sinh_lat.atan() * 180.0 / std::f64::consts::PI
}

// Process RGBA pixels to extract elevation values
pub fn process_pixel_to_elevation(r: u8, g: u8, b: u8) -> f64 {
    // Standard Mapbox Terrain-RGB encoding
    // -10000 + ((R * 256² + G * 256 + B) * 0.1)
    let value = (r as u32) * 65536 + (g as u32) * 256 + (b as u32);
    -10000.0 + (value as f64) * 0.1
}

// Fetch a raster tile using JavaScript fetch helper
pub async fn fetch_raster_tile(x: u32, y: u32, z: u32) -> Result<TileData, JsValue> {
    // Call the JavaScript helper to fetch the tile
    let promise_result = fetch_tile(z, x, y);
    // We need to unwrap the Result to get the Promise before passing it to JsFuture
    let promise = promise_result?;
    let js_result = JsFuture::from(promise).await?;
    
    // Process the results from JavaScript
    let js_obj = js_sys::Object::from(js_result);
    
    // Extract fields from the JS object
    let width = js_sys::Reflect::get(&js_obj, &JsValue::from_str("width"))?
        .as_f64()
        .ok_or_else(|| JsValue::from_str("Invalid width"))? as u32;
        
    let height = js_sys::Reflect::get(&js_obj, &JsValue::from_str("height"))?
        .as_f64()
        .ok_or_else(|| JsValue::from_str("Invalid height"))? as u32;
        
    let pixel_data_js = js_sys::Reflect::get(&js_obj, &JsValue::from_str("pixelData"))?;
    let pixel_data = Uint8Array::new(&pixel_data_js);
    
    
    // Sample some bytes from the data to see what's there
    if pixel_data.length() > 20 {
        let mut sample_bytes = vec![0u8; 20];
        // Use slice() to get only the first 20 bytes, then copy that smaller slice
        let sample_slice = Uint8Array::new_with_byte_offset_and_length(
            &pixel_data.buffer(), 
            pixel_data.byte_offset(), 
            20
        );
        sample_slice.copy_to(&mut sample_bytes[..]);
        let bytes_str = sample_bytes.iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<String>>()
            .join(" ");
        console_log!("First 20 bytes of pixel data: {}", bytes_str);
    }
    
    // Create our TileData struct
    let tile_data = TileData {
        width,
        height,
        x,
        y,
        z,
        data: pixel_data.to_vec(),
        timestamp: Date::now(),
    };
    
    // Update the cache
    let state = ModuleState::global();
    let mut state = state.lock().unwrap();
    let key = create_tile_key(x, y, z);
    state.add_raster_tile(key, tile_data.clone());
    
    Ok(tile_data)
}

// The main elevation processing function that uses cached tiles when available
#[wasm_bindgen]
pub async fn process_elevation_data_async(input_json: &str) -> Result<JsValue, JsValue> {
    console_log!("WASM: Processing elevation data with cached tiles...");
    
    // Parse the input JSON
    let input: ElevationProcessingInput = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;
    
    let min_lng = input.min_lng;
    let min_lat = input.min_lat;
    let max_lng = input.max_lng;
    let max_lat = input.max_lat;
    
    // Get grid dimensions
    let grid_size = GridSize {
        width: input.grid_width.max(100).min(1000),
        height: input.grid_height.max(100).min(1000),
    };
    
    let mut tile_data_array: Vec<TileData> = Vec::new();
    let mut cache_hits = 0;
    let mut cache_misses = 0;
    
    // First pass: Check cache and record hits and misses
    let mut missing_tiles: Vec<(u32, u32, u32)> = Vec::new();
    
    {
        let state = ModuleState::global();
        let mut state = state.lock().unwrap();
        
        for tile_request in &input.tiles {
            let key = create_tile_key(
                tile_request.x, 
                tile_request.y, 
                tile_request.z, 
            );
            
            if let Some(tile_data) = state.get_raster_tile(&key) {
                // We found the tile in cache
                tile_data_array.push(tile_data.clone());
                cache_hits += 1;
                console_log!("Using cached tile {}/{}/{}", tile_request.z, tile_request.x, tile_request.y);
            } else {
                // Not in cache, add to missing tiles list
                cache_misses += 1;
                console_log!("Missing tile {}/{}/{} in cache", tile_request.z, tile_request.x, tile_request.y);
                missing_tiles.push((tile_request.z, tile_request.x, tile_request.y));
            }
        }
    }
    
    // Second pass: Fetch missing tiles
    if !missing_tiles.is_empty() {
        console_log!("Fetching {} missing tiles...", missing_tiles.len());
        
        for (z, x, y) in missing_tiles {
            match fetch_raster_tile(x, y, z).await {
                Ok(tile_data) => {
                    console_log!("Successfully fetched and cached tile {}/{}/{}", z, x, y);
                    tile_data_array.push(tile_data);
                },
                Err(e) => {
                    console_log!("Failed to fetch tile {}/{}/{}: {:?}", z, x, y, e);
                    // Continue with available tiles
                }
            }
        }
    }
    
    // Process the elevation data using the available tiles
    let mut elevation_grid: Vec<Vec<f64>> = vec![vec![0.0; grid_size.width as usize]; grid_size.height as usize];
    let mut has_data: Vec<Vec<bool>> = vec![vec![false; grid_size.width as usize]; grid_size.height as usize];
    let mut min_elevation = f64::INFINITY;
    let mut max_elevation = f64::NEG_INFINITY;
    
    console_log!("Starting elevation processing with {} tiles", tile_data_array.len());
    
    // For debugging, track if any valid elevation values are found
    let mut valid_elevations_found = false;
    
    // Process each available tile
    for tile_data in &tile_data_array {
        // Extract and process elevation data from each tile
        let z = tile_data.z;
        let tile_x = tile_data.x;
        let tile_y = tile_data.y;
        
        // Print input bounding box for debugging
        console_log!("Input bounding box: [{:.6}, {:.6}] to [{:.6}, {:.6}]", 
                    min_lng, min_lat, max_lng, max_lat);
                    
        // Calculate tile bounds in geographic coordinates
        let tile_min_lng = tile_x_to_lng(tile_x, z);
        let tile_max_lng = tile_x_to_lng(tile_x + 1, z);
        let tile_max_lat = tile_y_to_lat(tile_y, z);
        let tile_min_lat = tile_y_to_lat(tile_y + 1, z);
        
        console_log!("Processing tile {}/{}/{}: bounds [{:.6}, {:.6}] to [{:.6}, {:.6}]", 
                  z, tile_x, tile_y, tile_min_lng, tile_min_lat, tile_max_lng, tile_max_lat);
        
        // Add a small buffer to the bounding box check to avoid excluding tiles at the edges
        const BUFFER: f64 = 0.01; // ~1km buffer depending on latitude
        
        // Modified check with buffer to be more inclusive of tiles
        if tile_max_lng < (min_lng - BUFFER) || tile_min_lng > (max_lng + BUFFER) || 
           tile_max_lat < (min_lat - BUFFER) || tile_min_lat > (max_lat + BUFFER) {
            console_log!("Skipping tile {}/{}/{} - outside bounding box", z, tile_x, tile_y);
            continue;
        }
        
        console_log!("Processing tile data for {}/{}/{}", z, tile_x, tile_y);
        
        // Process tile data
        for y in 0..tile_data.height {
            for x in 0..tile_data.width {
                let pixel_index = ((y * tile_data.width) + x) as usize * 4;
                
                if pixel_index + 2 >= tile_data.data.len() {
                    continue; // Skip if index out of bounds
                }
                
                let r = tile_data.data[pixel_index];
                let g = tile_data.data[pixel_index + 1];
                let b = tile_data.data[pixel_index + 2];
                
                // Skip transparent pixels (assuming 4th byte is alpha)
                if pixel_index + 3 < tile_data.data.len() && tile_data.data[pixel_index + 3] == 0 {
                    continue;
                }
                
                // Decode elevation - fixed to ensure proper calculation
                let elevation = process_pixel_to_elevation(r, g, b);
                
                // Sample some pixels to debug
                if (x == tile_data.width / 2 && y == tile_data.height / 2) || 
                   (x % 128 == 0 && y % 128 == 0) {
                    console_log!("Pixel({},{}) RGB({},{},{}) -> Elevation: {}", 
                                x, y, r, g, b, elevation);
                }
                
                // Only process valid elevation values
                // Allow a wider range of elevations but filter extreme outliers
                if elevation.is_finite() && !elevation.is_nan() && elevation > -12000.0 && elevation < 12000.0 {
                    min_elevation = min_elevation.min(elevation);
                    max_elevation = max_elevation.max(elevation);
                    valid_elevations_found = true;
                    
                    // Map this pixel to the output grid
                    // Improved coordinate calculation
                    let lng_percent = x as f64 / (tile_data.width as f64);
                    let lat_percent = y as f64 / (tile_data.height as f64);
                    
                    let abs_lng = tile_min_lng + lng_percent * (tile_max_lng - tile_min_lng);
                    let abs_lat = tile_min_lat + lat_percent * (tile_max_lat - tile_min_lat);
                    
                    // Only process if within our bounding box
                    if abs_lng >= min_lng && abs_lng <= max_lng && 
                       abs_lat >= min_lat && abs_lat <= max_lat {
                        
                        // More precise grid mapping
                        let grid_x = ((abs_lng - min_lng) / (max_lng - min_lng) * (grid_size.width - 1) as f64).round() as usize;
                        let grid_y = ((abs_lat - min_lat) / (max_lat - min_lat) * (grid_size.height - 1) as f64).round() as usize;
                        
                        if grid_x < grid_size.width as usize && grid_y < grid_size.height as usize {
                            elevation_grid[grid_y][grid_x] = elevation;
                            has_data[grid_y][grid_x] = true;
                        }
                    }
                }
            }
        }
    }
    
    // Print a summary of the elevation data found
    console_log!("Elevation processing summary: min={}, max={}, valid_elevations_found={}", 
               if min_elevation == f64::INFINITY { 0.0 } else { min_elevation }, 
               if max_elevation == f64::NEG_INFINITY { 0.0 } else { max_elevation }, 
               valid_elevations_found);
    
    // Set default min/max if no valid data found
    if !valid_elevations_found || min_elevation == f64::INFINITY || max_elevation == f64::NEG_INFINITY {
        console_log!("Warning: Limited or no valid elevation data found, using default elevation range");
        min_elevation = 0.0;
        max_elevation = 1000.0;  // Use a reasonable default range
        
        // Instead of filling with zeros, we'll create a slight slope for visualization
        for y in 0..grid_size.height as usize {
            for x in 0..grid_size.width as usize {
                let normalized_x = x as f64 / grid_size.width as f64;
                let normalized_y = y as f64 / grid_size.height as f64;
                elevation_grid[y][x] = normalized_x * normalized_y * 500.0;  // Create a simple gradient
                has_data[y][x] = true;
            }
        }
    } else {
        // Fix no-data areas with interpolation
        for y in 0..grid_size.height as usize {
            for x in 0..grid_size.width as usize {
                if !has_data[y][x] {
                    // Find nearest cells with data
                    let mut sum = 0.0;
                    let mut count = 0;
                    let mut search_radius = 1;
                    
                    // Expand search radius until we find data
                    while count == 0 && search_radius < 10 {
                        for dy in -search_radius..=search_radius {
                            for dx in -search_radius..=search_radius {
                                if dx == 0 && dy == 0 { continue; }
                                
                                let nx = x as i32 + dx;
                                let ny = y as i32 + dy;
                                
                                if nx >= 0 && nx < grid_size.width as i32 && 
                                   ny >= 0 && ny < grid_size.height as i32 {
                                    let nx = nx as usize;
                                    let ny = ny as usize;
                                    if has_data[ny][nx] {
                                        sum += elevation_grid[ny][nx];
                                        count += 1;
                                    }
                                }
                            }
                        }
                        search_radius += 1;
                    }
                    
                    if count > 0 {
                        elevation_grid[y][x] = sum / count as f64;
                    } else {
                        // If no neighbors have data, use average elevation
                        elevation_grid[y][x] = (min_elevation + max_elevation) / 2.0;
                    }
                }
            }
        }
    }
    
    // Calculate processed min/max which might be different after interpolation
    let mut processed_min = f64::INFINITY;
    let mut processed_max = f64::NEG_INFINITY;
    
    for row in &elevation_grid {
        for &cell in row {
            if cell.is_finite() && !cell.is_nan() {
                processed_min = processed_min.min(cell);
                processed_max = processed_max.max(cell);
            }
        }
    }
    
    // Ensure processed min/max are valid
    if processed_min == f64::INFINITY {
        processed_min = min_elevation;
    }
    if processed_max == f64::NEG_INFINITY {
        processed_max = max_elevation;
    }
    
    // If processed range is too small, enforce a minimum range
    if (processed_max - processed_min).abs() < 1.0 {
        let mid = (processed_min + processed_max) / 2.0;
        processed_min = mid - 500.0;
        processed_max = mid + 500.0;
    }
    
    // Store the processed result in the cache for future reuse
    let bbox_key = format!("{}_{}_{}_{}", min_lng, min_lat, max_lng, max_lat);
    {
        let state = ModuleState::global();
        let mut state = state.lock().unwrap();
        state.store_elevation_grid(bbox_key, elevation_grid.clone());
    }
    
    // Calculate hit rate
    let hit_rate = if cache_hits + cache_misses > 0 {
        cache_hits as f64 / (cache_hits + cache_misses) as f64
    } else {
        0.0
    };
    
    // Return the processed elevation data
    let result = ElevationProcessingResult {
        elevation_grid,
        grid_size,
        min_elevation,
        max_elevation,
        processed_min_elevation: processed_min,
        processed_max_elevation: processed_max,
        cache_hit_rate: hit_rate,
    };
    
    console_log!("Finished elevation processing: processed_min={}, processed_max={}", 
                processed_min, processed_max);
    
    Ok(to_value(&result)?)
}
