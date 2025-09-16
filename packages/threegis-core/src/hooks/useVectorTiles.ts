import { useState, useCallback } from 'react';
import { Tile, GridSize, fetchVtData } from '../sources/VectortileSource';
import { VectorTile } from '@mapbox/vector-tile';

export interface UseVectorTilesOptions {
  enableWasm?: boolean;
}

/**
 * Hook for fetching and processing vector tiles
 */
export function useVectorTiles() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [vectorTiles, setVectorTiles] = useState<{ tile: Tile, data: VectorTile }[]>([]);

  /**
   * Fetch vector tiles for a specific bounding box
   */
  const fetchTiles = useCallback(async (
    bbox: [number, number, number, number],
    zoom: number,
    gridSize: GridSize,
    bboxKey?: string
  ) => {
    setIsLoading(true);
    setError(null);
    
    try {
      await fetchVtData({
        bbox,
        zoom,
        gridSize,
        bboxKey
      });
      
      // Since fetchVtData currently returns unknown[] and doesn't provide
      // the expected { tile: Tile; data: VectorTile }[] format,
      // we'll set an empty array for now until the WASM implementation
      // is properly configured to return structured tile data
      const processedTiles: { tile: Tile; data: VectorTile }[] = [];
      
      setVectorTiles(processedTiles);
      return processedTiles;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error fetching vector tiles');
      setError(error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    fetchVectorTiles: fetchTiles,
    vectorTiles,
    isLoading,
    error
  };
}
