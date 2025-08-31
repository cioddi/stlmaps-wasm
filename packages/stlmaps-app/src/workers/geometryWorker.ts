/**
 * Geometry Processing Worker
 * Handles Three.js geometry creation and processing off the main thread
 */

import * as THREE from 'three';

interface WorkerMessage {
  id: string;
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
  cancelable?: boolean;
}

interface WorkerResponse {
  id: string;
  result?: any;
  error?: string;
  status: 'success' | 'error';
  progress?: number;
}

// Keep track of current processing
let currentTaskId: string | null = null;
let shouldCancel = false;

// Listen for messages from main thread
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, data, cancelable } = event.data;
  
  // Handle cancellation messages
  if (event.data.type === 'cancel') {
    shouldCancel = true;
    return;
  }
  
  try {
    currentTaskId = id;
    shouldCancel = false;
    
    const result = await processGeometries(data, id);
    
    if (!shouldCancel) {
      const response: WorkerResponse = {
        id,
        result,
        status: 'success'
      };
      
      self.postMessage(response);
    }
    
  } catch (error) {
    if (!shouldCancel) {
      const response: WorkerResponse = {
        id,
        error: error instanceof Error ? error.message : String(error),
        status: 'error'
      };
      
      self.postMessage(response);
    }
  } finally {
    currentTaskId = null;
  }
};

async function processGeometries(
  data: { geometryDataArray: any[], layerName: string }, 
  taskId: string
): Promise<any> {
  const { geometryDataArray, layerName } = data;
  const processedGeometries: any[] = [];
  const batchSize = 5; // Small batch size for frequent yielding
  
  console.log(`Worker: Processing ${geometryDataArray.length} geometries for ${layerName}`);
  
  for (let i = 0; i < geometryDataArray.length; i += batchSize) {
    // Check for cancellation
    if (shouldCancel || currentTaskId !== taskId) {
      throw new Error('Processing cancelled');
    }
    
    const batch = geometryDataArray.slice(i, i + batchSize);
    
    // Process current batch
    for (const geometryData of batch) {
      if (!geometryData.hasData || !geometryData.vertices || geometryData.vertices.length === 0) {
        console.log(`Worker: Skipping empty geometry data: hasData=${geometryData.hasData}, vertices=${geometryData.vertices?.length || 0}`);
        continue;
      }
      
      // Create serializable geometry data (can't send Three.js objects directly)
      const processedGeometry = {
        vertices: geometryData.vertices,
        normals: geometryData.normals,
        colors: geometryData.colors,
        indices: geometryData.indices,
        uvs: geometryData.uvs,
        properties: geometryData.properties,
        hasData: true,
        needsNormals: !geometryData.normals
      };
      
      processedGeometries.push(processedGeometry);
    }
    
    // Yield control and report progress
    if (i + batchSize < geometryDataArray.length) {
      const progress = (i + batchSize) / geometryDataArray.length;
      
      // Send progress update
      self.postMessage({
        id: taskId,
        status: 'progress',
        progress,
        result: {
          status: `Processing geometries... (${Math.min(i + batchSize, geometryDataArray.length)}/${geometryDataArray.length})`,
          progress: progress * 0.8 + 0.1 // 10-90% of total progress
        }
      });
      
      // Yield to allow cancellation checks
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  
  console.log(`Worker: Created ${processedGeometries.length} processed geometries for ${layerName}`);
  
  return {
    geometries: processedGeometries,
    layerName,
    geometryCount: processedGeometries.length
  };
}