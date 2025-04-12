import { create } from 'zustand';
import * as THREE from 'three';
import { vtGeometries as defaultVtGeometries } from "../config/layers";
import { VtDataSet } from '../components/GenerateMeshButton';

interface TerrainSettings {
  enabled: boolean;
  verticalExaggeration: number;
  baseHeight: number;
}

interface BuildingSettings {
  enabled: boolean;
  scaleFactor: number;
}

interface LayerState {
  // Layer data
  vtLayers: VtDataSet[];
  terrainSettings: TerrainSettings;
  buildingSettings: BuildingSettings;
  bbox: GeoJSON.Feature | undefined;
  
  // Actions for layers
  setVtLayers: (layers: VtDataSet[]) => void;
  updateVtLayer: (index: number, updates: Partial<VtDataSet>) => void;
  toggleLayerEnabled: (index: number) => void;
  setLayerColor: (index: number, hexColor: string) => void;
  setLayerExtrusionDepth: (index: number, value: number) => void;
  setLayerZOffset: (index: number, value: number) => void;
  setLayerBufferSize: (index: number, value: number) => void;
  
  // Actions for bbox
  setBbox: (bbox: GeoJSON.Feature | undefined) => void;
  
  // Actions for terrain
  setTerrainSettings: (settings: Partial<TerrainSettings>) => void;
  toggleTerrainEnabled: () => void;
  setTerrainVerticalExaggeration: (value: number) => void;
  setTerrainBaseHeight: (value: number) => void;
  
  // Actions for buildings
  setBuildingSettings: (settings: Partial<BuildingSettings>) => void;
  toggleBuildingsEnabled: () => void;
  setBuildingScaleFactor: (value: number) => void;
  
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
  vtLayers: [...defaultVtGeometries],
  terrainSettings: {
    enabled: true,
    verticalExaggeration: 0.06,
    baseHeight: 5
  },
  buildingSettings: {
    enabled: true,
    scaleFactor: 0.5
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
  
  // Bbox action
  setBbox: (bbox) => set({ bbox }),
  
  // Reset to defaults
  resetToDefaults: () => set({
    vtLayers: [...defaultVtGeometries],
    terrainSettings: {
      enabled: true,
      verticalExaggeration: 0.06,
      baseHeight: 5
    },
    buildingSettings: {
      enabled: true,
      scaleFactor: 0.5
    },
    bbox: undefined
  })
}));

export default useLayerStore;
