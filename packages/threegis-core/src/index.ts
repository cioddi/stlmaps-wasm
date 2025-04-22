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
export { useVectorTiles } from './hooks/useVectorTiles';

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

// Export vector tile functionality
export {
  fetchVtData,
  parseVectorTile,
  calculateTileCount,
  lngLatToTile,
  getTilesForBbox,
  extractFeaturesFromLayer
} from './sources/VectortileSource';

// Re-export vector tile types
export type {
  FetchVtDataOptions
} from './sources/VectortileSource';
