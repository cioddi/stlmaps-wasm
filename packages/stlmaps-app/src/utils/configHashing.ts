import { VtDataSet } from "../components/GenerateMeshButton";
import { TerrainSettings } from "../stores/useLayerStore";

/**
 * Creates a hash representation of terrain settings for comparison
 */
export function hashTerrainConfig(config: TerrainSettings): string {
  return JSON.stringify({
    enabled: config.enabled,
    verticalExaggeration: config.verticalExaggeration,
    baseHeight: config.baseHeight,
  });
}

/**
 * Creates a hash representation of a vector tile layer config for comparison
 */
export function hashVtLayerConfig(vtLayer: VtDataSet): string {
  // Include both geometry-affecting properties and visual properties like color
  return JSON.stringify({
    sourceLayer: vtLayer.sourceLayer,
    subClass: vtLayer.subClass,
    extrusionDepth: vtLayer.extrusionDepth,
    zOffset: vtLayer.zOffset,
    bufferSize: vtLayer.bufferSize,
    filter: vtLayer.filter,
    useAdaptiveScaleFactor: vtLayer.useAdaptiveScaleFactor,
    heightScaleFactor: vtLayer.heightScaleFactor,
    alignVerticesToTerrain: vtLayer.alignVerticesToTerrain,
    enabled: vtLayer.enabled,
    // Include color to detect material changes
    color: vtLayer.color ? { 
      r: vtLayer.color.r, 
      g: vtLayer.color.g, 
      b: vtLayer.color.b 
    } : undefined,
    // Exclude data and geometry as they're the result of processing
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
