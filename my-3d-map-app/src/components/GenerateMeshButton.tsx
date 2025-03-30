import { useState, Suspense, RefObject, ChangeEvent, useEffect } from "react";
import {
  CircularProgress,
  Slider,
  Typography,
  Box,
} from "@mui/material";
import ModelPreview from "./ModelPreview";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import {
  BuildingData,
  calculateTileCount,
  fetchBuildingData,
  fetchBuildingDataDirect,
  getTilesForBbox,
  processBuildings,
} from "./VectorTileFunctions";
import * as THREE from "three";
// @ts-expect-error
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';

// Define interfaces for our data structures
interface GridSize {
  width: number;
  height: number;
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
}

// Submerge offset to ensure bottom slightly dips into terrain
const BUILDING_SUBMERGE_OFFSET = 0.5;

export const GenerateMeshButton = function ({
  bbox, ...props
}: GenerateMeshButtonProps) {
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [terrainGeometry, setTerrainGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [buildingsGeometry, setBuildingsGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [verticalExaggeration, setVerticalExaggeration] =
    useState<number>(0.8);
  const [buildingScaleFactor, setBuildingScaleFactor] = useState<number>(1);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

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
      const terrainGeometry = createTerrainGeometry(
        elevationGrid,
        gridSize,
        minLng,
        minLat,
        maxLng,
        maxLat,
        minElevation,
        maxElevation,
        verticalExaggeration
      );

      const buildingsGeometry = createBuildingsGeometry(
        buildings,
        buildingScaleFactor,
        verticalExaggeration,
        minLng,
        minLat,
        maxLng,
        maxLat,
        elevationGrid,
        gridSize,
        minElevation,
        maxElevation
      );

      // Optionally merge both geometries. For brevity, just store terrain:
      const mergedGeometry = BufferGeometryUtils.mergeGeometries(
        [terrainGeometry, buildingsGeometry],
        true
      );
      // Now center everything once at the end:
      mergedGeometry.computeBoundingBox();
      const center = mergedGeometry.boundingBox?.getCenter(new THREE.Vector3());
      if (center) {
        mergedGeometry.translate(-center.x, -center.y, -center.z);
      }
      setTerrainGeometry(mergedGeometry);
      setBuildingsGeometry(null);
      props.setTerrainGeometry(mergedGeometry);
      props.setBuildingsGeometry(null);

      console.log("3D model generated successfully");

      // Open the preview
      setPreviewOpen(true);
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
    const gridSize: GridSize = { width: 150, height: 150 };

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
  }, [bbox, verticalExaggeration, buildingScaleFactor]);

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
            max={10.0}
            step={0.1}
            marks={[
              { value: 0.000001, label: "Min" },
              { value: 0.0001, label: "Med" },
              { value: 0.001, label: "Max" },
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
            max={100}
            step={1}
            marks={[
              { value: 0, label: "0" },
              { value: 50, label: "50" },
              { value: 100, label: "100" },
            ]}
          />
        </Box>

        {downloadUrl && (
          <>
            <Button
              variant="outlined"
              onClick={() => setPreviewOpen(true)}
              sx={{ marginBottom: "5px", marginRight: "5px" }}
            >
              Preview
            </Button>
            <Button
              variant="outlined"
              href={downloadUrl}
              download="model.obj"
              sx={{ marginBottom: "5px" }}
            >
              Download OBJ
            </Button>
          </>
        )}

    </>
  );
};

/**
 * Sample the terrain elevation at a given lng/lat using bilinear interpolation.
 * Returns the normalized elevation value scaled into 3D mesh coordinates.
 */
function sampleTerrainElevationAtPoint(
  lng: number,
  lat: number,
  elevationGrid: number[][],
  gridSize: GridSize,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  minElevation: number,
  maxElevation: number
): number {
  const { width, height } = gridSize;

  // If out of bounds, just return minElevation
  if (
    lng < bbox.minLng ||
    lng > bbox.maxLng ||
    lat < bbox.minLat ||
    lat > bbox.maxLat
  ) {
    return minElevation;
  }

  // Map (lng, lat) to [0..width-1, 0..height-1]
  const fracX =
    ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * (width - 1);
  const fracY =
    ((lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * (height - 1);

  const x0 = Math.floor(fracX);
  const y0 = Math.floor(fracY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const dx = fracX - x0;
  const dy = fracY - y0;

  // Bilinear interpolation from the elevation grid
  const z00 = elevationGrid[y0][x0];
  const z10 = elevationGrid[y0][x1];
  const z01 = elevationGrid[y1][x0];
  const z11 = elevationGrid[y1][x1];
  const top = z00 * (1 - dx) + z10 * dx;
  const bottom = z01 * (1 - dx) + z11 * dx;
  const elevation = top * (1 - dy) + bottom * dy;

  // Convert this elevation to mesh Z
  const elevationRange = maxElevation - minElevation || 1;
  const normalizedZ = (elevation - minElevation) / elevationRange;
  return normalizedZ * (200 /* meshWidth */ * 0.2);
}

/**
 * Calculate an adaptive scale factor for building heights based on the current map view
 */
function calculateAdaptiveScaleFactor(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  minElevation: number,
  maxElevation: number
): number {
  // Calculate real-world width in meters (approximate at the center latitude)
  const centerLat = (minLat + maxLat) / 2;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const metersPerDegreeLat = 111320; // Approximately constant across latitudes

  // Width and height in meters
  const widthInMeters = (maxLng - minLng) * metersPerDegreeLng;
  const heightInMeters = (maxLat - minLat) * metersPerDegreeLat;

  // Calculate diagonal length of the area
  const diagonalInMeters = Math.sqrt(
    widthInMeters * widthInMeters + heightInMeters * heightInMeters
  );

  // Calculate how meters in elevation map to mesh Z units
  const elevationRange = maxElevation - minElevation || 1;
  const meshZRange = 200 * 0.2; // meshWidth * 0.2, the Z range used for terrain
  const metersToMeshZ = meshZRange / elevationRange;

  // The base scale factor: 1 meter building height should equal 1 meter elevation in mesh units
  let scaleFactor = metersToMeshZ;

  // Apply adjustments based on map size to ensure buildings look reasonable at all scales
  if (diagonalInMeters > 10000) {
    // Large area (>10km diagonally)
    // Amplify buildings more in large areas to keep them visible
    scaleFactor *= 1.5;
  } else if (diagonalInMeters < 2000) {
    // Small area (<2km diagonally)
    // Reduce building height in small areas to prevent them from overwhelming the terrain
    scaleFactor *= 0.8;
  }

  // Ensure reasonable bounds for the scale factor
  const MIN_SCALE_FACTOR = 0.001;
  const MAX_SCALE_FACTOR = 0.5;

  return Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, scaleFactor));
}

function createTerrainGeometry(
  elevationGrid: number[][],
  gridSize: GridSize,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  minElevation: number,
  maxElevation: number,
  verticalExaggeration: number
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const { width, height } = gridSize;

  const topPositions: number[] = [];
  const bottomPositions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  // Generate top vertices (terrain)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const normalizedZ =
        (elevationGrid[y][x] - minElevation) /
        Math.max(1, maxElevation - minElevation);
      // Simple HSL gradient
      const c = new THREE.Color().setHSL(
        0.3 + 0.15 * normalizedZ,
        0.5,
        0.5
      );
      colors.push(c.r, c.g, c.b);
      const meshX = (x / (width - 1) - 0.5) * 200;
      const meshY = (y / (height - 1) - 0.5) * 200;
      const meshZ = normalizedZ * (200 * 0.2) * verticalExaggeration;
      topPositions.push(meshX, meshY, meshZ);
      bottomPositions.push(meshX, meshY, 0);
    }
  }

  // Build top surface indices
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = y * width + x;
      const tr = tl + 1;
      const bl = tl + width;
      const br = bl + 1;
      indices.push(tl, tr, bl, bl, tr, br);
    }
  }

  // Build bottom surface indices
  const bottomOffset = width * height;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = bottomOffset + y * width + x;
      const tr = tl + 1;
      const bl = tl + width;
      const br = bl + 1;
      // Reverse winding
      indices.push(tl, bl, tr, tr, bl, br);
    }
  }

  // Build side walls
  for (let y = 0; y < height - 1; y++) {
    const topIdxTop = y * width + (width - 1);
    const bottomIdxTop = bottomOffset + topIdxTop;
    const topIdxBot = (y + 1) * width + (width - 1);
    const bottomIdxBot = bottomOffset + topIdxBot;
    // Right edge (invert the triangle order)
    indices.push(topIdxTop, bottomIdxTop, bottomIdxBot);
    indices.push(topIdxTop, bottomIdxBot, topIdxBot);
    // Left edge (invert the triangle order)
    const leftTopIdx = y * width;
    const leftBottomIdx = bottomOffset + leftTopIdx;
    const leftTopNext = (y + 1) * width;
    const leftBottomNext = bottomOffset + leftTopNext;
    indices.push(leftTopIdx, leftBottomNext, leftBottomIdx);
    indices.push(leftTopIdx, leftTopNext, leftBottomNext);
  }
  for (let x = 0; x < width - 1; x++) {
    const topIdxTop = (height - 1) * width + x;
    const bottomIdxTop = bottomOffset + topIdxTop;
    const topIdxBot = topIdxTop + 1;
    const bottomIdxBot = bottomOffset + topIdxBot;
    // Bottom edge (invert)
    indices.push(topIdxTop, bottomIdxBot, bottomIdxTop);
    indices.push(topIdxTop, topIdxBot, bottomIdxBot);
    // Top edge (invert)
    const topEdgeIdx = x;
    const bottomEdgeIdx = bottomOffset + topEdgeIdx;
    const topEdgeNext = x + 1;
    const bottomEdgeNext = bottomOffset + topEdgeNext;
    indices.push(topEdgeIdx, bottomEdgeIdx, bottomEdgeNext);
    indices.push(topEdgeIdx, bottomEdgeNext, topEdgeNext);
  }

  // Merge top + bottom vertices
  const allPositions = new Float32Array(topPositions.length + bottomPositions.length);
  allPositions.set(topPositions, 0);
  allPositions.set(bottomPositions, topPositions.length);

  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(allPositions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createBuildingsGeometry(
  buildings: BuildingData[],
  buildingScaleFactor: number,
  verticalExaggeration: number,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  elevationGrid: number[][],
  gridSize: GridSize,
  minElevation: number,
  maxElevation: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  const geometry = new THREE.BufferGeometry();
  const colorArray: number[] = [];

  // Helper to transform lng/lat to mesh X/Y in [-100..100]
  function transformToMeshCoordinates(
    lng: number,
    lat: number
  ): [number, number] {
    const xFrac = (lng - minLng) / (maxLng - minLng) - 0.5;
    const yFrac = (lat - minLat) / (maxLat - minLat) - 0.5;
    return [xFrac * 200, yFrac * 200];
  }

  buildings.forEach((bld) => {
    const { footprint, height = 15 } = bld;
    if (!footprint || footprint.length < 3) return;

    // Sample terrain for each vertex
    let lowestTerrainZ = Infinity;
    let highestTerrainZ = -Infinity;
    const meshCoords: [number, number][] = [];
    const terrainZList: number[] = [];

    footprint.forEach(([lng, lat]) => {
      const tZ = sampleTerrainElevationAtPoint(
        lng,
        lat,
        elevationGrid,
        gridSize,
        { minLng, minLat, maxLng, maxLat },
        minElevation,
        maxElevation
      );
      lowestTerrainZ = Math.min(lowestTerrainZ, tZ);
      highestTerrainZ = Math.max(highestTerrainZ, tZ);
      meshCoords.push(transformToMeshCoordinates(lng, lat));
      terrainZList.push(tZ);
    });

    const validatedHeight = Math.min(Math.max(height, 2), 500);
    const adaptiveScaleFactor = calculateAdaptiveScaleFactor(
      minLng,
      minLat,
      maxLng,
      maxLat,
      minElevation,
      maxElevation
    );
    const effectiveHeight =
      validatedHeight * adaptiveScaleFactor * buildingScaleFactor +
      BUILDING_SUBMERGE_OFFSET;
    const zTop = lowestTerrainZ + effectiveHeight;
    const zBottom = lowestTerrainZ - BUILDING_SUBMERGE_OFFSET;

    // Write top vertices
    const topIndices: number[] = [];
    footprint.forEach((_, i) => {
      const [mx, my] = meshCoords[i];
      positions.push(mx, my, zTop);
      topIndices.push(vertexCount + i);
      // top vertex color
      colorArray.push(0.68, 0.85, 0.9);
    });

    // Write bottom vertices
    const bottomIndices: number[] = [];
    footprint.forEach((_, i) => {
      const [mx, my] = meshCoords[i];
      positions.push(mx, my, zBottom);
      bottomIndices.push(vertexCount + i + footprint.length);
      // bottom vertex color
      colorArray.push(0.68, 0.85, 0.9);
    });

    // Triangulate top face (reverse winding)
    for (let i = 2; i < footprint.length; i++) {
      indices.push(topIndices[0], topIndices[i], topIndices[i - 1]);
    }

    // Triangulate bottom face
    for (let i = 2; i < footprint.length; i++) {
      indices.push(
        bottomIndices[0],
        bottomIndices[i - 1],
        bottomIndices[i]
      );
    }

    // Add side faces
    for (let i = 0; i < footprint.length; i++) {
      const nextI = (i + 1) % footprint.length;
      const topL = topIndices[i];
      const topR = topIndices[nextI];
      const botL = bottomIndices[i];
      const botR = bottomIndices[nextI];
      indices.push(topL, topR, botL);
      indices.push(topR, botR, botL);
    }

    vertexCount += footprint.length * 2;
  });

  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(positions), 3)
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colorArray, 3));
  geometry.computeVertexNormals();
  return geometry;
}
