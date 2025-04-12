import { useState, useEffect } from "react";
import { Slider, Typography, Box } from "@mui/material";
import {
  GeometryData,
  calculateTileCount,
  extractGeojsonFeaturesFromVectorTiles,
  fetchVtData,
  getTilesForBbox,
  processBuildings,
} from "./VectorTileFunctions";
import * as THREE from "three";
//@ts-expect-error
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import createPolygonGeometry from "../three_maps/createPolygonGeometry";
import { createBuildingsGeometry } from "../three_maps/createBuildingsGeometry";
import { createTerrainGeometry } from "../three_maps/createTerrainGeometry";
import { bufferLineString } from "../three_maps/bufferLineString";
import useLayerStore from "../stores/useLayerStore";

// Define interfaces for our data structures
export interface GridSize {
  width: number;
  height: number;
}

export interface VtDataSet {
  sourceLayer: string;
  subClass?: string[];
  color: THREE.Color;
  data?: GeometryData[];
  geometry?: THREE.BufferGeometry;
  extrusionDepth?: number;
  zOffset?: number;
  bufferSize?: number;
  filter?: any[]; // Add support for MapLibre-style filter expressions
  useAdaptiveScaleFactor?: boolean;
  heightScaleFactor?: number;
  alignVerticesToTerrain?: boolean;
  enabled?: boolean;
}

export interface Tile {
  x: number;
  y: number;
  z: number;
}

interface TileData {
  imageData?: ImageData;
  width: number;
  height: number;
  x: number;
  y: number;
  z: number;
}

interface GeoJSONFeature {
  geometry: {
    type: string;
    coordinates: number[][][];
  };
  properties?: Record<string, any>;
  type: string;
}

interface ElevationProcessingResult {
  elevationGrid: number[][];
  gridSize: GridSize;
  minElevation: number;
  maxElevation: number;
}

interface GenerateMeshButtonProps {
}

export const GenerateMeshButton = function () {
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Get settings and setter functions directly from Zustand store
  const {
    bbox,
    vtLayers,
    terrainSettings,
    buildingSettings,
    setGeometryDataSets
  } = useLayerStore();

  // Modify generate3DModel function to include buildings
  const generate3DModel = async (): Promise<void> => {
    if (!bbox) {
      console.error("Cannot generate 3D model: bbox is undefined");
      return;
    }

    console.log("%c 🏗️ STARTING 3D MODEL GENERATION", "background: #4CAF50; color: white; padding: 4px; font-weight: bold;");
    console.log("Generating 3D model for:", bbox);
    console.log("Using terrain settings:", terrainSettings);
    console.log("Using building settings:", buildingSettings);
    console.log("Using vector tile layers:", vtLayers);

    try {
      // Extract bbox coordinates from the feature
      const feature = bbox;

      if (!feature.geometry || feature.geometry.type !== "Polygon") {
        console.error("Invalid geometry: expected a Polygon");
        return;
      }

      const coordinates = feature.geometry.coordinates[0]; // First ring of the polygon

      // Find min/max coordinates
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      coordinates.forEach((coord: number[]) => {
        const [lng, lat] = coord;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      });

      // Find appropriate zoom level where we get at most 4 tiles
      // Start with maximum supported zoom level (12)
      let zoom = 12;
      while (zoom > 0) {
        const tileCount = calculateTileCount(
          minLng,
          minLat,
          maxLng,
          maxLat,
          zoom
        );
        if (tileCount <= 4) break;
        zoom--;
      }

      console.log(`Using zoom level ${zoom} for the 3D model`);

      // Get tile coordinates
      const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
      console.log(`Downloading ${tiles.length} tiles`);

      // Download tile data
      console.log("🌐 Downloading tile data for tiles:", tiles);
      const tileData = await Promise.all(
        tiles.map((tile) => downloadTile(tile.z, tile.x, tile.y))
      );
      console.log("✅ Successfully downloaded all tile data:", tileData.length);

      // Process elevation data to create a grid
      console.log("🏔️ Processing elevation data...");
      const { elevationGrid, gridSize, minElevation, maxElevation } =
        processElevationData(tileData, tiles, minLng, minLat, maxLng, maxLat);
      console.log("✅ Elevation data processed:", { gridSize, minElevation, maxElevation });

      // Always use zoom level 14 for building data, since that's where buildings are available
      const buildingZoom = 14; // Force zoom 14 for buildings
      console.log(`Fetching buildings at fixed zoom level ${buildingZoom}`);

      // Fetch vt data for this bbox
      let vtData = await fetchVtData({
        bbox: [minLng, minLat, maxLng, maxLat],
        zoom: 14,
        gridSize,
      });

      // Generate three.js geometry from elevation grid and buildings
      console.log("🗻 Creating terrain geometry...");
      // Use settings from the Zustand store
      let {
        geometry: terrainGeometry,
        processedElevationGrid,
        processedMinElevation,
        processedMaxElevation,
      } = createTerrainGeometry(
        elevationGrid,
        gridSize,
        minElevation,
        maxElevation,
        terrainSettings.verticalExaggeration,
        terrainSettings.baseHeight
      );
      console.log("✅ Terrain geometry created successfully:", {
        geometryExists: !!terrainGeometry,
        vertexCount: terrainGeometry?.attributes?.position?.count || 0
      });

      // Set generated geometries based on settings
      console.log("🔄 Setting output geometries:", {
        terrainEnabled: terrainSettings.enabled,
        terrainGeometryExists: !!terrainGeometry,
        buildingsEnabled: buildingSettings.enabled,
      });

      //setTerrainGeometry(terrainSettings.enabled ? terrainGeometry : undefined);

      // Process vector tile layers
      const vtPolygonGeometries: VtDataSet[] = [];

      // Use layers from Zustand store
      for (let i = 0; i < vtLayers.length; i++) {
        const currentLayer = vtLayers[i];

        // Skip disabled layers
        if (currentLayer.enabled === false) {
          console.log(`Skipping disabled layer: ${currentLayer.sourceLayer}`);
          continue;
        }

        console.log(`Fetching ${currentLayer.sourceLayer} data...`);

        // Fetch data for this layer
        let layerData = await extractGeojsonFeaturesFromVectorTiles({
          bbox: [minLng, minLat, maxLng, maxLat],
          vtDataset: currentLayer,
          vectorTiles: vtData,
          elevationGrid: processedElevationGrid,
          gridSize,
        });

        console.log(`Received ${layerData?.length || 0} ${currentLayer.sourceLayer} features`);

        if (layerData && layerData.length > 0) {
          // Define clipping boundaries
          const TERRAIN_SIZE = 200;
          const clipBoundaries = {
            minX: -TERRAIN_SIZE / 2,
            maxX: TERRAIN_SIZE / 2,
            minY: -TERRAIN_SIZE / 2,
            maxY: TERRAIN_SIZE / 2,
            minZ: terrainSettings.baseHeight - 20,
            maxZ: terrainSettings.baseHeight + 100,
          };

          // Convert LineString geometries to polygons using a buffer
          layerData = layerData.map((feature) => {
            if (feature.type === "LineString") {
              const bufferedPolygon = bufferLineString(feature.geometry, vtLayers[i].bufferSize || 1); // Adjust buffer size as needed
              return { ...feature, type: 'Polygon', geometry: bufferedPolygon };
            }
            return feature;
          });

          const layerGeometry = createPolygonGeometry({
            polygons: layerData as GeometryData[],
            terrainBaseHeight: terrainSettings.baseHeight,
            bbox: [minLng, minLat, maxLng, maxLat],
            elevationGrid: processedElevationGrid,
            gridSize,
            minElevation: processedMinElevation,
            maxElevation: processedMaxElevation,
            vtDataSet: vtLayers[i],
            useSameZOffset: true,
          });

          if (
            layerGeometry &&
            layerGeometry.attributes &&
            layerGeometry.attributes.position &&
            layerGeometry.attributes.position.count > 0
          ) {
            console.log(
              `Created valid ${vtLayers[i].sourceLayer} geometry with ${layerGeometry.attributes.position.count} vertices`
            );
            vtPolygonGeometries.push({
              ...vtLayers[i],
              geometry: layerGeometry
            } as VtDataSet);
          } else {
            console.warn(
              `Failed to create valid ${vtLayers[i].sourceLayer} geometry or all features were clipped out`
            );
          }
        } else {
          console.warn(`No ${vtLayers[i].sourceLayer} features found`);
        }
      }



      // Create debug visualization for the terrain area if needed
      if (vtPolygonGeometries.length > 0) {
        // Create a box to visualize the clipping area (but don't actually use it for clipping)
        const TERRAIN_SIZE = 200;
        const boxGeometry = new THREE.BoxGeometry(
          TERRAIN_SIZE,
          TERRAIN_SIZE,
          TERRAIN_SIZE / 2
        );

        // Add the box geometry to the geometries (optional, for debugging only)
        //vtPolygonGeometries.push(boxGeometry);
      }

      //setPolygonGeometries(vtPolygonGeometries);
      setGeometryDataSets({
        terrainGeometry,
        polygonGeometries: vtPolygonGeometries
      })
      console.log("3D model generation complete!");

    } catch (error) {
      console.error("Error generating 3D model:", error);
    }
  };

  // Download a single tile from the WMTS service
  const downloadTile = async (
    z: number,
    x: number,
    y: number
  ): Promise<TileData> => {
    const url = `https://wms.wheregroup.com/dem_tileserver/raster_dem/${z}/${x}/${y}.webp`;

    console.log(`Downloading tile: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download tile: ${response.status}`);
      }

      // Get the image as blob
      const blob = await response.blob();

      // Use image bitmap for processing
      const imageBitmap = await createImageBitmap(blob);

      // Create a canvas to read pixel data
      const canvas = document.createElement("canvas");
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");

      ctx.drawImage(imageBitmap, 0, 0);

      // Get the raw pixel data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      return {
        imageData,
        width: canvas.width,
        height: canvas.height,
        x,
        y,
        z,
      };
    } catch (error) {
      console.error(`Error downloading tile ${z}/${x}/${y}:`, error);
      throw error;
    }
  };

  // Process the downloaded tiles to create an elevation grid
  const processElevationData = (
    tileData: TileData[],
    tiles: Tile[],
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number
  ): ElevationProcessingResult => {
    // Define grid size for the final model - higher resolution for better quality
    const gridSize: GridSize = { width: 200, height: 200 };

    // Track accumulated elevation values and weights
    const elevationGrid: number[][] = new Array(gridSize.height)
      .fill(0)
      .map(() => new Array(gridSize.width).fill(0));

    const coverageMap: number[][] = new Array(gridSize.height)
      .fill(0)
      .map(() => new Array(gridSize.width).fill(0));

    // Pre-process: Calculate valid elevation range for normalization
    let minElevationFound = Infinity;
    let maxElevationFound = -Infinity;

    tileData.forEach((tile) => {
      if (!tile.imageData) return;
      const { imageData, width, height } = tile;
      const data = imageData.data;

      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const pixelIndex = (py * width + px) * 4;
          const r = data[pixelIndex];
          const g = data[pixelIndex + 1];
          const b = data[pixelIndex + 2];

          // Decode elevation using the RGB encoding
          const elevation = -10000 + (r * 65536 + g * 256 + b) * 0.1;

          if (isFinite(elevation) && !isNaN(elevation)) {
            minElevationFound = Math.min(minElevationFound, elevation);
            maxElevationFound = Math.max(maxElevationFound, elevation);
          }
        }
      }
    });

    console.log(
      `Elevation range: ${minElevationFound.toFixed(
        2
      )}m - ${maxElevationFound.toFixed(2)}m`
    );

    // Process each tile to extract elevation data
    tileData.forEach((tile) => {
      if (!tile.imageData) return;

      const { imageData, width, height, x: tileX, y: tileY, z: zoom } = tile;
      const data = imageData.data;

      // Calculate the tile bounds in geographic coordinates
      const n = Math.pow(2, zoom);
      const tileMinLng = (tileX / n) * 360 - 180;
      const tileMaxLng = ((tileX + 1) / n) * 360 - 180;

      // Note: In web mercator, y=0 is at the top (north pole)
      const tileMaxLat =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI;
      const tileMinLat =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + 1)) / n))) * 180) /
        Math.PI;

      // For each pixel in our output grid
      for (let y = 0; y < gridSize.height; y++) {
        for (let x = 0; x < gridSize.width; x++) {
          // Calculate the lat/lng for this grid point
          const lng = minLng + (maxLng - minLng) * (x / (gridSize.width - 1));
          const lat = minLat + ((maxLat - minLat) * y) / (gridSize.height - 1);

          // Skip if this point is outside the current tile's geographic bounds
          if (
            lng < tileMinLng ||
            lng > tileMaxLng ||
            lat < tileMinLat ||
            lat > tileMaxLat
          ) {
            continue;
          }

          // Convert geographic coordinates to pixel coordinates in the tile
          // For longitude: simple linear mapping from tileMinLng-tileMaxLng to 0-(width-1)
          const fracX =
            ((lng - tileMinLng) / (tileMaxLng - tileMinLng)) * (width - 1);

          // For latitude: account for Mercator projection (y increases downward in the tile image)
          const fracY =
            (1 - (lat - tileMinLat) / (tileMaxLat - tileMinLat)) * (height - 1);

          // Get integer pixel coordinates
          const pixelX = Math.floor(fracX);
          const pixelY = Math.floor(fracY);

          // Constrain to valid pixel coordinates
          if (
            pixelX < 0 ||
            pixelX >= width - 1 ||
            pixelY < 0 ||
            pixelY >= height - 1
          ) {
            continue;
          }

          // Bilinear interpolation factors
          const dx = fracX - pixelX;
          const dy = fracY - pixelY;

          // Sample the 4 surrounding pixels
          const elevations: number[] = [];
          let hasInvalidElevation = false;

          for (let j = 0; j <= 1; j++) {
            for (let i = 0; i <= 1; i++) {
              const px = pixelX + i;
              const py = pixelY + j;

              if (px >= 0 && px < width && py >= 0 && py < height) {
                const pixelIndex = (py * width + px) * 4;
                const r = data[pixelIndex];
                const g = data[pixelIndex + 1];
                const b = data[pixelIndex + 2];

                // Decode elevation - make sure this matches the encoding used in the DEM tiles
                const elevation = -10000 + (r * 65536 + g * 256 + b) * 0.1;

                if (!isFinite(elevation) || isNaN(elevation)) {
                  hasInvalidElevation = true;
                  break;
                }

                elevations.push(elevation);
              } else {
                hasInvalidElevation = true;
                break;
              }
            }
            if (hasInvalidElevation) break;
          }

          if (hasInvalidElevation || elevations.length !== 4) continue;

          // Bilinear interpolation
          const topLeft = elevations[0];
          const topRight = elevations[1];
          const bottomLeft = elevations[2];
          const bottomRight = elevations[3];

          const top = topLeft * (1 - dx) + topRight * dx;
          const bottom = bottomLeft * (1 - dx) + bottomRight * dx;
          const elevation = top * (1 - dy) + bottom * dy;

          // Calculate edge distance for weighting
          // This creates a weight that's 1.0 in the center and gradually decreases to 0.3 at the edges
          const distFromCenterX = Math.abs(
            2.0 * ((lng - tileMinLng) / (tileMaxLng - tileMinLng) - 0.5)
          );
          const distFromCenterY = Math.abs(
            2.0 * ((lat - tileMinLat) / (tileMaxLat - tileMinLat) - 0.5)
          );
          const maxDist = Math.max(distFromCenterX, distFromCenterY);

          // Smoother falloff at edges - gradient starts earlier
          const edgeWeight = 1.0 - Math.pow(maxDist, 2) * 0.7;

          // Accumulate weighted elevation value
          elevationGrid[y][x] += elevation * edgeWeight;
          coverageMap[y][x] += edgeWeight;
        }
      }
    });

    // Normalize by coverage and ensure we have valid data everywhere
    let missingDataPoints = 0;

    for (let y = 0; y < gridSize.height; y++) {
      for (let x = 0; x < gridSize.width; x++) {
        if (coverageMap[y][x] > 0) {
          elevationGrid[y][x] /= coverageMap[y][x];
        } else {
          missingDataPoints++;

          // Find nearest valid point for missing data
          let nearestValid = null;
          let minDistance = Infinity;

          for (let ny = 0; ny < gridSize.height; ny++) {
            for (let nx = 0; nx < gridSize.width; nx++) {
              if (coverageMap[ny][nx] > 0) {
                const dist = Math.sqrt(
                  Math.pow(nx - x, 2) + Math.pow(ny - y, 2)
                );
                if (dist < minDistance) {
                  minDistance = dist;
                  nearestValid = { x: nx, y: ny };
                }
              }
            }
          }

          if (nearestValid) {
            elevationGrid[y][x] = elevationGrid[nearestValid.y][nearestValid.x];
          } else {
            // Fallback to average if no valid points at all
            elevationGrid[y][x] = (minElevationFound + maxElevationFound) / 2;
          }
        }
      }
    }

    if (missingDataPoints > 0) {
      console.log(`Filled ${missingDataPoints} missing data points`);
    }

    // Apply multiple smoothing passes for better results
    let smoothedGrid = elevationGrid;
    const smoothingPasses = 2;

    for (let i = 0; i < smoothingPasses; i++) {
      smoothedGrid = smoothElevationGrid(smoothedGrid, gridSize);
    }

    return {
      elevationGrid: smoothedGrid,
      gridSize,
      minElevation: minElevationFound,
      maxElevation: maxElevationFound,
    };
  };

  // Helper function to smooth the elevation grid
  const smoothElevationGrid = (
    grid: number[][],
    gridSize: GridSize
  ): number[][] => {
    const { width, height } = gridSize;
    const result = new Array(height)
      .fill(0)
      .map(() => new Array(width).fill(0));

    // Larger kernel for better smoothing
    const kernelSize = 5;
    const kernelRadius = Math.floor(kernelSize / 2);

    // Apply a gaussian smoothing kernel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let totalWeight = 0;

        for (let ky = -kernelRadius; ky <= kernelRadius; ky++) {
          for (let kx = -kernelRadius; kx <= kernelRadius; kx++) {
            const ny = y + ky;
            const nx = x + kx;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              // Gaussian weight based on distance
              const dist = Math.sqrt(kx * kx + ky * ky);
              // Sigma = kernelRadius/2 for a nice falloff
              const weight = Math.exp(
                (-dist * dist) / (2 * kernelRadius * kernelRadius)
              );

              sum += grid[ny][nx] * weight;
              totalWeight += weight;
            }
          }
        }

        if (totalWeight > 0) {
          result[y][x] = sum / totalWeight;
        } else {
          result[y][x] = grid[y][x];
        }
      }
    }

    return result;
  };

  useEffect(() => {
    console.log("GenerateMeshButton dependencies changed:", {
      hasBbox: !!bbox,
      terrainEnabled: terrainSettings?.enabled,
      buildingsEnabled: buildingSettings?.enabled,
      layerCount: vtLayers?.length
    });

    if (debounceTimer) clearTimeout(debounceTimer);
    if (!bbox) {
      console.warn("No bbox available, skipping model generation");
      return;
    }

    const timer = setTimeout(() => {
      console.log("Debounce timer expired, generating 3D model");
      generate3DModel();
    }, 1000);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [bbox, vtLayers, terrainSettings ]); // Only trigger on bbox changes, not on store state changes

  return (
    <>
    </>
  );
};


