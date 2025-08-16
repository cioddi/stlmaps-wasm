import { create } from "zustand";
import * as THREE from "three";
import { vtGeometries as defaultVtGeometries } from "../config/layers";
import { VtDataSet } from "../types/VtDataSet";

interface TerrainSettings {
  enabled: boolean;
  verticalExaggeration: number;
  baseHeight: number;
  color: string; // Hex color string for terrain
}

interface BuildingSettings {
  enabled: boolean;
  scaleFactor: number;
}

interface ConfigHashes {
  fullConfigHash: string;
  terrainHash: string;
  layerHashes: { index: number, hash: string }[];
}

interface ProcessedTerrainData {
  processedElevationGrid?: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
}

interface RenderingSettings {
  mode: 'quality' | 'performance';
}

interface LayerState {
  // Layer data
  vtLayers: VtDataSet[];
  terrainSettings: TerrainSettings;
  buildingSettings: BuildingSettings;
  renderingSettings: RenderingSettings;
  bbox: GeoJSON.Feature | undefined;
  
  // Config hashes for smart regeneration
  configHashes: ConfigHashes;
  processedTerrainData: ProcessedTerrainData;

  // Processing state
  isProcessing: boolean;
  processingStatus: string | null;
  processingProgress: number | null;

  // Geometry data
  geometryDataSets: {
    polygonGeometries: VtDataSet[] | null;
    terrainGeometry: THREE.BufferGeometry | undefined;
  }
  
  // Actions for config hashes and terrain data
  setConfigHashes: (hashes: ConfigHashes) => void;
  setProcessedTerrainData: (data: ProcessedTerrainData) => void;

  // Actions for layers
  setVtLayers: (layers: VtDataSet[]) => void;
  updateVtLayer: (index: number, updates: Partial<VtDataSet>) => void;
  toggleLayerEnabled: (index: number) => void;
  setLayerColor: (index: number, hexColor: string) => void;
  setLayerExtrusionDepth: (index: number, value: number | undefined) => void;
  setLayerMinExtrusionDepth: (index: number, value: number | undefined) => void;
  setLayerZOffset: (index: number, value: number) => void;
  setLayerBufferSize: (index: number, value: number) => void;
  toggleLayerUseAdaptiveScaleFactor: (index: number) => void;
  toggleLayerAlignVerticesToTerrain: (index: number) => void;
  setLayerHeightScaleFactor: (index: number, value: number) => void;
  setLayerCsgClipping: (index: number, value: boolean) => void;

  // Actions for bbox
  setBbox: (bbox: GeoJSON.Feature | undefined) => void;

  // Actions for terrain
  setTerrainSettings: (settings: Partial<TerrainSettings>) => void;
  toggleTerrainEnabled: () => void;
  setTerrainVerticalExaggeration: (value: number) => void;
  setTerrainBaseHeight: (value: number) => void;
  setTerrainColor: (color: string) => void;

  // Actions for buildings
  setBuildingSettings: (settings: Partial<BuildingSettings>) => void;
  toggleBuildingsEnabled: () => void;
  setBuildingScaleFactor: (value: number) => void;
  
  // Actions for rendering settings
  setRenderingMode: (mode: 'quality' | 'performance') => void;

  // Geometry actions
  setGeometryDataSets: (geometryDataSets: {
    polygonGeometries: VtDataSet[] | null;
    terrainGeometry: THREE.BufferGeometry | undefined;
  }) => void;

  // Processing state actions
  setIsProcessing: (isProcessing: boolean) => void;
  setProcessingStatus: (status: string | null) => void;
  setProcessingProgress: (progress: number | null) => void;
  updateProcessingState: (state: { isProcessing?: boolean; status?: string | null; progress?: number | null }) => void;

  // Reset actions
  resetToDefaults: () => void;
}

// Helper function to convert hex color to THREE.Color
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : null;
}

// Create the store with initial values and actions
const useLayerStore = create<LayerState>((set) => ({
  // Processing state
  isProcessing: false,
  processingStatus: null,
  processingProgress: null,
  
  // Config hashes and processed terrain data for smart regeneration
  configHashes: {
    fullConfigHash: "",
    terrainHash: "",
    layerHashes: []
  },
  processedTerrainData: {
    processedElevationGrid: undefined,
    processedMinElevation: 0,
    processedMaxElevation: 0
  },
  
  geometryDataSets: {
    polygonGeometries: null,
    terrainGeometry: undefined
  },
  setGeometryDataSets: (geometryDataSets) => set({ geometryDataSets: { ...geometryDataSets} }),
  
  // Methods for config hashes and processed terrain data
  setConfigHashes: (hashes) => set({ configHashes: hashes }),
  setProcessedTerrainData: (data) => set({ processedTerrainData: data }),
  
  vtLayers: [...defaultVtGeometries],
  terrainSettings: {
    enabled: true,
    verticalExaggeration: 0.06,
    baseHeight: 5,
    color: "#383533"
  },
  buildingSettings: {
    enabled: true,
    scaleFactor: 0.5
  },
  renderingSettings: {
    mode: 'quality'
  },
  bbox: undefined,


  // Layer actions
  setVtLayers: (layers) => set({ vtLayers: layers }),

  updateVtLayer: (index, updates) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = { ...updatedLayers[index], ...updates };
    return { vtLayers: updatedLayers };
  }),

  toggleLayerEnabled: (index) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      enabled: !updatedLayers[index].enabled
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerColor: (index, hexColor) => set((state) => {
    const rgbColor = hexToRgb(hexColor);
    if (!rgbColor) return state;

    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      color: new THREE.Color(rgbColor.r, rgbColor.g, rgbColor.b)
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerExtrusionDepth: (index, value) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      extrusionDepth: value
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerMinExtrusionDepth: (index, value) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      minExtrusionDepth: value
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerZOffset: (index, value) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      zOffset: value
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerBufferSize: (index, value) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      bufferSize: value
    };
    return { vtLayers: updatedLayers };
  }),

  toggleLayerUseAdaptiveScaleFactor: (index) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      useAdaptiveScaleFactor: !updatedLayers[index].useAdaptiveScaleFactor
    };
    return { vtLayers: updatedLayers };
  }),

  toggleLayerAlignVerticesToTerrain: (index) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      alignVerticesToTerrain: !updatedLayers[index].alignVerticesToTerrain
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerHeightScaleFactor: (index, value) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = {
      ...updatedLayers[index],
      heightScaleFactor: value
    };
    return { vtLayers: updatedLayers };
  }),

  setLayerCsgClipping: (index: number, value: boolean) => set((state) => {
    const updatedLayers = [...state.vtLayers];
    updatedLayers[index] = { ...updatedLayers[index], csgClipping: value };
    return { vtLayers: updatedLayers };
  }),

  // Terrain actions
  setTerrainSettings: (settings) => set((state) => ({
    terrainSettings: { ...state.terrainSettings, ...settings }
  })),

  toggleTerrainEnabled: () => set((state) => ({
    terrainSettings: {
      ...state.terrainSettings,
      enabled: !state.terrainSettings.enabled
    }
  })),

  setTerrainVerticalExaggeration: (value) => set((state) => ({
    terrainSettings: { ...state.terrainSettings, verticalExaggeration: value }
  })),

  setTerrainBaseHeight: (value) => set((state) => ({
    terrainSettings: { ...state.terrainSettings, baseHeight: value }
  })),
  
  setTerrainColor: (color) => set((state) => ({
    terrainSettings: { ...state.terrainSettings, color }
  })),

  // Building actions
  setBuildingSettings: (settings) => set((state) => ({
    buildingSettings: { ...state.buildingSettings, ...settings }
  })),

  toggleBuildingsEnabled: () => set((state) => ({
    buildingSettings: {
      ...state.buildingSettings,
      enabled: !state.buildingSettings.enabled
    }
  })),

  setBuildingScaleFactor: (value) => set((state) => ({
    buildingSettings: { ...state.buildingSettings, scaleFactor: value }
  })),

  // Rendering settings actions
  setRenderingMode: (mode) => set((state) => ({
    renderingSettings: { ...state.renderingSettings, mode }
  })),

  // Bbox action
  setBbox: (bbox) => set({ bbox }),

  // Processing state actions
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setProcessingStatus: (processingStatus) => set({ processingStatus }),
  setProcessingProgress: (processingProgress) => set({ processingProgress }),
  updateProcessingState: (state) => set((currentState) => ({
    isProcessing: state.isProcessing !== undefined ? state.isProcessing : currentState.isProcessing,
    processingStatus: state.status !== undefined ? state.status : currentState.processingStatus,
    processingProgress: state.progress !== undefined ? state.progress : currentState.processingProgress
  })),

  // Reset to defaults
  resetToDefaults: () => set({
    vtLayers: [...defaultVtGeometries],
    terrainSettings: {
      enabled: true,
      verticalExaggeration: 0.06,
      baseHeight: 5,
      color: "#6B8E23" // Default olive green color for terrain
    },
    buildingSettings: {
      enabled: true,
      scaleFactor: 0.5
    },
    bbox: undefined,
    geometryDataSets: {
      polygonGeometries: null,
      terrainGeometry: undefined
    },
    configHashes: {
      fullConfigHash: "",
      terrainHash: "",
      layerHashes: []
    },
    processedTerrainData: {
      processedElevationGrid: undefined,
      processedMinElevation: 0,
      processedMaxElevation: 0
    }
  })
}));

export default useLayerStore;
