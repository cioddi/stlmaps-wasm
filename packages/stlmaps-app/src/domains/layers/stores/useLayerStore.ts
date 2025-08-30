import { create } from 'zustand';
import * as THREE from 'three';
import { vtGeometries as defaultVtGeometries } from '../../../config/layers';
import type { LayerStore } from '../types/LayerTypes';

// Convert legacy THREE.Color to hex string and ensure all required properties
const convertLegacyLayers = (layers: unknown[]) => {
  return layers.map(layer => ({
    ...layer,
    enabled: layer.enabled ?? true,
    color: layer.color instanceof THREE.Color ? `#${layer.color.getHexString()}` : (layer.color || '#ffffff'),
    bufferSize: layer.bufferSize ?? 0,
    heightScaleFactor: layer.heightScaleFactor ?? 1,
    useAdaptiveScaleFactor: layer.useAdaptiveScaleFactor ?? false,
    zOffset: layer.zOffset ?? 0,
    alignVerticesToTerrain: layer.alignVerticesToTerrain ?? true,
    useCsgClipping: layer.csgClipping ?? false, // Map old name to new name
  }));
};

export const useLayerStore = create<LayerStore>((set, get) => ({
  // State
  vtLayers: convertLegacyLayers(defaultVtGeometries),

  // Actions
  setVtLayers: (layers) =>
    set({ vtLayers: layers }),

  updateVtLayer: (index, updates) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, ...updates } : layer
      ),
    })),

  toggleLayerEnabled: (index) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, enabled: !layer.enabled } : layer
      ),
    })),

  setLayerColor: (index, hexColor) => {
    const { vtLayers } = get();
    if (vtLayers[index]) {
      set((state) => ({
        vtLayers: state.vtLayers.map((layer, i) =>
          i === index ? { ...layer, color: hexColor } : layer
        ),
      }));
    }
  },

  setLayerExtrusionDepth: (index, value) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, extrusionDepth: value } : layer
      ),
    })),

  setLayerMinExtrusionDepth: (index, value) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, minExtrusionDepth: value } : layer
      ),
    })),

  setLayerZOffset: (index, value) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, zOffset: value } : layer
      ),
    })),

  setLayerBufferSize: (index, value) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, bufferSize: value } : layer
      ),
    })),

  toggleLayerUseAdaptiveScaleFactor: (index) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index
          ? { ...layer, useAdaptiveScaleFactor: !layer.useAdaptiveScaleFactor }
          : layer
      ),
    })),

  toggleLayerAlignVerticesToTerrain: (index) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index
          ? { ...layer, alignVerticesToTerrain: !layer.alignVerticesToTerrain }
          : layer
      ),
    })),

  setLayerHeightScaleFactor: (index, value) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, heightScaleFactor: value } : layer
      ),
    })),

  setLayerCsgClipping: (index, value) =>
    set((state) => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, useCsgClipping: value } : layer
      ),
    })),
}));