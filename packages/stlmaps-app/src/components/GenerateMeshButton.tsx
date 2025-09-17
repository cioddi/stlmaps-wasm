import React from "react";
import { useGenerateMesh } from "../hooks/useGenerateMesh";

/**
 * GenerateMeshButton Component (Refactored)
 *
 * This component now serves as an invisible background service that handles mesh generation
 * using the useGenerateMesh hook. The visual processing indicator has been moved to
 * the ProcessingIndicator component which is always visible.
 *
 * Key features:
 * - Invisible background mesh generation service
 * - Automatic processing based on store changes
 * - No UI rendering - purely functional
 */
export const GenerateMeshButton: React.FC = () => {
  // Initialize the mesh generation hook to enable automatic processing
  // This handles all the generation logic internally based on store changes
  useGenerateMesh();

  // This component is invisible - it only provides the mesh generation functionality
  // The visual processing indicator is now handled by ProcessingIndicator component
  return null;
};