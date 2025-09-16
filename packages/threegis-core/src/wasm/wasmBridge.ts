// filepath: /home/tobi/project/stlmaps/packages/threegis-core/src/wasm/wasmBridge.ts
// A simplified bridge to the WebAssembly module
import wasmInit, * as WasmModule from "@threegis/core-wasm";

// Store the module instance globally once initialized
let wasmModuleInstance: typeof WasmModule | null = null;
let initializationPromise: Promise<void> | null = null;
let isInitialized = false;

/**
 * Initialize the WebAssembly module with enhanced error handling
 */
export async function initializeWasm(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      if (typeof window === "undefined") {
        throw new Error("WASM initialization requires browser environment");
      }

      // Validate WebAssembly support
      if (!WebAssembly) {
        throw new Error("WebAssembly not supported in this environment");
      }

      // Configure WASM memory with validation
      try {
        const memory = new WebAssembly.Memory({
          initial: 2048,
          maximum: 32768
        });
        (window as any).__WASM_MEMORY = memory;

        const table = new WebAssembly.Table({
          initial: 10000,
          maximum: 50000,
          element: "anyfunc"
        });
        (window as any).__WASM_TABLE = table;

        const refTable = new WebAssembly.Table({
          initial: 10000,
          maximum: 50000,
          element: "externref"
        });
        (window as any).__WASM_EXTERNREF_TABLE = refTable;
        (window as any).__wbindgen_externref_table_ptr = refTable;
        (window as any).__wbindgen_anyfunc_table_ptr = table;
      } catch (memoryError) {
        throw new Error(`Failed to create WASM memory/tables: ${memoryError}`);
      }

      // Validate module import
      if (!WasmModule || typeof WasmModule !== "object") {
        throw new Error("WASM module failed to import properly");
      }

      // Initialize module - this is required for wasm-bindgen modules
      if (wasmInit && typeof wasmInit === "function") {
        try {
          await wasmInit();
        } catch (initError) {
          throw new Error(`WASM initialization failed: ${initError}`);
        }
      } else {
        throw new Error('WASM initialization function not available');
      }

      // Validate essential functions exist (non-critical for basic initialization)
      const requiredFunctions = [
        'fetch_vector_tiles',
        'extract_features_from_vector_tiles',
        'create_polygon_geometry'
      ];

      const missingFunctions = requiredFunctions.filter(
        fn => !(WasmModule as any)[fn] || typeof (WasmModule as any)[fn] !== 'function'
      );

      if (missingFunctions.length > 0) {
        console.warn(`Some WASM functions not available: ${missingFunctions.join(', ')}`);
        // Don't throw error - allow initialization to continue
      }

      wasmModuleInstance = WasmModule;
      (window as any).wasmDebugInstance = wasmModuleInstance;

      // Initialize WASM helper functions after module is loaded
      const { initWasmFetchHelpers } = await import('./wasmFetchUtils');
      initWasmFetchHelpers();

      isInitialized = true;

    } catch (error) {
      initializationPromise = null;
      throw new Error(`Failed to initialize WASM module: ${error}`);
    }
  })();

  return initializationPromise;
}

/**
 * Get the initialized WASM module instance with validation
 * @returns The WASM module instance
 */
export function getWasmModule(): typeof WasmModule {
  if (!isInitialized || !wasmModuleInstance) {
    throw new Error("WASM module not initialized. Call initializeWasm() first.");
  }
  return wasmModuleInstance;
}

/**
 * Check if WASM module is initialized
 * @returns True if the module is ready for use
 */
export function isWasmReady(): boolean {
  return isInitialized && wasmModuleInstance !== null;
}

/**
 * Safely call a WASM function with error handling
 * @param functionName Name of the WASM function to call
 * @param args Arguments to pass to the function
 * @returns Function result or throws enhanced error
 */
export async function safeWasmCall<T>(
  functionName: string,
  ...args: any[]
): Promise<T> {
  if (!isWasmReady()) {
    throw new Error(`WASM not ready for function call: ${functionName}`);
  }

  const wasmModule = getWasmModule();
  const fn = (wasmModule as any)[functionName];

  if (!fn || typeof fn !== 'function') {
    throw new Error(`WASM function not found: ${functionName}`);
  }

  try {
    const result = await fn(...args);
    return result;
  } catch (error) {
    throw new Error(`WASM function ${functionName} failed: ${error}`);
  }
}

/**
 * Example response from Rust hello function
 */
export interface HelloResponse {
  message: string;
  value: number;
}
