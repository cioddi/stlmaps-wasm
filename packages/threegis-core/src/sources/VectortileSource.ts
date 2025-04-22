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
): Promise<{ tile: Tile, data: VectorTile }[]> => {
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
      
      // Call the Rust function
      const wasmResult = await wasmModule.fetch_vector_tiles(input);
      
      // Convert the Rust result to JavaScript-friendly format
      return wasmResult.map((result: any) => {
        const tile: Tile = {
          x: result.tile.x,
          y: result.tile.y,
          z: result.tile.z
        };
        
        // Convert the binary data to a vector tile
        const vectorTile = parseVectorTile(result.data);
        
        return { tile, data: vectorTile };
      });
    } else {
      console.log("WASM module not available, using JavaScript vector tile fetching");
      
      // Fall back to the original JavaScript implementation if WASM is not available
      const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoom);
      if (tileCount > 9) {
        console.warn(
          `Skipping geometry data fetch: area too large (${tileCount} tiles, max allowed: 9)`
        );
        return [];
      }

      const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
      console.log(`Fetching geometry data from ${tiles.length} tiles`);

      return (await Promise.all(
        tiles.map(async (tile) => {
          const url = `https://wms.wheregroup.com/tileserver/tile/world-0-14/${tile.z}/${tile.x}/${tile.y}.pbf`;

          console.log(`Fetching geometry from: ${url}`);

          try {
            const response = await fetch(url);
            if (!response.ok) {
              console.warn(`Failed to fetch tile: ${response.status}`);
              return;
            }

            const arrayBuffer = await response.arrayBuffer();
            const vectorTile = parseVectorTile(arrayBuffer);

            return { tile, data: vectorTile };
          } catch (error) {
            console.error(`Error fetching tile ${tile.z}/${tile.x}/${tile.y}:`, error);
          }
        })
      )).filter((tile): tile is { tile: Tile, data: VectorTile } => tile !== undefined);
    }
  } catch (error) {
    console.error("Error in fetchVtData:", error);
    // Fall back to an empty result set in case of errors
    return [];
  }
};