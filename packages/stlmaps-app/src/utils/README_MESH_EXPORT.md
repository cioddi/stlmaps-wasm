# Automatic GLB Mesh Export

This document describes the automatic GLB export functionality that exports each mesh immediately after it's generated from the WASM context, before it's added to the 3D preview.

## Overview

Every time a mesh is created (terrain or layer geometry), it is automatically exported as a GLB file and downloaded to the user's Downloads folder. This happens transparently without user intervention and doesn't affect the normal 3D preview workflow.

## Implementation

### Core Files

1. **`src/utils/meshExporter.ts`** - Main export utility functions
2. **`src/hooks/useGenerateMesh.ts`** - Integration points for automatic export
3. **`src/utils/meshExporter.test.ts`** - Validation and testing utilities

### Export Flow

```
WASM Mesh Generation → Automatic GLB Export → THREE.js Conversion → 3D Preview
                      ↓
                   Downloads Folder
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

## Integration Points

### Terrain Export
Location: `useGenerateMesh.ts:627-635`
```typescript
const wasmTerrainResult = await wasmModule.create_terrain_geometry(terrainParams);

// Automatically export terrain mesh as GLB right after WASM generation
try {
  console.log('🚀 Automatically exporting terrain mesh as GLB...');
  await exportTerrainMeshAsGLB(wasmTerrainResult);
  console.log('✅ Terrain GLB export completed successfully');
} catch (exportError) {
  console.warn('⚠️ Terrain GLB export failed (non-critical):', exportError);
}
```

### Layer Export
Location: `useGenerateMesh.ts:238-263` (parallel) and `useGenerateMesh.ts:419-444` (sequential)
```typescript
// Automatically export layer geometries as GLB right after WASM generation
for (let geomIndex = 0; geomIndex < workerResult.geometries.length; geomIndex++) {
  const processedGeom = workerResult.geometries[geomIndex];

  if (processedGeom.hasData && processedGeom.vertices && processedGeom.vertices.length > 0) {
    const layerGeomData = {
      positions: processedGeom.vertices,
      indices: processedGeom.indices,
      colors: processedGeom.colors,
      normals: processedGeom.normals
    };

    await exportLayerGeometryAsGLB(layerGeomData, layer.label);
  }
}
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

```
🚀 Automatically exporting terrain mesh as GLB...
✅ GLB export successful: TerrainMesh {
  vertices: 2134,
  triangles: 4156,
  hasColors: true,
  hasNormals: true,
  blobSize: 287456,
  filename: 'terrain_2024-01-15T14-30-45.glb'
}
✅ Terrain GLB export completed successfully

🚀 Automatically exporting layer "buildings" geometries as GLB...
✅ GLB export successful: buildingsMesh {
  vertices: 8924,
  triangles: 15632,
  hasColors: true,
  hasNormals: true,
  blobSize: 1204576,
  filename: 'buildings_2024-01-15T14-30-46.glb'
}
✅ Layer "buildings" GLB export completed successfully

🎯 Mesh generation completed! Automatically exported 2 GLB files:
  ✅ Terrain mesh (2134 vertices)
  ✅ buildings layer (8924 vertices)
📂 Check your Downloads folder for the GLB files!
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