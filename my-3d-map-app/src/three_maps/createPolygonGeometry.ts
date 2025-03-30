import * as THREE from "three";
import { PolygonData } from "../components/VectorTileFunctions";
import { GridSize, VtDataSet } from "../components/GenerateMeshButton";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";

const BUILDING_SUBMERGE_OFFSET = 0.01;

function createPolygonGeometry(
  polygons: PolygonData[],
  geometryScaleFactor: number,
  verticalExaggeration: number,
  terrainBaseHeight: number,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  elevationGrid: number[][],
  gridSize: GridSize,
  minElevation: number,
  maxElevation: number,
  vtDataSet: VtDataSet
): THREE.BufferGeometry {
  const bufferGeometries: THREE.BufferGeometry[] = [];
  const processedGeometries = new Set<string>();

  // Maximum reasonable height in meters
  const MAX_HEIGHT = 500;
  // Minimum reasonable height in meters
  const MIN_HEIGHT = 2;

  function transformToMeshCoordinates(
    lng: number,
    lat: number
  ): [number, number] {
    const xFrac = (lng - minLng) / (maxLng - minLng) - 0.5;
    const yFrac = (lat - minLat) / (maxLat - minLat) - 0.5;
    return [xFrac * 200, yFrac * 200];
  }

  function sampleTerrainElevationAtPoint(
    lng: number,
    lat: number,
    elevationGrid: number[][],
    gridSize: GridSize,
    bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number }
  ): number {
    const { width, height } = gridSize;
    const { minLng, minLat, maxLng, maxLat } = bounds;

    const xFrac = (lng - minLng) / (maxLng - minLng);
    const yFrac = (lat - minLat) / (maxLat - minLat);

    let x = Math.floor(xFrac * width);
    let y = Math.floor(yFrac * height);

    x = Math.max(0, Math.min(x, width - 1));
    y = Math.max(0, Math.min(y, height - 1));

    const elevation = elevationGrid[y][x];

    return elevation;
  }
  function calculateAdaptiveScaleFactor(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    minElevation: number,
    maxElevation: number
  ): number {
    // Calculate the bounding box area in geographic coordinates (degrees).
    const lngDiff = maxLng - minLng;
    const latDiff = maxLat - minLat;
    const areaInDegrees = lngDiff * latDiff;

    // Calculate the elevation range.
    const elevationRange = maxElevation - minElevation;

    // Define some scaling factors based on area and elevation range.
    const areaScaleFactor = 1000; // Adjust this based on your typical area size.
    const elevationScaleFactor = 10; // Adjust this based on your typical elevation range.

    // Combine the scaling factors to get an adaptive scale factor.
    const adaptiveScaleFactor =
      areaInDegrees * areaScaleFactor + elevationRange * elevationScaleFactor;

    return adaptiveScaleFactor;
  }

  polygons.forEach((poly) => {
    const { geometry: footprint, height = 1 } = poly;

    if (!footprint || footprint.length < 3) return;

    // Create a footprint signature to detect duplicates
    const geometrySignature = footprint
      .map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
      .join("|");

    if (processedGeometries.has(geometrySignature)) return;
    processedGeometries.add(geometrySignature);

    // Ensure polygons are oriented clockwise
    const path2D = footprint.map(([lng, lat]) => new THREE.Vector2(lng, lat));
    if (!THREE.ShapeUtils.isClockWise(path2D)) {
      path2D.reverse();
    }

    // Calculate average terrain elevation
    let totalTerrainZ = 0;
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
      totalTerrainZ += tZ;
      meshCoords.push(transformToMeshCoordinates(lng, lat));
    });

    const avgTerrainZ = totalTerrainZ / path2D.length;

    // Apply vertical exaggeration
    const lowestExaggeratedTerrainZ = lowestTerrainZ * verticalExaggeration;
    const highestExaggeratedTerrainZ = highestTerrainZ * verticalExaggeration;
    const terrainDifference =
      highestExaggeratedTerrainZ - lowestExaggeratedTerrainZ;

    // Strict height validation
    const validatedHeight = Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT);

    const zBottom = terrainBaseHeight - BUILDING_SUBMERGE_OFFSET;

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
    bufferGeometries.push(geometry);
  });

  if (!bufferGeometries.length) return new THREE.BufferGeometry();
  const mergedGeometry = BufferGeometryUtils.mergeGeometries(
    bufferGeometries,
    false
  );
  return mergedGeometry || new THREE.BufferGeometry();
}

export default createPolygonGeometry;
