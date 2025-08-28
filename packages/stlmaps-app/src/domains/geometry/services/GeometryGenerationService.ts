import * as THREE from 'three';
//@ts-expect-error No types available for BufferGeometryUtils
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { 
  getWasmModule,
  fetchVtData,
  calculateTileCount,
  getTilesForBbox
} from '@threegis/core';
import { VtDataSet } from '../../../types/VtDataSet';
import { WorkerService } from '../../../workers/WorkerService';
import { tokenManager } from '../../../utils/CancellationToken';
import { 
  createComponentHashes,
  createConfigHash,
  hashBbox,
  hashVtLayerConfig,
  hashTerrainConfig 
} from '../../../utils/configHashing';
import type { ConfigHashes, ProcessedTerrainData } from '../types/GeometryTypes';

export interface GridSize {
  width: number;
  height: number;
}

export interface TerrainGeometryResult {
  geometry: THREE.BufferGeometry;
  processedElevationGrid: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
}

export interface GeometryGenerationConfig {
  bbox: GeoJSON.Feature | undefined;
  vtLayers: VtDataSet[];
  terrainSettings: {
    enabled: boolean;
    verticalExaggeration: number;
    baseHeight: number;
    color: string;
  };
  debugSettings: {
    geometryDebugMode: boolean;
  };
}

export interface GeometryGenerationCallbacks {
  onProgressUpdate: (status: string, progress: number) => void;
  onComplete: (result: GeometryGenerationResult) => void;
  onError: (error: Error) => void;
}

export interface GeometryGenerationResult {
  polygonGeometries: VtDataSet[] | null;
  terrainGeometry: THREE.BufferGeometry | undefined;
  configHashes: ConfigHashes;
  processedTerrainData: ProcessedTerrainData;
}

export class GeometryGenerationService {
  private workerService: WorkerService;

  constructor() {
    this.workerService = new WorkerService();
  }

  async generateGeometry(
    config: GeometryGenerationConfig,
    callbacks: GeometryGenerationCallbacks
  ): Promise<void> {
    const { bbox, vtLayers, terrainSettings, debugSettings } = config;
    const { onProgressUpdate, onComplete, onError } = callbacks;

    try {
      // Validate configuration
      if (!bbox) {
        throw new Error('Bounding box is required for geometry generation');
      }

      // Calculate configuration hashes
      const configHashes = this.calculateConfigHashes(config);

      onProgressUpdate('Initializing geometry generation...', 0);

      // Generate terrain geometry
      let terrainGeometry: THREE.BufferGeometry | undefined;
      let processedTerrainData: ProcessedTerrainData = {
        processedMinElevation: 0,
        processedMaxElevation: 100,
      };

      if (terrainSettings.enabled) {
        const terrainResult = await this.generateTerrainGeometry(
          bbox,
          terrainSettings,
          onProgressUpdate
        );
        terrainGeometry = terrainResult.geometry;
        processedTerrainData = {
          processedElevationGrid: terrainResult.processedElevationGrid,
          processedMinElevation: terrainResult.processedMinElevation,
          processedMaxElevation: terrainResult.processedMaxElevation,
        };
      }

      // Generate vector geometries
      const polygonGeometries = await this.generateVectorGeometries(
        bbox,
        vtLayers,
        debugSettings,
        onProgressUpdate
      );

      onComplete({
        polygonGeometries,
        terrainGeometry,
        configHashes,
        processedTerrainData,
      });
    } catch (error) {
      onError(error as Error);
    }
  }

  private calculateConfigHashes(config: GeometryGenerationConfig): ConfigHashes {
    const { bbox, vtLayers, terrainSettings } = config;
    
    if (!bbox) {
      throw new Error('Bounding box is required for hash calculation');
    }

    const bboxKey = hashBbox(bbox.geometry as any);
    const terrainHash = hashTerrainConfig(terrainSettings);
    const layerHashes = vtLayers.map((layer, index) => ({
      index,
      hash: hashVtLayerConfig(layer)
    }));

    const componentHashes = createComponentHashes(vtLayers, terrainSettings);
    const fullConfigHash = createConfigHash(componentHashes, bboxKey);

    return {
      fullConfigHash,
      terrainHash,
      layerHashes,
    };
  }

  private async generateTerrainGeometry(
    bbox: GeoJSON.Feature,
    terrainSettings: GeometryGenerationConfig['terrainSettings'],
    onProgressUpdate: (status: string, progress: number) => void
  ): Promise<TerrainGeometryResult> {
    onProgressUpdate('Processing terrain and elevation data', 10);

    const wasmModule = await getWasmModule();
    if (!wasmModule) {
      throw new Error('WASM module not initialized');
    }

    const bboxKey = hashBbox(bbox.geometry as any);
    
    // Call WASM terrain processing
    const terrainResult = wasmModule.process_terrain_geometry_native(
      JSON.stringify(bbox.geometry),
      bboxKey,
      terrainSettings.verticalExaggeration,
      terrainSettings.baseHeight
    );

    onProgressUpdate('Terrain processing completed', 50);

    if (!terrainResult || !terrainResult.geometry) {
      throw new Error('Failed to generate terrain geometry');
    }

    const geometry = this.createThreeGeometryFromWasm(terrainResult.geometry);
    
    return {
      geometry,
      processedElevationGrid: terrainResult.processedElevationGrid || [],
      processedMinElevation: terrainResult.processedMinElevation || 0,
      processedMaxElevation: terrainResult.processedMaxElevation || 100,
    };
  }

  private async generateVectorGeometries(
    bbox: GeoJSON.Feature,
    vtLayers: VtDataSet[],
    debugSettings: { geometryDebugMode: boolean },
    onProgressUpdate: (status: string, progress: number) => void
  ): Promise<VtDataSet[] | null> {
    const enabledLayers = vtLayers.filter(layer => layer.enabled);
    if (enabledLayers.length === 0) {
      onProgressUpdate('No enabled layers to process', 90);
      return null;
    }

    onProgressUpdate('Processing vector data', 60);

    const wasmModule = await getWasmModule();
    if (!wasmModule) {
      throw new Error('WASM module not initialized');
    }

    const bboxKey = hashBbox(bbox.geometry as any);
    
    // Process each enabled layer
    const processedLayers: VtDataSet[] = [];
    const totalLayers = enabledLayers.length;

    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const layerProgress = 60 + (i / totalLayers) * 30;
      
      onProgressUpdate(`Processing layer: ${layer.sourceLayer}`, layerProgress);

      try {
        // Fetch vector tile data
        const vtData = await fetchVtData(layer, bbox);
        
        // Process with WASM
        const processingConfig = {
          ...layer,
          bboxKey,
          vtData,
          debugMode: debugSettings.geometryDebugMode,
        };

        const result = wasmModule.process_polygon_geometry_native(
          JSON.stringify(processingConfig)
        );

        if (result && result.geometries) {
          processedLayers.push({
            ...layer,
            geometries: this.createThreeGeometriesFromWasm(result.geometries),
          });
        }
      } catch (error) {
        console.error(`Failed to process layer ${layer.sourceLayer}:`, error);
        // Continue processing other layers
      }
    }

    onProgressUpdate('Vector processing completed', 90);
    return processedLayers.length > 0 ? processedLayers : null;
  }

  private createThreeGeometryFromWasm(wasmGeometry: any): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    
    if (wasmGeometry.positions) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(wasmGeometry.positions, 3));
    }
    
    if (wasmGeometry.normals) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(wasmGeometry.normals, 3));
    }
    
    if (wasmGeometry.uvs) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(wasmGeometry.uvs, 2));
    }
    
    if (wasmGeometry.indices) {
      geometry.setIndex(new THREE.Uint32BufferAttribute(wasmGeometry.indices, 1));
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    
    return geometry;
  }

  private createThreeGeometriesFromWasm(wasmGeometries: any[]): THREE.BufferGeometry[] {
    return wasmGeometries.map(wasmGeom => this.createThreeGeometryFromWasm(wasmGeom));
  }

  dispose(): void {
    this.workerService.dispose();
  }
}