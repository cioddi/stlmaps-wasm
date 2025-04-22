// filepath: /home/tobi/project/stlmaps/packages/threegis-core/src/wasm/wasmFetchUtils.ts
/**
 * Interface for tile coordinate
 */
export interface Tile {
  x: number;
  y: number;
  z: number;
}

/**
 * Generic response for fetch operations that handles both raster and vector tiles
 */
export interface TileFetchResponse {
  width: number;
  height: number;
  x: number;
  y: number;
  z: number;
  pixelData?: Uint8Array;   // For raster tiles
  rawData?: Uint8Array;     // For vector tiles (PBF) or any raw data
  mimeType: string;         // Content type of the response
}

/**
 * Extract tile coordinates from URL path
 * @param url The URL to parse for tile coordinates
 * @returns Object with extracted x, y, z coordinates
 */
const extractTileCoordinatesFromUrl = (url: string): { x: number; y: number; z: number } => {
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
  
  return { x, y, z };
};

/**
 * Initialize the WASM JS helpers for fetch operations
 * This function exposes the fetch function to WASM
 */
export const initWasmFetchHelpers = () => {
  // Create global namespace for our helper functions
  (window as any).wasmJsHelpers = {
    ...(window as any).wasmJsHelpers,
    
    // Function to fetch data from a URL - the name must match what's used in Rust (fetch)
    fetch: async (url: string): Promise<TileFetchResponse> => {
      console.log(`JS Helper: Fetching from ${url}`);
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.status}`);
        }
        
        // Get the content type to determine how to process the response
        const contentType = response.headers.get('content-type') || '';
        const tileCoords = extractTileCoordinatesFromUrl(url);
        
        // Handle different content types appropriately
        if (contentType.includes('image/')) {
          // Handle as raster tile (WebP, PNG, etc.)
          const blob = await response.blob();
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
          
          console.log(`Decoded raster tile, dimensions ${canvas.width}x${canvas.height}, length: ${pixelData.length} bytes`);
          
          return {
            width: canvas.width,
            height: canvas.height,
            x: tileCoords.x,
            y: tileCoords.y,
            z: tileCoords.z,
            pixelData,
            mimeType: contentType
          };
        } else {
          // Handle as vector tile (PBF) or other binary format
          const arrayBuffer = await response.arrayBuffer();
          const rawData = new Uint8Array(arrayBuffer);
          
          console.log(`Fetched vector tile or binary data, length: ${rawData.length} bytes`);
          
          return {
            width: 256, // Standard tile width for vector tiles
            height: 256, // Standard tile height for vector tiles
            x: tileCoords.x,
            y: tileCoords.y,
            z: tileCoords.z,
            rawData,
            mimeType: contentType
          };
        }
      } catch (error) {
        console.error(`Error downloading from ${url}:`, error);
        throw error;
      }
    },
    
    // Additional helper functions can be added here
  };
  
  console.log('WebAssembly fetch helpers initialized');
};
