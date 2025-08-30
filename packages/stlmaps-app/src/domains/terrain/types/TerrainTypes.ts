
export interface TerrainSettings {
  enabled: boolean;
  verticalExaggeration: number;
  baseHeight: number;
  color: string; // Hex color string for terrain
}

export interface BuildingSettings {
  enabled: boolean;
  scaleFactor: number;
}

export interface ProcessedTerrainData {
  processedElevationGrid?: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
}

export interface TerrainState {
  terrainSettings: TerrainSettings;
  buildingSettings: BuildingSettings;
  processedTerrainData: ProcessedTerrainData;
}

export interface TerrainActions {
  setTerrainSettings: (settings: Partial<TerrainSettings>) => void;
  setBuildingSettings: (settings: Partial<BuildingSettings>) => void;
  setProcessedTerrainData: (data: ProcessedTerrainData) => void;
}

export interface TerrainStore extends TerrainState, TerrainActions {}