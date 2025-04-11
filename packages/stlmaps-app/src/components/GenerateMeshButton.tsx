import { useState, useEffect } from "react";
import { Slider, Typography, Box } from "@mui/material";
import {
  GeometryData,
  calculateTileCount,
  fetchBuildingData,
  fetchBuildingDataDirect,
  fetchGeometryData,
  getTilesForBbox,
  processBuildings,
} from "./VectorTileFunctions";
import * as THREE from "three";
//@ts-expect-error
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import createPolygonGeometry from "../three_maps/createPolygonGeometry";
import { vtGeometries } from "../config/layers";
import { createBuildingsGeometry } from "../three_maps/createBuildingsGeometry";
import { createTerrainGeometry } from "../three_maps/createTerrainGeometry";
import { bufferLineString } from "../three_maps/bufferLineString";

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
  bbox: GeoJSONFeature | undefined;
  setTerrainGeometry: (geometry: THREE.BufferGeometry | null) => void;
  setBuildingsGeometry: (geometry: THREE.BufferGeometry | null) => void;
  setPolygonGeometries: (geometry: THREE.BufferGeometry[] | null) => void;
}


export const GenerateMeshButton = function ({
  bbox,
  ...props
}: GenerateMeshButtonProps) {
  const [generating, setGenerating] = useState<boolean>(false);
  const [verticalExaggeration, setVerticalExaggeration] =
    useState<number>(0.06);
  const [buildingScaleFactor, setBuildingScaleFactor] = useState<number>(0.5);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(
    null
  );
  const [terrainBaseHeight, setTerrainBaseHeight] = useState<number>(5);

  // Modify generate3DModel function to include buildings
  const generate3DModel = async (): Promise<void> => {
    if (!bbox) return;
    console.log("Generating 3D model for:", bbox);
    setGenerating(true);

    try {
      // Extract bbox coordinates from the feature
      const feature = bbox;

      if (!feature.geometry || feature.geometry.type !== "Polygon") {
        console.error("Invalid geometry: expected a Polygon");
        setGenerating(false);
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
      const tileData = await Promise.all(
        tiles.map((tile) => downloadTile(tile.z, tile.x, tile.y))
      );

      // Process elevation data to create a grid
      const { elevationGrid, gridSize, minElevation, maxElevation } =
        processElevationData(tileData, tiles, minLng, minLat, maxLng, maxLat);

      // Always use zoom level 14 for building data, since that's where buildings are available
      const buildingZoom = 14; // Force zoom 14 for buildings
      console.log(`Fetching buildings at fixed zoom level ${buildingZoom}`);

      // Try both building data fetching methods
      let buildingFeatures = await fetchBuildingData(
        minLng,
        minLat,
        maxLng,
        maxLat,
        buildingZoom
      );

      // If primary method fails, try direct fetch
      if (buildingFeatures.length === 0) {
        console.log(
          "No buildings found with primary method, trying direct fetch"
        );
        buildingFeatures = await fetchBuildingDataDirect(
          minLng,
          minLat,
          maxLng,
          maxLat,
          buildingZoom
        );
      }

      console.log(`Successfully fetched ${buildingFeatures.length} buildings`);

      // Process building data
      const buildings = processBuildings(
        buildingFeatures,
        elevationGrid,
        gridSize,
        minLng,
        minLat,
        maxLng,
        maxLat
      );

      // Generate three.js geometry from elevation grid and buildings
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
        verticalExaggeration,
        terrainBaseHeight
      );

      const buildingsGeometry = createBuildingsGeometry({
        buildings,
        buildingScaleFactor,
        verticalExaggeration,
        terrainBaseHeight, // pass desired base height
        bbox: [minLng, minLat, maxLng, maxLat],
        elevationGrid: processedElevationGrid,
        gridSize,
        minElevation,
        maxElevation,
      });


      const vtPolygonGeometries: THREE.BufferGeometry[] = [];

      for (let i = 0; i < vtGeometries.length; i++) {
        console.log(`Fetching ${vtGeometries[i].sourceLayer} data...`);
        vtGeometries[i].data = await fetchGeometryData({
          bbox: [minLng, minLat, maxLng, maxLat],
          vtDataset: vtGeometries[i],
          zoom: 14,
          elevationGrid: processedElevationGrid,
          gridSize,
        });

        console.log(
          `Received ${vtGeometries[i].data?.length || 0} ${vtGeometries[i].sourceLayer} features`
        );

        if (vtGeometries[i].data && vtGeometries[i].data.length > 0) {
          const TERRAIN_SIZE = 200;
          const clipBoundaries = {
            minX: -TERRAIN_SIZE / 2,
            maxX: TERRAIN_SIZE / 2,
            minY: -TERRAIN_SIZE / 2,
            maxY: TERRAIN_SIZE / 2,
            minZ: terrainBaseHeight - 20,
            maxZ: terrainBaseHeight + 100,
          };

          if (vtGeometries[i].sourceLayer === "transportation") {
            // Convert LineString geometries to polygons using a buffer
            vtGeometries[i].data = vtGeometries[i].data.map((feature) => {
              if (feature.type === "LineString") {
                const bufferedPolygon = bufferLineString(feature.geometry, vtGeometries[i].bufferSize || 1); // Adjust buffer size as needed
                return { ...feature, type: 'Polygon', geometry: bufferedPolygon };
              }
              return feature;
            });
          }

          vtGeometries[i].geometry = createPolygonGeometry({
            polygons: vtGeometries[i].data as PolygonData[],
            terrainBaseHeight,
            bbox: [minLng, minLat, maxLng, maxLat],
            elevationGrid: processedElevationGrid,
            gridSize,
            minElevation: processedMinElevation,
            maxElevation: processedMaxElevation,
            vtDataSet: vtGeometries[i],
            useSameZOffset: true,
          });

          if (
            vtGeometries[i].geometry &&
            vtGeometries[i].geometry.attributes &&
            vtGeometries[i].geometry.attributes.position &&
            vtGeometries[i].geometry.attributes.position.count > 0
          ) {
            console.log(
              `Created valid ${vtGeometries[i].sourceLayer} geometry with ${vtGeometries[i].geometry.attributes.position.count} vertices`
            );
            vtPolygonGeometries.push(vtGeometries[i]);
          } else {
            console.warn(
              `Failed to create valid ${vtGeometries[i].sourceLayer} geometry or all features were clipped out`
            );
          }
        } else {
          console.warn(`No ${vtGeometries[i].sourceLayer} features found`);
        }
      }


      props.setTerrainGeometry(terrainGeometry);
      props.setBuildingsGeometry(buildingsGeometry);

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
      props.setPolygonGeometries(vtPolygonGeometries);
    } catch (error) {
      console.error("Error generating 3D model:", error);
    } finally {
      setGenerating(false);
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

  const handleExaggerationChange = (
    event: Event,
    newValue: number | number[]
  ) => {
    setVerticalExaggeration(newValue as number);
  };

  const handleBuildingScaleChange = (
    event: Event,
    newValue: number | number[]
  ) => {
    setBuildingScaleFactor(newValue as number);
  };

  useEffect(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!bbox) return;

    const timer = setTimeout(() => {
      generate3DModel();
    }, 1000);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [bbox, verticalExaggeration, buildingScaleFactor, terrainBaseHeight]);

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography id="vertical-exaggeration-slider" gutterBottom>
          Vertical Exaggeration: {verticalExaggeration.toFixed(6)}
        </Typography>
        <Slider
          value={verticalExaggeration}
          onChange={handleExaggerationChange}
          aria-labelledby="vertical-exaggeration-slider"
          min={0.01}
          max={1.0}
          step={0.01}
          marks={[
            { value: 0.01, label: "Min" },
            { value: 0.5, label: "Med" },
            { value: 1.0, label: "Max" },
          ]}
        />
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography id="building-scale-slider" gutterBottom>
          Building Height Scale: {buildingScaleFactor}
        </Typography>
        <Slider
          value={buildingScaleFactor}
          onChange={handleBuildingScaleChange}
          aria-labelledby="building-scale-slider"
          min={0}
          max={15}
          step={0.1}
          marks={[
            { value: 0, label: "0" },
            { value: 50, label: "50" },
            { value: 100, label: "100" },
          ]}
        />
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography id="terrain-base-height-slider" gutterBottom>
          Base Height: {terrainBaseHeight}
        </Typography>
        <Slider
          value={terrainBaseHeight}
          onChange={(e, newVal) => setTerrainBaseHeight(newVal as number)}
          min={0}
          max={100}
          step={1}
        />
      </Box>
    </>
  );
};


