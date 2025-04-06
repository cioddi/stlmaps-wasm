import * as THREE from "three";
import { PolygonData } from "../components/VectorTileFunctions";
import { GridSize, VtDataSet } from "../components/GenerateMeshButton";
import { CSG } from "three-csg-ts";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";

const BUILDING_SUBMERGE_OFFSET = 0.01;
// Flag to enable/disable CSG operations - set to false by default due to errors
const USE_CSG_OPERATIONS = true;

/**
 * Sample the terrain elevation at a given lng/lat using bilinear interpolation.
 * Returns the elevation value in the original range.
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

  // Convert this elevation to a normalized position value for the mesh
  // But constrain it within the original elevation range
  const normalizedValue = Math.max(
    0,
    Math.min(1, (elevation - minElevation) / (maxElevation - minElevation || 1))
  );

  // Scale for mesh height but keep within original elevation range
  return minElevation + normalizedValue * (maxElevation - minElevation);
}

function createPolygonGeometry({
  bbox: [minLng, minLat, maxLng, maxLat],
  polygons,
  terrainBaseHeight,
  elevationGrid,
  gridSize,
  minElevation,
  maxElevation,
  vtDataSet,
  useSameZOffset = false,
}: {
  polygons: PolygonData[];
  terrainBaseHeight: number;
  bbox: number[];
  elevationGrid: number[][];
  gridSize: GridSize;
  minElevation: number;
  maxElevation: number;
  vtDataSet: VtDataSet;
  useSameZOffset?: boolean;
}): THREE.BufferGeometry {
  // Log information about the input polygons for debugging
  console.log(
    `Processing ${polygons.length} polygons for ${vtDataSet.sourceLayer}`
  );

  // Create empty collections for our geometries
  const bufferGeometries: THREE.BufferGeometry[] = [];
  const processedGeometries = new Set<string>();

  // Maximum reasonable height in meters
  const MAX_HEIGHT = 500;
  // Minimum reasonable height in meters
  const MIN_HEIGHT = 0.5;

  // Calculate a dataset-wide terrain elevation offset by sampling multiple points
  let datasetLowestZ = Infinity;
  let datasetHighestZ = -Infinity;
  const SAMPLE_COUNT = 10; // Number of points to sample per dataset

  // Sample evenly across the dataset bounds
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const sampleLng = minLng + (maxLng - minLng) * (i / (SAMPLE_COUNT - 1));
    for (let j = 0; j < SAMPLE_COUNT; j++) {
      const sampleLat = minLat + (maxLat - minLat) * (j / (SAMPLE_COUNT - 1));
      const elevationZ = sampleTerrainElevationAtPoint(
        sampleLng,
        sampleLat,
        elevationGrid,
        gridSize,
        { minLng, minLat, maxLng, maxLat },
        minElevation,
        maxElevation
      );
      datasetLowestZ = Math.min(datasetLowestZ, elevationZ);
      datasetHighestZ = Math.max(datasetHighestZ, elevationZ);
    }
  }

  const datasetElevationRange = datasetHighestZ - datasetLowestZ;
  console.log(
    `Dataset elevation range: ${datasetElevationRange}, lowest: ${datasetLowestZ}, highest: ${datasetHighestZ}, minElevation: ${minElevation}, maxElevation: ${maxElevation}`
  );

  // Create a clipping box for all geometries
  // Size and position based on the terrain size (typically 200x200)
  const TERRAIN_SIZE = 200;
  // Make the clipping box much larger to include all geometries
  const clipBoxGeometry = new THREE.BoxGeometry(
    TERRAIN_SIZE, // much wider
    TERRAIN_SIZE, // much longer
    TERRAIN_SIZE // much taller
  );

  // Position the clipping box at the center of the terrain but lower to include water bodies
  const clipBoxMesh = new THREE.Mesh(
    clipBoxGeometry,
    new THREE.MeshBasicMaterial()
  );
  clipBoxMesh.position.set(0, 0, -10); // Move lower to ensure water is captured

  // Create a bounding box for simpler clipping
  const clipBox = new THREE.Box3();
  clipBox.setFromObject(clipBoxMesh);

  // For debug visualization
  const wireframeGeometry = new THREE.WireframeGeometry(clipBoxGeometry);
  const wireframeMaterial = new THREE.LineBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.5,
  });
  const wireframe = new THREE.LineSegments(
    wireframeGeometry,
    wireframeMaterial
  );
  wireframe.position.copy(clipBoxMesh.position);

  function transformToMeshCoordinates(
    lng: number,
    lat: number
  ): [number, number] {
    const xFrac = (lng - minLng) / (maxLng - minLng) - 0.5;
    const yFrac = (lat - minLat) / (maxLat - minLat) - 0.5;
    return [xFrac * 200, yFrac * 200];
  }

  // Helper function to clip an individual geometry
  function clipGeometry(
    geometry: THREE.BufferGeometry
  ): THREE.BufferGeometry | null {
    // Compute bounding box if not already computed
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }

    // If the geometry is completely outside the clip box, return null
    if (geometry.boundingBox && !clipBox.intersectsBox(geometry.boundingBox)) {
      return null;
    }

    if (USE_CSG_OPERATIONS) {
      try {
        // Skip invalid geometries
        if (
          !geometry ||
          !geometry.attributes ||
          !geometry.attributes.position
        ) {
          return null;
        }

        // Skip empty geometries
        if (geometry.attributes.position.count === 0) {
          return null;
        }

        // Clone the geometry and REMOVE color attribute before CSG operations
        // This prevents the NBuf3.write error with colors
        const geometryForCSG = geometry.clone();
        if (geometryForCSG.attributes.color) {
          geometryForCSG.deleteAttribute("color");
        }

        // Create a mesh from the geometry without colors
        const material = new THREE.MeshBasicMaterial();
        const mesh = new THREE.Mesh(geometryForCSG, material);

        try {
          // Perform CSG intersection without colors
          const result = CSG.intersect(mesh, clipBoxMesh);

          if (
            result &&
            result.geometry &&
            result.geometry.attributes &&
            result.geometry.attributes.position &&
            result.geometry.attributes.position.count > 0
          ) {
            // Add back the colors after CSG operation is complete
            if (geometry.attributes.color) {
              const originalColors = geometry.attributes.color;
              const colors = new Float32Array(
                result.geometry.attributes.position.count * 3
              );

              // Use a simple color (avoid transferring complex color objects)
              const r = originalColors.array ? originalColors.array[0] : 0.7;
              const g = originalColors.array ? originalColors.array[1] : 0.7;
              const b = originalColors.array ? originalColors.array[2] : 0.7;

              for (let i = 0; i < colors.length; i += 3) {
                colors[i] = r;
                colors[i + 1] = g;
                colors[i + 2] = b;
              }

              result.geometry.setAttribute(
                "color",
                new THREE.BufferAttribute(colors, 3)
              );
            }

            return result.geometry;
          }
          return null;
        } catch (e) {
          console.warn("CSG intersection failed:", e);
          // Fall back to the original geometry on error
          return geometry;
        }
      } catch (error) {
        console.error("Unhandled error during geometry clipping:", error);
        return geometry;
      }
    }

    return geometry;
  }

  // Process each polygon individually
  polygons.forEach((poly, polyIndex) => {
    const height = vtDataSet.extrusionDepth || poly.height || 10;
    const footprint: PolygonData["geometry"] = poly.geometry;

    if (!footprint || footprint.length < 3) {
      return;
    }

    // Ensure polygons are oriented clockwise
    const path2D = footprint.map(([lng, lat]) => new THREE.Vector2(lng, lat));
    if (!THREE.ShapeUtils.isClockWise(path2D)) {
      path2D.reverse();
    }

    // Calculate terrain elevation for this specific polygon
    let lowestTerrainZ = Infinity;
    let highestTerrainZ = -Infinity;
    const meshCoords: [number, number][] = [];

    path2D.forEach((vec2) => {
      const lng = vec2.x;
      const lat = vec2.y;
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
    });

    // Use dataset-wide elevation if the polygon's terrain difference is very small
    // This prevents unrealistic flat areas
    if (useSameZOffset) {
      // Use dataset values instead of individual polygon values
      lowestTerrainZ = datasetLowestZ;
      highestTerrainZ = datasetHighestZ;
    }

    // For water, use a fixed shallow depth; for other features, use the provided height
    const validatedHeight = Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT);
    const terrainDifference = highestTerrainZ - lowestTerrainZ;

    // For water, position it slightly below terrain; for other features, use terrain base height
    const zBottom =
      lowestTerrainZ +
      (typeof vtDataSet?.zOffset !== "undefined" ? vtDataSet.zOffset : 0) -
      BUILDING_SUBMERGE_OFFSET;
    console.log(
      "zBottom:",
      zBottom,
      "lowestTerrainZ:",
      lowestTerrainZ,
      "terrainDifference:",
      terrainDifference,
      "terrainBaseHeight:",
      terrainBaseHeight
    );

    const shape = new THREE.Shape();
    shape.moveTo(meshCoords[0][0], meshCoords[0][1]);
    for (let i = 1; i < meshCoords.length; i++) {
      shape.lineTo(meshCoords[i][0], meshCoords[i][1]);
    }
    shape.autoClose = true;

    const extrudeSettings = {
      steps: 1,
      depth: validatedHeight,
      bevelEnabled: false,
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.translate(0, 0, zBottom);
    console.log(
      `Polygon ${polyIndex} height: ${validatedHeight}, zBottom: ${zBottom}, terrainBaseHeight: ${terrainBaseHeight}, lowestTerrainZ: ${lowestTerrainZ}, terrainDifference: ${terrainDifference}, using dataset elevation: ${terrainDifference < 0.1}, datasetLowestZ: ${datasetLowestZ}, datasetHighestZ: ${datasetHighestZ}`
    );
    geometry.computeVertexNormals();

    // Add color attribute
    const colorObj = new THREE.Color(vtDataSet.color);
    const colorArray = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      colorArray[i * 3] = colorObj.r;
      colorArray[i * 3 + 1] = colorObj.g;
      colorArray[i * 3 + 2] = colorObj.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));

    // Remove UV attributes
    if (geometry.hasAttribute("uv")) {
      geometry.deleteAttribute("uv");
    }

    // Clip the geometry before adding it to the list
    const clippedGeometry = clipGeometry(geometry);

    // Skip empty geometries
    if (
      clippedGeometry &&
      clippedGeometry.attributes &&
      clippedGeometry.attributes.position &&
      clippedGeometry.attributes.position.count > 0
    ) {
      bufferGeometries.push(clippedGeometry);
    }
  });

  if (!bufferGeometries.length) return new THREE.BufferGeometry();

  // Check and normalize geometries to ensure they all have the same attributes
  const normalizedGeometries: THREE.BufferGeometry[] = [];

  // First, find which attributes are missing from some geometries
  for (const geometry of bufferGeometries) {
    if (!geometry.attributes || !geometry.attributes.position) {
      console.warn("Skipping geometry without position attribute");
      continue;
    }

    // Clone the geometry so we don't modify the original
    const cloned = geometry.clone();

    // Ensure it has normals
    if (!cloned.attributes.normal) {
      cloned.computeVertexNormals();
    }

    // Ensure it has colors
    if (!cloned.attributes.color) {
      const colorObj = new THREE.Color(vtDataSet.color);
      const colorArray = new Float32Array(cloned.attributes.position.count * 3);
      for (let i = 0; i < cloned.attributes.position.count; i++) {
        colorArray[i * 3] = colorObj.r;
        colorArray[i * 3 + 1] = colorObj.g;
        colorArray[i * 3 + 2] = colorObj.b;
      }
      cloned.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));
    }

    // Make sure we have at least 3 vertices (needed for a triangle)
    if (cloned.attributes.position.count >= 3) {
      normalizedGeometries.push(cloned);
    }
  }

  // Add the wireframe to the geometries for debugging
  console.log(`Merging ${normalizedGeometries.length} normalized geometries`);

  // If we have no valid geometries, return an empty one
  if (normalizedGeometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // If we have only one geometry, return it directly
  if (normalizedGeometries.length === 1) {
    return normalizedGeometries[0];
  }

  // Try to merge geometries
  try {
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(
      normalizedGeometries,
      false
    );
    if (!mergedGeometry) {
      console.warn("Merge operation returned null geometry");
      return new THREE.BufferGeometry();
    }
    return mergedGeometry;
  } catch (error) {
    console.error("Error merging geometries:", error);
    // Return the first geometry as a fallback
    return normalizedGeometries[0];
  }
}

export default createPolygonGeometry;
