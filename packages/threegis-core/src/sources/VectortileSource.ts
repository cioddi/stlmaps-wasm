import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { hashBbox } from "../utils/configHashing";
import { getWasmModule } from "../wasm/wasmBridge";


// Types
export interface Tile {
  x: number;
  y: number;
  z: number;
}

export interface GridSize {
  width: number;
  height: number;
}

export interface FetchVtDataOptions {
  bbox: number[]; // [minLng, minLat, maxLng, maxLat]
  zoom: number;
  gridSize: GridSize;
  bboxKey?: string; // Optional key for caching
}

/**
 * Parse vector tile data from an ArrayBuffer
 * @deprecated Use parseVectorTileRust instead for better performance
 */
export const parseVectorTile = (arrayBuffer: ArrayBuffer): VectorTile => {
  try {
    // Create a vector tile from the buffer
    const pbf = new Pbf(arrayBuffer);
    const vectorTile = new VectorTile(pbf);
    return vectorTile;
  } catch (error) {
    console.error("Error parsing vector tile:", error);
    return {} as VectorTile;
  }
};

/**
 * Parse vector tile data using Rust/WASM implementation
 */
export const parseVectorTileRust = (
  _arrayBuffer: ArrayBuffer,
  tile: Tile
): string => {
  try {
    const wasmModule = getWasmModule();
    if (!wasmModule) {
      throw new Error("WASM module not available");
    }

    // Generate a unique key for this tile
    const tileKey = `${tile.z}/${tile.x}/${tile.y}`;

    // Note: parse_mvt_data function doesn't exist in the current WASM module
    // This functionality might be handled differently or needs to be implemented
    console.warn("parseVectorTileRust: parse_mvt_data function not available in WASM module");

    return tileKey;
  } catch (error) {
    console.error("Error parsing vector tile with Rust:", error);
    throw error;
  }
};

/**
 * Extract features from parsed MVT data using Rust
 * This function calls WASM to process and cache features, not to return them directly
 */
export const extractFeaturesFromLayer = (
  bbox: number[],
  vtDataSet: any,
  bboxKey: string,
  elevationBboxKey?: string
): Promise<void> => {
  try {
    const wasmModule = getWasmModule();
    if (!wasmModule || !wasmModule.extract_features_from_vector_tiles) {
      throw new Error("WASM module or extract_features_from_vector_tiles function not available");
    }

    // Call Rust function with proper input structure for feature extraction
    const input = {
      bbox: bbox,
      vtDataSet: vtDataSet,
      bboxKey: bboxKey,
      elevationBBoxKey: elevationBboxKey
    };
    
    // This processes and caches the features in WASM, doesn't return them
    return wasmModule.extract_features_from_vector_tiles(input);
  } catch (error) {
    console.error(`Error extracting features from layer '${vtDataSet.sourceLayer}':`, error);
    throw error;
  }
};

/**
 * Extract features for a specific layer after vector tiles have been cached
 * This is the main function to call for feature extraction in the app
 */
export const extractGeojsonFeaturesFromVectorTiles = async (config: {
  bbox: number[];
  vtDataSet: any;
  bboxKey: string;
  elevationBboxKey?: string;
}): Promise<void> => {
  const { bbox, vtDataSet, bboxKey, elevationBboxKey } = config;
  
  console.log(`Extracting features for layer: ${vtDataSet.sourceLayer}`);
  
  // Call the WASM function to extract and cache features
  await extractFeaturesFromLayer(bbox, vtDataSet, bboxKey, elevationBboxKey);
  
  console.log(`✅ Features extracted and cached for layer: ${vtDataSet.sourceLayer}`);
};

/**
 * Calculate the number of tiles at a given zoom level
 */
export const calculateTileCount = (
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  zoom: number
): number => {
  const minTile = lngLatToTile(minLng, minLat, zoom);
  const maxTile = lngLatToTile(maxLng, maxLat, zoom);

  const width = Math.abs(maxTile.x - minTile.x) + 1;
  const height = Math.abs(maxTile.y - minTile.y) + 1;

  return width * height;
};

/**
 * Convert lng/lat to tile coordinates
 */
export const lngLatToTile = (
  lng: number,
  lat: number,
  zoom: number
): { x: number; y: number } => {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);

  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  return { x, y };
};

/**
 * Get all tiles that cover the bounding box
 */
export const getTilesForBbox = (
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  zoom: number
): Tile[] => {
  const minTile = lngLatToTile(minLng, minLat, zoom);
  const maxTile = lngLatToTile(maxLng, maxLat, zoom);

  const tiles: Tile[] = [];

  for (
    let x = Math.min(minTile.x, maxTile.x);
    x <= Math.max(minTile.x, maxTile.x);
    x++
  ) {
    for (
      let y = Math.min(minTile.y, maxTile.y);
      y <= Math.max(minTile.y, maxTile.y);
      y++
    ) {
      tiles.push({ x, y, z: zoom });
    }
  }

  return tiles;
};

/**
 * Fetch vector tile data for a specified bounding box
 * Uses WASM when available, falls back to JS implementation
 */
export const fetchVtData = async (
  config: FetchVtDataOptions
): Promise<unknown[]> => {
  const { bbox, zoom, gridSize, bboxKey } = config;
  const [minLng, minLat, maxLng, maxLat] = bbox;

  if (!gridSize || !gridSize.width || !gridSize.height) {
    console.warn("Invalid or missing gridSize. Returning no data.");
    return [];
  }

  try {
    // Check if we can use the Rust/WASM implementation
    const wasmModule = getWasmModule();
    if (wasmModule && wasmModule.fetch_vector_tiles) {
      console.log("Using WASM vector tile fetching for performance");

      const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoom);
      if (tileCount > 9) {
        console.warn(
          `Skipping geometry data fetch: area too large (${tileCount} tiles, max allowed: 9)`
        );
        return [];
      }

      // Create a bbox_key using the same approach as terrain
      // This ensures tiles are cached under the same key for both terrain and vector tiles
      const bboxKeyValue = bboxKey || hashBbox({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]
        }
      });

      // Prepare the input for the Rust function
      const input = {
        min_lng: minLng,
        min_lat: minLat,
        max_lng: maxLng,
        max_lat: maxLat,
        zoom,
        grid_width: gridSize.width,
        grid_height: gridSize.height,
        bbox_key: bboxKeyValue
      };

      // Call the Rust function to fetch and cache the vector tiles
      await wasmModule.fetch_vector_tiles(input);

    }
    return [];
  } catch (error) {
    console.error("Error in fetchVtData:", error);
    // Fall back to an empty result set in case of errors
    return [];
  }
};