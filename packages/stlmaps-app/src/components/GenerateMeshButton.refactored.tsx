import React, { useState, useCallback, useEffect } from 'react';
import { Fab, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';

import { ProcessingOrchestrator } from '../domains/processing/services/ProcessingOrchestrator';
import { 
  useLayerStore,
  useTerrainStore,
  useProcessingStore,
  useGeometryStore,
  useUIStore
} from '../domains';

// Service instance - shared across component re-renders
let processingOrchestrator: ProcessingOrchestrator | null = null;

export const GenerateMeshButton: React.FC = () => {
  // Domain store hooks
  const { vtLayers } = useLayerStore();
  const { terrainSettings } = useTerrainStore();
  const { isProcessing, updateProgress, resetProcessing } = useProcessingStore();
  const { bbox, setGeometryDataSets, setConfigHashes, setProcessedTerrainData } = useGeometryStore();
  const { debugSettings } = useUIStore();

  // Local state
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize service
  useEffect(() => {
    if (!processingOrchestrator) {
      processingOrchestrator = new ProcessingOrchestrator();
      setIsInitialized(true);
    }

    return () => {
      // Cleanup on unmount
      if (processingOrchestrator) {
        processingOrchestrator.dispose();
        processingOrchestrator = null;
      }
    };
  }, []);

  const handleStartProcessing = useCallback(async () => {
    if (!processingOrchestrator || !bbox) {
      console.error('Processing orchestrator not initialized or bbox missing');
      return;
    }

    const config = {
      geometry: {
        bbox,
        vtLayers,
        terrainSettings,
        debugSettings,
      },
    };

    const callbacks = {
      onStart: () => {
        console.log('🚀 Processing started');
      },
      onProgressUpdate: (status: string, progress: number) => {
        updateProgress(status, progress);
      },
      onComplete: (result: any) => {
        console.log('✅ Processing completed');
        
        // Update stores with results
        setGeometryDataSets({
          polygonGeometries: result.polygonGeometries,
          terrainGeometry: result.terrainGeometry,
        });
        
        setConfigHashes(result.configHashes);
        setProcessedTerrainData(result.processedTerrainData);
        
        // Reset processing state
        resetProcessing();
      },
      onError: (error: Error) => {
        console.error('❌ Processing failed:', error);
        updateProgress(`Error: ${error.message}`, 0);
        
        // Reset processing state after delay
        setTimeout(() => {
          resetProcessing();
        }, 3000);
      },
      onCancel: () => {
        console.log('⏹️ Processing cancelled');
        resetProcessing();
      },
    };

    await processingOrchestrator.startProcessing(config, callbacks);
  }, [
    bbox,
    vtLayers,
    terrainSettings,
    debugSettings,
    updateProgress,
    resetProcessing,
    setGeometryDataSets,
    setConfigHashes,
    setProcessedTerrainData,
  ]);

  const handleStopProcessing = useCallback(async () => {
    if (processingOrchestrator) {
      await processingOrchestrator.cancelCurrentProcessing();
      resetProcessing();
    }
  }, [resetProcessing]);

  const handleClick = isProcessing ? handleStopProcessing : handleStartProcessing;

  // Check if generation is possible
  const canGenerate = Boolean(
    isInitialized &&
    bbox &&
    vtLayers.some(layer => layer.enabled)
  );

  const tooltipTitle = isProcessing
    ? 'Stop processing'
    : !bbox
    ? 'Please select a bounding box first'
    : !vtLayers.some(layer => layer.enabled)
    ? 'Please enable at least one layer'
    : 'Generate 3D mesh';

  return (
    <Tooltip title={tooltipTitle} placement="left">
      <span>
        <Fab
          color="primary"
          size="large"
          onClick={handleClick}
          disabled={!canGenerate && !isProcessing}
          sx={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex: 1000,
          }}
        >
          {isProcessing ? <StopIcon /> : <PlayArrowIcon />}
        </Fab>
      </span>
    </Tooltip>
  );
};