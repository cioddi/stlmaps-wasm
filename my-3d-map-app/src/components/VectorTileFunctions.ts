import { VectorTile } from "@mapbox/vector-tile";
import { GridSize } from "@mui/material";
import Pbf from "pbf";
import { Tile } from "./GenerateMeshButton";

// Add new interfaces for building data
export interface BuildingFeature {
  geometry: {
    coordinates: number[][][]; // Polygon coordinates
    type: string;
  };
  properties: {
    render_height?: number; // Height data
    height?: number; // Alternative height property
  };
}

export interface BuildingData {
  footprint: number[][]; // Simplified to single polygon ring
  height: number;
  baseElevation: number; // Elevation at building position
}

// Function to fetch building data from vector tiles
export const fetchBuildingData = async (
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  zoom: number
): Promise<BuildingFeature[]> => {
  // Calculate number of tiles and check if there are too many
  const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoom);
  if (tileCount > 9) {
    console.warn(
      `Skipping building data fetch: area too large (${tileCount} tiles, max allowed: 9)`
    );
    return [];
  }

  // Get tiles that cover the bounding box
  const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
  console.log(`Fetching building data from ${tiles.length} tiles`);

  const buildingFeatures: BuildingFeature[] = [];

  try {
    // Get the current map style to extract building layer source
    const map = document._map;
    if (!map) {
      console.error("Map instance not found");
      return buildingFeatures;
    }

    // Find building source from map style
    const style = map.getStyle();
    let buildingSource = null;
    let buildingSourceLayer = null;

    // Find a layer containing buildings
    for (const layerId in style.layers) {
      const layer = style.layers[layerId];
      if (
        layer.id.toLowerCase().includes("building") ||
        (layer["source-layer"] &&
          layer["source-layer"].toLowerCase().includes("building"))
      ) {
        buildingSource = layer.source;
        buildingSourceLayer = layer["source-layer"];
        break;
      }
    }

    if (!buildingSource || !buildingSourceLayer) {
      console.warn("Could not find building source layer in map style");
      // Fallback to OpenMapTiles source
      buildingSource = "openmaptiles";
      buildingSourceLayer = "building";
    }

    // Get source URL template
    const sourceInfo = style.sources[buildingSource];
    if (!sourceInfo || !sourceInfo.tiles) {
      console.warn("Building source doesn't have tile URLs");
      return buildingFeatures;
    }

    const tileUrlTemplate = sourceInfo.tiles[0];

    await Promise.all(
      tiles.map(async (tile) => {
        // Replace placeholders in URL template with tile coordinates
        const url = tileUrlTemplate
          .replace("{z}", tile.z.toString())
          .replace("{x}", tile.x.toString())
          .replace("{y}", tile.y.toString());

        console.log(`Fetching buildings from: ${url}`);

        try {
          const response = await fetch(url);

          if (!response.ok) {
            console.warn(`Failed to fetch building tile: ${response.status}`);
            return;
          }

          const arrayBuffer = await response.arrayBuffer();

          // Parse MVT tile
          const vectorTile = parseVectorTile(arrayBuffer);

          // Extract building features
          const buildings = extractBuildingsFromVectorTile(
            vectorTile,
            tile,
            buildingSourceLayer
          );

          // Add to collection
          buildingFeatures.push(...buildings);
        } catch (error) {
          console.error(
            `Error fetching building tile ${tile.z}/${tile.x}/${tile.y}:`,
            error
          );
        }
      })
    );

    console.log(`Found ${buildingFeatures.length} buildings`);

    // Filter out any building features with invalid geometry
    const validBuildingFeatures = buildingFeatures.filter((feature) => {
      // Must have a Polygon geometry
      if (
        !feature.geometry ||
        (feature.geometry.type !== "Polygon" &&
          feature.geometry.type !== "MultiPolygon")
      ) {
        return false;
      }

      // Check each coordinate for NaN or non-finite values
      if (feature.geometry.type === "Polygon") {
        for (const ring of feature.geometry.coordinates) {
          for (const [lng, lat] of ring) {
            if (!isFinite(lng) || !isFinite(lat)) return false;
          }
        }
      } else {
        // MultiPolygon
        for (const polygon of feature.geometry.coordinates) {
          for (const ring of polygon) {
            for (const [lng, lat] of ring) {
              if (!isFinite(lng) || !isFinite(lat)) return false;
            }
          }
        }
      }

      return true;
    });

    console.log(
      `Filtered out invalid buildings, remaining: ${validBuildingFeatures.length}`
    );
    return validBuildingFeatures;
  } catch (error) {
    console.error("Error fetching building data:", error);
    return [];
  }
};

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

// Function to extract buildings from vector tile
const extractBuildingsFromVectorTile = (
  vectorTile: any,
  tile: Tile,
  sourceLayer: string
): BuildingFeature[] => {
  const features: BuildingFeature[] = [];

  try {
    // Check if the tile has the building layer
    if (!vectorTile.layers || !vectorTile.layers[sourceLayer]) {
      return features;
    }

    const buildingLayer = vectorTile.layers[sourceLayer];
    const tileSize = 4096; // Standard MVT tile size

    // Iterate through building features in this layer
    for (let i = 0; i < buildingLayer.length; i++) {
      const feature = buildingLayer.feature(i);
      const geomType = feature.type;

      // We only want polygons for buildings
      if (geomType !== 3) continue;

      // Get the geometry as GeoJSON
      const geojson = feature.toGeoJSON(tile.x, tile.y, tile.z);

      // Only process if we have polygon geometry
      if (
        geojson.geometry.type !== "Polygon" &&
        geojson.geometry.type !== "MultiPolygon"
      ) {
        continue;
      }

      // For MultiPolygon, we treat each polygon as a separate building
      if (geojson.geometry.type === "MultiPolygon") {
        geojson.geometry.coordinates.forEach((polygonCoords) => {
          features.push({
            geometry: {
              type: "Polygon",
              coordinates: polygonCoords,
            },
            properties: {
              render_height:
                feature.properties.render_height || feature.properties.height,
              height:
                feature.properties.height ||
                feature.properties.render_height ||
                5,
            },
          });
        });
      } else {
        // Single polygon
        features.push({
          geometry: {
            type: "Polygon",
            coordinates: geojson.geometry.coordinates,
          },
          properties: {
            render_height:
              feature.properties.render_height || feature.properties.height,
            height:
              feature.properties.height ||
              feature.properties.render_height ||
              5,
          },
        });
      }
    }

    return features;
  } catch (error) {
    console.error("Error extracting buildings from vector tile:", error);
    return [];
  }
};

// Alternative implementation for direct building fetch if the map instance doesn't expose the needed APIs
export const fetchBuildingDataDirect = async (
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  zoom: number
): Promise<BuildingFeature[]> => {
  // Calculate number of tiles and check if there are too many
  const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoom);
  if (tileCount > 9) {
    console.warn(
      `Skipping direct building data fetch: area too large (${tileCount} tiles, max allowed: 9)`
    );
    return [];
  }

  // Get tiles that cover the bounding box
  const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
  console.log(
    `Fetching building data from ${tiles.length} tiles using direct method`
  );

  const buildingFeatures: BuildingFeature[] = [];

  try {
    // Use OpenMapTiles or OSM vector tile source
    const baseUrl = "https://wms.wheregroup.com/tileserver/tile/world-0-14";

    await Promise.all(
      tiles.map(async (tile) => {
        const url = `${baseUrl}/${tile.z}/${tile.x}/${tile.y}.pbf`;

        console.log(`Fetching buildings from: ${url}`);

        try {
          const response = await fetch(url);

          if (!response.ok) {
            console.warn(`Failed to fetch building tile: ${response.status}`);
            return;
          }

          const arrayBuffer = await response.arrayBuffer();
          const vectorTile = parseVectorTile(arrayBuffer);

          // Building layer name in OpenMapTiles
          const buildings = extractBuildingsFromVectorTile(
            vectorTile,
            tile,
            "building"
          );

          // Add to collection
          buildingFeatures.push(...buildings);
        } catch (error) {
          console.error(
            `Error fetching building tile ${tile.z}/${tile.x}/${tile.y}:`,
            error
          );
        }
      })
    );

    console.log(`Found ${buildingFeatures.length} buildings`);
    return buildingFeatures;
  } catch (error) {
    console.error("Error fetching building data:", error);
    return [];
  }
};

// Process building data to map to the terrain
export const processBuildings = (
  buildingFeatures: BuildingFeature[],
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
    .filter((feature) => feature && feature.geometry && feature.geometry.type === "Polygon")
    .filter((feature) => feature.geometry.coordinates?.[0]?.length);

  buildingFeatures.forEach((feature) => {
    // Get building footprint
    const footprint = feature.geometry.coordinates[0];
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
      feature.properties.render_height !== undefined &&
      !isNaN(feature.properties.render_height)
    ) {
      buildingHeight = feature.properties.render_height;
    } else if (
      feature.properties.height !== undefined &&
      !isNaN(feature.properties.height)
    ) {
      buildingHeight = feature.properties.height;
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
