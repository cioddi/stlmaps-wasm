import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import * as THREE from 'three';
import { Feature } from 'geojson';

// View mode for UI
export type ViewMode = "split" | "map" | "model";

// Terrain settings interface
export interface TerrainSettings {
  enabled: boolean;
  verticalExaggeration: number;
  baseHeight: number;
  color: string;
}

// Building settings interface  
export interface BuildingSettings {
  enabled: boolean;
  color: string;
  opacity: number;
}

// VT Layer configuration interface
export interface VtDataSet {
  sourceLayer: string;
  label?: string; // Display label for grouping (defaults to sourceLayer if not provided)
  subClass?: string;
  geometry?: THREE.BufferGeometry;
  geometries?: THREE.BufferGeometry[];
  enabled: boolean;
  color: string;
  bufferSize: number;
  filter?: any; // MapLibre filter expression
  extrusionDepth?: number;
  minExtrusionDepth?: number;
  heightScaleFactor: number;
  useAdaptiveScaleFactor: boolean;
  zOffset: number;
  alignVerticesToTerrain: boolean;
  useCsgClipping: boolean;
  order?: number; // Layer rendering/processing order
  geometryDebugMode?: boolean;
  url?: string;
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
}

// Grid size interface
export interface GridSize {
  width: number;
  height: number;
}

// Geometry datasets interface
export interface GeometryDataSets {
  terrainGeometry?: THREE.BufferGeometry;
  polygonGeometries?: VtDataSet[];
}

// Config hashes interface
export interface ConfigHashes {
  fullConfigHash: string;
  terrainHash: string;
  layerHashes: { index: number; hash: string }[];
}

// Processed terrain data interface
export interface ProcessedTerrainData {
  processedElevationGrid: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
}

// Rendering settings interface
export interface RenderingSettings {
  mode: 'quality' | 'performance';
  shadows: boolean;
  antialias: boolean;
  pixelRatio: number;
}

// Debug settings interface
export interface DebugSettings {
  geometryDebugMode: boolean;
  showWireframes: boolean;
  showBoundingBoxes: boolean;
}

// Hover state interface
export interface HoverState {
  hoveredMesh: THREE.Object3D | null;
  hoveredProperties: Record<string, unknown> | null;
  mousePosition: { x: number; y: number } | null;
}

// Main app state interface
interface AppState {
  // Core app state
  bboxCenter: [number, number];
  bbox: Feature | null;
  viewMode: ViewMode;
  
  // UI state  
  sidebarOpen: boolean;
  menuOpen: boolean;
  openAttribution: boolean;
  openInfo: boolean;
  openTodoList: boolean;
  
  // Layer configuration
  vtLayers: VtDataSet[];
  
  // Terrain configuration
  terrainSettings: TerrainSettings;
  buildingSettings: BuildingSettings;
  processedTerrainData: ProcessedTerrainData | null;
  
  // Processing state
  isProcessing: boolean;
  processingStatus: string;
  
  // Geometry state
  geometryDataSets: GeometryDataSets;
  configHashes: ConfigHashes;
  
  // Rendering state
  renderingSettings: RenderingSettings;
  debugSettings: DebugSettings;
  hoverState: HoverState;
  colorOnlyUpdate: boolean;
  layerColorUpdates: Record<string, THREE.Color | number>;
  sceneGetter: (() => THREE.Scene | null) | null;
  
  // Actions
  setBboxCenter: (center: [number, number]) => void;
  setBbox: (bbox: Feature | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSidebarOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setOpenAttribution: (open: boolean) => void;
  setOpenInfo: (open: boolean) => void;
  setOpenTodoList: (open: boolean) => void;
  
  // Layer actions
  setVtLayers: (layers: VtDataSet[]) => void;
  updateVtLayer: (index: number, updates: Partial<VtDataSet>) => void;
  toggleLayerEnabled: (index: number) => void;
  setLayerColor: (index: number, color: string) => void;
  setLayerExtrusionDepth: (index: number, depth: number) => void;
  setLayerMinExtrusionDepth: (index: number, depth: number) => void;
  setLayerZOffset: (index: number, offset: number) => void;
  setLayerBufferSize: (index: number, size: number) => void;
  toggleLayerUseAdaptiveScaleFactor: (index: number) => void;
  toggleLayerAlignVerticesToTerrain: (index: number) => void;
  setLayerHeightScaleFactor: (index: number, factor: number) => void;
  setLayerCsgClipping: (index: number, enabled: boolean) => void;
  setLayerOrder: (index: number, order: number) => void;
  setLayerFilter: (index: number, filter: any) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  
  // Terrain actions
  setTerrainSettings: (settings: Partial<TerrainSettings>) => void;
  setBuildingSettings: (settings: Partial<BuildingSettings>) => void;
  setProcessedTerrainData: (data: ProcessedTerrainData | null) => void;
  
  // Processing actions
  setIsProcessing: (processing: boolean) => void;
  updateProgress: (status: string) => void;
  resetProcessing: () => void;
  
  // Geometry actions
  setGeometryDataSets: (datasets: GeometryDataSets) => void;
  setConfigHashes: (hashes: ConfigHashes) => void;
  
  // Rendering actions
  setRenderingSettings: (settings: Partial<RenderingSettings>) => void;
  setDebugSettings: (settings: Partial<DebugSettings>) => void;
  setHoverState: (state: Partial<HoverState>) => void;
  setColorOnlyUpdate: (update: boolean) => void;
  updateLayerColors: (colors: Record<string, THREE.Color | number>) => void;
  setSceneGetter: (getter: (() => THREE.Scene | null) | null) => void;
  
  // Legacy compatibility
  setHoveredMesh: (mesh: THREE.Object3D | null) => void;
  setMousePosition: (position: { x: number; y: number } | null) => void;
  clearHover: () => void;
  clearColorOnlyUpdate: () => void;
  setCurrentSceneGetter: (getter: (() => THREE.Scene | null) | null) => void;
}

// Default layer configuration with proper filters and ordering
const defaultLayers: VtDataSet[] = [
  {
    sourceLayer: "landuse",
    label: "Land Use Areas",
    enabled: true,
    color: "#4caf50",
    bufferSize: 2,
    extrusionDepth: 0.8,
    zOffset: -0.4,
    heightScaleFactor: 1,
    useAdaptiveScaleFactor: false,
    alignVerticesToTerrain: true,
    useCsgClipping: false,
    order: 1,
    filter: ["in", "class", "commercial", "residential"]
  },
  {
    sourceLayer: "landcover",
    label: "Natural Areas",
    enabled: true,
    color: "#74e010",
    bufferSize: 2,
    extrusionDepth: 1.2,
    zOffset: -0.3,
    heightScaleFactor: 1,
    useAdaptiveScaleFactor: false,
    alignVerticesToTerrain: true,
    useCsgClipping: false,
    order: 2
  },
  {
    sourceLayer: "park",
    label: "Parks & Recreation",
    enabled: true,
    color: "#26CB00",
    bufferSize: 2,
    extrusionDepth: 0.8,
    zOffset: -0.3,
    heightScaleFactor: 1,
    useAdaptiveScaleFactor: false,
    alignVerticesToTerrain: true,
    useCsgClipping: false,
    order: 3
  },
  {
    sourceLayer: "transportation",
    label: "Footways",
    enabled: true,
    color: "#ffefda",
    bufferSize: 1.5,
    extrusionDepth: 1.6,
    zOffset: -0.2,
    heightScaleFactor: 1,
    useAdaptiveScaleFactor: false,
    alignVerticesToTerrain: true,
    useCsgClipping: false,
    order: 4,
    filter: [
      "in",
      "subclass",
      "footway"
    ]
  },
  {
    sourceLayer: "transportation",
    label: "Roads & Streets",
    enabled: true,
    color: "#989898",
    bufferSize: 2,
    extrusionDepth: 1.6,
    zOffset: -0.2,
    heightScaleFactor: 1,
    useAdaptiveScaleFactor: false,
    alignVerticesToTerrain: true,
    useCsgClipping: false,
    order: 4,
    filter: [
      "in",
      "class",
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "service",
      "minor",
      "track",
      "raceway"
    ]
  },
  {
    sourceLayer: "water",
    label: "Water Bodies",
    enabled: true,
    color: "#76bcff",
    bufferSize: 0,
    extrusionDepth: 1.4,
    zOffset: 0.2,
    heightScaleFactor: 1,
    useAdaptiveScaleFactor: false,
    alignVerticesToTerrain: true,
    useCsgClipping: false,
    order: 5
  },
  {
    sourceLayer: "building",
    label: "Buildings",
    enabled: true,
    color: "#afafaf",
    bufferSize: 0,
    zOffset: -0.1,
    heightScaleFactor: 1, // 50% taller than default to make buildings more visible
    useAdaptiveScaleFactor: true,
    alignVerticesToTerrain: false,
    useCsgClipping: false,
    order: 6
  }
];

// Create the unified Zustand store
export const useAppStore = create<AppState>()(
  subscribeWithSelector((set) => ({
    // Core app state
    bboxCenter: [-74.00599999999997, 40.71279999999999],
    bbox: null,
    viewMode: "split",
    
    // UI state
    sidebarOpen: false,
    menuOpen: false,
    openAttribution: false,
    openInfo: false,
    openTodoList: false,
    
    // Layer configuration
    vtLayers: defaultLayers,
    
    // Terrain configuration
    terrainSettings: {
      enabled: true,
      verticalExaggeration: 2,
      baseHeight: 5,
      color: "#8B4513"
    },
    buildingSettings: {
      enabled: true,
      color: "#7fcdcd",
      opacity: 1.0
    },
    processedTerrainData: null,
    
    // Processing state
    isProcessing: false,
    processingStatus: "",
    
    // Geometry state
    geometryDataSets: {},
    configHashes: {
      fullConfigHash: "",
      terrainHash: "",
      layerHashes: []
    },
    
    // Rendering state
    renderingSettings: {
      mode: 'performance',
      shadows: false,
      antialias: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
    },
    debugSettings: {
      geometryDebugMode: false,
      showWireframes: false,
      showBoundingBoxes: false
    },
    hoverState: {
      hoveredMesh: null,
      hoveredProperties: null,
      mousePosition: null
    },
    colorOnlyUpdate: false,
    layerColorUpdates: {},
    sceneGetter: null,
    
    // Actions
    setBboxCenter: (center) => set({ bboxCenter: center }),
    setBbox: (bbox) => set({ bbox }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setMenuOpen: (open) => set({ menuOpen: open }),
    setOpenAttribution: (open) => set({ openAttribution: open }),
    setOpenInfo: (open) => set({ openInfo: open }),
    setOpenTodoList: (open) => set({ openTodoList: open }),
    
    // Layer actions
    setVtLayers: (layers) => set({ vtLayers: layers }),
    updateVtLayer: (index, updates) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) => 
        i === index ? { ...layer, ...updates } : layer
      )
    })),
    toggleLayerEnabled: (index) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, enabled: !layer.enabled } : layer
      )
    })),
    setLayerColor: (index, color) => set(state => {
      const newVtLayers = state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, color } : layer
      );
      
      // Trigger live color update in 3D preview
      const layer = state.vtLayers[index];
      if (layer) {
        const threeColor = new THREE.Color(color);
        return {
          vtLayers: newVtLayers,
          layerColorUpdates: {
            ...state.layerColorUpdates,
            [layer.label]: threeColor
          },
          colorOnlyUpdate: true
        };
      }
      
      return { vtLayers: newVtLayers };
    }),
    setLayerExtrusionDepth: (index, depth) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, extrusionDepth: depth } : layer
      )
    })),
    setLayerMinExtrusionDepth: (index, depth) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, minExtrusionDepth: depth } : layer
      )
    })),
    setLayerZOffset: (index, offset) => set(state => {
      const newVtLayers = state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, zOffset: offset } : layer
      );
      
      // Trigger live zOffset update in 3D preview
      const layer = state.vtLayers[index];
      if (layer) {
        return {
          vtLayers: newVtLayers,
          layerColorUpdates: {
            ...state.layerColorUpdates,
            [`${layer.label}_zOffset`]: offset
          },
          colorOnlyUpdate: true
        };
      }
      
      return { vtLayers: newVtLayers };
    }),
    setLayerBufferSize: (index, size) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, bufferSize: size } : layer
      )
    })),
    toggleLayerUseAdaptiveScaleFactor: (index) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, useAdaptiveScaleFactor: !layer.useAdaptiveScaleFactor } : layer
      )
    })),
    toggleLayerAlignVerticesToTerrain: (index) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, alignVerticesToTerrain: !layer.alignVerticesToTerrain } : layer
      )
    })),
    setLayerHeightScaleFactor: (index, factor) => set(state => {
      const newVtLayers = state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, heightScaleFactor: factor } : layer
      );
      
      // Trigger live height scale factor update in 3D preview
      const layer = state.vtLayers[index];
      if (layer) {
        return {
          vtLayers: newVtLayers,
          layerColorUpdates: {
            ...state.layerColorUpdates,
            [`${layer.label}_heightScaleFactor`]: factor
          },
          colorOnlyUpdate: true
        };
      }
      
      return { vtLayers: newVtLayers };
    }),
    setLayerCsgClipping: (index, enabled) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, useCsgClipping: enabled } : layer
      )
    })),
    setLayerOrder: (index, order) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, order } : layer
      )
    })),
    setLayerFilter: (index, filter) => set(state => ({
      vtLayers: state.vtLayers.map((layer, i) =>
        i === index ? { ...layer, filter } : layer
      )
    })),
    reorderLayers: (fromIndex, toIndex) => set(state => {
      const newLayers = [...state.vtLayers];
      const [removed] = newLayers.splice(fromIndex, 1);
      newLayers.splice(toIndex, 0, removed);
      
      // Update order values to match new positions
      return {
        vtLayers: newLayers.map((layer, i) => ({
          ...layer,
          order: i + 1
        }))
      };
    }),
    
    // Terrain actions
    setTerrainSettings: (settings) => set(state => {
      const newTerrainSettings = { ...state.terrainSettings, ...settings };
      const updates: Record<string, THREE.Color | number> = {};
      
      // Trigger live terrain color update in 3D preview
      if (settings.color) {
        updates.terrain = new THREE.Color(settings.color);
      }
      
      // Trigger live terrain base height update in 3D preview
      if (settings.baseHeight !== undefined) {
        updates.terrainBaseHeight = settings.baseHeight;
      }
      
      return {
        terrainSettings: newTerrainSettings,
        layerColorUpdates: {
          ...state.layerColorUpdates,
          ...updates
        },
        colorOnlyUpdate: Object.keys(updates).length > 0
      };
    }),
    setBuildingSettings: (settings) => set(state => ({
      buildingSettings: { ...state.buildingSettings, ...settings }
    })),
    setProcessedTerrainData: (data) => set({ processedTerrainData: data }),
    
    // Processing actions
    setIsProcessing: (processing) => set({ isProcessing: processing }),
    updateProgress: (status) => set({ 
      isProcessing: true, // Automatically set processing to true when progress is updated
      processingStatus: status
    }),
    resetProcessing: () => set({ 
      isProcessing: false, 
      processingStatus: ""
    }),
    
    // Geometry actions
    setGeometryDataSets: (datasets) => set({ geometryDataSets: datasets }),
    setConfigHashes: (hashes) => set({ configHashes: hashes }),
    
    // Rendering actions
    setRenderingSettings: (settings) => set(state => ({
      renderingSettings: { ...state.renderingSettings, ...settings }
    })),
    setDebugSettings: (settings) => set(state => ({
      debugSettings: { ...state.debugSettings, ...settings }
    })),
    setHoverState: (hoverState) => set(state => ({
      hoverState: { ...state.hoverState, ...hoverState }
    })),
    setColorOnlyUpdate: (update) => set({ colorOnlyUpdate: update }),
    updateLayerColors: (colors) => set(state => ({
      layerColorUpdates: { ...state.layerColorUpdates, ...colors }
    })),
    setSceneGetter: (getter) => set({ sceneGetter: getter }),
    
    // Legacy compatibility
    setHoveredMesh: (mesh) => set(state => ({
      hoverState: { ...state.hoverState, hoveredMesh: mesh }
    })),
    setMousePosition: (position) => set(state => ({
      hoverState: { ...state.hoverState, mousePosition: position }
    })),
    clearHover: () => set({
      hoverState: { 
        hoveredMesh: null, 
        hoveredProperties: null, 
        mousePosition: null 
      }
    }),
    clearColorOnlyUpdate: () => set({ colorOnlyUpdate: false }),
    setCurrentSceneGetter: (getter) => set({ sceneGetter: getter }),
  }))
);