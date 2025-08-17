import * as THREE from "three";
import { GridSize, VtDataSet } from "../components/GenerateMeshButton";
import { CSG } from "three-csg-ts";
// @ts-expect-error - BufferGeometryUtils not in types
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import { sampleTerrainElevationAtPoint } from "./sampleTerrainElevationAtPoint";
import { transformToMeshCoordinates } from "./transformToMeshCoordinates";
import { GeometryData } from "../components/VectorTileFunctions";
import { calculateAdaptiveScaleFactor } from "./calculateAdaptiveScaleFactor";

const BUILDING_SUBMERGE_OFFSET = 0.01;
// Flag to enable/disable CSG operations - set to false by default due to errors
const USE_CSG_OPERATIONS = true;

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
  polygons: GeometryData[];
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

  // Create a clipping box for all geometries
  // Size and position based on the terrain size (typically 200x200)
  const TERRAIN_SIZE = 200;
  // Make the clipping box much larger to include all geometries
  const clipBoxGeometry = new THREE.BoxGeometry(
    TERRAIN_SIZE, // much wider
    TERRAIN_SIZE, // much longer
    TERRAIN_SIZE*5 // much taller
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
          // Check if any point in the resulting geometry has a z-coordinate below 0
          const positions = result.geometry.attributes.position.array;
          for (let i = 2; i < positions.length; i += 3) {
            if (positions[i] < 0) {
              console.warn("Resulting geometry has a point below z=0, returning original geometry", geometry,);
              return null;
              return geometry;
            }
          }
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
    //poly.height ||
    let height = vtDataSet.extrusionDepth || poly.height || (datasetHighestZ - datasetLowestZ + 0.1);

    if (vtDataSet.minExtrusionDepth && height < vtDataSet.minExtrusionDepth) {
      height = vtDataSet.minExtrusionDepth;
    }

    const footprint: GeometryData["geometry"] = poly.geometry;

    if (!footprint || footprint.length < 3) {
      return;
    }

    // Ensure polygons are oriented clockwise
    const path2D = footprint.map(([lng, lat]: number[]) => new THREE.Vector2(lng, lat));
    if (!THREE.ShapeUtils.isClockWise(path2D)) {
      path2D.reverse();
    }

    // Calculate terrain elevation for this specific polygon
    let lowestTerrainZ = Infinity;
    let highestTerrainZ = -Infinity;
    const meshCoords: [number, number][] = [];

    path2D.forEach((vec2: THREE.Vector2) => {
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
      meshCoords.push(transformToMeshCoordinates({ lng, lat, bbox: [minLng, minLat, maxLng, maxLat] }));
    });

    // Use dataset-wide elevation if the polygon's terrain difference is very small
    // This prevents unrealistic flat areas
    if (useSameZOffset) {
      // Use dataset values instead of individual polygon values
      lowestTerrainZ = datasetLowestZ;
      highestTerrainZ = datasetHighestZ;
    }

    // For water, use a fixed shallow depth; for other features, use the provided height
    let validatedHeight = Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT);
    if (vtDataSet.useAdaptiveScaleFactor) {

      const adaptiveScaleFactor = calculateAdaptiveScaleFactor(
        minLng,
        minLat,
        maxLng,
        maxLat,
        minElevation,
        maxElevation
      );
      validatedHeight = validatedHeight * adaptiveScaleFactor;
    }

    if (vtDataSet.heightScaleFactor) {
      validatedHeight = validatedHeight * vtDataSet.heightScaleFactor;
    }
    const terrainDifference = highestTerrainZ - lowestTerrainZ;

    // For water, position it slightly below terrain; for other features, use terrain base height
    const zBottom =
      lowestTerrainZ +
      (typeof vtDataSet?.zOffset !== "undefined" ? vtDataSet.zOffset : 0) -
      BUILDING_SUBMERGE_OFFSET;


    const shape = new THREE.Shape();
    shape.moveTo(meshCoords[0][0], meshCoords[0][1]);
    for (let i = 1; i < meshCoords.length; i++) {
      shape.lineTo(meshCoords[i][0], meshCoords[i][1]);
    }
    shape.autoClose = true;

    const extrudeSettings = {
      steps: 1,
      depth: validatedHeight,
      bevelEnabled: true,
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.translate(0, 0, zBottom);

    // Align vertices to terrain if specified
    if (vtDataSet.alignVerticesToTerrain) {
      // For ExtrudeGeometry, we need to:
      // 1. Identify top face vertices (they have higher z-values)
      // 2. Adjust only those vertices based on terrain height
      // 3. Keep bottom face at a consistent level
      // This preserves the structure of the extruded geometry
      
      const positions = geometry.attributes.position;
      const meshSize = 200; // Standard terrain mesh size
      
      // Create a heightmap to store terrain heights by vertex X,Y position
      const terrainHeightMap = new Map<string, number>();
      
      // First, detect which vertices are on the top face by their z-value
      // and pre-compute terrain heights for each unique X,Y coordinate
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        
        // Skip if this is clearly a bottom vertex
        if (z <= zBottom + 0.1) continue;
        
        // Create a key based on x,y coordinates (with rounding to handle floating point issues)
        const posKey = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
        
        // Only calculate terrain height once per unique x,y position
        if (!terrainHeightMap.has(posKey)) {
          // Convert mesh coordinates to geographic coordinates
          const geoLng = minLng + ((x + meshSize / 2) / meshSize) * (maxLng - minLng);
          const geoLat = minLat + ((y + meshSize / 2) / meshSize) * (maxLat - minLat);
          
          // Sample terrain height at this position
          const terrainZ = sampleTerrainElevationAtPoint(
            geoLng,
            geoLat,
            elevationGrid,
            gridSize,
            { minLng, minLat, maxLng, maxLat },
            minElevation,
            maxElevation
          );
          
          terrainHeightMap.set(posKey, terrainZ);
        }
      }
      
      // Now apply the terrain height adjustments to the top face
      // We'll examine each vertex to determine if it's part of the top face
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        
        // A more reliable way to identify top face vertices:
        // In an ExtrudeGeometry, the top face vertices have z values 
        // very close to zBottom + validatedHeight
        const isTopFace = Math.abs(z - (zBottom + validatedHeight)) < 0.1;
        
        if (isTopFace) {
          const posKey = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
          const terrainZ = terrainHeightMap.get(posKey);
          
          if (terrainZ !== undefined) {
            // Set the top vertex to terrain height + building height
            // This maintains the building's height while conforming to terrain
            positions.setZ(i, terrainZ + validatedHeight);
          }
        }
      }
      
      // Update the geometry and recompute normals
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    }

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

    // Store individual polygon properties in userData for hover interaction
    geometry.userData = {
      properties: {
        polygonIndex: polyIndex,
        sourceLayer: vtDataSet.sourceLayer,
        height: height,
        extrusionDepth: vtDataSet.extrusionDepth,
        zOffset: vtDataSet.zOffset,
        baseElevation: poly.baseElevation,
        geometryType: poly.type,
        // Include MVT feature properties (class, subclass, etc.)
        ...poly.properties
      }
    };

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

  console.log(`Merging ${normalizedGeometries.length} normalized geometries`);

  // If we have no valid geometries, return an empty one
  if (normalizedGeometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // If we have only one geometry, return it directly
  if (normalizedGeometries.length === 1) {
    return normalizedGeometries[0];
  }

  // Try to merge geometries - but preserve userData from individual geometries
  try {
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(
      normalizedGeometries,
      false
    );
    if (!mergedGeometry) {
      console.warn("Merge operation returned null geometry");
      return new THREE.BufferGeometry();
    }
    
    // Store information about all individual features in userData for hover interaction
    mergedGeometry.userData = {
      individualFeatures: normalizedGeometries.map(geom => geom.userData?.properties || {}),
      featureCount: normalizedGeometries.length
    };
    
    return mergedGeometry;
  } catch (error) {
    console.error("Error merging geometries:", error);
    // Return the first geometry as a fallback
    return normalizedGeometries[0];
  }
}

export default createPolygonGeometry;
