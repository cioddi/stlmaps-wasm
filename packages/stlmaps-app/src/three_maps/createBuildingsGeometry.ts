import * as THREE from "three";
import { BuildingData } from "../components/VectorTileFunctions";
import { GridSize } from "../components/GenerateMeshButton";
import { sampleTerrainElevationAtPoint } from "./sampleTerrainElevationAtPoint";
import { calculateAdaptiveScaleFactor } from "./calculateAdaptiveScaleFactor";
//@ts-expect-error
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import { transformToMeshCoordinates } from "./transformToMeshCoordinates";

// Submerge offset to ensure bottom slightly dips into terrain
const BUILDING_SUBMERGE_OFFSET = 0.5;

export function createBuildingsGeometry({
  buildings,
  buildingScaleFactor,
  verticalExaggeration,
  terrainBaseHeight,
  bbox: [minLng, minLat, maxLng, maxLat],
  elevationGrid,
  gridSize,
  minElevation,
  maxElevation,
}: {
  buildings: BuildingData[];
  buildingScaleFactor: number;
  verticalExaggeration: number;
  terrainBaseHeight: number; // new parameter
  bbox: [number, number, number, number];
  elevationGrid: number[][];
  gridSize: GridSize;
  minElevation: number;
  maxElevation: number;
}): THREE.BufferGeometry {
  const bufferGeometries: THREE.BufferGeometry[] = [];
  const processedFootprints = new Set<string>();
  // Define a consistent building color
  const buildingColor = new THREE.Color(0.7, 0.7, 0.7);

  // Maximum reasonable building height in meters (skyscrapers rarely exceed this)
  const MAX_BUILDING_HEIGHT = 500;
  // Minimum reasonable building height in meters
  const MIN_BUILDING_HEIGHT = 2;


  buildings.forEach((bld) => {
    const { footprint, height = 15 } = bld;
    if (!footprint || footprint.length < 3) return;

    // Create a footprint signature to detect duplicates
    const footprintSignature = footprint
      .map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
      .join("|");

    if (processedFootprints.has(footprintSignature)) return;
    processedFootprints.add(footprintSignature);

    // Ensure polygons are oriented clockwise
    const path2D = footprint.map(([lng, lat]) => new THREE.Vector2(lng, lat));
    if (!THREE.ShapeUtils.isClockWise(path2D)) {
      path2D.reverse();
    }

    // Calculate average terrain elevation instead of just the lowest point
    let totalTerrainZ = 0;
    let lowestTerrainZ = Infinity;
    let highestTerrainZ = -Infinity;
    const meshCoords: [number, number][] = [];

    path2D.forEach((vec2) => {
      const lng = vec2.x;
      const lat = vec2.y;
      // Get terrain elevation without exaggeration
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
      totalTerrainZ += tZ;
      meshCoords.push(transformToMeshCoordinates({lng, lat, bbox: [minLng, minLat, maxLng, maxLat]}));
    });

    // Use average elevation for more stability with complex buildings
    const avgTerrainZ = totalTerrainZ / path2D.length;

    // Apply vertical exaggeration to base elevation
    const lowestExaggeratedTerrainZ = lowestTerrainZ;
    const highestExaggeratedTerrainZ = highestTerrainZ;
    const terrainDifference =
      highestExaggeratedTerrainZ - lowestExaggeratedTerrainZ;

    // Strict height validation to prevent unreasonable values
    const validatedHeight = Math.min(
      Math.max(height + terrainDifference, MIN_BUILDING_HEIGHT),
      MAX_BUILDING_HEIGHT
    );

    const adaptiveScaleFactor = calculateAdaptiveScaleFactor(
      minLng,
      minLat,
      maxLng,
      maxLat,
      minElevation,
      maxElevation
    );

    // Apply vertical exaggeration to building height with a dampening factor for taller buildings
    // This prevents extreme heights while maintaining proportionality
    const heightDampeningFactor = Math.max(
      0.5,
      1 - validatedHeight / MAX_BUILDING_HEIGHT
    );
    const effectiveHeight =
      validatedHeight *
      adaptiveScaleFactor *
      buildingScaleFactor *
      heightDampeningFactor;

    const zBottom =
      lowestExaggeratedTerrainZ - BUILDING_SUBMERGE_OFFSET;

      console.log("effectiveHeight", effectiveHeight, "zBottom", zBottom, "lowestExaggeratedTerrainZ", lowestExaggeratedTerrainZ, "heightDampeningFactor", heightDampeningFactor);
    const shape = new THREE.Shape();
    shape.moveTo(meshCoords[0][0], meshCoords[0][1]);
    for (let i = 1; i < meshCoords.length; i++) {
      shape.lineTo(meshCoords[i][0], meshCoords[i][1]);
    }
    shape.autoClose = true;

    const extrudeSettings = {
      steps: 1,
      depth: effectiveHeight,
      bevelEnabled: false,
    };
    const buildingGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    buildingGeometry.translate(0, 0, zBottom);
    buildingGeometry.computeVertexNormals();

    // Add color attribute to match terrain expectation
    const colorArray = new Float32Array(
      buildingGeometry.attributes.position.count * 3
    );
    for (let i = 0; i < buildingGeometry.attributes.position.count; i++) {
      colorArray[i * 3] = buildingColor.r;
      colorArray[i * 3 + 1] = buildingColor.g;
      colorArray[i * 3 + 2] = buildingColor.b;
    }
    buildingGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colorArray, 3)
    );

    // Remove UV attributes to prevent conflicts
    if (buildingGeometry.hasAttribute("uv")) {
      buildingGeometry.deleteAttribute("uv");
    }

    bufferGeometries.push(buildingGeometry);
  });

  if (!bufferGeometries.length) return new THREE.BufferGeometry();
  const mergedGeometry = BufferGeometryUtils.mergeGeometries(
    bufferGeometries,
    false
  );
  return mergedGeometry || new THREE.BufferGeometry();
}
