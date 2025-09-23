# GLB Mesh Export Utilities

This document describes the GLB export utility functions that can be used to export mesh data directly from WASM context to GLB format.

## Overview

The mesh export utilities provide functions to convert raw WASM mesh data to GLB format. These are primarily used for manual export functionality through the ExportButtons component, but can also be used programmatically when needed.

## Implementation

### Core Files

1. **`src/utils/meshExporter.ts`** - Main export utility functions
2. **`src/utils/meshExporter.test.ts`** - Validation and testing utilities
3. **`src/components/ExportButtons.tsx`** - Manual export functionality using these utilities

### Export Flow

```
WASM Mesh Generation → THREE.js Conversion → 3D Preview
                      ↓ (Manual Export)
                   GLB Export Utilities → Downloads Folder
```

### Key Functions

#### `exportWasmMeshAsGLB(meshData, options)`
- Core function that converts raw WASM mesh data to GLB format
- Creates THREE.js geometry from TypedArrays
- Uses GLTFExporter to generate binary GLB file
- Automatically triggers download

#### `exportTerrainMeshAsGLB(terrainResult)`
- Specialized function for terrain mesh export
- Extracts positions, indices, colors, normals from terrain result
- Generates filename with timestamp: `terrain_YYYY-MM-DDTHH-mm-ss.glb`

#### `exportLayerGeometryAsGLB(meshData, layerName)`
- Specialized function for layer geometry export
- Handles multiple geometries per layer
- Generates filename with timestamp: `{layerName}_YYYY-MM-DDTHH-mm-ss.glb`

## Manual Export Usage

The export utilities are designed to be called manually when needed. The primary integration is through the ExportButtons component, but they can also be used programmatically:

```typescript
import { exportWasmMeshAsGLB } from '../utils/meshExporter';

// Example: Export mesh data manually
const meshData = {
  positions: Float32Array,
  indices: Uint32Array,
  colors: Float32Array,
  normals: Float32Array
};

await exportWasmMeshAsGLB(meshData, {
  filename: 'my_mesh',
  autoDownload: true,
  meshName: 'CustomMesh'
});
```

## File Naming Convention

### Terrain Files
- Format: `terrain_YYYY-MM-DDTHH-mm-ss.glb`
- Example: `terrain_2024-01-15T14-30-45.glb`

### Layer Files
- Format: `{layerName}_YYYY-MM-DDTHH-mm-ss.glb`
- Example: `buildings_2024-01-15T14-30-46.glb`
- Multiple geometries: `{layerName}_geom{index}_YYYY-MM-DDTHH-mm-ss.glb`

## Features

### Automatic Download
- Files are automatically downloaded to the user's Downloads folder
- No user interaction required
- Non-blocking - export failures don't break the main mesh generation workflow

### Comprehensive Logging
- Console messages track export progress
- Success/failure logging for each export
- Final summary of all exported files

### Data Preservation
- Exports the exact mesh data as it comes from WASM
- Preserves vertex positions, indices, colors, and normals
- No modification or optimization applied

### Error Handling
- Export failures are caught and logged as warnings
- Main mesh generation workflow continues even if export fails
- Non-critical operation that doesn't affect the 3D preview

## Console Output Example

When using the export utilities manually:

```
✅ GLB export successful: TerrainMesh {
  vertices: 2134,
  triangles: 4156,
  hasColors: true,
  hasNormals: true,
  blobSize: 287456,
  filename: 'terrain_2024-01-15T14-30-45.glb'
}
```

## GLB File Format

The exported GLB files include:
- **Geometry**: Vertex positions, indices, normals
- **Materials**: Basic material with vertex colors (if available)
- **Lighting**: Ambient and directional lights for better visualization
- **Binary Format**: Efficient GLB format compatible with most 3D applications

## Testing

### Validation on Startup
- `validateExportFunctions()` runs on app initialization
- Verifies all export functions are properly structured
- Available in browser console as `window.validateMeshExporter()`

### Demo Function
- `demoExport()` available in browser console as `window.demoMeshExport()`
- Exports a simple test triangle to verify functionality

## Benefits

1. **Immediate Access**: Get GLB files right after mesh generation
2. **Data Integrity**: Raw WASM data preserved without modification
3. **No Manual Export**: Fully automatic, no user interaction needed
4. **Non-Disruptive**: Doesn't interfere with the 3D preview workflow
5. **Multiple Formats**: Both terrain and layer geometries are exported
6. **Debugging Aid**: Useful for inspecting generated meshes in external tools

## Supported Applications

The exported GLB files can be opened in:
- Blender
- 3D viewers (Windows 3D Viewer, macOS Preview)
- Web browsers
- Game engines (Unity, Unreal Engine)
- CAD applications
- 3D printing slicers

## Future Enhancements

Potential improvements could include:
- Optional export toggle in UI
- Custom export location selection
- Batch export compression
- Export format selection (OBJ, STL, etc.)
- Metadata inclusion in GLB files