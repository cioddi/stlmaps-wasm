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
    // Function to fetch tile data
    fetchTile: async (z: number, x: number, y: number): Promise<TileData> => {
      const url = `https://wms.wheregroup.com/dem_tileserver/raster_dem/${z}/${x}/${y}.webp`;
      console.log(`JS Helper: Fetching tile from ${url}`);
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch tile: ${response.status}`);
        }
        
        // Get the image as blob
        const blob = await response.blob();
        
        // Use image bitmap for processing
        const imageBitmap = await createImageBitmap(blob);
        
        // Create a canvas to read pixel data
        const canvas = document.createElement('canvas');
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');
        
        ctx.drawImage(imageBitmap, 0, 0);
        
        // Get the raw pixel data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        return {
          width: canvas.width,
          height: canvas.height,
          x,
          y,
          z,
          pixelData: new Uint8Array(imageData.data)
        };
      } catch (error) {
        console.error(`Error downloading tile ${z}/${x}/${y}:`, error);
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
  
  // Create the input for the WASM function
  const input: ProcessElevationInput = {
    minLng,
    minLat,
    maxLng,
    maxLat,
    tiles
  };
  
  // Convert to JSON string to pass to WASM
  const inputJson = JSON.stringify(input);
  
  try {
    // Call the WASM function
    const result = await wasmModule.process_elevation_data(inputJson);
    console.log('WASM elevation processing complete', result);
    return result as ElevationProcessingResult;
  } catch (error) {
    console.error('Failed to process elevation data in WASM:', error);
    throw error;
  }
};
