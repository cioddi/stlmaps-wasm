import { VtDataSet } from "../components/GenerateMeshButton";
import { TerrainSettings } from "../stores/useLayerStore";

/**
 * Creates a hash representation of terrain settings for geometry generation
 * (excludes visual-only properties like color)
 */
export function hashTerrainConfig(config: TerrainSettings): string {
  return JSON.stringify({
    enabled: config.enabled,
    verticalExaggeration: config.verticalExaggeration,
    // baseHeight excluded - can be updated in real-time
    // Color is excluded to prevent geometry regeneration on color changes
  });
}

/**
 * Creates a hash representation of visual-only properties for terrain
 */
export function hashTerrainVisuals(config: TerrainSettings): string {
  return JSON.stringify({
    enabled: config.enabled,
    color: config.color,
  });
}

/**
 * Creates a hash representation of a vector tile layer config for geometry generation
 * (excludes visual-only properties like color)
 */
export function hashVtLayerConfig(vtLayer: VtDataSet): string {
  // Only include geometry-affecting properties, exclude visual properties and real-time adjustable properties
  return JSON.stringify({
    sourceLayer: vtLayer.sourceLayer,
    subClass: vtLayer.subClass,
    extrusionDepth: vtLayer.extrusionDepth,
    // zOffset excluded - can be updated in real-time
    bufferSize: vtLayer.bufferSize,
    filter: vtLayer.filter,
    useAdaptiveScaleFactor: vtLayer.useAdaptiveScaleFactor,
    // heightScaleFactor excluded - can be updated in real-time
    alignVerticesToTerrain: vtLayer.alignVerticesToTerrain,
    enabled: vtLayer.enabled,
    // Color is excluded to prevent geometry regeneration on color changes
  });
}

/**
 * Creates a hash representation of visual-only properties for a vector tile layer
 */
export function hashVtLayerVisuals(vtLayer: VtDataSet): string {
  return JSON.stringify({
    sourceLayer: vtLayer.sourceLayer,
    color: vtLayer.color ? { 
      r: vtLayer.color.r, 
      g: vtLayer.color.g, 
      b: vtLayer.color.b 
    } : undefined,
  });
}

/**
 * Creates a hash representation of bbox
 */
export function hashBbox(bbox: GeoJSON.Feature | undefined): string {
  if (!bbox) return "undefined";
  return JSON.stringify(bbox.geometry);
}

/**
 * Creates a hash from all relevant configurations that affect geometry generation
 */
export function createConfigHash(
  bbox: GeoJSON.Feature | undefined, 
  terrainSettings: TerrainSettings,
  vtLayers: VtDataSet[]
): string {
  return JSON.stringify({
    bbox: hashBbox(bbox),
    terrain: hashTerrainConfig(terrainSettings),
    layers: vtLayers.filter(l => l.enabled !== false).map(hashVtLayerConfig)
  });
}

/**
 * Creates individual hashes for each component of the scene
 */
export function createComponentHashes(
  bbox: GeoJSON.Feature | undefined,
  terrainSettings: TerrainSettings,
  vtLayers: VtDataSet[]
) {
  const terrainHash = terrainSettings.enabled ? 
    `${hashBbox(bbox)}:${hashTerrainConfig(terrainSettings)}` : 
    "disabled";
  
  const layerHashes = vtLayers.map((layer, index) => ({
    index,
    hash: layer.enabled !== false ? 
      `${hashBbox(bbox)}:${hashVtLayerConfig(layer)}` : 
      "disabled"
  }));

  return {
    terrainHash,
    layerHashes
  };
}
