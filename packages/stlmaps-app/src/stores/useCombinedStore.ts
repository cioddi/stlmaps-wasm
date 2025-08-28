import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { 
  useLayerStore,
  useTerrainStore,
  useProcessingStore,
  useGeometryStore,
  useUIStore
} from '../domains';
import { toLegacyFormat } from '../domains/layers/utils/LayerCompatibility';
import { performanceMonitor } from '../utils/PerformanceMonitor';

// Combined state type for legacy compatibility
interface CombinedState {
  // Layer state (converted to legacy format)
  vtLayers: ReturnType<typeof toLegacyFormat>[];
  setVtLayers: ReturnType<typeof useLayerStore>['setVtLayers'];
  updateVtLayer: ReturnType<typeof useLayerStore>['updateVtLayer'];
  toggleLayerEnabled: ReturnType<typeof useLayerStore>['toggleLayerEnabled'];
  setLayerColor: ReturnType<typeof useLayerStore>['setLayerColor'];
  setLayerExtrusionDepth: ReturnType<typeof useLayerStore>['setLayerExtrusionDepth'];
  setLayerMinExtrusionDepth: ReturnType<typeof useLayerStore>['setLayerMinExtrusionDepth'];
  setLayerZOffset: ReturnType<typeof useLayerStore>['setLayerZOffset'];
  setLayerBufferSize: ReturnType<typeof useLayerStore>['setLayerBufferSize'];
  toggleLayerUseAdaptiveScaleFactor: ReturnType<typeof useLayerStore>['toggleLayerUseAdaptiveScaleFactor'];
  toggleLayerAlignVerticesToTerrain: ReturnType<typeof useLayerStore>['toggleLayerAlignVerticesToTerrain'];
  setLayerHeightScaleFactor: ReturnType<typeof useLayerStore>['setLayerHeightScaleFactor'];
  setLayerCsgClipping: ReturnType<typeof useLayerStore>['setLayerCsgClipping'];

  // Terrain state
  terrainSettings: ReturnType<typeof useTerrainStore>['terrainSettings'];
  buildingSettings: ReturnType<typeof useTerrainStore>['buildingSettings'];
  processedTerrainData: ReturnType<typeof useTerrainStore>['processedTerrainData'];
  setTerrainSettings: ReturnType<typeof useTerrainStore>['setTerrainSettings'];
  setBuildingSettings: ReturnType<typeof useTerrainStore>['setBuildingSettings'];
  setProcessedTerrainData: ReturnType<typeof useTerrainStore>['setProcessedTerrainData'];

  // Processing state
  isProcessing: ReturnType<typeof useProcessingStore>['isProcessing'];
  processingStatus: ReturnType<typeof useProcessingStore>['processingStatus'];
  processingProgress: ReturnType<typeof useProcessingStore>['processingProgress'];
  _forceUpdate?: ReturnType<typeof useProcessingStore>['_forceUpdate'];
  setProcessing: ReturnType<typeof useProcessingStore>['setProcessing'];
  setIsProcessing: ReturnType<typeof useProcessingStore>['setProcessing']; // Legacy alias
  updateProgress: ReturnType<typeof useProcessingStore>['updateProgress'];
  resetProcessing: ReturnType<typeof useProcessingStore>['resetProcessing'];

  // Geometry state
  bbox: ReturnType<typeof useGeometryStore>['bbox'];
  configHashes: ReturnType<typeof useGeometryStore>['configHashes'];
  geometryDataSets: ReturnType<typeof useGeometryStore>['geometryDataSets'];
  setBbox: ReturnType<typeof useGeometryStore>['setBbox'];
  setConfigHashes: ReturnType<typeof useGeometryStore>['setConfigHashes'];
  setGeometryDataSets: ReturnType<typeof useGeometryStore>['setGeometryDataSets'];

  // UI state
  renderingSettings: ReturnType<typeof useUIStore>['renderingSettings'];
  debugSettings: ReturnType<typeof useUIStore>['debugSettings'];
  hoverState: ReturnType<typeof useUIStore>['hoverState'];
  colorOnlyUpdate: ReturnType<typeof useUIStore>['colorOnlyUpdate'];
  layerColorUpdates: ReturnType<typeof useUIStore>['layerColorUpdates'];
  sceneGetter: ReturnType<typeof useUIStore>['sceneGetter'];
  setRenderingSettings: ReturnType<typeof useUIStore>['setRenderingSettings'];
  setDebugSettings: ReturnType<typeof useUIStore>['setDebugSettings'];
  setHoverState: ReturnType<typeof useUIStore>['setHoverState'];
  setColorOnlyUpdate: ReturnType<typeof useUIStore>['setColorOnlyUpdate'];
  updateLayerColors: ReturnType<typeof useUIStore>['updateLayerColors'];
  setSceneGetter: ReturnType<typeof useUIStore>['setSceneGetter'];

  // Legacy action compatibility methods
  setRenderingMode: (mode: 'quality' | 'performance') => void;
  setHoveredMesh: (mesh: THREE.Object3D | null) => void;
  setMousePosition: (position: { x: number; y: number } | null) => void;
  clearHover: () => void;
  clearColorOnlyUpdate: () => void;
  setCurrentSceneGetter: (getter: (() => THREE.Scene | null) | null) => void;

  // Internal method to sync state
  _syncState: () => void;
}

// Create combined store that syncs with individual domain stores
export const useCombinedStore = create<CombinedState>()(
  subscribeWithSelector((set, get) => {
    // Get initial state from all stores
    const layerStore = useLayerStore.getState();
    const terrainStore = useTerrainStore.getState();
    const processingStore = useProcessingStore.getState();
    const geometryStore = useGeometryStore.getState();
    const uiStore = useUIStore.getState();

    return {
      // Layer state (converted to legacy format)
      vtLayers: layerStore.vtLayers.map(toLegacyFormat),
      setVtLayers: layerStore.setVtLayers,
      updateVtLayer: layerStore.updateVtLayer,
      toggleLayerEnabled: layerStore.toggleLayerEnabled,
      setLayerColor: layerStore.setLayerColor,
      setLayerExtrusionDepth: layerStore.setLayerExtrusionDepth,
      setLayerMinExtrusionDepth: layerStore.setLayerMinExtrusionDepth,
      setLayerZOffset: layerStore.setLayerZOffset,
      setLayerBufferSize: layerStore.setLayerBufferSize,
      toggleLayerUseAdaptiveScaleFactor: layerStore.toggleLayerUseAdaptiveScaleFactor,
      toggleLayerAlignVerticesToTerrain: layerStore.toggleLayerAlignVerticesToTerrain,
      setLayerHeightScaleFactor: layerStore.setLayerHeightScaleFactor,
      setLayerCsgClipping: layerStore.setLayerCsgClipping,

      // Terrain state
      terrainSettings: terrainStore.terrainSettings,
      buildingSettings: terrainStore.buildingSettings,
      processedTerrainData: terrainStore.processedTerrainData,
      setTerrainSettings: terrainStore.setTerrainSettings,
      setBuildingSettings: terrainStore.setBuildingSettings,
      setProcessedTerrainData: terrainStore.setProcessedTerrainData,

      // Processing state
      isProcessing: processingStore.isProcessing,
      processingStatus: processingStore.processingStatus,
      processingProgress: processingStore.processingProgress,
      _forceUpdate: processingStore._forceUpdate,
      setProcessing: processingStore.setProcessing,
      setIsProcessing: processingStore.setProcessing, // Legacy alias
      updateProgress: processingStore.updateProgress,
      resetProcessing: processingStore.resetProcessing,

      // Geometry state
      bbox: geometryStore.bbox,
      configHashes: geometryStore.configHashes,
      geometryDataSets: geometryStore.geometryDataSets,
      setBbox: geometryStore.setBbox,
      setConfigHashes: geometryStore.setConfigHashes,
      setGeometryDataSets: geometryStore.setGeometryDataSets,

      // UI state
      renderingSettings: uiStore.renderingSettings,
      debugSettings: uiStore.debugSettings,
      hoverState: uiStore.hoverState,
      colorOnlyUpdate: uiStore.colorOnlyUpdate,
      layerColorUpdates: uiStore.layerColorUpdates,
      sceneGetter: uiStore.sceneGetter,
      setRenderingSettings: uiStore.setRenderingSettings,
      setDebugSettings: uiStore.setDebugSettings,
      setHoverState: uiStore.setHoverState,
      setColorOnlyUpdate: uiStore.setColorOnlyUpdate,
      updateLayerColors: uiStore.updateLayerColors,
      setSceneGetter: uiStore.setSceneGetter,

      // Legacy action compatibility methods
      setRenderingMode: (mode: 'quality' | 'performance') => {
        uiStore.setRenderingSettings({ mode });
      },

      setHoveredMesh: (mesh: THREE.Object3D | null) => {
        uiStore.setHoverState({ hoveredMesh: mesh });
      },

      setMousePosition: (position: { x: number; y: number } | null) => {
        uiStore.setHoverState({ mousePosition: position });
      },

      clearHover: () => {
        uiStore.setHoverState({ 
          hoveredMesh: null, 
          hoveredProperties: null, 
          mousePosition: null 
        });
      },

      clearColorOnlyUpdate: () => {
        uiStore.setColorOnlyUpdate(false);
      },

      setCurrentSceneGetter: (getter: (() => THREE.Scene | null) | null) => {
        uiStore.setSceneGetter(getter);
      },

      // Sync method with performance monitoring
      _syncState: () => {
        performanceMonitor.measure('combined-store-sync', () => {
          const newLayerState = useLayerStore.getState();
          const newTerrainState = useTerrainStore.getState();
          const newProcessingState = useProcessingStore.getState();
          const newGeometryState = useGeometryStore.getState();
          const newUIState = useUIStore.getState();

          const newState = {
            // Update layer state with legacy format
            vtLayers: newLayerState.vtLayers.map(toLegacyFormat),
            
            // Update other states
            terrainSettings: newTerrainState.terrainSettings,
            buildingSettings: newTerrainState.buildingSettings,
            processedTerrainData: newTerrainState.processedTerrainData,
            
            isProcessing: newProcessingState.isProcessing,
            processingStatus: newProcessingState.processingStatus,
            processingProgress: newProcessingState.processingProgress,
            _forceUpdate: newProcessingState._forceUpdate,
            
            bbox: newGeometryState.bbox,
            configHashes: newGeometryState.configHashes,
            geometryDataSets: newGeometryState.geometryDataSets,
            
            renderingSettings: newUIState.renderingSettings,
            debugSettings: newUIState.debugSettings,
            hoverState: newUIState.hoverState,
            colorOnlyUpdate: newUIState.colorOnlyUpdate,
            layerColorUpdates: newUIState.layerColorUpdates,
            sceneGetter: newUIState.sceneGetter,
          };

          set(newState);

          // Track state size for performance monitoring
          performanceMonitor.recordStoreOperation(
            'CombinedStore',
            'sync',
            JSON.stringify(newState).length,
            0 // Duration is measured by the outer measure call
          );
        });
      },
    };
  })
);

// Subscribe to changes in individual stores and sync
useLayerStore.subscribe((state) => {
  useCombinedStore.getState()._syncState();
});

useTerrainStore.subscribe((state) => {
  useCombinedStore.getState()._syncState();
});

useProcessingStore.subscribe((state) => {
  useCombinedStore.getState()._syncState();
});

useGeometryStore.subscribe((state) => {
  useCombinedStore.getState()._syncState();
});

useUIStore.subscribe((state) => {
  useCombinedStore.getState()._syncState();
});