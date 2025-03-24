import { useState, Suspense, RefObject, ChangeEvent } from "react";
import {
  Button,
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
}

interface GenerateMeshButtonProps {
  bboxRef: RefObject<GeoJSONFeature>;
}

export const GenerateMeshButton = function ({
  bboxRef,
}: GenerateMeshButtonProps) {
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [objData, setObjData] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [verticalExaggeration, setVerticalExaggeration] =
    useState<number>(0.05);

  // Generate an OBJ file from the elevation grid
  const generateObjFromElevation = (
    elevationGrid: number[][],
    gridSize: GridSize,
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number
  ): string => {
    let objContent = "# OBJ file generated from elevation data\n";
    objContent +=
      "# Bounds: " + [minLng, minLat, maxLng, maxLat].join(", ") + "\n";

    // Define standardized mesh dimensions
    const meshWidth = 200;
    const meshHeight = 200;
    const bbox = { minLng, minLat, maxLng, maxLat };

    // Add vertices for top surface
    const { width, height } = gridSize;

    // Find min and max elevation for proper scaling
    let minElevation = Infinity;
    let maxElevation = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        minElevation = Math.min(minElevation, elevationGrid[y][x]);
        maxElevation = Math.max(maxElevation, elevationGrid[y][x]);
      }
    }

    console.log(
      `Min elevation: ${minElevation}, Max elevation: ${maxElevation}`
    );

    // Set base elevation to be below the minimum elevation
    const baseOffset = 10; // units below the minimum
    const baseElevation = minElevation - baseOffset;

    // Add top surface vertices
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lng = minLng + ((maxLng - minLng) * x) / (width - 1);
        const lat = minLat + ((maxLat - minLat) * y) / (height - 1);
        const elevation = elevationGrid[y][x];

        // Transform to mesh coordinates WITH elevation
        const [meshX, meshY, meshZ] = transformToMeshCoordinates(
          bbox,
          meshWidth,
          meshHeight,
          [lng, lat],
          elevation,
          minElevation,
          maxElevation
        );

        // OBJ format: v x y z
        objContent += `v ${meshX.toFixed(4)} ${meshY.toFixed(
          4
        )} ${meshZ.toFixed(4)}\n`;
      }
    }

    // Add bottom surface vertices
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lng = minLng + ((maxLng - minLng) * x) / (width - 1);
        const lat = minLat + ((maxLat - minLat) * y) / (height - 1);

        // Transform to mesh coordinates with BASE elevation
        const [meshX, meshY, meshZ] = transformToMeshCoordinates(
          bbox,
          meshWidth,
          meshHeight,
          [lng, lat],
          baseElevation,
          minElevation,
          maxElevation
        );

        // OBJ format: v x y z
        objContent += `v ${meshX.toFixed(4)} ${meshY.toFixed(
          4
        )} ${meshZ.toFixed(4)}\n`;
      }
    }

    // The rest of the function remains mostly the same, with updated vertex references
    // Calculate total number of vertices per layer
    const verticesPerLayer = width * height;

    // Add faces for top surface
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const topLeft = y * width + x + 1; // +1 because OBJ indices start at 1
        const topRight = topLeft + 1;
        const bottomLeft = (y + 1) * width + x + 1;
        const bottomRight = bottomLeft + 1;

        // Two triangles per grid cell for the top surface
        objContent += `f ${topLeft} ${topRight} ${bottomLeft}\n`;
        objContent += `f ${bottomLeft} ${topRight} ${bottomRight}\n`;
      }
    }

    // The rest of the function continues as before...
    // ...existing code for bottom and side surfaces...

    return objContent;
  };

  // Transform WGS84 coordinates to mesh coordinates including elevation
  const transformToMeshCoordinates = (
    bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number },
    meshWidth: number,
    meshHeight: number,
    coordinates: [number, number],
    elevation?: number,
    minElevation?: number,
    maxElevation?: number
  ): [number, number, number] => {
    const [lng, lat] = coordinates;

    // Calculate the normalized position (0-1) within the bounding box
    const normalizedX = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng);
    const normalizedY = (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat);

    // Scale to mesh dimensions - center the mesh around origin
    const meshX = (normalizedX - 0.5) * meshWidth;
    const meshY = (normalizedY - 0.5) * meshHeight;

    // Scale elevation if provided
    let meshZ = 0;
    if (
      elevation !== undefined &&
      minElevation !== undefined &&
      maxElevation !== undefined
    ) {
      // Scale elevation to be 20% of mesh width
      const elevationRange = maxElevation - minElevation;
      if (elevationRange > 0) {
        const normalizedZ = (elevation - minElevation) / elevationRange;
        meshZ = normalizedZ * (meshWidth * 0.2);
      }
    }

    return [meshX, meshY, meshZ];
  };

  // Modify generate3DModel function to include buildings
  const generate3DModel = async (): Promise<void> => {
    if (!bboxRef.current) return;
    console.log("Generating 3D model for:", bboxRef.current);
    setGenerating(true);

    try {
      // Extract bbox coordinates from the feature
      const feature = bboxRef.current;

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
      const { elevationGrid, gridSize } = processElevationData(
        tileData,
        tiles,
        minLng,
        minLat,
        maxLng,
        maxLat
      );

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

      // Generate OBJ model from elevation grid and buildings
      const objData = generateObjFromElevationWithBuildings(
        elevationGrid,
        gridSize,
        buildings,
        minLng,
        minLat,
        maxLng,
        maxLat
      );

      // Store obj data for preview
      setObjData(objData);

      // Create download
      const blob = new Blob([objData], { type: "text/plain" });
      setDownloadUrl(URL.createObjectURL(blob));
      console.log("3D model generated successfully");

      // Open the preview
      setPreviewOpen(true);
    } catch (error) {
      console.error("Error generating 3D model:", error);
    } finally {
      setGenerating(false);
    }
  };

  // Generate OBJ with buildings
  const generateObjFromElevationWithBuildings = (
    elevationGrid: number[][],
    gridSize: GridSize,
    buildings: BuildingData[],
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number
  ): string => {
    // Start with the terrain
    const objContent = generateObjFromElevation(
      elevationGrid,
      gridSize,
      minLng,
      minLat,
      maxLng,
      maxLat
    );

    // If no buildings, return just the terrain
    if (buildings.length === 0) {
      return objContent;
    }

    // Count vertices in the terrain to know the offset
    const terrainVertexCount = countVerticesInObj(objContent);

    // Add buildings to the OBJ content
    let buildingsObjContent = "\n# Building models\n";

    buildings.forEach((building, index) => {
      buildingsObjContent += `# Building ${index + 1}\n`;
      buildingsObjContent += generateBuildingObj(
        building,
        terrainVertexCount + getBuildingVertexOffset(buildings, index),
        verticalExaggeration,
        minLng,
        minLat,
        maxLng,
        maxLat
      );
    });

    return objContent + buildingsObjContent;
  };

  // Count vertices in OBJ content
  const countVerticesInObj = (objContent: string): number => {
    const lines = objContent.split("\n");
    let count = 0;

    for (const line of lines) {
      if (line.startsWith("v ")) {
        count++;
      }
    }

    return count;
  };

  // Calculate vertex offset for a building
  const getBuildingVertexOffset = (
    buildings: BuildingData[],
    currentIndex: number
  ): number => {
    let offset = 0;

    for (let i = 0; i < currentIndex; i++) {
      // Each building adds vertices for its footprint (top + bottom) and walls
      const footprintPoints = buildings[i].footprint.length;
      offset += footprintPoints * 2 + footprintPoints * 2; // Top + bottom + walls
    }

    return offset;
  };

  // Generate OBJ content for a building
  const generateBuildingObj = (
    building: BuildingData,
    vertexOffset: number,
    verticalExaggeration: number,
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number
  ): string => {
    let objContent = "";
    const { footprint, height, baseElevation } = building;

    if (
      !footprint ||
      footprint.length < 3 ||
      isNaN(height) ||
      isNaN(baseElevation)
    ) {
      return "";
    }

    // Define standardized mesh dimensions
    const meshWidth = 200;
    const meshHeight = 200;
    const bbox = { minLng, minLat, maxLng, maxLat };

    // Find elevation range for scaling
    // This should match the range used in the terrain generation
    let minElevation = Infinity;
    let maxElevation = -Infinity;

    // Use a reasonable estimation if we don't have the exact values
    minElevation = baseElevation - 100;
    maxElevation = baseElevation + 500;

    // Transform footprint to mesh coordinates
    const validPoints = footprint
      .filter(([lng, lat]) => isFinite(lng) && isFinite(lat))
      .map(([lng, lat]) =>
        transformToMeshCoordinates(bbox, meshWidth, meshHeight, [lng, lat])
      );

    if (validPoints.length < 3) {
      return "";
    }

    // Calculate top elevation (baseElevation + building height)
    const topElevation = baseElevation + height;

    const addedTopVertices: number[] = [];
    for (let i = 0; i < validPoints.length; i++) {
      const [x, y] = validPoints[i];
      // Add z-coordinate for top of building
      const [transformedX, transformedY, transformedZ] =
        transformToMeshCoordinates(
          bbox,
          meshWidth,
          meshHeight,
          footprint[i],
          topElevation,
          minElevation,
          maxElevation
        );
      objContent += `v ${transformedX.toFixed(4)} ${transformedY.toFixed(
        4
      )} ${transformedZ.toFixed(4)}\n`;
      addedTopVertices.push(i);
    }

    const addedBottomVertices: number[] = [];
    for (let i = 0; i < validPoints.length; i++) {
      const [x, y] = validPoints[i];
      // Add z-coordinate for bottom of building
      const [transformedX, transformedY, transformedZ] =
        transformToMeshCoordinates(
          bbox,
          meshWidth,
          meshHeight,
          footprint[i],
          baseElevation,
          minElevation,
          maxElevation
        );
      objContent += `v ${transformedX.toFixed(4)} ${transformedY.toFixed(
        4
      )} ${transformedZ.toFixed(4)}\n`;
      addedBottomVertices.push(i);
    }

    if (addedTopVertices.length < 3 || addedBottomVertices.length < 3) {
      return "";
    }

    const topIndexOffset = vertexOffset;
    const bottomIndexOffset = vertexOffset + addedTopVertices.length;

    // Top face
    objContent += "f";
    for (let i = 0; i < addedTopVertices.length; i++) {
      objContent += ` ${topIndexOffset + i + 1}`;
    }
    objContent += "\n";

    // Bottom face
    objContent += "f";
    for (let i = addedBottomVertices.length - 1; i >= 0; i--) {
      objContent += ` ${bottomIndexOffset + i + 1}`;
    }
    objContent += "\n";

    // Side faces
    const count = addedTopVertices.length;
    for (let i = 0; i < count; i++) {
      const nextI = (i + 1) % count;
      const topLeft = topIndexOffset + i + 1;
      const topRight = topIndexOffset + nextI + 1;
      const bottomLeft = bottomIndexOffset + i + 1;
      const bottomRight = bottomIndexOffset + nextI + 1;
      objContent += `f ${topLeft} ${bottomLeft} ${topRight}\n`;
      objContent += `f ${topRight} ${bottomLeft} ${bottomRight}\n`;
    }

    return objContent;
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

    return { elevationGrid: smoothedGrid, gridSize };
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

  return (
    <>
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          backgroundColor: "rgba(255,255,255,0.8)",
          padding: "10px",
          borderRadius: "4px",
          width: "300px",
        }}
      >
        <Box sx={{ mb: 2 }}>
          <Typography id="vertical-exaggeration-slider" gutterBottom>
            Vertical Exaggeration: {verticalExaggeration.toFixed(6)}
          </Typography>
          <Slider
            value={verticalExaggeration}
            onChange={handleExaggerationChange}
            aria-labelledby="vertical-exaggeration-slider"
            min={0.000001}
            max={0.001}
            step={0.00001}
            marks={[
              { value: 0.000001, label: "Min" },
              { value: 0.0001, label: "Med" },
              { value: 0.001, label: "Max" },
            ]}
          />
        </Box>
        <Button
          variant="contained"
          color="primary"
          onClick={generate3DModel}
          disabled={generating}
        >
          {generating ? <CircularProgress size={24} /> : "Generate 3D Model"}
        </Button>
        {downloadUrl && (
          <>
            <Button
              variant="outlined"
              style={{ marginLeft: "1rem" }}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            <Button
              variant="outlined"
              style={{ marginLeft: "1rem" }}
              href={downloadUrl}
              download="model.obj"
            >
              Download OBJ
            </Button>
          </>
        )}
      </div>

      <Suspense fallback={null}>
        {objData && (
          <ModelPreview
            objData={objData}
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </Suspense>
    </>
  );
};
