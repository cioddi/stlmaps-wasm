import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore, VtDataSet } from '../stores/useAppStore';
import { getStateFromCurrentUrl, updateBrowserUrl, getShareableUrl } from '../utils/urlState';
import { Feature } from 'geojson';

/**
 * Hook to sync app state with URL for shareable links
 * - On mount: reads URL params and applies to store if present
 * - Provides functions to generate shareable URLs and copy to clipboard
 */
export function useUrlState() {
    const [isInitialized, setIsInitialized] = useState(false);

    // Get state from store
    const bbox = useAppStore(state => state.bbox);
    const terrainSettings = useAppStore(state => state.terrainSettings);
    const vtLayers = useAppStore(state => state.vtLayers);

    // Get actions
    const setBbox = useAppStore(state => state.setBbox);
    const setBboxCenter = useAppStore(state => state.setBboxCenter);
    const setTerrainSettings = useAppStore(state => state.setTerrainSettings);
    const setVtLayers = useAppStore(state => state.setVtLayers);

    // Load state from URL on mount
    useEffect(() => {
        if (isInitialized) return;

        const urlState = getStateFromCurrentUrl();
        if (urlState) {
            // Apply bbox from URL
            if (urlState.bbox) {
                const bboxFeature: Feature = {
                    type: urlState.bbox.type as 'Feature',
                    properties: {},
                    geometry: {
                        type: urlState.bbox.geometry.type as 'Polygon',
                        coordinates: urlState.bbox.geometry.coordinates
                    }
                };
                setBbox(bboxFeature);

                // Calculate center from bbox polygon to update map position
                const coords = urlState.bbox.geometry.coordinates[0];
                if (coords && coords.length >= 4) {
                    // Simple centroid calculation (average of min/max extent)
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                    coords.forEach((coord: number[]) => {
                        minX = Math.min(minX, coord[0]);
                        maxX = Math.max(maxX, coord[0]);
                        minY = Math.min(minY, coord[1]);
                        maxY = Math.max(maxY, coord[1]);
                    });

                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;

                    if (isFinite(centerX) && isFinite(centerY)) {
                        setBboxCenter([centerX, centerY]);
                    }
                }
            }

            // Apply terrain settings from URL
            if (urlState.terrain) {
                setTerrainSettings({
                    enabled: urlState.terrain.enabled,
                    verticalExaggeration: urlState.terrain.verticalExaggeration,
                    baseHeight: urlState.terrain.baseHeight,
                    color: urlState.terrain.color,
                });
            }

            // Apply layer configs from URL
            if (urlState.layers && urlState.layers.length > 0) {
                // Merge URL layer configs with existing layers
                const updatedLayers: VtDataSet[] = vtLayers.map((existingLayer, index) => {
                    const urlLayer = urlState.layers?.[index];
                    if (urlLayer && urlLayer.sourceLayer === existingLayer.sourceLayer) {
                        return {
                            ...existingLayer,
                            enabled: urlLayer.enabled,
                            color: urlLayer.color,
                            filter: urlLayer.filter,
                            extrusionDepth: urlLayer.extrusionDepth ?? existingLayer.extrusionDepth,
                            zOffset: urlLayer.zOffset ?? existingLayer.zOffset,
                            bufferSize: urlLayer.bufferSize ?? existingLayer.bufferSize,
                            fixedBufferSize: urlLayer.fixedBufferSize ?? existingLayer.fixedBufferSize,
                        };
                    }
                    return existingLayer;
                });
                setVtLayers(updatedLayers);
            }
        }

        setIsInitialized(true);
    }, [isInitialized, setBbox, setTerrainSettings, setVtLayers, vtLayers]);

    // Update URL when state changes (debounced)
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Don't update URL on first render before initialization
        if (!isInitialized) return;

        // Debounce URL updates
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            updateBrowserUrl(bbox, terrainSettings, vtLayers);
        }, 200);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [bbox, terrainSettings, vtLayers, isInitialized]);

    // Generate shareable URL
    const generateShareableUrl = useCallback(() => {
        return getShareableUrl(bbox, terrainSettings, vtLayers);
    }, [bbox, terrainSettings, vtLayers]);

    // Copy shareable URL to clipboard
    const copyShareableUrl = useCallback(async (): Promise<boolean> => {
        try {
            const url = generateShareableUrl();
            await navigator.clipboard.writeText(url);
            return true;
        } catch (error) {
            console.error('Failed to copy URL to clipboard:', error);
            return false;
        }
    }, [generateShareableUrl]);

    return {
        isInitialized,
        generateShareableUrl,
        copyShareableUrl,
    };
}
