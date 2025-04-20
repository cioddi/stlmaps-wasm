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
    
    // Modern wasm-bindgen modules often don't have an explicit initialize function
    // Instead, they initialize automatically when imported
    // Only try to call initialize if it actually exists
    if (typeof WasmModule === 'object' && WasmModule !== null) {
      // Check for explicit initialization functions with different possible names
      const initFn = (WasmModule as any).__wbindgen_init || 
                    (WasmModule as any).__wbg_init;
      
      if (initFn && typeof initFn === 'function') {
        try {
          initFn();
          console.log('WASM module explicitly initialized');
        } catch (initError) {
          console.warn('Non-critical: Error during explicit WASM initialization:', initError);
          // Continue anyway, as many WASM modules self-initialize on import
        }
      } else {
        console.log('WASM module has no explicit initialization function (normal for wasm-bindgen modules)');
      }
    }
    
    // Store the module instance for later use
    wasmModuleInstance = WasmModule;
    (window as any).wasmDebugInstance = wasmModuleInstance;
    
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
