// filepath: /home/tobi/project/stlmaps/packages/threegis-core/src/wasm/elevationProcessor.ts
/**
 * Interface for grid size dimensions
 */
export interface GridSize {
  width: number;
  height: number;
}

/**
 * Interface for tile data from WebAssembly
 */
export interface TileData {
  width: number;
  height: number;
  x: number;
  y: number;
  z: number;
  pixelData: Uint8Array;
}

/**
 * Interface for a tile coordinate
 */
export interface Tile {
  x: number;
  y: number;
  z: number;
}

/**
 * Result of elevation data processing from WebAssembly
 */
export interface ElevationProcessingResult {
  elevationGrid: number[][];
  gridSize: GridSize;
  minElevation: number;
  maxElevation: number;
}

/**
 * Input parameters for processing elevation data
 */
export interface ProcessElevationInput {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  tiles: Tile[];
}

import { initWasmFetchHelpers } from './wasmFetchUtils';

// This object contains helper functions specific to elevation processing
// that will be called from the WASM code
export const initWasmJsHelpers = () => {
  // Initialize the fetch helpers first
  initWasmFetchHelpers();
  
  // Add elevation-specific helpers
  (window as any).wasmJsHelpers = {
    ...(window as any).wasmJsHelpers,
    
    // Function to process image data from a blob
    processImageData: async (data: Uint8Array): Promise<ImageData> => {
      // Create an ImageData object from the raw data
      const width = 256; // Standard tile width
      const height = 256; // Standard tile height
      
      // Convert the Uint8Array to an ImageData object
      return new ImageData(
        new Uint8ClampedArray(data), 
        width, 
        height
      );
    }
  };
  
  console.log('WebAssembly elevation helpers initialized');
};

/**
 * Process elevation data using the WASM module
 * 
 * @param wasmModule The WebAssembly module instance
 * @param minLng Minimum longitude of the bounding box
 * @param minLat Minimum latitude of the bounding box
 * @param maxLng Maximum longitude of the bounding box
 * @param maxLat Maximum latitude of the bounding box
 * @param tiles Array of tile coordinates
 * @returns Promise resolving to the processed elevation data
 */
export const processElevationDataWasm = async (
  wasmModule: any,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  tiles: Tile[]
): Promise<ElevationProcessingResult> => {
  console.log('Processing elevation data with WASM', { minLng, minLat, maxLng, maxLat, tileCount: tiles.length });
  
  // Make sure our JS helper functions are initialized
  if (!(window as any).wasmJsHelpers) {
    initWasmJsHelpers();
  }
  
  // Create the input for the WASM function with snake_case keys to match Rust struct
  const input = {
    min_lng: minLng,
    min_lat: minLat,
    max_lng: maxLng,
    max_lat: maxLat,
    tiles: tiles.map(tile => ({
      x: tile.x,
      y: tile.y,
      z: tile.z
    })),
    grid_width: 200,  // Default tile width
    grid_height: 200  // Default tile height
  };
  
  // Convert to JSON string to pass to WASM
  const inputJson = JSON.stringify(input);
  
  try {
    // Call the WASM function
    const result = await wasmModule.process_elevation_data_async(inputJson);
    console.log('WASM elevation processing complete', result);
    
    // Validate the result structure and provide defaults if needed
    if (!result) {
      throw new Error('WASM returned empty result');
    }
    
    // Ensure gridSize exists with width and height properties using the input values
    const gridSize = result.gridSize || { 
      width: input.grid_width, 
      height: input.grid_height 
    };
    
    // Create a properly structured result with all required fields
    const processedResult: ElevationProcessingResult = {
      elevationGrid: result.elevation_grid || [],
      gridSize: {
        width: gridSize.width || 256,
        height: gridSize.height || 256
      },
      minElevation: typeof result.processed_min_elevation === 'number' ? result.processed_min_elevation : 0,
      maxElevation: typeof result.processed_max_elevation === 'number' ? result.processed_max_elevation : 1000
    };
    
    return processedResult;
  } catch (error) {
    console.error('Failed to process elevation data in WASM:', error);
    throw error;
  }
};
