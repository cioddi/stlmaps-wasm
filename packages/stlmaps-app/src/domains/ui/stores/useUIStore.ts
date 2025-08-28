import { create } from 'zustand';
import type { UIStore } from '../types/UITypes';

const DEFAULT_RENDERING_SETTINGS = {
  mode: 'performance' as const,
};

const DEFAULT_DEBUG_SETTINGS = {
  geometryDebugMode: false,
};

const DEFAULT_HOVER_STATE = {
  hoveredMesh: null,
  hoveredProperties: null,
  mousePosition: null,
};

export const useUIStore = create<UIStore>((set) => ({
  // State
  renderingSettings: DEFAULT_RENDERING_SETTINGS,
  debugSettings: DEFAULT_DEBUG_SETTINGS,
  hoverState: DEFAULT_HOVER_STATE,
  colorOnlyUpdate: false,
  layerColorUpdates: {},
  sceneGetter: null,

  // Actions
  setRenderingSettings: (settings) =>
    set((state) => ({
      renderingSettings: { ...state.renderingSettings, ...settings },
    })),

  setDebugSettings: (settings) =>
    set((state) => ({
      debugSettings: { ...state.debugSettings, ...settings },
    })),

  setHoverState: (state) =>
    set((prevState) => ({
      hoverState: { ...prevState.hoverState, ...state },
    })),

  setColorOnlyUpdate: (value) =>
    set({ colorOnlyUpdate: value }),

  updateLayerColors: (updates) =>
    set((state) => ({
      layerColorUpdates: { ...state.layerColorUpdates, ...updates },
    })),

  setSceneGetter: (getter) =>
    set({ sceneGetter: getter }),
}));