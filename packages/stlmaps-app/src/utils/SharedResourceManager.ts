/**
 * Shared Resource Manager
 * Manages vector tile data sharing between main thread and worker WASM instances
 * Ensures all WASM contexts can access the same cached vector tile data
 */

import { getWasmModule } from "@threegis/core";

// ================================================================================
// Types and Interfaces
// ================================================================================

export interface VectorTileData {
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

export interface SharedResourceState {
  processId: string;
  vectorTiles: Map<string, VectorTileData>;
  elevationData?: {
    grid: number[][];
    gridSize: { width: number; height: number };
    minElevation: number;
    maxElevation: number;
  };
  bbox: [number, number, number, number];
  timestamp: number;
}

export interface ResourceTransferMessage {
  type: 'sync-resources' | 'add-tile' | 'clear-cache';
  processId: string;
  data?: any;
}

// ================================================================================
// Shared Resource Manager
// ================================================================================

export class SharedResourceManager {
  private static instance: SharedResourceManager | null = null;
  private resourceCache = new Map<string, SharedResourceState>();
  private pendingTransfers = new Map<string, Promise<void>>();

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): SharedResourceManager {
    if (!SharedResourceManager.instance) {
      SharedResourceManager.instance = new SharedResourceManager();
    }
    return SharedResourceManager.instance;
  }

  // ================================================================================
  // Resource Collection
  // ================================================================================

  /**
   * Extract and cache vector tile data from main thread WASM instance
   */
  async extractVectorTilesFromMainThread(
    processId: string,
    bbox: [number, number, number, number]
  ): Promise<VectorTileData[]> {
    try {
      console.log(`📦 Extracting vector tiles from main thread for process: ${processId}`);

      const wasmModule = getWasmModule();
      if (!wasmModule) {
        throw new Error('Main thread WASM module not available');
      }

      // Get vector tile data from main WASM instance using correct functions
      const vectorTiles: VectorTileData[] = [];

      // Try to extract cached vector tile data using process feature data functions
      try {
        // Check if we can get vector tile data for this process
        if (wasmModule.get_process_feature_data_js && wasmModule.get_cached_process_ids_js) {
          const processIds = wasmModule.get_cached_process_ids_js();

          if (processIds && processIds.includes(processId)) {
            console.log(`📦 Found process ${processId} in WASM cache`);

            // Try different data keys that might contain vector tile information
            const possibleDataKeys = [
              'vector_tiles',
              'vt_data',
              'tile_cache',
              'cached_tiles',
              'tile_data'
            ];

            for (const dataKey of possibleDataKeys) {
              try {
                const tileDataJson = wasmModule.get_process_feature_data_js(processId, dataKey);

                if (tileDataJson) {
                  console.log(`✅ Found vector tile data under key: ${dataKey}`);
                  const tileData = JSON.parse(tileDataJson);

                  if (Array.isArray(tileData)) {
                    for (const tile of tileData) {
                      if (tile.tileKey && tile.data) {
                        vectorTiles.push({
                          tileKey: tile.tileKey,
                          data: tile.data instanceof ArrayBuffer ? tile.data : new ArrayBuffer(0),
                          metadata: {
                            x: tile.x || 0,
                            y: tile.y || 0,
                            z: tile.z || 0,
                            sourceLayer: tile.sourceLayer,
                            size: tile.data instanceof ArrayBuffer ? tile.data.byteLength : 0,
                            timestamp: Date.now()
                          }
                        });
                      }
                    }
                  }
                  break; // Exit loop if we found data
                }
              } catch (parseError) {
                console.warn(`Failed to parse data for key ${dataKey}:`, parseError);
              }
            }
          } else {
            console.warn(`⚠️ Process ${processId} not found in cached process IDs`);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Error accessing process feature data:`, error);
      }

      // Alternative approach: Use fetch_vector_tiles to cache tiles (not extract)
      // Since fetch_vector_tiles doesn't support extraction, remove this approach
      // The primary method should be the interceptAndCacheVectorTiles approach

      // Cache the extracted tiles
      if (vectorTiles.length > 0) {
        const resourceState: SharedResourceState = {
          processId,
          vectorTiles: new Map(vectorTiles.map(tile => [tile.tileKey, tile])),
          bbox,
          timestamp: Date.now()
        };

        this.resourceCache.set(processId, resourceState);
        console.log(`✅ Cached ${vectorTiles.length} vector tiles for process ${processId}`);
      } else {
        console.warn(`⚠️ No vector tiles found in main thread cache for process ${processId}`);
      }

      return vectorTiles;

    } catch (error) {
      console.error(`❌ Failed to extract vector tiles from main thread:`, error);
      return [];
    }
  }

  /**
   * Alternative approach: Cache tile data during the fetch process
   */
  async interceptAndCacheVectorTiles(
    processId: string,
    bbox: [number, number, number, number],
    zoom: number
  ): Promise<VectorTileData[]> {
    try {
      console.log(`🔄 Intercepting vector tile fetch for process: ${processId}`);

      // Calculate which tiles we need for the bbox
      const tiles = this.calculateRequiredTiles(bbox, zoom);
      const vectorTiles: VectorTileData[] = [];

      // Fetch tiles directly and cache them
      for (const tile of tiles) {
        try {
          const tileUrl = this.buildTileUrl(tile.x, tile.y, tile.z);
          const response = await fetch(tileUrl);

          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();

            const vectorTile: VectorTileData = {
              tileKey: `${tile.z}/${tile.x}/${tile.y}`,
              data: arrayBuffer,
              metadata: {
                x: tile.x,
                y: tile.y,
                z: tile.z,
                size: arrayBuffer.byteLength,
                timestamp: Date.now()
              }
            };

            vectorTiles.push(vectorTile);
          }
        } catch (tileError) {
          console.warn(`Failed to fetch tile ${tile.z}/${tile.x}/${tile.y}:`, tileError);
        }
      }

      // Cache the tiles
      if (vectorTiles.length > 0) {
        const resourceState: SharedResourceState = {
          processId,
          vectorTiles: new Map(vectorTiles.map(tile => [tile.tileKey, tile])),
          bbox,
          timestamp: Date.now()
        };

        this.resourceCache.set(processId, resourceState);
        console.log(`✅ Intercepted and cached ${vectorTiles.length} vector tiles`);
      }

      return vectorTiles;

    } catch (error) {
      console.error(`❌ Failed to intercept vector tiles:`, error);
      return [];
    }
  }

  // ================================================================================
  // Resource Transfer to Workers
  // ================================================================================

  /**
   * Transfer cached resources to a worker WASM instance
   */
  async transferResourcesToWorker(
    worker: Worker,
    processId: string,
    options: {
      timeout?: number;
      includeElevation?: boolean;
    } = {}
  ): Promise<void> {
    const { timeout = 30000, includeElevation = true } = options;

    // Check if transfer is already in progress
    const transferKey = `${processId}-${worker.toString()}`;
    if (this.pendingTransfers.has(transferKey)) {
      return this.pendingTransfers.get(transferKey)!;
    }

    const transferPromise = this.performResourceTransfer(
      worker,
      processId,
      timeout,
      includeElevation
    );

    this.pendingTransfers.set(transferKey, transferPromise);

    try {
      await transferPromise;
    } finally {
      this.pendingTransfers.delete(transferKey);
    }
  }

  private async performResourceTransfer(
    worker: Worker,
    processId: string,
    timeout: number,
    includeElevation: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const resourceState = this.resourceCache.get(processId);

      if (!resourceState) {
        reject(new Error(`No cached resources found for process ${processId}`));
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Resource transfer timeout for process ${processId}`));
      }, timeout);

      // Prepare transfer data
      const transferData = {
        processId,
        bbox: resourceState.bbox,
        vectorTiles: Array.from(resourceState.vectorTiles.values()),
        elevationData: includeElevation ? resourceState.elevationData : undefined,
        timestamp: resourceState.timestamp
      };

      // Set up response handler
      const messageHandler = (event: MessageEvent) => {
        if (event.data.type === 'resources-synced' && event.data.processId === processId) {
          clearTimeout(timeoutId);
          worker.removeEventListener('message', messageHandler);

          if (event.data.success) {
            console.log(`✅ Resources transferred to worker for process ${processId}`);
            resolve();
          } else {
            reject(new Error(event.data.error || 'Resource transfer failed'));
          }
        }
      };

      worker.addEventListener('message', messageHandler);

      // Send resources to worker
      worker.postMessage({
        id: `transfer-${Date.now()}`,
        type: 'sync-resources',
        data: transferData
      });

      console.log(`📤 Transferring ${transferData.vectorTiles.length} tiles to worker`);
    });
  }

  // ================================================================================
  // Utility Functions
  // ================================================================================

  private calculateRequiredTiles(
    bbox: [number, number, number, number],
    zoom: number
  ): Array<{ x: number; y: number; z: number }> {
    const [west, south, east, north] = bbox;
    const tiles: Array<{ x: number; y: number; z: number }> = [];

    // Convert lat/lng to tile coordinates
    const minTileX = Math.floor(this.lngToTileX(west, zoom));
    const maxTileX = Math.floor(this.lngToTileX(east, zoom));
    const minTileY = Math.floor(this.latToTileY(north, zoom)); // Note: Y is flipped
    const maxTileY = Math.floor(this.latToTileY(south, zoom));

    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        tiles.push({ x, y, z: zoom });
      }
    }

    return tiles;
  }

  private lngToTileX(lng: number, zoom: number): number {
    return (lng + 180) / 360 * Math.pow(2, zoom);
  }

  private latToTileY(lat: number, zoom: number): number {
    return (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom);
  }

  private buildTileUrl(x: number, y: number, z: number): string {
    // Use the actual tile server URL pattern from the project
    return `https://wms.wheregroup.com/tileserver/tile/tileserver.php?/europe-0-14/${z}/${x}/${y}.pbf`;
  }

  // ================================================================================
  // Cache Management
  // ================================================================================

  /**
   * Add elevation data to the resource cache
   */
  addElevationData(
    processId: string,
    elevationData: {
      grid: number[][];
      gridSize: { width: number; height: number };
      minElevation: number;
      maxElevation: number;
    }
  ): void {
    const resourceState = this.resourceCache.get(processId);

    if (resourceState) {
      resourceState.elevationData = elevationData;
      console.log(`✅ Added elevation data to resource cache for process ${processId}`);
    } else {
      console.warn(`⚠️ No resource state found for process ${processId} when adding elevation data`);
    }
  }

  /**
   * Clear cached resources for a process
   */
  clearResources(processId: string): void {
    const deleted = this.resourceCache.delete(processId);
    if (deleted) {
      console.log(`🗑️ Cleared cached resources for process ${processId}`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalProcesses: number;
    totalTiles: number;
    totalSizeMB: number;
    processes: Array<{
      processId: string;
      tileCount: number;
      sizeMB: number;
      hasElevation: boolean;
    }>;
  } {
    let totalTiles = 0;
    let totalSize = 0;
    const processes: any[] = [];

    for (const [processId, state] of this.resourceCache.entries()) {
      const tileCount = state.vectorTiles.size;
      const processSize = Array.from(state.vectorTiles.values())
        .reduce((sum, tile) => sum + tile.metadata.size, 0);

      totalTiles += tileCount;
      totalSize += processSize;

      processes.push({
        processId,
        tileCount,
        sizeMB: processSize / (1024 * 1024),
        hasElevation: !!state.elevationData
      });
    }

    return {
      totalProcesses: this.resourceCache.size,
      totalTiles,
      totalSizeMB: totalSize / (1024 * 1024),
      processes
    };
  }

  /**
   * Cleanup old cached resources
   */
  cleanup(maxAgeMs: number = 300000): void { // 5 minutes default
    const now = Date.now();
    let cleaned = 0;

    for (const [processId, state] of this.resourceCache.entries()) {
      if (now - state.timestamp > maxAgeMs) {
        this.resourceCache.delete(processId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old resource caches`);
    }
  }
}

// ================================================================================
// Singleton Export
// ================================================================================

export const sharedResourceManager = SharedResourceManager.getInstance();