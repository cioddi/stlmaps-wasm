import * as THREE from 'three';

export interface RenderingSettings {
  mode: 'quality' | 'performance';
}

export interface DebugSettings {
  geometryDebugMode: boolean; // Skip processing like linestring buffering and polygon extrusion
}

export interface HoverState {
  hoveredMesh: THREE.Object3D | null;
  hoveredProperties: Record<string, unknown> | null;
  mousePosition: { x: number; y: number } | null;
}

export interface UIState {
  renderingSettings: RenderingSettings;
  debugSettings: DebugSettings;
  hoverState: HoverState;
  colorOnlyUpdate: boolean;
  layerColorUpdates: Record<string, THREE.Color>;
  sceneGetter: (() => THREE.Scene | null) | null;
}

export interface UIActions {
  setRenderingSettings: (settings: Partial<RenderingSettings>) => void;
  setDebugSettings: (settings: Partial<DebugSettings>) => void;
  setHoverState: (state: Partial<HoverState>) => void;
  setColorOnlyUpdate: (value: boolean) => void;
  updateLayerColors: (updates: Record<string, THREE.Color>) => void;
  setSceneGetter: (getter: (() => THREE.Scene | null) | null) => void;
}

export interface UIStore extends UIState, UIActions {}