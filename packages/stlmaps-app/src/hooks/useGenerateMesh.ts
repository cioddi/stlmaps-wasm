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
import { getWasmContextPool } from "../utils/WasmContextPool";
import { performanceMonitor } from "../utils/PerformanceMonitor";
import { sharedResourceManager } from "../utils/SharedResourceManager";
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
  processingTimeMs: number;
  vertexCount: number;
  geometryCount: number;
}

export interface MeshGenerationResult {
  terrainResult: TerrainProcessingResult | null;
  layerResults: LayerProcessingResult[];
  totalProcessingTimeMs: number;
  parallelizationEfficiency: number;
  success: boolean;
  error?: Error;
}

export interface ProcessingProgress {
  stage: 'initializing' | 'terrain' | 'layers' | 'finalizing' | 'complete' | 'error';
  currentLayerIndex?: number;
  totalLayers?: number;
  percentage: number;
  message: string;
  layerProgress?: Map<string, number>;
}

// ================================================================================
// Optimized Layer Processing Manager
// ================================================================================

class ParallelLayerProcessor {
  private contextPool = getWasmContextPool({
    maxContexts: Math.min(navigator.hardwareConcurrency || 4, 8),
    timeoutMs: 300000, // 5 minutes for large bbox processing
    enableDebugLogging: false
  });

  private activeProcesses = new Map<string, AbortController>();
  private layerProgressTracking = new Map<string, number>();

  async initializeContexts(layerCount: number): Promise<void> {
    const contextsNeeded = Math.min(layerCount, navigator.hardwareConcurrency || 4);
    console.log(`🚀 Initializing ${contextsNeeded} WASM contexts for ${layerCount} layers`);

    await this.contextPool.ensureMinimumContexts(contextsNeeded);

    const stats = this.contextPool.getStats();
    console.log(`✅ Context pool ready:`, stats);
  }

  async processLayersInParallel(
    layers: VtDataSet[],
    bboxCoords: [number, number, number, number],
    processId: string,
    terrainData: any,
    terrainSettings: any,
    debugSettings: any,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<LayerProcessingResult[]> {
    if (layers.length === 0) {
      return [];
    }

    // Initialize progress tracking
    this.layerProgressTracking.clear();
    layers.forEach(layer => {
      this.layerProgressTracking.set(layer.label, 0);
    });

    // Create abort controllers for each layer
    const abortControllers = new Map<string, AbortController>();
    layers.forEach(layer => {
      const controller = new AbortController();
      abortControllers.set(layer.label, controller);
      this.activeProcesses.set(layer.label, controller);
    });

    try {
      // Check if any layers require terrain alignment (must be sequential)
      const hasTerrainAlignment = layers.some(layer => layer.alignVerticesToTerrain);

      if (hasTerrainAlignment) {
        console.log('🏔️ Sequential processing due to terrain alignment');
        return await this.processLayersSequentially(
          layers,
          bboxCoords,
          processId,
          terrainData,
          terrainSettings,
          debugSettings,
          onProgress,
          abortControllers
        );
      } else {
        console.log('⚡ Parallel processing enabled');
        return await this.processLayersParallel(
          layers,
          bboxCoords,
          processId,
          terrainData,
          terrainSettings,
          debugSettings,
          onProgress,
          abortControllers
        );
      }

    } finally {
      // Clean up abort controllers
      abortControllers.forEach(controller => controller.abort());
      this.activeProcesses.clear();
      this.layerProgressTracking.clear();
    }
  }

  private async processLayersParallel(
    layers: VtDataSet[],
    bboxCoords: [number, number, number, number],
    processId: string,
    terrainData: any,
    terrainSettings: any,
    debugSettings: any,
    onProgress: (progress: ProcessingProgress) => void,
    abortControllers: Map<string, AbortController>
  ): Promise<LayerProcessingResult[]> {
    const startTime = Date.now();

    // Create processing promises for all layers
    const processingPromises = layers.map(async (layer, index) => {
      const layerStartTime = Date.now();
      const abortController = abortControllers.get(layer.label)!;

      try {
        const useDebugMode = debugSettings.geometryDebugMode || layer.geometryDebugMode;

        // Convert layer configuration
        const layerConfig = {
          sourceLayer: layer.sourceLayer,
          subClass: layer.subClass ? [layer.subClass] : undefined,
          enabled: layer.enabled,
          bufferSize: layer.bufferSize,
          extrusionDepth: layer.extrusionDepth ?? null,
          minExtrusionDepth: layer.minExtrusionDepth ?? null,
          zOffset: layer.zOffset ?? null,
          alignVerticesToTerrain: layer.alignVerticesToTerrain ?? null,
          applyMedianHeight: layer.applyMedianHeight ?? null,
          csgClipping: layer.useCsgClipping ?? null,
          filter: layer.filter ?? null,
          geometryDebugMode: useDebugMode
        };

        // Process layer in dedicated WASM context
        const workerResult = await this.contextPool.processLayerInContext(
          layerConfig,
          bboxCoords,
          processId,
          terrainData,
          terrainSettings,
          useDebugMode,
          {
            timeout: 300000, // 5 minutes for large datasets
            onProgress: (progress, message) => {
              // Update progress for this specific layer
              this.layerProgressTracking.set(layer.label, progress);

              // Calculate overall progress
              const totalProgress = Array.from(this.layerProgressTracking.values())
                .reduce((sum, prog) => sum + prog, 0) / layers.length;

              onProgress({
                stage: 'layers',
                currentLayerIndex: index,
                totalLayers: layers.length,
                percentage: 20 + (totalProgress * 0.6), // 20% terrain + 60% layers
                message: `${message} (${index + 1}/${layers.length})`,
                layerProgress: new Map(this.layerProgressTracking)
              });
            }
          }
        );

        // Check for cancellation
        if (abortController.signal.aborted) {
          throw new Error('Layer processing was cancelled');
        }

        // Convert worker results to Three.js geometries (minimal main thread work)
        const geometries: THREE.BufferGeometry[] = [];
        const processedGeometries = workerResult.geometries;

        let totalVertexCount = 0;

        for (const processedGeom of processedGeometries) {
          if (!processedGeom.hasData || !processedGeom.vertices || processedGeom.vertices.length === 0) {
            continue;
          }

          const geometry = new THREE.BufferGeometry();

          // Use TypedArrays directly from worker (avoid copying)
          geometry.setAttribute('position', new THREE.BufferAttribute(processedGeom.vertices, 3));
          totalVertexCount += processedGeom.vertices.length / 3;

          if (processedGeom.normals) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(processedGeom.normals, 3));
          }

          if (processedGeom.colors) {
            geometry.setAttribute('color', new THREE.BufferAttribute(processedGeom.colors, 3));
          }

          if (processedGeom.indices) {
            geometry.setIndex(new THREE.BufferAttribute(processedGeom.indices, 1));
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

        const processingTime = Date.now() - layerStartTime;

        console.log(`✅ Layer "${layer.label}" processed in ${processingTime}ms: ${geometries.length} geometries, ${totalVertexCount} vertices`);

        return {
          layer,
          geometry: containerGeometry,
          success: true,
          processingTimeMs: processingTime,
          vertexCount: totalVertexCount,
          geometryCount: geometries.length
        } as LayerProcessingResult;

      } catch (error) {
        const processingTime = Date.now() - layerStartTime;

        console.error(`❌ Layer "${layer.label}" failed after ${processingTime}ms:`, error);

        return {
          layer,
          geometry: new THREE.BufferGeometry(),
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          processingTimeMs: processingTime,
          vertexCount: 0,
          geometryCount: 0
        } as LayerProcessingResult;
      }
    });

    // Execute all layer processing in parallel
    const results = await Promise.all(processingPromises);

    const totalTime = Date.now() - startTime;
    const sequentialEstimate = results.reduce((sum, r) => sum + r.processingTimeMs, 0);
    const efficiency = sequentialEstimate > 0 ? Math.min(100, (sequentialEstimate / totalTime) * 100) : 0;

    console.log(`🎯 Parallel processing completed: ${totalTime}ms (${efficiency.toFixed(1)}% efficiency)`);

    return results;
  }

  private async processLayersSequentially(
    layers: VtDataSet[],
    bboxCoords: [number, number, number, number],
    processId: string,
    terrainData: any,
    terrainSettings: any,
    debugSettings: any,
    onProgress: (progress: ProcessingProgress) => void,
    abortControllers: Map<string, AbortController>
  ): Promise<LayerProcessingResult[]> {
    const results: LayerProcessingResult[] = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const abortController = abortControllers.get(layer.label)!;

      if (abortController.signal.aborted) {
        break;
      }

      const layerStartTime = Date.now();

      try {
        const useDebugMode = debugSettings.geometryDebugMode || layer.geometryDebugMode;

        const layerConfig = {
          sourceLayer: layer.sourceLayer,
          subClass: layer.subClass ? [layer.subClass] : undefined,
          enabled: layer.enabled,
          bufferSize: layer.bufferSize,
          extrusionDepth: layer.extrusionDepth ?? null,
          minExtrusionDepth: layer.minExtrusionDepth ?? null,
          zOffset: layer.zOffset ?? null,
          alignVerticesToTerrain: layer.alignVerticesToTerrain ?? null,
          applyMedianHeight: layer.applyMedianHeight ?? null,
          csgClipping: layer.useCsgClipping ?? null,
          filter: layer.filter ?? null,
          geometryDebugMode: useDebugMode
        };

        const workerResult = await this.contextPool.processLayerInContext(
          layerConfig,
          bboxCoords,
          processId,
          terrainData,
          terrainSettings,
          useDebugMode,
          {
            timeout: 300000, // 5 minutes for large datasets
            onProgress: (progress, message) => {
              const baseProgress = 20 + (i * 60) / layers.length;
              const layerProgress = (progress * 60) / (layers.length * 100);

              onProgress({
                stage: 'layers',
                currentLayerIndex: i,
                totalLayers: layers.length,
                percentage: baseProgress + layerProgress,
                message: `${message} (${i + 1}/${layers.length})`
              });
            }
          }
        );

        // Convert to Three.js geometries (same as parallel version)
        const geometries: THREE.BufferGeometry[] = [];
        let totalVertexCount = 0;

        for (const processedGeom of workerResult.geometries) {
          if (!processedGeom.hasData || !processedGeom.vertices || processedGeom.vertices.length === 0) {
            continue;
          }

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(processedGeom.vertices, 3));
          totalVertexCount += processedGeom.vertices.length / 3;

          if (processedGeom.normals) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(processedGeom.normals, 3));
          }
          if (processedGeom.colors) {
            geometry.setAttribute('color', new THREE.BufferAttribute(processedGeom.colors, 3));
          }
          if (processedGeom.indices) {
            geometry.setIndex(new THREE.BufferAttribute(processedGeom.indices, 1));
          }
          if (processedGeom.properties) {
            geometry.userData = { properties: processedGeom.properties };
          }
          if (processedGeom.needsNormals) {
            geometry.computeVertexNormals();
          }

          geometries.push(geometry);
        }

        const containerGeometry = new THREE.BufferGeometry();
        containerGeometry.userData = {
          isContainer: true,
          individualGeometries: geometries,
          geometryCount: geometries.length
        };

        const processingTime = Date.now() - layerStartTime;

        results.push({
          layer,
          geometry: containerGeometry,
          success: true,
          processingTimeMs: processingTime,
          vertexCount: totalVertexCount,
          geometryCount: geometries.length
        });

        console.log(`✅ Sequential layer "${layer.label}" processed in ${processingTime}ms`);

      } catch (error) {
        const processingTime = Date.now() - layerStartTime;

        results.push({
          layer,
          geometry: new THREE.BufferGeometry(),
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          processingTimeMs: processingTime,
          vertexCount: 0,
          geometryCount: 0
        });

        console.error(`❌ Sequential layer "${layer.label}" failed:`, error);
      }
    }

    return results;
  }

  async cleanup(): Promise<void> {
    // Cancel all active processes
    this.activeProcesses.forEach(controller => controller.abort());
    this.activeProcesses.clear();
    this.layerProgressTracking.clear();

    // Cleanup idle contexts
    await this.contextPool.cleanupIdleContexts(30000); // Clean contexts idle for 30s
  }

  getStats() {
    return this.contextPool.getStats();
  }
}

// ================================================================================
// Main Optimized Hook Implementation
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
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Refs for cleanup and cancellation
  const layerProcessorRef = useRef<ParallelLayerProcessor | null>(null);
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

  const processTerrainOptimized = useCallback(async (
    bboxCoords: [number, number, number, number],
    processId: string,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<TerrainProcessingResult> => {
    const [minLng, minLat, maxLng, maxLat] = bboxCoords;

    onProgress({
      stage: 'terrain',
      percentage: 5,
      message: 'Processing elevation data...'
    });

    try {
      // Process elevation data
      const elevationResult = await processElevationForBbox(bboxCoords, processId);

      onProgress({
        stage: 'terrain',
        percentage: 10,
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
        percentage: 15,
        message: 'Creating terrain geometry...'
      });

      // Create terrain geometry using WASM (main thread)
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
        percentage: 20,
        message: 'Terrain processing complete'
      });

      // Convert WASM TypedArrays to THREE.js BufferGeometry directly
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(wasmTerrainResult.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(wasmTerrainResult.normals, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(wasmTerrainResult.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(wasmTerrainResult.indices, 1));

      const result: TerrainProcessingResult = {
        terrainGeometry: geometry,
        processedElevationGrid: wasmTerrainResult.processedElevationGrid,
        processedMinElevation: wasmTerrainResult.processedMinElevation,
        processedMaxElevation: wasmTerrainResult.processedMaxElevation,
        originalMinElevation: wasmTerrainResult.originalMinElevation,
        originalMaxElevation: wasmTerrainResult.originalMaxElevation,
        gridSize: elevationResult.gridSize
      };

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

  // ================================================================================
  // Main Generation Function
  // ================================================================================

  const generateMeshOptimized = useCallback(async (): Promise<MeshGenerationResult> => {
    const startTime = Date.now();

    if (!bbox) {
      throw new Error("Cannot generate mesh: bbox is undefined");
    }

    if (!isWasmInitialized) {
      throw new Error("WASM module not initialized. Please try again later.");
    }

    // Start performance monitoring
    const performanceSessionId = performanceMonitor.startSession(vtLayers.length);

    // Initialize processing state
    setIsProcessingMesh(true);
    setProcessingProgress({
      stage: 'initializing',
      percentage: 0,
      message: 'Initializing optimized mesh generation...'
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
          zOffset: layer.zOffset,
          alignVerticesToTerrain: layer.alignVerticesToTerrain,
          applyMedianHeight: layer.applyMedianHeight,
          filter: layer.filter
        }))
      };

      // Start new process
      const processId = await processManager.startProcess(processConfig);
      currentProcessIdRef.current = processId;

      console.log(`🚀 Started optimized mesh generation process: ${processId}`);

      // Initialize layer processor
      const layerProcessor = new ParallelLayerProcessor();
      layerProcessorRef.current = layerProcessor;

      setProcessingProgress({
        stage: 'initializing',
        percentage: 2,
        message: 'Fetching vector tile data...'
      });

      // Fetch VT data (shared resource)
      const zoomLevel = calculateOptimalZoomLevel(...bboxCoords);
      await fetchVtData({
        bbox: bboxCoords,
        zoom: 14,
        gridSize: { width: 256, height: 256 },
        bboxKey: processId,
      });

      // Check for cancellation
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Process terrain
      const terrainStartTime = performance.now();
      const terrainResult = await processTerrainOptimized(
        bboxCoords,
        processId,
        setProcessingProgress
      );
      const terrainEndTime = performance.now();

      // Record terrain processing performance
      performanceMonitor.recordTerrainProcessing(terrainEndTime - terrainStartTime);

      // Check for cancellation after terrain
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      setProcessingProgress({
        stage: 'initializing',
        percentage: 25,
        message: 'Preparing parallel processing...'
      });

      // Workers will handle their own vector tile fetching
      console.log(`⚡ Workers will fetch vector tiles independently for optimal performance`);

      // Initialize contexts for layer processing
      await layerProcessor.initializeContexts(vtLayers.length);

      // Process layers in parallel using dedicated WASM contexts
      const layerResults = await layerProcessor.processLayersInParallel(
        vtLayers,
        bboxCoords,
        processId,
        {
          processedElevationGrid: terrainResult.processedElevationGrid,
          gridSize: terrainResult.gridSize,
          originalMinElevation: terrainResult.originalMinElevation,
          originalMaxElevation: terrainResult.originalMaxElevation
        },
        terrainSettings,
        debugSettings,
        setProcessingProgress
      );

      // Check for cancellation before finalizing
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      setProcessingProgress({
        stage: 'finalizing',
        percentage: 90,
        message: 'Finalizing optimized mesh generation...'
      });

      // Clean up layer processor
      await layerProcessor.cleanup();

      const totalTime = Date.now() - startTime;

      // Calculate parallelization efficiency
      const sequentialTime = layerResults.reduce((sum, r) => sum + r.processingTimeMs, 0);
      const parallelTime = Math.max(...layerResults.map(r => r.processingTimeMs));
      const efficiency = sequentialTime > 0 ? Math.min(100, (sequentialTime / parallelTime) * 100) : 0;

      setProcessingProgress({
        stage: 'complete',
        percentage: 100,
        message: 'Optimized mesh generation complete!'
      });

      console.log(`🎉 Optimized mesh generation completed in ${totalTime}ms (${efficiency.toFixed(1)}% efficiency)`);

      // End performance monitoring and log analysis
      const performanceSession = performanceMonitor.endSession();
      if (performanceSession) {
        performanceMonitor.logPerformanceSummary(performanceSession);
      }

      return {
        terrainResult,
        layerResults,
        totalProcessingTimeMs: totalTime,
        parallelizationEfficiency: efficiency,
        success: true
      };

    } catch (error) {
      console.error('❌ Optimized mesh generation failed:', error);

      // Clean up on error
      if (layerProcessorRef.current) {
        await layerProcessorRef.current.cleanup();
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
        parallelizationEfficiency: 0,
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    } finally {
      // Ensure processing state is always properly reset
      setIsProcessingMesh(false);
      setProcessingProgress({
        stage: 'initializing',
        percentage: 0,
        message: 'Ready'
      });
      abortControllerRef.current = null;
      currentProcessIdRef.current = null;

      // Clean up layer processor reference
      if (layerProcessorRef.current) {
        layerProcessorRef.current = null;
      }
    }
  }, [
    bbox,
    isWasmInitialized,
    terrainSettings,
    vtLayers,
    debugSettings,
    extractBoundingBoxCoordinates,
    calculateOptimalZoomLevel,
    processTerrainOptimized
  ]);

  // ================================================================================
  // Public Interface
  // ================================================================================

  const startMeshGeneration = useCallback(async () => {
    if (isProcessingMesh) {
      console.warn('Mesh generation already in progress, cancelling and restarting');
      await cancelMeshGeneration();
      // Small additional delay after cancellation
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Cancel any existing operations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    try {
      const result = await generateMeshOptimized();

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

        console.log('✅ Optimized mesh generation completed successfully');
        console.log('📊 Performance metrics:', {
          totalTime: result.totalProcessingTimeMs,
          efficiency: `${result.parallelizationEfficiency.toFixed(1)}%`,
          layerResults: result.layerResults.map(r => ({
            layer: r.layer.label,
            time: r.processingTimeMs,
            vertices: r.vertexCount,
            success: r.success
          }))
        });
      }

      return result;
    } catch (error) {
      console.error('❌ Optimized mesh generation error:', error);
      throw error;
    }
  }, [
    isProcessingMesh,
    generateMeshOptimized,
    setGeometryDataSets,
    setConfigHashes,
    bbox,
    terrainSettings,
    vtLayers
  ]);

  const cancelMeshGeneration = useCallback(async () => {
    if (abortControllerRef.current) {
      console.log('🛑 Cancelling optimized mesh generation...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (currentProcessIdRef.current) {
      processManager.cancelProcess(currentProcessIdRef.current);
      currentProcessIdRef.current = null;
    }

    // Clean up layer processor with proper async handling
    if (layerProcessorRef.current) {
      await layerProcessorRef.current.cleanup();
      layerProcessorRef.current = null;
    }

    // Clear any pending debounce timers
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      setDebounceTimer(null);
    }

    // Ensure processing state is properly reset
    setIsProcessingMesh(false);
    setProcessingProgress({
      stage: 'initializing',
      percentage: 0,
      message: 'Ready'
    });

    // Small delay to ensure WASM cleanup completes before next operation
    await new Promise(resolve => setTimeout(resolve, 100)); // Increased delay
  }, [debounceTimer]);

  // ================================================================================
  // Auto-generation Logic
  // ================================================================================

  const geometryOnlyLayersHash = useMemo(() => {
    return vtLayers.map(hashVtLayerConfig).join(':');
  }, [vtLayers]);

  const geometryOnlyTerrainHash = useMemo(() => {
    return hashTerrainConfig(terrainSettings);
  }, [terrainSettings]);

  // Track if we should use immediate processing (when interrupting an active process)
  const immediateProcessingRef = useRef(false);

  useEffect(() => {
    console.log("useGenerateMeshOptimized dependencies changed:", {
      hasBbox: !!bbox,
      terrainEnabled: terrainSettings?.enabled,
      buildingsEnabled: buildingSettings?.enabled,
      layerCount: vtLayers?.length,
    });

    // Check if there was an active process before cancelling
    const hadActiveProcess = isProcessingMesh;

    // Handle async cancellation
    const handleBboxChange = async () => {
      // Cancel any existing operation and clear timers
      await cancelMeshGeneration();

      if (!bbox) {
        console.warn("No bbox available, skipping optimized mesh generation");
        immediateProcessingRef.current = false;
        return;
      }

      // If there was an active process, use immediate processing for responsive UX
      // Otherwise use normal debouncing for initial changes
      const delay = hadActiveProcess ? 200 : 1000; // Increased immediate delay for better reliability

      // Set flag for next iteration (only if we had an active process)
      immediateProcessingRef.current = hadActiveProcess;

      const timer = setTimeout(async () => {
        console.log(`${hadActiveProcess ? 'Immediate' : 'Debounce'} timer expired, starting optimized mesh generation`);
        try {
          await startMeshGeneration();
        } catch (error) {
          console.error('Error during mesh generation:', error);
        } finally {
          // Reset immediate processing flag after starting
          immediateProcessingRef.current = false;
        }
      }, delay);

      setDebounceTimer(timer);
    };

    handleBboxChange();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
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
      // Cleanup on unmount - use fire-and-forget async
      (async () => {
        await cancelMeshGeneration();
        if (layerProcessorRef.current) {
          await layerProcessorRef.current.cleanup();
        }
      })();

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
    hasActiveContexts: layerProcessorRef.current ? true : false,
    contextPoolStats: layerProcessorRef.current?.getStats() || null
  };
}