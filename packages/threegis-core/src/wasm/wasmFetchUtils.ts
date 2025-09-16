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
 * Configuration for fetch retry behavior
 */
export interface FetchConfig {
  maxRetries: number;
  timeoutMs: number;
  backoffMs: number;
  validateContent: boolean;
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
 * Create a fetch function with timeout support
 */
const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await window.fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

/**
 * Robust fetch implementation with retry logic and validation
 */
const robustFetch = async (url: string, config: FetchConfig): Promise<TileFetchResponse> => {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, config.timeoutMs);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const contentLength = response.headers.get('content-length');
      const tileCoords = extractTileCoordinatesFromUrl(url);

      if (config.validateContent && contentLength === '0') {
        throw new Error('Empty response received');
      }

      if (contentType.includes('image/')) {
        const blob = await response.blob();

        if (config.validateContent && blob.size === 0) {
          throw new Error('Empty image blob received');
        }

        const imageBitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');
        ctx.drawImage(imageBitmap, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixelData = new Uint8Array(imageData.data);

        if (config.validateContent && pixelData.length === 0) {
          throw new Error('Empty pixel data extracted');
        }

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
        const arrayBuffer = await response.arrayBuffer();
        const rawData = new Uint8Array(arrayBuffer);

        if (config.validateContent && rawData.length === 0) {
          throw new Error('Empty binary data received');
        }

        return {
          width: 256,
          height: 256,
          x: tileCoords.x,
          y: tileCoords.y,
          z: tileCoords.z,
          rawData,
          mimeType: contentType
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        const delay = config.backoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  if (lastError!.message.includes('CORS') || lastError!.message.includes('network')) {
    throw new Error(`Network error after ${config.maxRetries + 1} attempts: ${lastError!.message}`);
  }

  throw new Error(`Fetch failed after ${config.maxRetries + 1} attempts: ${lastError!.message}`);
};

/**
 * Initialize the WASM JS helpers for fetch operations
 * This function exposes the fetch function to WASM
 */
export const initWasmFetchHelpers = () => {
  const defaultConfig: FetchConfig = {
    maxRetries: 3,
    timeoutMs: 10000,
    backoffMs: 1000,
    validateContent: true
  };

  (window as any).wasmJsHelpers = {
    ...(window as any).wasmJsHelpers,

    fetch: async (url: string, configOverrides?: Partial<FetchConfig>): Promise<TileFetchResponse> => {
      const config = { ...defaultConfig, ...configOverrides };
      return robustFetch(url, config);
    },

    fetchWithConfig: async (url: string, config: FetchConfig): Promise<TileFetchResponse> => {
      return robustFetch(url, config);
    }
  };
  
};
