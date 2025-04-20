// A simplified bridge to the WebAssembly module
import * as WasmModule from '@threegis/core-wasm';

/**
 * Initialize the WebAssembly module
 */
export async function initializeWasm(): Promise<void> {
  try {
    // Create a global WebAssembly table with generous size
    // This helps prevent the "WebAssembly.Table.grow()" error
    if (typeof window !== 'undefined') {
      const table = new WebAssembly.Table({
        initial: 1000,
        element: 'anyfunc'
      });
      
      // Store it globally to prevent garbage collection
      (window as any).__WASM_TABLE = table;
    }
    
    // For the wasm-bindgen generated modules, we don't need to call default()
    // The module initializes itself when imported
    
    // Check if the module was properly imported
    if (!WasmModule) {
      throw new Error('WASM Module failed to import properly');
    }
    
    // Call the initialize function if it exists
    // Note: Many wasm-bindgen generated modules don't have an initialize function
    if (WasmModule.initialize && typeof WasmModule.initialize === 'function') {
      WasmModule.initialize();
    }
    
    console.log('WASM module initialized');
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
