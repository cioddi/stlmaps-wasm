// filepath: /home/tobi/project/stlmaps/packages/threegis-core/src/hooks/useElevationProcessor.ts
import { useState, useCallback } from 'react';
import { getWasmModule } from '../wasm/wasmBridge';
import { 
  processElevationDataWasm,
  //type Tile as WasmTile, 
  //type GridSize as WasmGridSize, 
  //type ElevationProcessingResult as WasmElevationResult 
} from '../wasm/elevationProcessor';

// Re-export the types so they can be used from this module
export interface GridSize {
  width: number;
  height: number;
}

export interface ElevationProcessingResult {
  elevationGrid: number[][];
  gridSize: GridSize;
  minElevation: number;
  maxElevation: number;
  processedMinElevation: number;
  processedMaxElevation: number;
}

// Re-export the Tile interface
export interface Tile {
  x: number;
  y: number;
  z: number;
}

/**
 * Hook for processing elevation data using WebAssembly
 */
export function useElevationProcessor() {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  /**
   * Process elevation data for a given bounding box using WebAssembly
   */
  const processElevationData = useCallback(async (
    bbox: [number, number, number, number], // [minLng, minLat, maxLng, maxLat]
    tiles: Tile[]
  ): Promise<ElevationProcessingResult> => {
    setIsProcessing(true);
    setError(null);
    setProgress(0);
    
    try {
      // Get the initialized WASM module
      const wasmModule = getWasmModule();
      
      // Update progress
      setProgress(10);
      
      // Process elevation data using WASM
      // Convert our Tile type to WasmTile type
      const wasmTiles = tiles.map(tile => ({
        x: tile.x,
        y: tile.y,
        z: tile.z
      }));
      
      const result = await processElevationDataWasm(
        wasmModule,
        bbox[0], // minLng
        bbox[1], // minLat
        bbox[2], // maxLng
        bbox[3], // maxLat
        wasmTiles
      );
      
      // Update progress
      setProgress(100);
      
      // Convert from WASM result to our result type
      const fullResult: ElevationProcessingResult = {
        elevationGrid: result.elevationGrid,
        gridSize: {
          width: result.gridSize.width,
          height: result.gridSize.height
        },
        minElevation: result.minElevation,
        maxElevation: result.maxElevation,
        processedMinElevation: result.minElevation,
        processedMaxElevation: result.maxElevation
      };
      
      return fullResult;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Get appropriate tiles for a bounding box
   */
  const getTilesForBbox = useCallback((
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    zoom: number
  ): Tile[] => {
    // Convert lng/lat to tile coordinates
    const n = Math.pow(2, zoom);
    
    // Calculate tile coordinates
    const minTileX = Math.floor((minLng + 180) / 360 * n);
    const maxTileX = Math.floor((maxLng + 180) / 360 * n);
    
    // Calculate y tile coordinates (note: y goes from 0 at the top to 2^zoom-1 at the bottom)
    const minTileY = Math.floor(
      (1 - Math.log(Math.tan(maxLat * Math.PI / 180) + 1 / Math.cos(maxLat * Math.PI / 180)) / Math.PI) / 2 * n
    );
    const maxTileY = Math.floor(
      (1 - Math.log(Math.tan(minLat * Math.PI / 180) + 1 / Math.cos(minLat * Math.PI / 180)) / Math.PI) / 2 * n
    );
    
    // Generate tile list
    const tiles: Tile[] = [];
    for (let y = minTileY; y <= maxTileY; y++) {
      for (let x = minTileX; x <= maxTileX; x++) {
        tiles.push({ x, y, z: zoom });
      }
    }
    
    return tiles;
  }, []);

  /**
   * Calculate how many tiles would be needed for a given bounding box and zoom level
   */
  const calculateTileCount = useCallback((
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    zoom: number
  ): number => {
    const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
    return tiles.length;
  }, [getTilesForBbox]);

  /**
   * Find the optimal zoom level for a bounding box (where number of tiles is <= maxTiles)
   */
  const findOptimalZoom = useCallback((
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    maxTiles: number = 9
  ): number => {
    // Start with maximum reasonable zoom level for DEM (usually 14)
    let zoom = 14;
    
    // Decrease zoom until we get a manageable number of tiles
    while (zoom > 0) {
      const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoom);
      if (tileCount <= maxTiles) {
        break;
      }
      zoom--;
    }
    
    return zoom;
  }, [calculateTileCount]);

  /**
   * Process elevation data for a GeoJSON bounding box feature
   */
  const processElevationForBbox = useCallback(async (
    bboxFeature: GeoJSON.Feature
  ): Promise<ElevationProcessingResult> => {
    if (!bboxFeature.geometry || bboxFeature.geometry.type !== "Polygon") {
      throw new Error("Invalid geometry: expected a Polygon");
    }
    
    // Extract coordinates from the polygon
    const coordinates = bboxFeature.geometry.coordinates[0]; // First ring of the polygon
    
    // Find min/max coordinates
    let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
    
    coordinates.forEach((coord: number[]) => {
      const [lng, lat] = coord;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });
    
    // Find optimal zoom level
    const zoom = findOptimalZoom(minLng, minLat, maxLng, maxLat);
    console.log(`Using zoom level ${zoom} for elevation data`);
    
    // Get tiles for this bbox
    const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
    console.log(`Processing ${tiles.length} tiles for elevation data`);
    
    // Process the elevation data
    return processElevationData([minLng, minLat, maxLng, maxLat], tiles);
  }, [findOptimalZoom, getTilesForBbox, processElevationData]);

  return {
    processElevationData,
    processElevationForBbox,
    getTilesForBbox,
    calculateTileCount,
    findOptimalZoom,
    isProcessing,
    error,
    progress
  };
}
