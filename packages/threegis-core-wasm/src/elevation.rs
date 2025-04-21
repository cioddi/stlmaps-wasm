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
    // NEW: process identifier for grouping cache entries
    pub process_id: Option<String>,
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
    
    // Replace previous per-tile pixel loop with grid-based accumulation
	
	console_log!("Starting elevation processing with {} tiles", tile_data_array.len());
	
	// Calculate overall min/max elevation from all tiles (preprocessing)
	let mut min_elevation_found = f64::INFINITY;
	let mut max_elevation_found = f64::NEG_INFINITY;
	for tile in &tile_data_array {
		for py in 0..tile.height {
			for px in 0..tile.width {
				let idx = (py * tile.width + px) * 4;                if idx + 2 >= tile.data.len() as u32 { continue; }
				let elev = process_pixel_to_elevation(                    tile.data[idx as usize],
                    tile.data[(idx + 1) as usize],
                    tile.data[(idx + 2) as usize]
				);
				if elev.is_finite() {
					min_elevation_found = min_elevation_found.min(elev);
					max_elevation_found = max_elevation_found.max(elev);
				}
			}
		}
	}
	console_log!("Elevation range: {} - {}", min_elevation_found, max_elevation_found);
	
	// Initialize accumulation grids matching the output grid size
	let grid_width = grid_size.width as usize;
	let grid_height = grid_size.height as usize;
	let mut elevation_grid: Vec<Vec<f64>> = vec![vec![0.0; grid_width]; grid_height];
	let mut coverage_map: Vec<Vec<f64>> = vec![vec![0.0; grid_width]; grid_height];
	
	// For each tile, accumulate elevation values on the output grid
	for tile in &tile_data_array {
		let z = tile.z;
		// Calculate tile geographic bounds
		let tile_min_lng = tile_x_to_lng(tile.x, z);
		let tile_max_lng = tile_x_to_lng(tile.x + 1, z);
		let tile_max_lat = tile_y_to_lat(tile.y, z);
		let tile_min_lat = tile_y_to_lat(tile.y + 1, z);
		
		// For each grid cell, compute the geographic coordinate
		for gy in 0..grid_height {
			let lat = min_lat + (max_lat - min_lat) * (gy as f64) / ((grid_height - 1) as f64);
			for gx in 0..grid_width {
				let lng = min_lng + (max_lng - min_lng) * (gx as f64) / ((grid_width - 1) as f64);
				// Skip grid points outside the tile’s bounds
				if lng < tile_min_lng || lng > tile_max_lng || lat < tile_min_lat || lat > tile_max_lat {
					continue;
				}
				// Map geographic coordinate to fractional pixel coordinates in tile
				let frac_x = ((lng - tile_min_lng) / (tile_max_lng - tile_min_lng)) * ((tile.width - 1) as f64);
				let frac_y = (1.0 - ((lat - tile_min_lat) / (tile_max_lat - tile_min_lat))) * ((tile.height - 1) as f64);
				let pixel_x = frac_x.floor() as usize;
				let pixel_y = frac_y.floor() as usize;                if pixel_x >= (tile.width - 1) as usize || pixel_y >= (tile.height - 1) as usize { continue; }
				let dx = frac_x - pixel_x as f64;
				let dy = frac_y - pixel_y as f64;
				
				// Sample the four surrounding pixels with bounds checking
                let idx_tl = (pixel_y * (tile.width as usize) + pixel_x) * 4;
                let idx_tr = (pixel_y * (tile.width as usize) + pixel_x + 1) * 4;
                let idx_bl = ((pixel_y + 1) * (tile.width as usize) + pixel_x) * 4;
                let idx_br = ((pixel_y + 1) * (tile.width as usize) + pixel_x + 1) * 4;
				if idx_br + 2 >= tile.data.len() { continue; }
				let elev_tl = process_pixel_to_elevation(tile.data[idx_tl], tile.data[idx_tl + 1], tile.data[idx_tl + 2]);
				let elev_tr = process_pixel_to_elevation(tile.data[idx_tr], tile.data[idx_tr + 1], tile.data[idx_tr + 2]);
				let elev_bl = process_pixel_to_elevation(tile.data[idx_bl], tile.data[idx_bl + 1], tile.data[idx_bl + 2]);
				let elev_br = process_pixel_to_elevation(tile.data[idx_br], tile.data[idx_br + 1], tile.data[idx_br + 2]);
				
				// Perform bilinear interpolation
				let top = elev_tl * (1.0 - dx) + elev_tr * dx;
				let bottom = elev_bl * (1.0 - dx) + elev_br * dx;
				let elevation = top * (1.0 - dy) + bottom * dy;
				
				// Compute edge weighting based on proximity to tile center
				let norm_x = (lng - tile_min_lng) / (tile_max_lng - tile_min_lng);
				let norm_y = (lat - tile_min_lat) / (tile_max_lat - tile_min_lat);
				let dist_from_center_x = (2.0 * norm_x - 1.0).abs();
				let dist_from_center_y = (2.0 * norm_y - 1.0).abs();
				let max_dist = dist_from_center_x.max(dist_from_center_y);
				let edge_weight = 1.0 - (max_dist * max_dist * 0.7);
				
				// Accumulate the weighted elevation and corresponding coverage
				elevation_grid[gy][gx] += elevation * edge_weight;
				coverage_map[gy][gx] += edge_weight;
			}
		}
	}
	
	// Normalize grid cells by the accumulated coverage weight;
	// fill missing data points with the average elevation if needed.
	for gy in 0..grid_height {
		for gx in 0..grid_width {
			if coverage_map[gy][gx] > 0.0 {
				elevation_grid[gy][gx] /= coverage_map[gy][gx];
			} else {
				elevation_grid[gy][gx] = (min_elevation_found + max_elevation_found) / 2.0;
			}
		}
	}
	
	// Compute processed min/max from the normalized grid
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
	if processed_min == f64::INFINITY { processed_min = min_elevation_found; }
	if processed_max == f64::NEG_INFINITY { processed_max = max_elevation_found; }
	if (processed_max - processed_min).abs() < 1.0 {
		let mid = (processed_min + processed_max) / 2.0;
		processed_min = mid - 500.0;
		processed_max = mid + 500.0;
	}
	
	// After computing elevation_grid and before returning the result:
    let bbox_key = format!("{}_{}_{}_{}", min_lng, min_lat, max_lng, max_lat);
    {
        let state = ModuleState::global();
        let mut state = state.lock().unwrap();
        
        console_log!("📦 [Cache] Preparing to store elevation data...");
        console_log!("📦 [Cache] Using bbox_key: {}", bbox_key);
        console_log!("📦 [Cache] Grid dimensions: {}x{}", grid_width, grid_height);
        
        // Store the processed result in cache using the bbox key
        state.store_elevation_grid(bbox_key.clone(), elevation_grid.clone());
        console_log!("📦 [Cache] Stored elevation grid with bbox_key");
        
        // Debug current cache state
        console_log!("📦 [Cache] Current elevation cache size: {} entries", state.elevation_grids.len());
        
        // If a process_id is provided, store the elevation grid with that ID directly
        // This ensures the terrain generation can find it using just the process_id
        if let Some(ref process_id) = input.process_id {
            console_log!("📦 [Cache] Process ID provided: '{}'", process_id);
            
            // Store using the process_id directly as the key
            state.elevation_grids.insert(process_id.clone(), elevation_grid.clone());
            console_log!("📦 [Cache] ✅ Stored elevation grid with direct process_id: '{}'", process_id);
            
            // Also store with a prefixed version of the process_id for redundancy
            let alt_key = format!("process_{}", process_id);
            state.elevation_grids.insert(alt_key.clone(), elevation_grid.clone());
            console_log!("📦 [Cache] ✅ Stored elevation grid with alternate key: '{}'", alt_key);
            
            // Create a mapping from bbox to process_id for debugging
            console_log!("📦 [Cache] ✅ Associated process_id '{}' with bbox_key '{}'", process_id, bbox_key);
            
            // List all keys in cache for debugging 
            let keys: Vec<String> = state.elevation_grids.keys().cloned().collect();
            console_log!("📦 [Cache] All cache keys after storage: {:?}", keys);
        } else {
            console_log!("📦 [Cache] ⚠️ No process_id provided, elevation data only stored with bbox_key");
        }
    }
    
    // Calculate tile cache hit rate as before
    let hit_rate = if cache_hits + cache_misses > 0 {
		cache_hits as f64 / (cache_hits + cache_misses) as f64
	} else {
		0.0
	};
	
	let min_elevation = processed_min; // Use processed min as min_elevation
	let max_elevation = processed_max; // Use processed max as max_elevation
	
	let result = ElevationProcessingResult {
		elevation_grid,
		grid_size,
		min_elevation,
		max_elevation,
		processed_min_elevation: processed_min,
		processed_max_elevation: processed_max,
		cache_hit_rate: hit_rate,
	};
	
	console_log!("Finished elevation processing: processed_min={}, processed_max={}", processed_min, processed_max);
	
	Ok(to_value(&result)?)
}

// These functions have been moved to cache_manager.rs and exposed via lib.rs
