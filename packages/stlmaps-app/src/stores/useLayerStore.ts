/**
 * Legacy compatibility layer for the old useLayerStore
 * @deprecated Use individual domain stores from ../domains instead
 * 
 * This file provides a compatibility layer to avoid breaking existing components
 * while we gradually migrate to the new domain-driven architecture.
 */

import { useCombinedStore } from './useCombinedStore';

// Re-export the individual stores for migration
export { 
  useLayerStore,
  useTerrainStore,
  useProcessingStore,
  useGeometryStore,
  useUIStore
} from '../domains';

// Default export for backwards compatibility - now uses the combined store
export default useCombinedStore;