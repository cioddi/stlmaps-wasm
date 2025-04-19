/**
 * Calculate an adaptive scale factor for building heights based on the current map view.
 * This ensures buildings are scaled proportionally to the current bbox scale.
 */
export function calculateAdaptiveScaleFactor(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  minElevation: number,
  maxElevation: number
): number {
  // Constants for the mesh
  const MESH_WIDTH = 200; // Standard mesh width in local units
  const MESH_HEIGHT = 200; // Standard mesh height in local units
  const TERRAIN_Z_FACTOR = 0.2; // Fraction of mesh width used for terrain height

  // Calculate real-world dimensions in meters (approximate at the center latitude)
  const centerLat = (minLat + maxLat) / 2;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const metersPerDegreeLat = 111320; // Approximately constant across latitudes

  // Width and height in meters
  const widthInMeters = (maxLng - minLng) * metersPerDegreeLng;
  const heightInMeters = (maxLat - minLat) * metersPerDegreeLat;

  // Calculate the real-world to mesh ratio (how many real-world meters per mesh unit)
  const horizontalScaleFactor = Math.max(widthInMeters / MESH_WIDTH, heightInMeters / MESH_HEIGHT);

  // Calculate the elevation range
  const elevationRange = Math.max(maxElevation - minElevation, 1); // Prevent division by zero
  
  // Calculate vertical scale factor to maintain proportional vertical exaggeration
  // This ensures proper scaling between horizontal and vertical dimensions
  let scaleFactor = horizontalScaleFactor;

  // Adjust scale based on zoom level to make buildings visible at different scales
  // We use the diagonal length as a proxy for zoom level
  const diagonalInMeters = Math.sqrt(
    widthInMeters * widthInMeters + heightInMeters * heightInMeters
  );

  // Apply adjustments for different scales
  //if (diagonalInMeters > 20000) {
  //  // Very large area (>20km) - increase height to keep buildings visible
  //  scaleFactor *= 3.0;
  //} else if (diagonalInMeters > 10000) {
  //  // Large area (10-20km)
  //  scaleFactor *= 2.0;
  //} else if (diagonalInMeters < 1000) {
  //  // Very small area (<1km) - reduce to prevent overwhelming the view
  //  scaleFactor *= 0.5;
  //} else if (diagonalInMeters < 3000) {
  //  // Small area (1-3km)
  //  scaleFactor *= 0.8;
  //}

  //// Apply correction for extreme terrain elevation differences
  //// If terrain has large elevation changes, adjust building heights to match
  //if (elevationRange > 1000) {
  //  // Very mountainous terrain
  //  scaleFactor *= 0.7;
  //} else if (elevationRange < 50) {
  //  // Very flat terrain
  //  scaleFactor *= 1.2;
  //}

  // Ensure reasonable bounds for the scale factor
  const MIN_SCALE_FACTOR = 0.0005;
  const MAX_SCALE_FACTOR = 0.5;

  return Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, scaleFactor));
}
