import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { Tile, GridSize, VtDataSet } from "./GenerateMeshButton";
import { hashBbox } from "../utils/configHashing";

export interface BuildingData {
  footprint: number[][]; // Simplified to single polygon ring
  height: number;
  baseElevation: number; // Elevation at building position
}
export interface GeometryData {
  geometry: number[][]; // Represents a single polygon ring
  type: string; // Geometry type (e.g., Polygon, LineString)
  height: number;
  baseElevation: number; // Elevation at geometry position
}

export interface LineStringData {
  coordinates: number[][]; // Represents a line string
}

export interface PointData {
  coordinates: number[]; // Represents a point
}

// Function to parse MVT
export const parseVectorTile = (arrayBuffer: ArrayBuffer): any => {
  try {
    // Create a vector tile from the buffer
    const pbf = new Pbf(arrayBuffer);
    const vectorTile = new VectorTile(pbf);
    return vectorTile;
  } catch (error) {
    console.error("Error parsing vector tile:", error);
    return {};
  }
};

// Process building data to map to the terrain
export const processBuildings = (
  buildingFeatures: GeometryData[],
  elevationGrid: number[][],
  gridSize: GridSize,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number
): BuildingData[] => {
  const buildings: BuildingData[] = [];
  const { width, height } = gridSize;

  // Filter out invalid or empty building features
  buildingFeatures = buildingFeatures
    .filter((feature) => feature && feature.geometry && feature.type === "Polygon")
    .filter((feature) => feature.geometry?.[0]?.length);

  buildingFeatures.forEach((feature) => {
    // Get building footprint
    const footprint = feature.geometry;
    if (!footprint?.length) return;

    // Check if ALL points are within bounds
    let fullyInBounds = true;
    for (const point of footprint) {
      const [lng, lat] = point;
      if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
        fullyInBounds = false;
        break;
      }
    }
    if (!fullyInBounds) return;

    // Determine building height
    let buildingHeight = 5;
    if (
      feature.height !== undefined &&
      !isNaN(feature.height)
    ) {
      buildingHeight = feature.height;
    }
    buildingHeight = Math.max(5, Math.min(500, buildingHeight));

    // Get base elevation from nearest grid cell
    const centroid = calculateCentroid(footprint);
    const [centroidLng, centroidLat] = centroid;
    const gridX = Math.floor(
      ((centroidLng - minLng) / (maxLng - minLng || 1)) * (width - 1)
    );
    const gridY = Math.floor(
      ((centroidLat - minLat) / (maxLat - minLat || 1)) * (height - 1)
    );

    let baseElevation = 0;
    if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
      baseElevation = elevationGrid[gridY][gridX];
    } else {
      const nearestX = Math.max(0, Math.min(width - 1, gridX));
      const nearestY = Math.max(0, Math.min(height - 1, gridY));
      baseElevation = elevationGrid[nearestY][nearestX];
    }

    buildings.push({
      footprint,
      height: buildingHeight,
      baseElevation,
    });
  });

  console.log(`Processed ${buildings.length} buildings for 3D model`);
  return buildings;
};

// Helper to calculate centroid of a polygon
const calculateCentroid = (points: number[][]): number[] => {
  let sumX = 0;
  let sumY = 0;

  for (const point of points) {
    sumX += point[0];
    sumY += point[1];
  }

  return [sumX / points.length, sumY / points.length];
};
// Helper function to calculate the number of tiles at a given zoom level
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

// Convert lng/lat to tile coordinates
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

// Get all tiles that cover the bounding box
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

export interface ExtractGeojsonFeaturesFromVectorTilesOptions {
  vectorTiles: { tile: Tile, data: VectorTile }[];
  vtDataset: VtDataSet;
  elevationGrid: number[][];
  gridSize: GridSize;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}
export const extractGeojsonFeaturesFromVectorTiles = async (
  config: ExtractGeojsonFeaturesFromVectorTilesOptions
): Promise<GeometryData[]> => {
  const { bbox, vectorTiles, vtDataset, elevationGrid, gridSize } = config;
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Skip processing if the layer is explicitly disabled
  if (vtDataset.enabled === false) {
    console.log(`Skipping disabled layer "${vtDataset.sourceLayer}"`);
    return [];
  }

  const geometryData: GeometryData[] = [];

  vectorTiles.forEach((vtEl) => {
    let vectorTile = vtEl.data;
    let tile = vtEl.tile;

    if (!vectorTile.layers || !vectorTile.layers[vtDataset.sourceLayer]) {
      console.warn(`Source layer "${vtDataset.sourceLayer}" not found in tile`);
      return;
    }

    const layer = vectorTile.layers[vtDataset.sourceLayer];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i).toGeoJSON(tile.x, tile.y, tile.z);

      // Filter by subclass if specified
      if (vtDataset?.subClass && vtDataset.subClass.indexOf(feature.properties?.subclass) !== -1) {
        continue;
      }

      // Apply filter expression if provided
      if (vtDataset.filter && !evaluateFilter(vtDataset.filter, feature)) {
        continue;
      }

      if (feature.geometry.type === "Polygon") {
        feature.geometry.coordinates.forEach((ring) => {
          const baseElevation = calculateBaseElevation(
            ring,
            elevationGrid,
            gridSize,
            minLng,
            minLat,
            maxLng,
            maxLat
          );

          geometryData.push({
            geometry: ring,
            type: "Polygon",
            height: feature?.properties?.height || feature?.properties?.render_height, // Default height
            baseElevation,
          });
        });
      } else if (feature.geometry.type === "MultiPolygon") {
        feature.geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => {
            const baseElevation = calculateBaseElevation(
              ring,
              elevationGrid,
              gridSize,
              minLng,
              minLat,
              maxLng,
              maxLat
            );

            geometryData.push({
              geometry: ring,
              type: "Polygon",
              height: feature?.properties?.height || feature?.properties?.render_height, // Default height
              baseElevation,
            });
          });
        });
      } else if (feature.geometry.type === "LineString") {

        //console.log("LineString geometry detected", feature.geometry);
        const baseElevation = calculateBaseElevation(
          feature.geometry.coordinates,
          elevationGrid,
          gridSize,
          minLng,
          minLat,
          maxLng,
          maxLat
        );

        geometryData.push({
          geometry: feature.geometry.coordinates,
          type: "LineString",
          height: feature?.properties?.height || feature?.properties?.render_height || 0, // Default height
          baseElevation,
        });
      } else if (feature.geometry.type === "Point") {
        const baseElevation = calculateBaseElevation(
          [feature.geometry.coordinates],
          elevationGrid,
          gridSize,
          minLng,
          minLat,
          maxLng,
          maxLat
        );

        geometryData.push({
          geometry: [feature.geometry.coordinates],
          type: "Point",
          height: feature?.properties?.height || feature?.properties?.render_height || 0, // Default height
          baseElevation,
        });
      } else if (feature.geometry.type === "MultiLineString") {
        //console.log("MultiLineString geometry detected", feature.geometry);
        feature.geometry.coordinates.forEach((lineString) => {
          const baseElevation = calculateBaseElevation(
            lineString,
            elevationGrid,
            gridSize,
            minLng,
            minLat,
            maxLng,
            maxLat
          );

          geometryData.push({
            geometry: lineString,
            type: "LineString",
            height: feature?.properties?.height || feature?.properties?.render_height || 0, // Default height
            baseElevation,
          });
        });
      } else if (feature.geometry.type === "MultiPoint") {
        feature.geometry.coordinates.forEach((point) => {
          const baseElevation = calculateBaseElevation(
            [point],
            elevationGrid,
            gridSize,
            minLng,
            minLat,
            maxLng,
            maxLat
          );

          geometryData.push({
            geometry: [point],
            type: "Point",
            height: feature?.properties?.height || feature?.properties?.render_height || 0, // Default height
            baseElevation,
          });
        });
      }
    }

    console.log(`Fetched ${geometryData.length} polygons from source layer "${vtDataset.sourceLayer}"`);
  });
  return geometryData;
};

export interface FetchVtDataOptions {
  bbox: number[]; // [minLng, minLat, maxLng, maxLat]
  zoom: number;
  gridSize: GridSize;
  bboxKey?: string; // Optional key for caching
}

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
    if (window.wasmModule && window.wasmModule.fetch_vector_tiles) {
      console.log("Using WASM vector tile fetching for performance");
      
      // Create a bbox_key using the same approach as terrain
      // This ensures tiles are cached under the same key for both terrain and vector tiles
      const bboxKeyValue = bboxKey || hashBbox({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]
        },
        properties:{}
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
      const wasmResult = await window.wasmModule.fetch_vector_tiles(input);
      
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

      let vtData: { tile: Tile, data: VectorTile[] }[] = [];

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
      )).filter((tile) => tile !== undefined);
    }
  } catch (error) {
    console.error("Error in fetchVtData:", error);
    // Fall back to an empty result set in case of errors
    return [];
  }
};

/**
 * Calculate the base elevation for a polygon ring using the elevation grid.
 * @param ring The polygon ring (array of [lng, lat] coordinates).
 * @param elevationGrid The elevation grid.
 * @param gridSize The size of the elevation grid.
 * @param minLng Minimum longitude of the bounding box.
 * @param minLat Minimum latitude of the bounding box.
 * @param maxLng Maximum longitude of the bounding box.
 * @param maxLat Maximum latitude of the bounding box.
 * @returns The average base elevation for the ring.
 */
const calculateBaseElevation = (
  ring: number[][],
  elevationGrid: number[][],
  gridSize: GridSize,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number
): number => {
  const { width, height } = gridSize;
  let totalElevation = 0;
  let validPoints = 0;

  ring.forEach(([lng, lat]) => {
    const x = Math.floor(((lng - minLng) / (maxLng - minLng)) * (width - 1));
    const y = Math.floor(((lat - minLat) / (maxLat - minLat)) * (height - 1));

    if (x >= 0 && x < width && y >= 0 && y < height) {
      totalElevation += elevationGrid[y][x];
      validPoints++;
    }
  });

  return validPoints > 0 ? totalElevation / validPoints : 0;
};

// Add this new filter evaluation function
/**
 * Evaluates a MapLibre filter expression against a feature
 * @param filter The filter expression array
 * @param feature The feature to test against the filter
 * @returns Boolean indicating if the feature passes the filter
 */
export function evaluateFilter(
  filter: any[] | undefined,
  feature: GeoJSON.Feature
): boolean {
  if (!filter) return true;

  // Get operator type (first element in the array)
  const operator = filter[0];

  if (operator === "all") {
    // All conditions must be true
    for (let i = 1; i < filter.length; i++) {
      if (!evaluateFilter(filter[i], feature)) return false;
    }
    return true;
  } else if (operator === "any") {
    // At least one condition must be true
    for (let i = 1; i < filter.length; i++) {
      if (evaluateFilter(filter[i], feature)) return true;
    }
    return false;
  } else if (operator === "none") {
    // None of the conditions should be true
    for (let i = 1; i < filter.length; i++) {
      if (evaluateFilter(filter[i], feature)) return false;
    }
    return true;
  } else if (operator === "==") {
    const [_, key, value] = filter;

    if (key === "$type") {
      return feature.geometry.type === value;
    } else {
      return feature.properties?.[key] === value;
    }
  } else if (operator === "!=") {
    const [_, key, value] = filter;

    if (key === "$type") {
      return feature.geometry.type !== value;
    } else {
      return feature.properties?.[key] !== value;
    }
  } else if (operator === "in") {
    const [_, key, ...values] = filter;

    if (key === "$type") {
      return values.includes(feature.geometry.type);
    } else {
      return values.includes(feature.properties?.[key]);
    }
  } else if (operator === "!in") {
    const [_, key, ...values] = filter;

    if (key === "$type") {
      return !values.includes(feature.geometry.type);
    } else {
      return !values.includes(feature.properties?.[key]);
    }
  } else if (operator === "has") {
    const key = filter[1];
    return key in (feature.properties || {});
  } else if (operator === "!has") {
    const key = filter[1];
    return !(key in (feature.properties || {}));
  }

  // Return true for unsupported operators
  console.warn(`Unsupported filter operator: ${operator}`);
  return true;
}
