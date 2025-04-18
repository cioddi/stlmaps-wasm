/**
 * Web Worker for polygon geometry processing
 * This worker handles computationally intensive geometry operations off the main thread
 */

// Import the createPolygonGeometry function that will do the actual processing
import createPolygonGeometry from "../three_maps/createPolygonGeometry";
import { GeometryData } from "../components/VectorTileFunctions";
import { GridSize, VtDataSet } from "../components/GenerateMeshButton";

// Track whether the current task should be cancelled
let isCancelled = false;

// Set up the worker message handler
self.onmessage = (event) => {
  // Check if this is a cancellation message
  if (event.data.type === 'cancel') {
    console.log(`[Worker]: Received cancellation signal`);
    isCancelled = true;
    // Send an acknowledgment that cancellation was received
    self.postMessage({
      status: 'cancelled',
      message: 'Worker acknowledged cancellation'
    });
    return;
  }
  
  try {
    const { id, data } = event.data;
    
    // Reset cancellation state at the start of a new task
    isCancelled = false;
    
    console.log(`[Worker ${id}]: Starting polygon geometry processing`);

    // Extract input data from the message
    const {
      bbox,
      polygons,
      terrainBaseHeight,
      elevationGrid,
      gridSize,
      minElevation,
      maxElevation,
      vtDataSet,
      useSameZOffset,
    } = data;

    //// Send progress update
    //self.postMessage({
    //  id,
    //  status: 'progress',
    //  message: 'Processing started'
    //});

    // Track the start time to monitor performance
    const startTime = performance.now();
    
    // Check if we've been cancelled before starting expensive operation
    if (isCancelled) {
      console.log(`[Worker ${id}]: Task was cancelled before processing started`);
      throw new Error('Task was cancelled');
    }

    // Call the existing createPolygonGeometry function to process the polygons
    const geometry = createPolygonGeometry({
      polygons,
      terrainBaseHeight,
      bbox,
      elevationGrid,
      gridSize,
      minElevation,
      maxElevation,
      vtDataSet,
      useSameZOffset
    });

    // More robust check for valid geometry
    if (!geometry) {
      throw new Error("Invalid geometry: geometry is null or undefined");
    }
    
    // Check if task was cancelled during processing
    if (isCancelled) {
      console.log(`[Worker ${id}]: Task was cancelled during processing`);
      throw new Error('Task was cancelled');
    }
    
    console.log(`[Worker ${id}]: Geometry created with attributes:`, 
                Object.keys(geometry.attributes || {}).join(', '));

    // Create a safe serialization with additional checks - convert to simple objects
    const serializedGeometry = safeSerializeGeometry(geometry);

    const endTime = performance.now();
    console.log(`[Worker ${id}]: Finished in ${(endTime - startTime).toFixed(1)}ms`);
    console.log(`[Worker ${id}]: Sending serialized geometry with vertex count:`, 
                serializedGeometry.vertices.length / 3);
    
    // For large data, use structured JSON to avoid transfer issues
    // This guarantees the data will arrive intact but as regular arrays
    const jsonString = JSON.stringify(serializedGeometry);
    
    self.postMessage({
      id,
      status: 'success',
      result: jsonString,  // Send as string to avoid transferable object issues
      dataType: 'json-string'  // Flag to indicate we're sending JSON string
    });
  } catch (error) {
    console.error('[Worker] Error:', error);
    self.postMessage({
      id: event.data.id,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Safely serializes a THREE.BufferGeometry object for transfer across the worker boundary
 * with additional error handling and validation
 * 
 * @param geometry - The THREE.BufferGeometry to serialize
 * @returns An object containing serialized geometry data with regular arrays (not TypedArrays)
 */
function safeSerializeGeometry(geometry: any): Record<string, any> {
  // Extract raw data from the buffer geometry
  const result: Record<string, any> = {};
  
  try {
    if (!geometry || !geometry.attributes) {
      console.warn('Invalid geometry received for serialization');
      // Return minimal valid structure for empty geometry
      return { 
        vertices: [],
        hasData: false
      };
    }
    
    // Position attribute (required)
    if (geometry.attributes.position && geometry.attributes.position.array) {
      const posArray = geometry.attributes.position.array;
      // Convert TypedArray to regular array for reliable serialization
      result.vertices = Array.from(posArray);
      console.log(`Position attribute found with ${posArray.length} elements`);
    } else {
      console.warn('Missing position attribute in geometry');
      // Create minimal valid data to prevent errors
      result.vertices = [];
      result.hasData = false;
      return result;
    }
    
    // Normal attribute (optional)
    if (geometry.attributes.normal && geometry.attributes.normal.array) {
      result.normals = Array.from(geometry.attributes.normal.array);
    }
    
    // UV attribute (optional)
    if (geometry.attributes.uv && geometry.attributes.uv.array) {
      result.uvs = Array.from(geometry.attributes.uv.array);
    }
    
    // Index attribute (optional)
    if (geometry.index && geometry.index.array) {
      result.indices = Array.from(geometry.index.array);
    }
    
    // Color attribute (optional)
    if (geometry.attributes.color && geometry.attributes.color.array) {
      result.colors = Array.from(geometry.attributes.color.array);
    }
    
    // Add flag to indicate this is valid data
    result.hasData = true;
    
  } catch (error) {
    console.error('Error during geometry serialization:', error);
    // Return minimal valid data structure to prevent complete failure
    return { 
      vertices: [],
      hasData: false,
      error: (error instanceof Error) ? error.message : String(error)
    };
  }
  
  return result;
}

// Signal that the worker is ready
console.log('[PolygonGeometryWorker] Initialized and ready for tasks');
