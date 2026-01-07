/**
 * Dedicated WASM Layer Worker
 * Each worker maintains its own WASM instance for true parallel processing
 * Handles layer-specific geometry processing without blocking main thread
 */

// Import WASM module and initialization function
import wasmInit, * as WasmModule from "@threegis/core-wasm";

// ================================================================================
// WASM Fetch Helper Functions for Worker Context
// ================================================================================

interface TileFetchResponse {
  width: number;
  height: number;
  x: number;
  y: number;
  z: number;
  pixelData?: Uint8Array;
  rawData?: Uint8Array;
  mimeType: string;
}

interface FetchConfig {
  maxRetries: number;
  timeoutMs: number;
  backoffMs: number;
  validateContent: boolean;
}

const extractTileCoordinatesFromUrl = (url: string): { x: number; y: number; z: number } => {
  const urlParts = url.split('/');
  let x = 0, y = 0, z = 0;

  if (urlParts.length >= 3) {
    const possibleZ = parseInt(urlParts[urlParts.length - 3], 10);
    const possibleX = parseInt(urlParts[urlParts.length - 2], 10);
    const possibleY = parseInt(urlParts[urlParts.length - 1], 10);

    if (!isNaN(possibleZ)) z = possibleZ;
    if (!isNaN(possibleX)) x = possibleX;

    if (!isNaN(possibleY)) {
      const yStr = urlParts[urlParts.length - 1];
      const dotIndex = yStr.indexOf('.');
      if (dotIndex > 0) {
        y = parseInt(yStr.substring(0, dotIndex), 10);
      } else {
        y = possibleY;
      }
    }
  }

  return { x, y, z };
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal }); // Use global fetch in worker
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

const robustFetch = async (url: string, config: FetchConfig): Promise<TileFetchResponse> => {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, config.timeoutMs);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await response.arrayBuffer();
      const rawData = new Uint8Array(arrayBuffer);

      if (config.validateContent && rawData.length === 0) {
        throw new Error('Empty response data');
      }

      const tileCoords = extractTileCoordinatesFromUrl(url);

      return {
        width: 256,
        height: 256,
        x: tileCoords.x,
        y: tileCoords.y,
        z: tileCoords.z,
        rawData,
        mimeType: contentType
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        const delay = config.backoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw new Error(`Fetch failed after ${config.maxRetries + 1} attempts: ${lastError!.message}`);
};

const initWorkerWasmFetchHelpers = () => {
  const defaultConfig: FetchConfig = {
    maxRetries: 3,
    timeoutMs: 10000,
    backoffMs: 1000,
    validateContent: true
  };

  (self as any).wasmJsHelpers = {
    ...(self as any).wasmJsHelpers,

    fetch: async (url: string, configOverrides?: Partial<FetchConfig>): Promise<TileFetchResponse> => {
      const config = { ...defaultConfig, ...configOverrides };
      return robustFetch(url, config);
    },

    fetchWithConfig: async (url: string, config: FetchConfig): Promise<TileFetchResponse> => {
      return robustFetch(url, config);
    }
  };
};

// ================================================================================
// Types and Interfaces
// ================================================================================

interface WorkerMessage {
  id: string;
  type: 'init' | 'process-layer' | 'sync-resources' | 'terminate' | 'cancel';
  data?: any;
}

interface SharedVectorTileData {
  tileKey: string;
  data: ArrayBuffer;
  metadata: {
    x: number;
    y: number;
    z: number;
    sourceLayer?: string;
    size: number;
    timestamp: number;
  };
}

interface ResourceSyncData {
  processId: string;
  bbox: [number, number, number, number];
  vectorTiles: SharedVectorTileData[];
  elevationData?: {
    grid: number[][];
    gridSize: { width: number; height: number };
    minElevation: number;
    maxElevation: number;
  };
  timestamp: number;
}

interface WorkerResponse {
  id: string;
  type: 'initialized' | 'progress' | 'result' | 'error' | 'resources-synced';
  data?: any;
  progress?: number;
  error?: string;
  success?: boolean;
  processId?: string;
}

interface LayerProcessingInput {
  layerConfig: any;
  bboxCoords: [number, number, number, number];
  processId: string;
  terrainData: {
    processedElevationGrid: number[][];
    gridSize: { width: number; height: number };
    originalMinElevation: number;
    originalMaxElevation: number;
    processedMinElevation: number;
    processedMaxElevation: number;
  };
  terrainSettings: any;
  debugMode: boolean;
}

// ================================================================================
// Worker State
// ================================================================================

let wasmModule: typeof WasmModule | null = null;
let isInitialized = false;
let currentTaskId: string | null = null;
let cancelFlag = false;

// Shared resource state
let sharedVectorTiles: Map<string, SharedVectorTileData> = new Map();
let sharedElevationData: any = null;
let currentProcessId: string | null = null;
let fetchingProcessId: string | null = null;  // Track which process is currently being fetched

// ================================================================================
// WASM Initialization
// ================================================================================

async function initializeWasmInWorker(): Promise<void> {
  try {
    

    // Initialize WASM fetch helpers first
    initWorkerWasmFetchHelpers();
    

    // Validate WebAssembly support
    if (!WebAssembly) {
      throw new Error("WebAssembly not supported in worker environment");
    }

    // Create dedicated memory for this worker
    const memory = new WebAssembly.Memory({
      initial: 1024,  // Start smaller per worker
      maximum: 8192   // Limit per worker to allow multiple instances
    });

    const table = new WebAssembly.Table({
      initial: 5000,  // Smaller table per worker
      maximum: 25000,
      element: "anyfunc"
    });

    const refTable = new WebAssembly.Table({
      initial: 5000,
      maximum: 25000,
      element: "externref"
    });

    // Set up worker-specific WASM environment
    (self as any).__WASM_MEMORY = memory;
    (self as any).__WASM_TABLE = table;
    (self as any).__WASM_EXTERNREF_TABLE = refTable;
    (self as any).__wbindgen_externref_table_ptr = refTable;
    (self as any).__wbindgen_anyfunc_table_ptr = table;

    // Initialize WASM module in this worker context
    await wasmInit();
    wasmModule = WasmModule;

    // Validate essential functions exist
    const requiredFunctions = [
      'extract_features_from_vector_tiles',
      'process_polygon_geometry'
    ];

    const missingFunctions = requiredFunctions.filter(
      fn => !(wasmModule as any)[fn] || typeof (wasmModule as any)[fn] !== 'function'
    );

    if (missingFunctions.length > 0) {
      throw new Error(`Missing WASM functions: ${missingFunctions.join(', ')}`);
    }

    isInitialized = true;
    

  } catch (error) {
    isInitialized = false;
    wasmModule = null;
    throw new Error(`Worker WASM initialization failed: ${error}`);
  }
}

// ================================================================================
// Resource Synchronization Functions
// ================================================================================

async function syncSharedResources(data: ResourceSyncData): Promise<void> {
  try {
    

    // Store process ID for future reference
    currentProcessId = data.processId;

    // Clear existing resources
    sharedVectorTiles.clear();
    sharedElevationData = null;

    // Store vector tiles
    for (const tile of data.vectorTiles) {
      sharedVectorTiles.set(tile.tileKey, tile);
    }

    // Store elevation data if provided
    if (data.elevationData) {
      sharedElevationData = data.elevationData;
    }

    // If WASM is initialized, load resources into WASM instance
    if (isInitialized && wasmModule) {
      await loadResourcesIntoWasm(data);
    }

    

  } catch (error) {
    
    throw error;
  }
}

async function loadResourcesIntoWasm(data: ResourceSyncData): Promise<void> {
  if (!wasmModule) {
    throw new Error('WASM module not available');
  }

  try {
    // Load vector tiles into WASM process cache using add_process_feature_data_js
    if ((wasmModule as any).add_process_feature_data_js && data.vectorTiles.length > 0) {
      

      // Store vector tiles as JSON data in process cache
      const tileDataForWasm = data.vectorTiles.map(tile => ({
        tileKey: tile.tileKey,
        x: tile.metadata.x,
        y: tile.metadata.y,
        z: tile.metadata.z,
        sourceLayer: tile.metadata.sourceLayer,
        data: Array.from(new Uint8Array(tile.data)), // Convert ArrayBuffer to array for JSON
        size: tile.metadata.size
      }));

      // Try multiple data keys to ensure the data is accessible
      const dataKeys = ['vector_tiles', 'vt_data', 'tile_cache'];

      for (const dataKey of dataKeys) {
        try {
          const success = (wasmModule as any).add_process_feature_data_js(
            data.processId,
            dataKey,
            JSON.stringify(tileDataForWasm)
          );

          if (success) {
            
          }
        } catch (keyError) {
          
        }
      }

      // Also try to store individual tiles by tile key
      for (const tile of data.vectorTiles) {
        try {
          const tileData = {
            x: tile.metadata.x,
            y: tile.metadata.y,
            z: tile.metadata.z,
            sourceLayer: tile.metadata.sourceLayer,
            data: Array.from(new Uint8Array(tile.data)),
            size: tile.metadata.size
          };

          (wasmModule as any).add_process_feature_data_js(
            data.processId,
            `tile_${tile.tileKey}`,
            JSON.stringify(tileData)
          );
        } catch (tileError) {
          
        }
      }
    }

    // Load elevation data if available
    if (data.elevationData && (wasmModule as any).add_process_feature_data_js) {
      try {
        const success = (wasmModule as any).add_process_feature_data_js(
          data.processId,
          'elevation_data',
          JSON.stringify(data.elevationData)
        );

        if (success) {
          
        }
      } catch (elevationError) {
        
      }
    }

    

  } catch (error) {
    
    // Don't throw here as the worker can still function with fallback methods
  }
}

// ================================================================================
// Vector Tile Availability Functions
// ================================================================================

/**
 * Ensure vector tiles are available for the given process ID
 * If shared tiles aren't available, fetch them directly in this worker
 */
async function ensureVectorTilesForProcess(
  processId: string,
  bboxCoords: [number, number, number, number]
): Promise<void> {
  if (!wasmModule) {
    throw new Error('WASM module not available');
  }

  try {
    // Check if we already have shared vector tiles
    if (sharedVectorTiles.size > 0) {

      return;
    }

    // Check if tiles are already cached in WASM for this process
    if ((wasmModule as any).get_cached_process_ids_js) {
      const processIds = (wasmModule as any).get_cached_process_ids_js();
      if (processIds && processIds.includes(processId)) {

        return;
      }
    }

    // Check if another worker is already fetching this process
    if (fetchingProcessId === processId) {
      // Wait for the other worker to finish fetching
      let attempts = 0;
      while (fetchingProcessId === processId && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        attempts++;
      }
      // Check again if tiles are now available
      if ((wasmModule as any).get_cached_process_ids_js) {
        const processIds = (wasmModule as any).get_cached_process_ids_js();
        if (processIds && processIds.includes(processId)) {
          currentProcessId = processId;
          return;
        }
      }
    }

    // Set fetching flag to prevent other workers from fetching the same data
    fetchingProcessId = processId;

    const [west, south, east, north] = bboxCoords;
    const fetchInput = {
      min_lng: west,
      min_lat: south,
      max_lng: east,
      max_lat: north,
      zoom: 14,
      grid_width: 256,
      grid_height: 256,
      process_id: processId  // Use original process ID, not unique worker ID
    };

    if ((wasmModule as any).fetch_vector_tiles) {
      await (wasmModule as any).fetch_vector_tiles(fetchInput);

      // Use the original process ID for consistency
      currentProcessId = processId;
    } else {

    }

  } catch (error) {

    // Don't throw here - let the extraction attempt proceed and handle the error there
  } finally {
    // Clear fetching flag when done
    if (fetchingProcessId === processId) {
      fetchingProcessId = null;
    }
  }
}

// ================================================================================
// Layer Processing Functions
// ================================================================================

async function processLayerInWorker(input: LayerProcessingInput): Promise<any> {
  if (!isInitialized || !wasmModule) {
    throw new Error('WASM module not initialized in worker');
  }

  const { layerConfig, bboxCoords, processId, terrainData, terrainSettings, debugMode } = input;

  try {
    // Check for cancellation
    if (cancelFlag) {
      throw new Error('Task was cancelled');
    }

    // Report progress
    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 5,
      data: { message: `Ensuring vector tiles for ${layerConfig.sourceLayer}...` }
    } as WorkerResponse);

    // Step 0: Ensure vector tiles are available for this process
    await ensureVectorTilesForProcess(processId, bboxCoords);

    // Report progress
    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 10,
      data: { message: `Extracting features for ${layerConfig.sourceLayer}...` }
    } as WorkerResponse);

    // Step 1: Extract features from vector tiles
    // Use the current process ID (may have been updated to worker-specific ID)
    const activeProcessId = currentProcessId || processId;

    const extractResult = await wasmModule.extract_features_from_vector_tiles({
      bbox: bboxCoords,
      vtDataSet: layerConfig,
      processId: activeProcessId,
      elevationProcessId: activeProcessId
    });

    if (cancelFlag) {
      throw new Error('Task was cancelled');
    }

    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 40,
      data: { message: `Creating geometry for ${layerConfig.sourceLayer}...` }
    } as WorkerResponse);

    // Step 2: Create polygon geometry
    const polygonGeometryInput = {
      terrainBaseHeight: terrainSettings.baseHeight,
      verticalExaggeration: terrainSettings.verticalExaggeration,
      bbox: bboxCoords,
      elevationGrid: terrainData.processedElevationGrid,
      gridSize: terrainData.gridSize,
      minElevation: terrainData.originalMinElevation,
      maxElevation: terrainData.originalMaxElevation,
      // Add terrain mesh data as CSV strings for easy serialization
      terrainVerticesBase64: terrainData.terrainVertices ? Array.from(terrainData.terrainVertices).join(',') : '',
      terrainIndicesBase64: terrainData.terrainIndices ? Array.from(terrainData.terrainIndices).join(',') : '',
      vtDataSet: {
        ...layerConfig,
        geometryDebugMode: debugMode
      },
      // Buildings should NOT use same Z offset - each building needs to sit on its own terrain location
      // Other layers like roads/parks can share Z offset for consistency
      useSameZOffset: layerConfig.sourceLayer !== 'building',
      processId: activeProcessId,
    };

    if (cancelFlag) {
      throw new Error('Task was cancelled');
    }

    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 60,
      data: { message: `Processing ${layerConfig.sourceLayer} geometry...` }
    } as WorkerResponse);

    // Process geometry in WASM
    const serializedInput = JSON.stringify(polygonGeometryInput);
    const geometryJson = await wasmModule.process_polygon_geometry(serializedInput);

    if (cancelFlag) {
      throw new Error('Task was cancelled');
    }

    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 80,
      data: { message: `Parsing geometry data for ${layerConfig.sourceLayer}...` }
    } as WorkerResponse);

    // Step 3: Parse geometry JSON in worker (avoid main thread blocking)
    let geometryDataArray;
    try {
      geometryDataArray = JSON.parse(geometryJson);
    } catch (parseError) {
      throw new Error(`Failed to parse geometry JSON: ${parseError}`);
    }

    if (cancelFlag) {
      throw new Error('Task was cancelled');
    }

    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 90,
      data: { message: `Optimizing geometry for ${layerConfig.sourceLayer}...` }
    } as WorkerResponse);

    // Step 4: Process and optimize geometry data
    const processedGeometries = [];
    const totalGeometries = geometryDataArray.length;

    for (let i = 0; i < geometryDataArray.length; i++) {
      if (cancelFlag) {
        throw new Error('Task was cancelled');
      }

      const geometryData = geometryDataArray[i];

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

      // Convert to TypedArrays for optimal transfer
      const vertices = new Float32Array(geometryData.vertices);

      let indices: Uint32Array | null = null;
      if (geometryData.indices && geometryData.indices.length > 0) {
        indices = new Uint32Array(geometryData.indices);
      }

      let normals: Float32Array | null = null;
      let needsNormals = false;
      if (geometryData.normals && geometryData.normals.length > 0) {
        normals = new Float32Array(geometryData.normals);
      } else {
        needsNormals = true;
      }

      let colors: Float32Array | null = null;
      if (geometryData.colors && geometryData.colors.length > 0) {
        colors = new Float32Array(geometryData.colors);
      }

      processedGeometries.push({
        hasData: true,
        vertices: vertices,
        indices: indices,
        normals: normals,
        colors: colors,
        needsNormals,
        properties: geometryData.properties || {}
      });

      // Yield control periodically to prevent blocking
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    postMessage({
      id: currentTaskId,
      type: 'progress',
      progress: 100,
      data: { message: `${layerConfig.sourceLayer} processing complete` }
    } as WorkerResponse);

    return {
      layerConfig,
      geometries: processedGeometries,
      totalProcessed: processedGeometries.length,
      hasData: processedGeometries.some(g => g.hasData)
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
    switch (type) {
      case 'init':
        await initializeWasmInWorker();
        postMessage({
          id,
          type: 'initialized',
          data: { success: true }
        } as WorkerResponse);
        break;

      case 'process-layer':
        currentTaskId = id;
        cancelFlag = false;

        const result = await processLayerInWorker(data);

        postMessage({
          id,
          type: 'result',
          data: result
        } as WorkerResponse);

        currentTaskId = null;
        break;

      case 'sync-resources':
        await syncSharedResources(data);
        postMessage({
          id,
          type: 'resources-synced',
          success: true,
          processId: data.processId
        } as WorkerResponse);
        break;

      case 'cancel':
        if (currentTaskId === id || !id) {
          cancelFlag = true;
          
        }
        break;

      case 'terminate':
        // Clean up WASM resources
        if (wasmModule && (wasmModule as any).clear_process_cache_js) {
          try {
            (wasmModule as any).clear_process_cache_js();
          } catch (cleanupError) {
            
          }
        }

        wasmModule = null;
        isInitialized = false;
        self.close();
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

  } catch (error) {
    

    postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    } as WorkerResponse);
  }
};

// Handle worker errors
self.onerror = (error) => {
  

  if (currentTaskId) {
    postMessage({
      id: currentTaskId,
      type: 'error',
      error: `Worker error: ${error.message || error}`
    } as WorkerResponse);
  }
};

// Export for TypeScript
export {};