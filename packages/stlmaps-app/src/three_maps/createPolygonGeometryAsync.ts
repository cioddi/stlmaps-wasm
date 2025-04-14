import * as THREE from "three";
import { WorkerService } from "../workers/WorkerService";
import { GridSize, VtDataSet } from "../components/GenerateMeshButton";
import { GeometryData } from "../components/VectorTileFunctions";

// Import the worker directly - Vite will handle the bundling
import PolygonWorker from "../workers/polygonGeometryWorker.ts?worker";
const WORKER_NAME = "polygon-geometry";

/**
 * Creates polygon geometry using a web worker to avoid blocking the main thread
 * 
 * @param params - Parameters needed for polygon geometry creation
 * @returns Promise that resolves with the created buffer geometry
 */
export async function createPolygonGeometryAsync({
  bbox,
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
}): Promise<THREE.BufferGeometry> {
  try {
    // Run the geometry creation in a worker
    const serializedGeometry = await WorkerService.runWorkerTask(
      WORKER_NAME,
      PolygonWorker,
      {
        bbox,
        polygons,
        terrainBaseHeight,
        elevationGrid,
        gridSize,
        minElevation,
        maxElevation,
        vtDataSet,
        useSameZOffset,
      }
    );

    const parsedGeometry = JSON.parse(serializedGeometry);
    // Create a new buffer geometry from the serialized data
    if (!parsedGeometry || !parsedGeometry.vertices) {
      console.error("Worker returned invalid geometry data");
      return new THREE.BufferGeometry();
    }

    const geometry = new THREE.BufferGeometry();
    
    // Add position attribute
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(parsedGeometry.vertices, 3)
    );
    
    // Add normal attribute if available
    if (parsedGeometry.normals) {
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(parsedGeometry.normals, 3)
      );
    } else {
      // Compute normals if not provided
      geometry.computeVertexNormals();
    }
    
    // Add UV attribute if available
    if (parsedGeometry.uvs) {
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(parsedGeometry.uvs, 2)
      );
    }
    
    // Add indices if available
    if (parsedGeometry.indices) {
      geometry.setIndex(Array.from(parsedGeometry.indices));
    }
    
    return geometry;
  } catch (error) {
    console.error("Error in polygon geometry worker:", error);
    // Return an empty geometry as fallback
    return new THREE.BufferGeometry();
  }
}

/**
 * Legacy synchronous function for compatibility with existing code
 * This is a wrapper that logs a deprecation warning and calls the async version
 * In the long term, all code should be updated to use the async version directly
 */
export function createPolygonGeometry(params: {
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
  console.warn(
    "Deprecated: createPolygonGeometry is running on the main thread. " +
    "Use createPolygonGeometryAsync instead to avoid UI freezing."
  );
  
  // Create an empty geometry that will be populated later
  const placeholder = new THREE.BufferGeometry();
  
  // Start the async operation
  createPolygonGeometryAsync(params)
    .then((geometry) => {
      // Copy all attributes and properties from the async result to our placeholder
      placeholder.copy(geometry);
      // Force attribute update
      placeholder.attributes.position.needsUpdate = true;
      if (placeholder.attributes.normal) {
        placeholder.attributes.normal.needsUpdate = true;
      }
    })
    .catch((error) => {
      console.error("Failed to create polygon geometry asynchronously:", error);
    });
  
  // Return the placeholder that will be updated when the worker finishes
  return placeholder;
}

// Default export for compatibility with existing imports
export default createPolygonGeometry;
