// filepath: /home/tobi/project/stlmaps/packages/threegis-core/src/index.ts
// Export the common types from the elevation processor hook
export type { 
  GridSize, 
  ElevationProcessingResult, 
  Tile 
} from './hooks/useElevationProcessor';

// Export the hooks
export { useWasm } from './hooks/useWasm';
export { useElevationProcessor } from './hooks/useElevationProcessor';

// Export the WASM bridge functions
export { 
  initializeWasm,
  getWasmModule
} from './wasm/wasmBridge';

// Export additional types and functions needed for elevation processing
export { 
  initWasmJsHelpers, 
  processElevationDataWasm 
} from './wasm/elevationProcessor';
