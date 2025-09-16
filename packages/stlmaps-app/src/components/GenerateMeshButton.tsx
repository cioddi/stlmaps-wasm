import React from "react";
import { useGenerateMesh } from "../hooks/useGenerateMesh";

/**
 * GenerateMeshButton Component (Refactored)
 *
 * This component has been completely refactored to use the new useGenerateMesh hook.
 * All processing logic has been moved to the hook for better separation of concerns,
 * reusability, and maintainability.
 *
 * Key improvements:
 * - Clean separation between UI and business logic
 * - Parallel processing with multiple WASM contexts
 * - Background processing to prevent main thread blocking
 * - Better error handling and progress reporting
 * - Cancellation support
 * - Resource cleanup
 */
export const GenerateMeshButton: React.FC = () => {
  const {
    // State
    isProcessingMesh,
    processingProgress,

    // Actions
    startMeshGeneration,
    cancelMeshGeneration,

    // Utils
    isWasmInitialized,

    // Debug info (can be removed in production)
    currentProcessId,
    hasActiveContexts
  } = useGenerateMesh();

  // Render processing status for debugging (optional)
  if (process.env.NODE_ENV === 'development') {
    return (
      <div style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontSize: '12px',
        zIndex: 1000,
        maxWidth: '300px'
      }}>
        <div><strong>Mesh Generation Status</strong></div>
        <div>WASM Initialized: {isWasmInitialized ? '✅' : '❌'}</div>
        <div>Processing: {isProcessingMesh ? '🔄' : '⏸️'}</div>
        <div>Stage: {processingProgress.stage}</div>
        <div>Progress: {processingProgress.percentage.toFixed(1)}%</div>
        <div>Message: {processingProgress.message}</div>
        {currentProcessId && <div>Process ID: {currentProcessId.slice(-8)}...</div>}
        <div>Active Contexts: {hasActiveContexts ? '🟢' : '🔴'}</div>

        {processingProgress.currentLayerIndex !== undefined && (
          <div>
            Layer: {processingProgress.currentLayerIndex + 1}/{processingProgress.totalLayers}
          </div>
        )}

        <div style={{ marginTop: '10px' }}>
          <button
            onClick={startMeshGeneration}
            disabled={isProcessingMesh || !isWasmInitialized}
            style={{
              marginRight: '5px',
              padding: '5px 10px',
              fontSize: '11px',
              cursor: isProcessingMesh ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessingMesh ? 'Generating...' : 'Generate Mesh'}
          </button>

          <button
            onClick={cancelMeshGeneration}
            disabled={!isProcessingMesh}
            style={{
              padding: '5px 10px',
              fontSize: '11px',
              cursor: !isProcessingMesh ? 'not-allowed' : 'pointer',
              background: '#dc3545',
              color: 'white',
              border: 'none'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // In production, this component is invisible as processing happens automatically
  // The hook handles all the generation logic internally based on store changes
  return null;
};