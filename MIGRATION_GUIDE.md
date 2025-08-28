# Migration Guide: From Monolithic to Domain-Driven Architecture

This guide helps you migrate existing components from the legacy monolithic store to the new domain-driven architecture while maintaining full backward compatibility.

## 🎯 Overview

The project has been refactored from a single large store to focused domain stores, but **all existing components continue to work without changes** thanks to the compatibility layer. This guide shows you how to gradually modernize your components.

## 📊 Current State

### ✅ **Backward Compatibility**
All existing components using `useLayerStore()` continue to work exactly as before:
```typescript
// This still works perfectly
import useLayerStore from '../stores/useLayerStore';

const MyComponent = () => {
  const { vtLayers, terrainSettings, isProcessing } = useLayerStore();
  // Component works exactly as before
};
```

### 🆕 **New Architecture Available**
New components can use focused domain stores for better maintainability:
```typescript
// Modern approach with focused stores
import { useLayerStore, useTerrainStore, useProcessingStore } from '../domains';

const ModernComponent = () => {
  const { vtLayers } = useLayerStore();
  const { terrainSettings } = useTerrainStore();
  const { isProcessing } = useProcessingStore();
  // Cleaner, more focused component
};
```

## 🔄 Migration Strategies

### Strategy 1: **No Migration Required** (Recommended for most components)
Keep using the existing approach if the component is working well:
```typescript
// Keep this approach for stable components
import useLayerStore from '../stores/useLayerStore';

const ExistingComponent = () => {
  const { vtLayers, setLayerColor } = useLayerStore();
  return <div>{/* Component works as before */}</div>;
};
```

### Strategy 2: **Selective Migration** (For new features)
Use domain stores only for new functionality:
```typescript
// New features use domain stores
import { useLayerStore } from '../domains';
import useLayerStore as useLegacyStore from '../stores/useLayerStore';

const MixedComponent = () => {
  // Legacy functionality
  const legacyData = useLegacyStore(state => state.someOldProperty);
  
  // New functionality with domain stores
  const { vtLayers, setLayerColor } = useLayerStore();
  
  return <div>{/* Mix of old and new */}</div>;
};
```

### Strategy 3: **Full Migration** (For major refactoring)
Completely migrate to domain stores:
```typescript
// Before: Monolithic store usage
import useLayerStore from '../stores/useLayerStore';

const OldComponent = () => {
  const {
    vtLayers,
    terrainSettings,
    isProcessing,
    processingStatus,
    renderingSettings,
    setLayerColor,
    setTerrainSettings,
    updateProgress
  } = useLayerStore();
  
  // Component logic using all mixed concerns
};

// After: Domain-focused stores
import { 
  useLayerStore,
  useTerrainStore,
  useProcessingStore,
  useUIStore
} from '../domains';

const ModernComponent = () => {
  // Each domain is clearly separated
  const { vtLayers, setLayerColor } = useLayerStore();
  const { terrainSettings, setTerrainSettings } = useTerrainStore();
  const { isProcessing, processingStatus, updateProgress } = useProcessingStore();
  const { renderingSettings } = useUIStore();
  
  // Component logic with clear separation of concerns
};
```

## 🏗️ Domain Store Architecture

### Available Domains

#### 1. **Layer Domain** (`useLayerStore`)
Manages vector tile layers and their properties:
```typescript
import { useLayerStore } from '../domains';

const { 
  vtLayers,
  setVtLayers,
  updateVtLayer,
  toggleLayerEnabled,
  setLayerColor,
  setLayerExtrusionDepth,
  // ... other layer actions
} = useLayerStore();
```

#### 2. **Terrain Domain** (`useTerrainStore`)
Handles terrain and building settings:
```typescript
import { useTerrainStore } from '../domains';

const {
  terrainSettings,
  buildingSettings,
  processedTerrainData,
  setTerrainSettings,
  setBuildingSettings,
  setProcessedTerrainData,
} = useTerrainStore();
```

#### 3. **Processing Domain** (`useProcessingStore`)
Manages processing state and progress:
```typescript
import { useProcessingStore } from '../domains';

const {
  isProcessing,
  processingStatus,
  processingProgress,
  setProcessing,
  updateProgress,
  resetProcessing,
} = useProcessingStore();
```

#### 4. **Geometry Domain** (`useGeometryStore`)
Handles geometry data and bounding boxes:
```typescript
import { useGeometryStore } from '../domains';

const {
  bbox,
  configHashes,
  geometryDataSets,
  setBbox,
  setConfigHashes,
  setGeometryDataSets,
} = useGeometryStore();
```

#### 5. **UI Domain** (`useUIStore`)
Manages UI state and rendering settings:
```typescript
import { useUIStore } from '../domains';

const {
  renderingSettings,
  debugSettings,
  hoverState,
  colorOnlyUpdate,
  layerColorUpdates,
  sceneGetter,
  setRenderingSettings,
  // ... other UI actions
} = useUIStore();
```

## 📋 Migration Checklist

### Phase 1: Understanding (No Code Changes)
- [ ] Read this migration guide completely
- [ ] Understand that all existing code continues to work
- [ ] Identify which domain each part of your component logic belongs to

### Phase 2: New Features (Gradual Migration)
- [ ] For new components, use domain stores directly
- [ ] For new features in existing components, consider domain stores
- [ ] Keep legacy approach for stable, working functionality

### Phase 3: Refactoring (Optional, Long-term)
- [ ] Identify components that would benefit from domain separation
- [ ] Migrate one component at a time
- [ ] Test thoroughly after each migration
- [ ] Remove legacy imports when fully migrated

## 🔧 Best Practices

### ✅ **Do:**
- **Keep existing code working** - no rush to migrate
- **Use domain stores for new features** to start building good patterns
- **Migrate gradually** one component at a time
- **Test thoroughly** after any changes
- **Use TypeScript** to catch any compatibility issues

### ❌ **Don't:**
- **Migrate everything at once** - too risky and unnecessary
- **Break working components** for the sake of migration
- **Mix legacy and domain stores** unnecessarily in the same logical operation
- **Ignore TypeScript errors** during migration

## 🧪 Testing Migration

### 1. **Before Migration**
```typescript
// Test that existing functionality works
const component = render(<MyComponent />);
expect(component.getByText('Layer Name')).toBeInTheDocument();
```

### 2. **After Migration**
```typescript
// Same tests should pass
const component = render(<MyComponent />);
expect(component.getByText('Layer Name')).toBeInTheDocument();
// Plus any new tests for enhanced functionality
```

### 3. **Performance Testing**
```typescript
// Check that performance hasn't degraded
import { useRenderCount } from './test-utils';

const RenderCountTest = () => {
  const renderCount = useRenderCount();
  const { vtLayers } = useLayerStore(); // or domain store
  return <div>Rendered {renderCount} times</div>;
};
```

## 🎯 Examples

### Example 1: Layer Color Picker Component

**Legacy Approach (Still Works)**:
```typescript
import React from 'react';
import useLayerStore from '../stores/useLayerStore';

const LayerColorPicker: React.FC<{ layerIndex: number }> = ({ layerIndex }) => {
  const { vtLayers, setLayerColor } = useLayerStore();
  const layer = vtLayers[layerIndex];
  
  return (
    <input
      type="color"
      value={layer?.color?.getHexString ? `#${layer.color.getHexString()}` : '#ffffff'}
      onChange={(e) => setLayerColor(layerIndex, e.target.value)}
    />
  );
};
```

**Modern Approach (Recommended for New Components)**:
```typescript
import React from 'react';
import { useLayerStore } from '../domains';

const ModernLayerColorPicker: React.FC<{ layerIndex: number }> = ({ layerIndex }) => {
  const { vtLayers, setLayerColor } = useLayerStore();
  const layer = vtLayers[layerIndex];
  
  return (
    <input
      type="color"
      value={layer?.color || '#ffffff'}
      onChange={(e) => setLayerColor(layerIndex, e.target.value)}
    />
  );
};
```

### Example 2: Processing Status Component

**Legacy Approach**:
```typescript
import React from 'react';
import useLayerStore from '../stores/useLayerStore';

const ProcessingStatus: React.FC = () => {
  const { isProcessing, processingStatus, processingProgress } = useLayerStore();
  
  if (!isProcessing) return null;
  
  return (
    <div>
      <p>{processingStatus}</p>
      <progress value={processingProgress || 0} max={100} />
    </div>
  );
};
```

**Modern Approach**:
```typescript
import React from 'react';
import { useProcessingStore } from '../domains';

const ModernProcessingStatus: React.FC = () => {
  const { isProcessing, processingStatus, processingProgress } = useProcessingStore();
  
  if (!isProcessing) return null;
  
  return (
    <div>
      <p>{processingStatus}</p>
      <progress value={processingProgress || 0} max={100} />
    </div>
  );
};
```

## 🚀 Service Layer Integration

For complex business logic, use the new service layer:

```typescript
import React from 'react';
import { useProcessingStore, useGeometryStore } from '../domains';
import { ProcessingOrchestrator } from '../domains/processing/services/ProcessingOrchestrator';

const ModernGenerateButton: React.FC = () => {
  const { updateProgress, resetProcessing } = useProcessingStore();
  const { bbox, setGeometryDataSets } = useGeometryStore();
  
  const handleGenerate = async () => {
    const orchestrator = new ProcessingOrchestrator();
    
    await orchestrator.startProcessing(
      { geometry: { bbox, /* other config */ } },
      {
        onStart: () => console.log('Started'),
        onProgressUpdate: updateProgress,
        onComplete: (result) => {
          setGeometryDataSets(result.geometryDataSets);
          resetProcessing();
        },
        onError: (error) => console.error(error),
        onCancel: () => resetProcessing(),
      }
    );
  };
  
  return <button onClick={handleGenerate}>Generate</button>;
};
```

## 📈 Performance Considerations

### Benefits of Domain Stores:
- **Reduced re-renders**: Components only subscribe to relevant state
- **Better tree-shaking**: Unused domain logic can be eliminated
- **Cleaner dependencies**: Easier to track what affects what
- **Improved testing**: Test individual domains in isolation

### Compatibility Layer Impact:
- **Minimal overhead**: The compatibility layer is optimized
- **No performance regression**: Existing components perform the same
- **Gradual optimization**: Migrate high-frequency components first

## 🔗 Conclusion

The migration to domain-driven architecture is **optional and gradual**. All your existing code continues to work perfectly while providing a clear path for improvement.

**Recommended Approach**:
1. **Keep existing components as-is** if they're working well
2. **Use domain stores for new components** to establish good patterns
3. **Migrate selectively** only when adding new features or major refactoring
4. **Test thoroughly** and migrate incrementally

This approach minimizes risk while providing all the benefits of clean architecture for future development.