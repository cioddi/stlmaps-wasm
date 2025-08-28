// Layer domain
export { useLayerStore } from './layers/stores/useLayerStore';
export type { LayerStore, LayerState, LayerActions } from './layers/types/LayerTypes';

// Terrain domain
export { useTerrainStore } from './terrain/stores/useTerrainStore';
export type { TerrainStore, TerrainState, TerrainActions, TerrainSettings, BuildingSettings, ProcessedTerrainData } from './terrain/types/TerrainTypes';

// Processing domain
export { useProcessingStore } from './processing/stores/useProcessingStore';
export type { ProcessingStore, ProcessingState, ProcessingActions } from './processing/types/ProcessingTypes';

// Geometry domain
export { useGeometryStore } from './geometry/stores/useGeometryStore';
export type { GeometryStore, GeometryState, GeometryActions, ConfigHashes } from './geometry/types/GeometryTypes';

// UI domain
export { useUIStore } from './ui/stores/useUIStore';
export type { UIStore, UIState, UIActions, RenderingSettings, DebugSettings, HoverState } from './ui/types/UITypes';