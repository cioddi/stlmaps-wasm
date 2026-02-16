import * as THREE from "three";
import type { FilterExpression } from "./MapLibre";

// VtDataSet interface for vector tile layer configuration
export interface VtDataSet {
  sourceLayer: string;
  subClass?: string;
  geometry?: THREE.BufferGeometry;
  geometries?: THREE.BufferGeometry[]; // For multiple geometries
  enabled: boolean;
  color: string; // Hex color string
  bufferSize: number;
  fixedBufferSize?: boolean;
  filter?: FilterExpression; // MapLibre filter expression with proper types
  extrusionDepth?: number;
  minExtrusionDepth?: number;
  zOffset: number;
  alignVerticesToTerrain: boolean;
  applyMedianHeight: boolean;
  useCsgClipping: boolean; // Renamed for consistency
  geometryDebugMode?: boolean; // Skip processing like linestring buffering and polygon extrusion

  // Additional properties for better type safety
  url?: string; // Vector tile URL template
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
}
