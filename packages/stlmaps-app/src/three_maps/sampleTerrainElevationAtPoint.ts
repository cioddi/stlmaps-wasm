import { GridSize } from "../components/GenerateMeshButton";

/**
 * Sample the terrain elevation at a given lng/lat using bilinear interpolation.
 * Returns the elevation value in the original range.
 */
export function sampleTerrainElevationAtPoint(
  lng: number,
  lat: number,
  elevationGrid: number[][],
  gridSize: GridSize,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number; },
  minElevation: number,
  maxElevation: number): number {
  const { width, height } = gridSize;

  // If out of bounds, just return minElevation
  if (lng < bbox.minLng ||
    lng > bbox.maxLng ||
    lat < bbox.minLat ||
    lat > bbox.maxLat) {
    return minElevation;
  }

  // Map (lng, lat) to [0..width-1, 0..height-1]
  const fracX = ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * (width - 1);
  const fracY = ((lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * (height - 1);

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

  // Convert this elevation to a normalized position value for the mesh
  // But constrain it within the original elevation range
  const normalizedValue = Math.max(
    0,
    Math.min(1, (elevation - minElevation) / (maxElevation - minElevation || 1))
  );

  // Scale for mesh height but keep within original elevation range
  return minElevation + normalizedValue * (maxElevation - minElevation);
}
