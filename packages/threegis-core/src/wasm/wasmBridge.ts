// A simplified bridge to the WebAssembly module
import * as WasmModule from '@threegis/core-wasm';

/**
 * Initialize the WebAssembly module
 */
export async function initializeWasm(): Promise<void> {
  try {
    if (typeof WasmModule.default === 'function') {
      await WasmModule.default();
      console.log('WASM module initialized');
    }
    
    if (typeof WasmModule.initialize === 'function') {
      WasmModule.initialize();
    }
  } catch (error) {
    console.error('Failed to initialize WASM module:', error);
    throw error;
  }
}

/**
 * Example response from Rust hello function
 */
export interface HelloResponse {
  message: string;
  value: number;
}

/**
 * Call the hello_from_rust function in the WebAssembly module
 */
export function callHelloFromRust(name: string): HelloResponse {
  if (typeof WasmModule.hello_from_rust !== 'function') {
    return {
      message: 'WASM function not available',
      value: -1
    };
  }
  
  try {
    return WasmModule.hello_from_rust(name) as HelloResponse;
  } catch (error) {
    console.error('Error calling WASM function:', error);
    return {
      message: `Error: ${error}`,
      value: -1
    };
  }
}

/**
 * Coordinate transformation result
 */
export interface TransformedCoords {
  lon: number;
  lat: number;
  original_epsg: number;
  target_epsg: number;
}

/**
 * Transform coordinates between different coordinate systems
 */
export function callTransformCoordinate(
  lon: number, 
  lat: number, 
  fromEpsg: number, 
  toEpsg: number
): TransformedCoords {
  if (typeof WasmModule.transform_coordinate !== 'function') {
    return { lon, lat, original_epsg: fromEpsg, target_epsg: toEpsg };
  }
  
  try {
    return WasmModule.transform_coordinate(lon, lat, fromEpsg, toEpsg) as TransformedCoords;
  } catch (error) {
    console.error('Error transforming coordinates:', error);
    return { lon, lat, original_epsg: fromEpsg, target_epsg: toEpsg };
  }
}
