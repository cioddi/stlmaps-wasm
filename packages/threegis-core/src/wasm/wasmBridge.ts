// filepath: /home/tobi/project/stlmaps/packages/threegis-core/src/wasm/wasmBridge.ts
// A simplified bridge to the WebAssembly module
import * as WasmModule from '@threegis/core-wasm';

// Store the module instance globally once initialized
let wasmModuleInstance: typeof WasmModule | null = null;

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
    
    // Check for module initialization
    // First check if we have the expected initialize function
    if (WasmModule.initialize && typeof WasmModule.initialize === 'function') {
      try {
        WasmModule.initialize();
        console.log('WASM module explicitly initialized via initialize() function');
      } catch (initError) {
        console.warn('Error during explicit WASM initialization:', initError);
        // Continue anyway, as the module might be usable without initialization
      }
    } else {
      console.log('WASM module has no initialize function, using auto-initialization');
    }
    
    // Store the module instance for later use
    wasmModuleInstance = WasmModule;
    
    console.log('WASM module initialized successfully');
  } catch (error) {
    console.error('Failed to initialize WASM module:', error);
    throw error;
  }
}

/**
 * Get the initialized WASM module instance
 * @returns The WASM module instance
 */
export function getWasmModule(): typeof WasmModule {
  if (!wasmModuleInstance) {
    throw new Error('WASM module not initialized. Call initializeWasm() first.');
  }
  return wasmModuleInstance;
}

/**
 * Example response from Rust hello function
 */
export interface HelloResponse {
  message: string;
  value: number;
}
