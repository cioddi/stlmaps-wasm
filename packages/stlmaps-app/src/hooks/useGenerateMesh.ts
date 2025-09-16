import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { useAppStore } from "../stores/useAppStore";
import {
  createComponentHashes,
  createConfigHash,
  hashBbox,
  hashVtLayerConfig,
  hashTerrainConfig,
} from "../utils/configHashing";
import { WorkerService } from "../workers/WorkerService";
import GeometryWorker from "../workers/geometryWorker?worker";
import BackgroundProcessor from "../workers/backgroundProcessor?worker";
import { tokenManager } from "../utils/CancellationToken";
import { VtDataSet } from "../types/VtDataSet";
import {
  useWasm,
  useElevationProcessor,
  getWasmModule,
  fetchVtData,
  calculateTileCount
} from "@threegis/core";
import { processManager } from "@threegis/core";

// ================================================================================
// Types and Interfaces
// ================================================================================

export interface GridSize {
  width: number;
  height: number;
}

export interface MeshGenerationConfig {
  bbox: [number, number, number, number];
  terrainSettings: any;
  layers: VtDataSet[];
}

export interface ProcessingContextManager {
  createTerrainContext(): Promise<string>;
  createLayerContext(layerName: string): Promise<string>;
  terminateContext(contextId: string): Promise<void>;
  shareResourcesBetweenContexts(fromContext: string, toContext: string, resourceKeys: string[]): Promise<void>;
}

export interface TerrainProcessingResult {
  terrainGeometry: THREE.BufferGeometry;
  processedElevationGrid: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
  originalMinElevation: number;
  originalMaxElevation: number;
  gridSize: GridSize;
}

export interface LayerProcessingResult {
  layer: VtDataSet;
  geometry: THREE.BufferGeometry;
  success: boolean;
  error?: Error;
}

export interface MeshGenerationResult {
  terrainResult: TerrainProcessingResult | null;
  layerResults: LayerProcessingResult[];
  totalProcessingTimeMs: number;
  success: boolean;
  error?: Error;
}

export interface ProcessingProgress {
  stage: 'initializing' | 'terrain' | 'layers' | 'finalizing' | 'complete' | 'error';
  currentLayerIndex?: number;
  totalLayers?: number;
  percentage: number;
  message: string;
}

// ================================================================================
// WASM Context Management
// ================================================================================

class WasmContextManager implements ProcessingContextManager {
  private activeContexts = new Map<string, any>();
  private sharedResources = new Map<string, Set<string>>();

  async createTerrainContext(): Promise<string> {
    const contextId = `terrain-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    try {
      // Create new WASM instance for terrain processing
      // Since WASM is single-threaded per instance, we need separate instances for parallel processing
      const wasmModule = getWasmModule();
      this.activeContexts.set(contextId, wasmModule);
      this.sharedResources.set(contextId, new Set());

      console.log(`🏔️ Created terrain processing context: ${contextId}`);
      return contextId;
    } catch (error) {
      throw new Error(`Failed to create terrain context: ${error}`);
    }
  }

  async createLayerContext(layerName: string): Promise<string> {
    const contextId = `layer-${layerName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    try {
      // For now, we'll use the same WASM instance but with different process IDs
      // In a more advanced implementation, we could spawn Web Workers with WASM instances
      const wasmModule = getWasmModule();
      this.activeContexts.set(contextId, wasmModule);
      this.sharedResources.set(contextId, new Set());

      console.log(`📊 Created layer processing context for ${layerName}: ${contextId}`);
      return contextId;
    } catch (error) {
      throw new Error(`Failed to create layer context for ${layerName}: ${error}`);
    }
  }

  async terminateContext(contextId: string): Promise<void> {
    try {
      const wasmInstance = this.activeContexts.get(contextId);
      if (wasmInstance) {
        // Clean up any resources associated with this context
        if (wasmInstance.clear_process_cache_js) {
          wasmInstance.clear_process_cache_js(contextId);
        }
      }

      this.activeContexts.delete(contextId);
      this.sharedResources.delete(contextId);

      console.log(`🗑️ Terminated processing context: ${contextId}`);
    } catch (error) {
      console.warn(`Failed to clean up context ${contextId}:`, error);
    }
  }

  async shareResourcesBetweenContexts(fromContext: string, toContext: string, resourceKeys: string[]): Promise<void> {
    try {
      const fromResources = this.sharedResources.get(fromContext);
      const toResources = this.sharedResources.get(toContext);

      if (!fromResources || !toResources) {
        throw new Error(`Context not found: from=${!!fromResources}, to=${!!toResources}`);
      }

      // Mark resources as shared between contexts
      resourceKeys.forEach(key => {
        fromResources.add(key);
        toResources.add(key);
      });

      console.log(`🔄 Shared ${resourceKeys.length} resources from ${fromContext} to ${toContext}`);
    } catch (error) {
      console.warn(`Failed to share resources: ${error}`);
    }
  }

  getContext(contextId: string): any {
    return this.activeContexts.get(contextId);
  }

  async terminateAllContexts(): Promise<void> {
    const terminatePromises = Array.from(this.activeContexts.keys()).map(
      contextId => this.terminateContext(contextId)
    );
    await Promise.all(terminatePromises);
  }
}

// ================================================================================
// Background Processing Utilities
// ================================================================================

/**
 * Moves heavy computations to a background thread to prevent main thread blocking
 */
class BackgroundProcessor {
  private static workerPool = new Map<string, Worker>();

  static async processInBackground<T, R>(
    taskName: string,
    data: T,
    onProgress?: (progress: number) => void
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      // Create or reuse worker
      let worker = this.workerPool.get(taskName);
      if (!worker) {
        // Create worker from the background processor file
        worker = new Worker(new URL('/src/workers/backgroundProcessor.ts', import.meta.url), {
          type: 'module'
        });
        this.workerPool.set(taskName, worker);
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Background processing timeout for task: ${taskName}`));
      }, 30000); // 30 second timeout

      worker.onmessage = (event) => {
        const { type, data: responseData, progress, error } = event.data;

        if (type === 'progress' && onProgress) {
          onProgress(progress);
        } else if (type === 'complete') {
          clearTimeout(timeout);
          resolve(responseData);
        } else if (type === 'error') {
          clearTimeout(timeout);
          reject(new Error(error || 'Background processing failed'));
        }
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };

      // Send data to worker
      worker.postMessage(data);
    });
  }

  static terminateWorker(taskName: string): void {
    const worker = this.workerPool.get(taskName);
    if (worker) {
      worker.terminate();
      this.workerPool.delete(taskName);
    }
  }

  static terminateAllWorkers(): void {
    this.workerPool.forEach((worker, taskName) => {
      worker.terminate();
    });
    this.workerPool.clear();
  }
}

// ================================================================================
// Main Hook Implementation
// ================================================================================

export function useGenerateMesh() {
  // ================================================================================
  // State Management
  // ================================================================================

  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    stage: 'initializing',
    percentage: 0,
    message: 'Initializing...'
  });

  const [isProcessingMesh, setIsProcessingMesh] = useState(false);
  const [lastProcessedBboxHash, setLastProcessedBboxHash] = useState<string>("");
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Refs for cleanup and cancellation
  const contextManagerRef = useRef<WasmContextManager | null>(null);
  const currentProcessIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get WASM-related hooks
  const { isInitialized: isWasmInitialized } = useWasm();
  const { processElevationForBbox } = useElevationProcessor();

  // Get store state
  const {
    bbox,
    vtLayers,
    terrainSettings,
    buildingSettings,
    debugSettings,
    setGeometryDataSets,
    geometryDataSets,
    setIsProcessing,
    updateProgress,
    resetProcessing,
    configHashes,
    setConfigHashes,
    setProcessedTerrainData,
  } = useAppStore();

  // ================================================================================
  // Utility Functions
  // ================================================================================

  const convertToRustVtDataSet = useCallback((jsVtDataSet: VtDataSet) => {
    return {
      sourceLayer: jsVtDataSet.sourceLayer,
      subClass: jsVtDataSet.subClass ? [jsVtDataSet.subClass] : undefined,
      enabled: jsVtDataSet.enabled,
      bufferSize: jsVtDataSet.bufferSize,
      extrusionDepth: jsVtDataSet.extrusionDepth ?? null,
      minExtrusionDepth: jsVtDataSet.minExtrusionDepth ?? null,
      heightScaleFactor: jsVtDataSet.heightScaleFactor ?? null,
      useAdaptiveScaleFactor: jsVtDataSet.useAdaptiveScaleFactor ?? null,
      zOffset: jsVtDataSet.zOffset ?? null,
      alignVerticesToTerrain: jsVtDataSet.alignVerticesToTerrain ?? null,
      csgClipping: jsVtDataSet.useCsgClipping ?? null,
      filter: jsVtDataSet.filter ?? null,
    };
  }, []);

  const calculateOptimalZoomLevel = useCallback((
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number
  ): number => {
    let zoomLevel = 12;
    while (zoomLevel > 0) {
      const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoomLevel);
      if (tileCount <= 4) break;
      zoomLevel--;
    }
    return zoomLevel;
  }, []);

  const extractBoundingBoxCoordinates = useCallback((bbox: any): [number, number, number, number] => {
    if (!bbox?.geometry || bbox.geometry.type !== "Polygon") {
      throw new Error("Invalid geometry: expected a Polygon");
    }

    const coordinates = bbox.geometry.coordinates[0];
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

    coordinates.forEach((coord: number[]) => {
      const [lng, lat] = coord;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });

    return [minLng, minLat, maxLng, maxLat];
  }, []);

  // ================================================================================
  // Core Processing Functions
  // ================================================================================

  const processTerrainInBackground = useCallback(async (
    bboxCoords: [number, number, number, number],
    processId: string,
    terrainContextId: string,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<TerrainProcessingResult> => {
    const [minLng, minLat, maxLng, maxLat] = bboxCoords;

    onProgress({
      stage: 'terrain',
      percentage: 10,
      message: 'Processing elevation data...'
    });

    try {
      // Process elevation data first
      const elevationResult = await processElevationForBbox(bboxCoords, processId);

      onProgress({
        stage: 'terrain',
        percentage: 30,
        message: 'Generating terrain mesh...'
      });

      // Store terrain data in app state
      setProcessedTerrainData({
        processedElevationGrid: elevationResult.elevationGrid,
        processedMinElevation: elevationResult.minElevation,
        processedMaxElevation: elevationResult.maxElevation,
      });

      // Re-register elevation data for terrain generation
      await processElevationForBbox(bboxCoords, processId);

      onProgress({
        stage: 'terrain',
        percentage: 50,
        message: 'Creating terrain geometry...'
      });

      // Create terrain geometry using WASM
      const wasmModule = getWasmModule();
      const terrainParams = {
        min_lng: minLng,
        min_lat: minLat,
        max_lng: maxLng,
        max_lat: maxLat,
        vertical_exaggeration: terrainSettings.verticalExaggeration,
        terrain_base_height: terrainSettings.baseHeight,
        process_id: processId,
      };

      const wasmTerrainResult = await wasmModule.create_terrain_geometry(terrainParams);

      onProgress({
        stage: 'terrain',
        percentage: 70,
        message: 'Converting terrain to Three.js format...'
      });

      // Convert WASM TypedArrays to THREE.js BufferGeometry directly (optimized)
      const geometry = new THREE.BufferGeometry();

      // Use direct TypedArray references for better performance
      geometry.setAttribute("position", new THREE.BufferAttribute(wasmTerrainResult.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(wasmTerrainResult.normals, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(wasmTerrainResult.colors, 3));

      // Use Uint32Array directly instead of converting to Array
      geometry.setIndex(new THREE.BufferAttribute(wasmTerrainResult.indices, 1));

      const terrainGeometry = geometry;

      const result: TerrainProcessingResult = {
        terrainGeometry: terrainGeometry as THREE.BufferGeometry,
        processedElevationGrid: wasmTerrainResult.processedElevationGrid,
        processedMinElevation: wasmTerrainResult.processedMinElevation,
        processedMaxElevation: wasmTerrainResult.processedMaxElevation,
        originalMinElevation: wasmTerrainResult.originalMinElevation,
        originalMaxElevation: wasmTerrainResult.originalMaxElevation,
        gridSize: elevationResult.gridSize
      };

      onProgress({
        stage: 'terrain',
        percentage: 90,
        message: 'Terrain processing complete'
      });

      console.log('🏔️ Terrain processing completed successfully', {
        vertexCount: wasmTerrainResult.positions.length / 3,
        elevationRange: result.processedMaxElevation - result.processedMinElevation
      });

      return result;
    } catch (error) {
      console.error('❌ Terrain processing failed:', error);
      throw new Error(`Terrain processing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [processElevationForBbox, terrainSettings, setProcessedTerrainData]);

  const processLayerInBackground = useCallback(async (
    layer: VtDataSet,
    layerIndex: number,
    totalLayers: number,
    bboxCoords: [number, number, number, number],
    processId: string,
    layerContextId: string,
    terrainResult: TerrainProcessingResult,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<LayerProcessingResult> => {
    const [minLng, minLat, maxLng, maxLat] = bboxCoords;
    const baseProgress = 20 + (layerIndex * 60) / totalLayers;
    const progressStep = 60 / totalLayers;

    try {
      onProgress({
        stage: 'layers',
        currentLayerIndex: layerIndex,
        totalLayers,
        percentage: baseProgress,
        message: `Processing ${layer.sourceLayer} layer...`
      });

      // Extract and cache features in background
      await getWasmModule().extract_features_from_vector_tiles({
        bbox: bboxCoords,
        vtDataSet: convertToRustVtDataSet(layer),
        processId: processId,
        elevationProcessId: processId
      });

      onProgress({
        stage: 'layers',
        currentLayerIndex: layerIndex,
        totalLayers,
        percentage: baseProgress + progressStep * 0.3,
        message: `Creating geometry for ${layer.sourceLayer}...`
      });

      // Determine if debug mode should be used
      const useDebugMode = debugSettings.geometryDebugMode || layer.geometryDebugMode;

      // Prepare geometry input
      const polygonGeometryInput = {
        terrainBaseHeight: terrainSettings.baseHeight,
        verticalExaggeration: terrainSettings.verticalExaggeration,
        bbox: bboxCoords,
        elevationGrid: terrainResult.processedElevationGrid,
        gridSize: terrainResult.gridSize,
        minElevation: terrainResult.originalMinElevation,
        maxElevation: terrainResult.originalMaxElevation,
        vtDataSet: {
          ...convertToRustVtDataSet(layer),
          geometryDebugMode: useDebugMode
        },
        useSameZOffset: true,
        processId: processId,
      };

      onProgress({
        stage: 'layers',
        currentLayerIndex: layerIndex,
        totalLayers,
        percentage: baseProgress + progressStep * 0.5,
        message: `Processing ${layer.sourceLayer} geometry...`
      });

      // Process geometry in WASM
      const serializedInput = JSON.stringify(polygonGeometryInput);
      const geometryJson = await getWasmModule().process_polygon_geometry(serializedInput);

      // Parse JSON in background to avoid blocking main thread
      const geometryDataArray = await BackgroundProcessor.processInBackground(
        `layer-${layer.label}-parsing`,
        {
          type: 'parse-json',
          data: { jsonString: geometryJson }
        }
      );

      onProgress({
        stage: 'layers',
        currentLayerIndex: layerIndex,
        totalLayers,
        percentage: baseProgress + progressStep * 0.8,
        message: `Converting ${layer.sourceLayer} to Three.js...`
      });

      // Process geometries in background worker
      const workerResult = await BackgroundProcessor.processInBackground(
        `layer-${layer.label}-processing`,
        {
          type: 'process-geometries',
          data: {
            geometryDataArray,
            layerName: layer.label
          }
        },
        (progress) => {
          onProgress({
            stage: 'layers',
            currentLayerIndex: layerIndex,
            totalLayers,
            percentage: baseProgress + progressStep * (0.8 + progress * 0.2),
            message: `Converting ${layer.sourceLayer} to Three.js...`
          });
        }
      );

      // Convert worker results to Three.js geometries on main thread (minimal work)
      const geometries: THREE.BufferGeometry[] = [];
      const processedGeometries = workerResult.geometries;

      for (const processedGeom of processedGeometries) {
        if (!processedGeom.hasData || !processedGeom.vertices || processedGeom.vertices.length === 0) {
          continue;
        }

        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(processedGeom.vertices), 3));

        if (processedGeom.normals && processedGeom.normals.length > 0) {
          geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(processedGeom.normals), 3));
        }

        if (processedGeom.colors && processedGeom.colors.length > 0) {
          geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(processedGeom.colors), 3));
        }

        if (processedGeom.indices && processedGeom.indices.length > 0) {
          geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(processedGeom.indices), 1));
        }

        if (processedGeom.properties) {
          geometry.userData = { properties: processedGeom.properties };
        }

        if (processedGeom.needsNormals) {
          geometry.computeVertexNormals();
        }

        geometries.push(geometry);
      }

      // Create container geometry
      const containerGeometry = new THREE.BufferGeometry();
      containerGeometry.userData = {
        isContainer: true,
        individualGeometries: geometries,
        geometryCount: geometries.length
      };

      // Debug geometry data
      const totalVertices = geometries.reduce((sum, geo) => {
        const positions = geo.attributes.position;
        return sum + (positions ? positions.count : 0);
      }, 0);

      console.log(`🔍 Layer "${layer.label}" (${layer.sourceLayer}): ${geometries.length} geometries, ${totalVertices} total vertices`);
      geometries.forEach((geo, i) => {
        const positions = geo.attributes.position;
        const vertexCount = positions ? positions.count : 0;
        if (vertexCount > 0) {
          console.log(`  - Geometry ${i}: ${vertexCount} vertices`);
        }
      });

      onProgress({
        stage: 'layers',
        currentLayerIndex: layerIndex,
        totalLayers,
        percentage: baseProgress + progressStep,
        message: `${layer.sourceLayer} processing complete`
      });

      console.log(`✅ Layer ${layer.sourceLayer} processed successfully with ${geometries.length} geometries`);

      return {
        layer,
        geometry: containerGeometry,
        success: true
      };

    } catch (error) {
      console.error(`❌ Failed to process layer ${layer.sourceLayer}:`, error);

      return {
        layer,
        geometry: new THREE.BufferGeometry(),
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }, [convertToRustVtDataSet, debugSettings, terrainSettings]);

  // ================================================================================
  // Main Generation Function
  // ================================================================================

  const generateMeshInBackground = useCallback(async (): Promise<MeshGenerationResult> => {
    const startTime = Date.now();

    if (!bbox) {
      throw new Error("Cannot generate mesh: bbox is undefined");
    }

    if (!isWasmInitialized) {
      throw new Error("WASM module not initialized. Please try again later.");
    }

    // Initialize processing state
    setIsProcessingMesh(true);
    setProcessingProgress({
      stage: 'initializing',
      percentage: 0,
      message: 'Initializing mesh generation...'
    });

    // Create abort controller for cancellation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Extract bbox coordinates
      const bboxCoords = extractBoundingBoxCoordinates(bbox);

      // Create process configuration
      const processConfig = {
        bbox: bboxCoords,
        terrainSettings,
        layers: vtLayers.map(layer => ({
          sourceLayer: layer.sourceLayer,
          label: layer.label,
          enabled: layer.enabled,
          color: layer.color,
          extrusionDepth: layer.extrusionDepth,
          minExtrusionDepth: layer.minExtrusionDepth,
          heightScaleFactor: layer.heightScaleFactor,
          useAdaptiveScaleFactor: layer.useAdaptiveScaleFactor,
          zOffset: layer.zOffset,
          alignVerticesToTerrain: layer.alignVerticesToTerrain,
          filter: layer.filter
        }))
      };

      // Start new process
      const processId = await processManager.startProcess(processConfig);
      currentProcessIdRef.current = processId;

      console.log(`🚀 Started mesh generation process: ${processId}`);

      // Initialize context manager
      const contextManager = new WasmContextManager();
      contextManagerRef.current = contextManager;

      setProcessingProgress({
        stage: 'initializing',
        percentage: 5,
        message: 'Creating processing contexts...'
      });

      // Create processing contexts
      const terrainContextId = await contextManager.createTerrainContext();

      // Create layer contexts for parallel processing
      const layerContextPromises = vtLayers.map(async (layer) => {
        const contextId = await contextManager.createLayerContext(layer.label);
        return { layer, contextId };
      });
      const layerContexts = await Promise.all(layerContextPromises);

      setProcessingProgress({
        stage: 'initializing',
        percentage: 10,
        message: 'Fetching vector tile data...'
      });

      // Fetch VT data (shared resource)
      const zoomLevel = calculateOptimalZoomLevel(...bboxCoords);
      await fetchVtData({
        bbox: bboxCoords,
        zoom: 14,
        gridSize: { width: 256, height: 256 }, // Will be updated after terrain processing
        bboxKey: processId, // Use process ID for caching
      });

      // Check for cancellation
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Process terrain in background
      const terrainResult = await processTerrainInBackground(
        bboxCoords,
        processId,
        terrainContextId,
        setProcessingProgress
      );

      // Check for cancellation after terrain
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      setProcessingProgress({
        stage: 'layers',
        percentage: 20,
        message: 'Processing layers in parallel...'
      });

      // Share elevation resources between contexts
      const elevationResourceKeys = [`elevation-${processId}`, `terrain-${processId}`];
      await Promise.all(
        layerContexts.map(({ contextId }) =>
          contextManager.shareResourcesBetweenContexts(terrainContextId, contextId, elevationResourceKeys)
        )
      );

      // Process layers in parallel using separate contexts
      const layerProcessingPromises = layerContexts.map(async ({ layer, contextId }, index) => {
        return await processLayerInBackground(
          layer,
          index,
          vtLayers.length,
          bboxCoords,
          processId,
          contextId,
          terrainResult,
          setProcessingProgress
        );
      });

      // Execute layer processing with controlled parallelism
      const hasTerrainAlignment = vtLayers.some(layer => layer.alignVerticesToTerrain);
      let layerResults: LayerProcessingResult[];

      if (hasTerrainAlignment) {
        console.log('🏔️ Processing layers sequentially due to terrain alignment');
        layerResults = [];
        for (const promise of layerProcessingPromises) {
          if (abortController.signal.aborted) {
            throw new Error('Operation was cancelled');
          }
          const result = await promise;
          layerResults.push(result);
        }
      } else {
        console.log('⚡ Processing layers in parallel');
        layerResults = await Promise.all(layerProcessingPromises);
      }

      // Check for cancellation before finalizing
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      setProcessingProgress({
        stage: 'finalizing',
        percentage: 90,
        message: 'Finalizing mesh generation...'
      });

      // Clean up contexts
      await contextManager.terminateAllContexts();

      const totalTime = Date.now() - startTime;

      setProcessingProgress({
        stage: 'complete',
        percentage: 100,
        message: 'Mesh generation complete!'
      });

      console.log(`🎉 Mesh generation completed in ${totalTime}ms`);

      return {
        terrainResult,
        layerResults,
        totalProcessingTimeMs: totalTime,
        success: true
      };

    } catch (error) {
      console.error('❌ Mesh generation failed:', error);

      // Clean up on error
      if (contextManagerRef.current) {
        await contextManagerRef.current.terminateAllContexts();
      }

      const totalTime = Date.now() - startTime;

      setProcessingProgress({
        stage: 'error',
        percentage: 0,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      });

      return {
        terrainResult: null,
        layerResults: [],
        totalProcessingTimeMs: totalTime,
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    } finally {
      setIsProcessingMesh(false);
      abortControllerRef.current = null;
      currentProcessIdRef.current = null;
    }
  }, [
    bbox,
    isWasmInitialized,
    terrainSettings,
    vtLayers,
    extractBoundingBoxCoordinates,
    calculateOptimalZoomLevel,
    processTerrainInBackground,
    processLayerInBackground
  ]);

  // ================================================================================
  // Public Interface
  // ================================================================================

  const startMeshGeneration = useCallback(async () => {
    if (isProcessingMesh) {
      console.warn('Mesh generation already in progress');
      return;
    }

    // Cancel any existing operations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Cancel WASM operations
    try {
      WorkerService.cancelActiveTasks("polygon-geometry");
      const wasmModule = getWasmModule();
      if (wasmModule?.cancel_operation) {
        wasmModule.cancel_operation("polygon_processing");
        wasmModule.cancel_operation("terrain_generation");
      }
    } catch (err) {
      console.warn("Error cancelling existing tasks:", err);
    }

    try {
      const result = await generateMeshInBackground();

      if (result.success && result.terrainResult) {
        // Update geometry data sets
        const polygonGeometries = result.layerResults.map(layerResult => ({
          ...layerResult.layer,
          geometry: layerResult.geometry
        }));

        setGeometryDataSets({
          terrainGeometry: result.terrainResult.terrainGeometry,
          polygonGeometries
        });

        // Update configuration hashes
        const currentFullConfigHash = createConfigHash(bbox, terrainSettings, vtLayers);
        const { terrainHash: currentTerrainHash, layerHashes: currentLayerHashes } =
          createComponentHashes(bbox, terrainSettings, vtLayers);

        setConfigHashes({
          fullConfigHash: currentFullConfigHash,
          terrainHash: currentTerrainHash,
          layerHashes: currentLayerHashes,
        });

        console.log('✅ Mesh generation completed successfully');
      }

      return result;
    } catch (error) {
      console.error('❌ Mesh generation error:', error);
      throw error;
    }
  }, [
    isProcessingMesh,
    generateMeshInBackground,
    setGeometryDataSets,
    setConfigHashes,
    bbox,
    terrainSettings,
    vtLayers
  ]);

  const cancelMeshGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      console.log('🛑 Cancelling mesh generation...');
      abortControllerRef.current.abort();
    }

    if (currentProcessIdRef.current) {
      processManager.cancelProcess(currentProcessIdRef.current);
    }

    // Clean up background workers
    BackgroundProcessor.terminateAllWorkers();

    setIsProcessingMesh(false);
    setProcessingProgress({
      stage: 'initializing',
      percentage: 0,
      message: 'Ready'
    });
  }, []);

  // ================================================================================
  // Auto-generation Logic
  // ================================================================================

  const geometryOnlyLayersHash = useMemo(() => {
    return vtLayers.map(hashVtLayerConfig).join(':');
  }, [vtLayers]);

  const geometryOnlyTerrainHash = useMemo(() => {
    return hashTerrainConfig(terrainSettings);
  }, [terrainSettings]);

  useEffect(() => {
    console.log("useGenerateMesh dependencies changed:", {
      hasBbox: !!bbox,
      terrainEnabled: terrainSettings?.enabled,
      buildingsEnabled: buildingSettings?.enabled,
      layerCount: vtLayers?.length,
    });

    // Cancel any existing operation
    cancelMeshGeneration();

    if (debounceTimer) clearTimeout(debounceTimer);
    if (!bbox) {
      console.warn("No bbox available, skipping mesh generation");
      return;
    }

    const timer = setTimeout(() => {
      console.log("Debounce timer expired, starting mesh generation");
      startMeshGeneration();
    }, 1000);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [
    bbox,
    geometryOnlyLayersHash,
    geometryOnlyTerrainHash
  ]);

  // ================================================================================
  // Cleanup
  // ================================================================================

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      cancelMeshGeneration();
      if (contextManagerRef.current) {
        contextManagerRef.current.terminateAllContexts();
      }
      BackgroundProcessor.terminateAllWorkers();

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [cancelMeshGeneration, debounceTimer]);

  // ================================================================================
  // Return Hook Interface
  // ================================================================================

  return {
    // State
    isProcessingMesh,
    processingProgress,

    // Actions
    startMeshGeneration,
    cancelMeshGeneration,

    // Utils
    isWasmInitialized,

    // Debug info
    currentProcessId: currentProcessIdRef.current,
    hasActiveContexts: contextManagerRef.current ? true : false
  };
}