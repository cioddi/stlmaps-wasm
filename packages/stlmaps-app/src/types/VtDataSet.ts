import * as THREE from "three";

// VtDataSet interface for vector tile layer configuration
export interface VtDataSet {
  sourceLayer: string;
  subClass?: string;
  geometry?: THREE.BufferGeometry;
  enabled?: boolean;
  color?: THREE.Color;
  bufferSize?: number;
  filter?: any[]; // MapLibre filter expression
  extrusionDepth?: number;
  minExtrusionDepth?: number;
  heightScaleFactor?: number;
  useAdaptiveScaleFactor?: boolean;
  zOffset?: number;
  alignVerticesToTerrain?: boolean;
  csgClipping?: boolean;
}
