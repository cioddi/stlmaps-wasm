import { create } from 'zustand';
import type { GeometryStore } from '../types/GeometryTypes';

const DEFAULT_CONFIG_HASHES = {
  fullConfigHash: '',
  terrainHash: '',
  layerHashes: [],
};

const DEFAULT_GEOMETRY_DATA_SETS = {
  polygonGeometries: null,
  terrainGeometry: undefined,
};

export const useGeometryStore = create<GeometryStore>((set) => ({
  // State
  bbox: undefined,
  configHashes: DEFAULT_CONFIG_HASHES,
  geometryDataSets: DEFAULT_GEOMETRY_DATA_SETS,

  // Actions
  setBbox: (bbox) =>
    set({ bbox }),

  setConfigHashes: (hashes) =>
    set({ configHashes: hashes }),

  setGeometryDataSets: (dataSets) =>
    set({ geometryDataSets: dataSets }),
}));