import { create } from 'zustand';
import type { TerrainStore } from '../types/TerrainTypes';

const DEFAULT_TERRAIN_SETTINGS = {
  enabled: true,
  verticalExaggeration: 1,
  baseHeight: 5,
  color: '#8B4513', // Brown color for terrain
};

const DEFAULT_BUILDING_SETTINGS = {
  enabled: true,
  scaleFactor: 1,
};

const DEFAULT_PROCESSED_TERRAIN_DATA = {
  processedMinElevation: 0,
  processedMaxElevation: 100,
};

export const useTerrainStore = create<TerrainStore>((set, get) => ({
  // State
  terrainSettings: DEFAULT_TERRAIN_SETTINGS,
  buildingSettings: DEFAULT_BUILDING_SETTINGS,
  processedTerrainData: DEFAULT_PROCESSED_TERRAIN_DATA,

  // Actions
  setTerrainSettings: (settings) =>
    set((state) => ({
      terrainSettings: { ...state.terrainSettings, ...settings },
    })),

  setBuildingSettings: (settings) =>
    set((state) => ({
      buildingSettings: { ...state.buildingSettings, ...settings },
    })),

  setProcessedTerrainData: (data) =>
    set({ processedTerrainData: data }),
}));