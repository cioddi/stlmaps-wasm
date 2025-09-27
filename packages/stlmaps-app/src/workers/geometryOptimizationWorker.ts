/**
 * Geometry Optimization Worker
 * Handles Three.js geometry creation and optimization off the main thread
 * Prevents UI blocking during final geometry processing
 */

import * as THREE from 'three';

// ================================================================================
// Types and Interfaces
// ================================================================================

interface WorkerMessage {
  id: string;
  type: 'create-geometries' | 'optimize-geometry' | 'merge-geometries' | 'cancel';
  data?: any;
}

interface WorkerResponse {
  id: string;
  type: 'progress' | 'result' | 'error';
  data?: any;
  progress?: number;
  error?: string;
}

interface GeometryData {
  hasData: boolean;
  vertices: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
  colors?: Float32Array;
  needsNormals: boolean;
  properties?: Record<string, any>;
}

interface OptimizedGeometryResult {
  geometries: THREE.BufferGeometry[];
  totalVertices: number;
  totalTriangles: number;
  optimizationStats: {
    originalVertices: number;
    optimizedVertices: number;
    reduction: number;
  };
}

// ================================================================================
// Worker State
// ================================================================================

let currentTaskId: string | null = null;
let cancelFlag = false;

// ================================================================================
// Geometry Processing Functions
// ================================================================================

/**
 * Creates optimized Three.js geometries from processed data
 */
async function createOptimizedGeometries(
  taskId: string,
  geometryDataArray: GeometryData[],
  layerName: string
): Promise<OptimizedGeometryResult> {
  try {
    const geometries: THREE.BufferGeometry[] = [];
    let totalVertices = 0;
    let totalTriangles = 0;
    let originalVertexCount = 0;
    let optimizedVertexCount = 0;

    const totalItems = geometryDataArray.length;

    postMessage({
      id: taskId,
      type: 'progress',
      progress: 0,
      data: { message: `Creating ${totalItems} geometries for ${layerName}...` }
    } as WorkerResponse);

    for (let i = 0; i < geometryDataArray.length; i++) {
      if (cancelFlag) {
        throw new Error('Task was cancelled');
      }

      const geometryData = geometryDataArray[i];

      if (!geometryData.hasData || !geometryData.vertices || geometryData.vertices.length === 0) {
        continue;
      }

      const originalVertices = geometryData.vertices.length / 3;
      originalVertexCount += originalVertices;

      // Create BufferGeometry
      const geometry = new THREE.BufferGeometry();

      // Set position attribute
      geometry.setAttribute('position', new THREE.BufferAttribute(geometryData.vertices, 3));

      // Set normals if available
      if (geometryData.normals && geometryData.normals.length > 0) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(geometryData.normals, 3));
      }

      // Set colors if available
      if (geometryData.colors && geometryData.colors.length > 0) {
        geometry.setAttribute('color', new THREE.BufferAttribute(geometryData.colors, 3));
      }

      // Set indices if available
      if (geometryData.indices && geometryData.indices.length > 0) {
        geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1));
        totalTriangles += geometryData.indices.length / 3;
      } else {
        totalTriangles += geometryData.vertices.length / 9; // 3 vertices per triangle, 3 components per vertex
      }

      // Add properties to userData
      if (geometryData.properties) {
        geometry.userData = { properties: geometryData.properties };
      }

      // Compute normals if needed (optimization: only when required)
      if (geometryData.needsNormals && !geometryData.normals) {
        geometry.computeVertexNormals();
      }

      // Optional optimization: merge vertices if beneficial
      const optimizedGeometry = await optimizeGeometry(geometry);
      const optimizedVertices = optimizedGeometry.attributes.position.count;

      optimizedVertexCount += optimizedVertices;
      totalVertices += optimizedVertices;

      geometries.push(optimizedGeometry);

      // Report progress
      const progress = ((i + 1) / totalItems) * 100;
      if (i % 10 === 0 || i === totalItems - 1) {
        postMessage({
          id: taskId,
          type: 'progress',
          progress,
          data: { message: `Processed ${i + 1}/${totalItems} geometries...` }
        } as WorkerResponse);

        // Yield control to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const reduction = originalVertexCount > 0
      ? ((originalVertexCount - optimizedVertexCount) / originalVertexCount) * 100
      : 0;

    const result: OptimizedGeometryResult = {
      geometries,
      totalVertices,
      totalTriangles,
      optimizationStats: {
        originalVertices: originalVertexCount,
        optimizedVertices: optimizedVertexCount,
        reduction
      }
    };

    
    

    return result;

  } catch (error) {
    
    throw error;
  }
}

/**
 * Optimizes a single geometry by removing duplicate vertices and other optimizations
 */
async function optimizeGeometry(geometry: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
  try {
    // For now, return as-is. In the future, we could implement:
    // - Vertex deduplication
    // - Mesh simplification
    // - Normal optimization
    // - Index optimization

    // Ensure bounding sphere is computed for culling optimizations
    geometry.computeBoundingSphere();

    return geometry;
  } catch (error) {
    
    return geometry;
  }
}

/**
 * Merges multiple geometries into a single optimized geometry
 */
async function mergeGeometries(
  taskId: string,
  geometries: THREE.BufferGeometry[],
  preserveIndividual: boolean = true
): Promise<{ merged?: THREE.BufferGeometry; individual: THREE.BufferGeometry[] }> {
  try {
    postMessage({
      id: taskId,
      type: 'progress',
      progress: 0,
      data: { message: `Merging ${geometries.length} geometries...` }
    } as WorkerResponse);

    if (cancelFlag) {
      throw new Error('Task was cancelled');
    }

    let merged: THREE.BufferGeometry | undefined;

    // Only merge if we have multiple geometries and merging is beneficial
    if (geometries.length > 1 && geometries.length < 1000) { // Avoid merging too many geometries
      try {
        // Merge geometries for better rendering performance
        merged = new THREE.BufferGeometry();

        // Simple merge implementation (in production, use THREE.BufferGeometryUtils.mergeGeometries)
        const positions: number[] = [];
        const normals: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];

        let vertexOffset = 0;

        for (let i = 0; i < geometries.length; i++) {
          const geom = geometries[i];

          if (geom.attributes.position) {
            const posArray = geom.attributes.position.array as Float32Array;
            positions.push(...Array.from(posArray));
          }

          if (geom.attributes.normal) {
            const normArray = geom.attributes.normal.array as Float32Array;
            normals.push(...Array.from(normArray));
          }

          if (geom.attributes.color) {
            const colorArray = geom.attributes.color.array as Float32Array;
            colors.push(...Array.from(colorArray));
          }

          if (geom.index) {
            const indexArray = geom.index.array as Uint32Array;
            const offsetIndices = Array.from(indexArray).map(idx => idx + vertexOffset);
            indices.push(...offsetIndices);
          }

          vertexOffset += geom.attributes.position.count;

          // Progress update
          if (i % 100 === 0) {
            const progress = (i / geometries.length) * 50; // First 50% for merging
            postMessage({
              id: taskId,
              type: 'progress',
              progress,
              data: { message: `Merging geometry ${i + 1}/${geometries.length}...` }
            } as WorkerResponse);

            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        // Set merged attributes
        if (positions.length > 0) {
          merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        }
        if (normals.length > 0) {
          merged.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        }
        if (colors.length > 0) {
          merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        }
        if (indices.length > 0) {
          merged.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        }

        merged.computeBoundingSphere();

        postMessage({
          id: taskId,
          type: 'progress',
          progress: 75,
          data: { message: 'Optimizing merged geometry...' }
        } as WorkerResponse);

      } catch (mergeError) {
        
        merged = undefined;
      }
    }

    postMessage({
      id: taskId,
      type: 'progress',
      progress: 100,
      data: { message: 'Geometry processing complete' }
    } as WorkerResponse);

    return {
      merged,
      individual: preserveIndividual ? geometries : []
    };

  } catch (error) {
    
    throw error;
  }
}

// ================================================================================
// Message Handler
// ================================================================================

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = event.data;

  try {
    currentTaskId = id;
    cancelFlag = false;

    switch (type) {
      case 'create-geometries': {
        const { geometryDataArray, layerName } = data;
        const result = await createOptimizedGeometries(id, geometryDataArray, layerName);

        postMessage({
          id,
          type: 'result',
          data: result
        } as WorkerResponse);
        break;
      }

      case 'merge-geometries': {
        const { geometries, preserveIndividual } = data;
        const result = await mergeGeometries(id, geometries, preserveIndividual);

        postMessage({
          id,
          type: 'result',
          data: result
        } as WorkerResponse);
        break;
      }

      case 'optimize-geometry': {
        const { geometry } = data;
        const result = await optimizeGeometry(geometry);

        postMessage({
          id,
          type: 'result',
          data: { optimizedGeometry: result }
        } as WorkerResponse);
        break;
      }

      case 'cancel':
        if (currentTaskId === id || !id) {
          cancelFlag = true;
          
        }
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    currentTaskId = null;

  } catch (error) {
    

    if (error instanceof Error && error.message === 'Task was cancelled') {
      // Don't report cancelled tasks as errors
      return;
    }

    postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    } as WorkerResponse);

    currentTaskId = null;
  }
};

// Handle worker errors
self.onerror = (error) => {
  

  if (currentTaskId) {
    postMessage({
      id: currentTaskId,
      type: 'error',
      error: `Geometry worker error: ${error.message || error}`
    } as WorkerResponse);
  }
};

// Export for TypeScript
export {};