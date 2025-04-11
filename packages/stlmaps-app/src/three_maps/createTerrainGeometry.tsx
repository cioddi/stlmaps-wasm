import * as THREE from "three";
import { GridSize } from "../components/GenerateMeshButton";

export function createTerrainGeometry(
  elevationGrid: number[][],
  gridSize: GridSize,
  minElevation: number,
  maxElevation: number,
  verticalExaggeration: number,
  terrainBaseHeight: number // added
): {
  geometry: THREE.BufferGeometry;
  processedElevationGrid: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
} {
  const processedElevationGrid: number[][] = [];
  const geometry = new THREE.BufferGeometry();
  const { width, height } = gridSize;

  let processedMinElevation = Infinity;
  let processedMaxElevation = -Infinity;

  const topPositions: number[] = [];
  const bottomPositions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  // Generate top vertices (terrain)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const normalizedZ = (elevationGrid[y][x] - minElevation) /
        Math.max(1, maxElevation - minElevation);
      // Light brown terrain color inspired by Zelda/Disney style
      const lightBrown = new THREE.Color(0xd2b48c); // Tan/sand color
      const darkBrown = new THREE.Color(0xa87b4d); // Medium earthy brown
      const c = new THREE.Color().lerpColors(lightBrown, darkBrown, normalizedZ);
      colors.push(c.r, c.g, c.b);
      const meshX = (x / (width - 1) - 0.5) * 200;
      const meshY = (y / (height - 1) - 0.5) * 200;
      const meshZ = terrainBaseHeight + normalizedZ * (200 * 0.2) * verticalExaggeration;

      //console.log("terrainBaseHeight", terrainBaseHeight ,"normalizedZ", normalizedZ, "verticalExaggeration", verticalExaggeration, "meshZ", meshZ);
      // Track processed min/max elevations
      processedMinElevation = Math.min(processedMinElevation, meshZ);
      processedMaxElevation = Math.max(processedMaxElevation, meshZ);

      topPositions.push(meshX, meshY, meshZ);
      if (!processedElevationGrid[y]) {
        processedElevationGrid[y] = [];
      }
      processedElevationGrid[y][x] = meshZ;
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
  const allPositions = new Float32Array(
    topPositions.length + bottomPositions.length
  );
  allPositions.set(topPositions, 0);
  allPositions.set(bottomPositions, topPositions.length);

  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(allPositions, 3)
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  console.log(processedElevationGrid);
  return {
    geometry,
    processedElevationGrid,
    processedMinElevation,
    processedMaxElevation,
  };
}
