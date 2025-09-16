/**
 * Enhanced Background Processor Worker
 * Handles heavy computations off the main thread to prevent blocking
 * Supports multiple operation types and progress reporting
 */

import * as THREE from 'three';

// ================================================================================
// Types and Interfaces
// ================================================================================

interface BaseWorkerMessage {
  type: string;
  taskId?: string;
  requestId?: string;
}

interface ProcessGeometriesMessage extends BaseWorkerMessage {
  type: 'process-geometries';
  data: {
    geometryDataArray: Array<{
      vertices: number[];
      normals: number[] | null;
      colors: number[] | null;
      indices: number[] | null;
      uvs: number[] | null;
      hasData: boolean;
      properties?: Record<string, unknown>;
    }>;
    layerName: string;
  };
}

interface ConvertTerrainMessage extends BaseWorkerMessage {
  type: 'convert-terrain';
  data: {
    positions: number[];
    normals: number[];
    colors: number[];
    indices: number[];
  };
}

interface ParseJsonMessage extends BaseWorkerMessage {
  type: 'parse-json';
  data: {
    jsonString: string;
  };
}

interface OptimizeGeometryMessage extends BaseWorkerMessage {
  type: 'optimize-geometry';
  data: {
    vertices: number[];
    indices: number[];
    normals?: number[];
    colors?: number[];
    threshold?: number;
  };
}

interface CancelMessage extends BaseWorkerMessage {
  type: 'cancel';
  taskId?: string;
}

type WorkerMessage =
  | ProcessGeometriesMessage
  | ConvertTerrainMessage
  | ParseJsonMessage
  | OptimizeGeometryMessage
  | CancelMessage;

interface WorkerResponse {
  type: 'progress' | 'complete' | 'error';
  taskId?: string;
  requestId?: string;
  data?: any;
  progress?: number;
  error?: string;
  message?: string;
}

// ================================================================================
// Worker State Management
// ================================================================================

class WorkerStateManager {
  private activeTasks = new Map<string, boolean>();
  private cancellationFlags = new Map<string, boolean>();

  startTask(taskId: string): void {
    this.activeTasks.set(taskId, true);
    this.cancellationFlags.set(taskId, false);
  }

  cancelTask(taskId?: string): void {
    if (taskId) {
      this.cancellationFlags.set(taskId, true);
      this.activeTasks.delete(taskId);
    } else {
      // Cancel all tasks
      this.cancellationFlags.clear();
      this.activeTasks.clear();
    }
  }

  isCancelled(taskId: string): boolean {
    return this.cancellationFlags.get(taskId) === true;
  }

  completeTask(taskId: string): void {
    this.activeTasks.delete(taskId);
    this.cancellationFlags.delete(taskId);
  }

  checkCancellation(taskId: string): void {
    if (this.isCancelled(taskId)) {
      throw new Error('Task was cancelled');
    }
  }
}

const stateManager = new WorkerStateManager();

// ================================================================================
// Utility Functions
// ================================================================================

/**
 * Sends progress update to main thread
 */
function reportProgress(taskId: string, progress: number, message: string): void {
  const response: WorkerResponse = {
    type: 'progress',
    taskId,
    progress: Math.min(100, Math.max(0, progress)),
    message
  };
  self.postMessage(response);
}

/**
 * Sends completion response to main thread
 */
function reportComplete(taskId: string, data: any): void {
  const response: WorkerResponse = {
    type: 'complete',
    taskId,
    data
  };
  self.postMessage(response);
}

/**
 * Sends error response to main thread
 */
function reportError(taskId: string, error: string | Error): void {
  const response: WorkerResponse = {
    type: 'error',
    taskId,
    error: error instanceof Error ? error.message : String(error)
  };
  self.postMessage(response);
}

/**
 * Yields control back to the event loop to prevent blocking
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ================================================================================
// Processing Functions
// ================================================================================

/**
 * Processes geometry data arrays into optimized format
 */
async function processGeometries(
  taskId: string,
  geometryDataArray: Array<any>,
  layerName: string
): Promise<any> {
  try {
    reportProgress(taskId, 0, `Starting ${layerName} geometry processing...`);

    const processedGeometries: Array<any> = [];
    const totalGeometries = geometryDataArray.length;

    for (let i = 0; i < geometryDataArray.length; i++) {
      stateManager.checkCancellation(taskId);

      const geometryData = geometryDataArray[i];
      const progress = (i / totalGeometries) * 100;

      reportProgress(taskId, progress, `Processing geometry ${i + 1}/${totalGeometries}...`);

      if (!geometryData.hasData || !geometryData.vertices || geometryData.vertices.length === 0) {
        processedGeometries.push({
          hasData: false,
          vertices: [],
          indices: [],
          normals: [],
          colors: [],
          properties: geometryData.properties || {}
        });
        continue;
      }

      // Process vertices
      const vertices = new Float32Array(geometryData.vertices);

      // Process indices
      let indices: Uint32Array | null = null;
      if (geometryData.indices && geometryData.indices.length > 0) {
        indices = new Uint32Array(geometryData.indices);
      }

      // Process normals
      let normals: Float32Array | null = null;
      let needsNormals = false;
      if (geometryData.normals && geometryData.normals.length > 0) {
        normals = new Float32Array(geometryData.normals);
      } else {
        needsNormals = true;
      }

      // Process colors
      let colors: Float32Array | null = null;
      if (geometryData.colors && geometryData.colors.length > 0) {
        colors = new Float32Array(geometryData.colors);
      }

      processedGeometries.push({
        hasData: true,
        vertices: Array.from(vertices),
        indices: indices ? Array.from(indices) : null,
        normals: normals ? Array.from(normals) : null,
        colors: colors ? Array.from(colors) : null,
        needsNormals,
        properties: geometryData.properties || {}
      });

      // Yield control periodically
      if (i % 10 === 0) {
        await yieldToEventLoop();
      }
    }

    reportProgress(taskId, 100, `${layerName} geometry processing complete`);

    return {
      geometries: processedGeometries,
      layerName,
      totalProcessed: processedGeometries.length
    };

  } catch (error) {
    if (error instanceof Error && error.message === 'Task was cancelled') {
      throw error;
    }
    throw new Error(`Geometry processing failed: ${error}`);
  }
}

/**
 * Converts terrain data to Three.js compatible format
 */
async function convertTerrain(
  taskId: string,
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[]
): Promise<THREE.BufferGeometry> {
  try {
    reportProgress(taskId, 0, 'Converting terrain to Three.js format...');

    stateManager.checkCancellation(taskId);

    reportProgress(taskId, 25, 'Processing positions...');
    const geometry = new THREE.BufferGeometry();

    // Convert arrays to TypedArrays for better performance
    const positionArray = new Float32Array(positions);
    const normalArray = new Float32Array(normals);
    const colorArray = new Float32Array(colors);
    const indexArray = new Uint32Array(indices);

    reportProgress(taskId, 50, 'Setting attributes...');

    geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

    stateManager.checkCancellation(taskId);

    reportProgress(taskId, 75, 'Computing bounding sphere...');
    geometry.computeBoundingSphere();

    reportProgress(taskId, 100, 'Terrain conversion complete');

    return geometry;

  } catch (error) {
    if (error instanceof Error && error.message === 'Task was cancelled') {
      throw error;
    }
    throw new Error(`Terrain conversion failed: ${error}`);
  }
}

/**
 * Parses large JSON strings without blocking
 */
async function parseJsonAsync(
  taskId: string,
  jsonString: string
): Promise<any> {
  try {
    reportProgress(taskId, 0, 'Parsing JSON data...');

    stateManager.checkCancellation(taskId);

    // For very large JSON strings, we might want to implement chunked parsing
    // For now, we'll use setTimeout to yield control
    const result = await new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const parsed = JSON.parse(jsonString);
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      }, 0);
    });

    reportProgress(taskId, 100, 'JSON parsing complete');

    return result;

  } catch (error) {
    if (error instanceof Error && error.message === 'Task was cancelled') {
      throw error;
    }
    throw new Error(`JSON parsing failed: ${error}`);
  }
}

/**
 * Optimizes geometry by removing duplicate vertices
 */
async function optimizeGeometry(
  taskId: string,
  vertices: number[],
  indices: number[],
  normals?: number[],
  colors?: number[],
  threshold: number = 0.001
): Promise<any> {
  try {
    reportProgress(taskId, 0, 'Starting geometry optimization...');

    stateManager.checkCancellation(taskId);

    const vertexCount = vertices.length / 3;
    const optimizedVertices: number[] = [];
    const optimizedIndices: number[] = [];
    const optimizedNormals: number[] = [];
    const optimizedColors: number[] = [];

    const vertexMap = new Map<string, number>();
    let newVertexIndex = 0;

    reportProgress(taskId, 25, 'Processing vertices...');

    for (let i = 0; i < vertexCount; i++) {
      stateManager.checkCancellation(taskId);

      const x = vertices[i * 3];
      const y = vertices[i * 3 + 1];
      const z = vertices[i * 3 + 2];

      // Create a key for this vertex position (rounded to threshold)
      const key = `${Math.round(x / threshold)}:${Math.round(y / threshold)}:${Math.round(z / threshold)}`;

      let mappedIndex = vertexMap.get(key);
      if (mappedIndex === undefined) {
        // New unique vertex
        mappedIndex = newVertexIndex++;
        vertexMap.set(key, mappedIndex);

        optimizedVertices.push(x, y, z);

        if (normals && normals.length >= (i + 1) * 3) {
          optimizedNormals.push(
            normals[i * 3],
            normals[i * 3 + 1],
            normals[i * 3 + 2]
          );
        }

        if (colors && colors.length >= (i + 1) * 3) {
          optimizedColors.push(
            colors[i * 3],
            colors[i * 3 + 1],
            colors[i * 3 + 2]
          );
        }
      }

      // Update indices that reference this vertex
      for (let j = 0; j < indices.length; j++) {
        if (indices[j] === i) {
          optimizedIndices.push(mappedIndex);
        }
      }

      // Report progress periodically
      if (i % 1000 === 0) {
        const progress = 25 + (i / vertexCount) * 50;
        reportProgress(taskId, progress, `Processed ${i}/${vertexCount} vertices...`);
        await yieldToEventLoop();
      }
    }

    reportProgress(taskId, 100, 'Geometry optimization complete');

    const reductionPercentage = ((vertexCount - newVertexIndex) / vertexCount) * 100;
    console.log(`Geometry optimized: ${vertexCount} -> ${newVertexIndex} vertices (${reductionPercentage.toFixed(1)}% reduction)`);

    return {
      vertices: optimizedVertices,
      indices: optimizedIndices,
      normals: normals && normals.length > 0 ? optimizedNormals : null,
      colors: colors && colors.length > 0 ? optimizedColors : null,
      originalVertexCount: vertexCount,
      optimizedVertexCount: newVertexIndex,
      reductionPercentage
    };

  } catch (error) {
    if (error instanceof Error && error.message === 'Task was cancelled') {
      throw error;
    }
    throw new Error(`Geometry optimization failed: ${error}`);
  }
}

// ================================================================================
// Message Handler
// ================================================================================

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  const taskId = message.taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    if (message.type === 'cancel') {
      stateManager.cancelTask(message.taskId);
      return;
    }

    stateManager.startTask(taskId);

    let result: any;

    switch (message.type) {
      case 'process-geometries':
        result = await processGeometries(
          taskId,
          message.data.geometryDataArray,
          message.data.layerName
        );
        break;

      case 'convert-terrain':
        result = await convertTerrain(
          taskId,
          message.data.positions,
          message.data.normals,
          message.data.colors,
          message.data.indices
        );
        break;

      case 'parse-json':
        result = await parseJsonAsync(taskId, message.data.jsonString);
        break;

      case 'optimize-geometry':
        result = await optimizeGeometry(
          taskId,
          message.data.vertices,
          message.data.indices,
          message.data.normals,
          message.data.colors,
          message.data.threshold
        );
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }

    stateManager.completeTask(taskId);
    reportComplete(taskId, result);

  } catch (error) {
    stateManager.completeTask(taskId);

    if (error instanceof Error && error.message === 'Task was cancelled') {
      // Don't report cancelled tasks as errors
      return;
    }

    console.error(`Background processor error for task ${taskId}:`, error);
    reportError(taskId, error instanceof Error ? error : new Error(String(error)));
  }
};

// Handle worker termination
self.onunload = () => {
  console.log('Background processor worker terminating...');
};

export {}; // Make this a module