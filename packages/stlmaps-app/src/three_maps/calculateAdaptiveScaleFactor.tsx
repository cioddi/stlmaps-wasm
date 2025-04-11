/**
 * Calculate an adaptive scale factor for building heights based on the current map view
 */
export function calculateAdaptiveScaleFactor(
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
