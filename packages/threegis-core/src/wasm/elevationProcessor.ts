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

// This object contains helper functions that will be called from the WASM code
// The functions are registered globally to be accessible from the WASM module
export const initWasmJsHelpers = () => {
  // Create global namespace for our helper functions
  (window as any).wasmJsHelpers = {
    // Function to fetch data from a URL - the name must match what's used in Rust (fetch)
    fetch: async (url: string): Promise<TileData> => {
      console.log(`JS Helper: Fetching from ${url}`);
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.status}`);
        }
        
        // Get the image as blob
        const blob = await response.blob();
        
        // Decode the WebP image to get actual pixel data
        const imageBitmap = await createImageBitmap(blob);
        
        // Create a canvas to extract the pixel data
        const canvas = document.createElement('canvas');
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        
        // Draw the image on the canvas
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');
        ctx.drawImage(imageBitmap, 0, 0);
        
        // Get the decoded pixel data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixelData = new Uint8Array(imageData.data);
        
        console.log(`Decoded pixel data, dimensions ${canvas.width}x${canvas.height}, length: ${pixelData.length} bytes`);
        
        // Sample RGB values from center pixel for debugging
        const centerIdx = ((canvas.height/2) * canvas.width + canvas.width/2) * 4;
        console.log(`Sample RGB at center: R:${pixelData[centerIdx]}, G:${pixelData[centerIdx+1]}, B:${pixelData[centerIdx+2]}`);
        
        // Extract x, y, z from URL if possible
        const urlParts = url.split('/');
        let x = 0, y = 0, z = 0;
        
        // Try to extract tile coordinates from URL
        if (urlParts.length >= 3) {
          const possibleZ = parseInt(urlParts[urlParts.length - 3], 10);
          const possibleX = parseInt(urlParts[urlParts.length - 2], 10);
          const possibleY = parseInt(urlParts[urlParts.length - 1], 10);
          
          if (!isNaN(possibleZ)) z = possibleZ;
          if (!isNaN(possibleX)) x = possibleX;
          if (!isNaN(possibleY)) {
            // The Y coordinate might have a file extension
            const yStr = urlParts[urlParts.length - 1];
            const dotIndex = yStr.indexOf('.');
            if (dotIndex > 0) {
              y = parseInt(yStr.substring(0, dotIndex), 10);
            } else {
              y = possibleY;
            }
          }
        }
        
        return {
          width: canvas.width,
          height: canvas.height,
          x,
          y,
          z,
          pixelData
        };
      } catch (error) {
        console.error(`Error downloading from ${url}:`, error);
        throw error;
      }
    },
    
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
  
  console.log('WebAssembly JS helpers initialized');
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
