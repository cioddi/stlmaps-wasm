import * as THREE from 'three';
import type { VtDataSet } from '../../../types/VtDataSet';

// Legacy compatible layer interface that components expect
export interface LegacyVtDataSet {
  sourceLayer: string;
  subClass?: string;
  geometry?: THREE.BufferGeometry;
  enabled: boolean;
  color: THREE.Color; // Legacy components expect THREE.Color
  bufferSize: number;
  filter?: any[]; // Legacy components expect any[]
  extrusionDepth?: number;
  minExtrusionDepth?: number;
  heightScaleFactor: number;
  useAdaptiveScaleFactor: boolean;
  zOffset: number;
  alignVerticesToTerrain: boolean;
  csgClipping: boolean; // Use legacy name
  geometryDebugMode?: boolean;
}

// Convert new VtDataSet to legacy format for backward compatibility
export const toLegacyFormat = (layer: VtDataSet): LegacyVtDataSet => {
  return {
    sourceLayer: layer.sourceLayer,
    subClass: layer.subClass,
    geometry: layer.geometry,
    enabled: layer.enabled,
    color: new THREE.Color(layer.color), // Convert hex string to THREE.Color
    bufferSize: layer.bufferSize,
    filter: layer.filter as any[], // Type assertion for legacy compatibility
    extrusionDepth: layer.extrusionDepth,
    minExtrusionDepth: layer.minExtrusionDepth,
    heightScaleFactor: layer.heightScaleFactor,
    useAdaptiveScaleFactor: layer.useAdaptiveScaleFactor,
    zOffset: layer.zOffset,
    alignVerticesToTerrain: layer.alignVerticesToTerrain,
    csgClipping: layer.useCsgClipping, // Map new name to legacy name
    geometryDebugMode: layer.geometryDebugMode,
  };
};

// Convert legacy format to new VtDataSet
export const fromLegacyFormat = (layer: LegacyVtDataSet): VtDataSet => {
  return {
    sourceLayer: layer.sourceLayer,
    subClass: layer.subClass,
    geometry: layer.geometry,
    enabled: layer.enabled,
    color: `#${layer.color.getHexString()}`, // Convert THREE.Color to hex string
    bufferSize: layer.bufferSize,
    filter: layer.filter,
    extrusionDepth: layer.extrusionDepth,
    minExtrusionDepth: layer.minExtrusionDepth,
    heightScaleFactor: layer.heightScaleFactor,
    useAdaptiveScaleFactor: layer.useAdaptiveScaleFactor,
    zOffset: layer.zOffset,
    alignVerticesToTerrain: layer.alignVerticesToTerrain,
    useCsgClipping: layer.csgClipping, // Map legacy name to new name
    geometryDebugMode: layer.geometryDebugMode,
  };
};