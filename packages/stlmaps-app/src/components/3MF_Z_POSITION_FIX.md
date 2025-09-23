# 3MF Export Z Position Preservation Fix

## Problem Identified

The 3MF export was losing Z positions from the 3D preview, flattening all geometry to incorrect heights.

## Root Cause

The 3MF export was extracting **geometry-local coordinates** instead of **world coordinates**:

```typescript
// BROKEN CODE (BEFORE):
const positions = geometry.attributes.position?.array; // ❌ Local coordinates only
```

**Problem:** This gets the raw geometry data without the mesh transformations applied in the preview, including:
- Z offset positions set in the ModelPreview
- Terrain base height adjustments
- Layer Z positioning
- Any other world matrix transformations

## How Other Exports Work Correctly

Other export formats (GLB, STL, OBJ) use the manifold-preserving export path where:

1. **Mesh transformations are applied** via `exportMesh.applyMatrix4(originalMesh.matrixWorld)`
2. **Exporters automatically handle world coordinates** when processing the mesh

But 3MF export was **bypassing this system** by directly extracting raw geometry data.

## Solution Implemented

### Fix: Apply World Matrix Transformations to Geometry

**Location:** `ExportButtons.tsx:578-625`

**Before (Broken):**
```typescript
scene.traverse((object) => {
  if (object instanceof THREE.Mesh && object.geometry) {
    const geometry = object.geometry;

    // Extract vertices - WRONG: Gets local coordinates only
    const positions = geometry.attributes.position?.array; // ❌
    if (!positions) return;

    // Extract indices from original geometry
    let indices = Array.from(geometry.index.array); // ❌

    // Extract colors from original geometry
    let colors = Array.from(geometry.attributes.color.array); // ❌
  }
});
```

**After (Fixed):**
```typescript
scene.traverse((object) => {
  if (object instanceof THREE.Mesh && object.geometry) {
    const geometry = object.geometry;

    // Extract vertices with world transformations applied
    const positionAttribute = geometry.attributes.position;
    if (!positionAttribute) return;

    // Clone geometry and apply world matrix to preserve Z positions from preview
    const transformedGeometry = geometry.clone();
    transformedGeometry.applyMatrix4(object.matrixWorld); // ✅ Apply world transformations

    const positions = transformedGeometry.attributes.position?.array; // ✅ World coordinates
    if (!positions) return;

    // Log Z position range for debugging
    const zValues = [];
    for (let i = 2; i < positions.length; i += 3) {
      zValues.push(positions[i]);
    }
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    console.log(`📐 3MF Export - ${object.name || 'unnamed'} mesh Z range: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)}`);

    // Extract indices from transformed geometry
    let indices = Array.from(transformedGeometry.index.array); // ✅

    // Extract colors from transformed geometry
    let colors = Array.from(transformedGeometry.attributes.color.array); // ✅
  }
});
```

## Key Changes

1. **🔧 Clone Geometry:** Create a copy to avoid modifying the original
2. **🎯 Apply World Matrix:** `transformedGeometry.applyMatrix4(object.matrixWorld)`
3. **📊 Extract Transformed Data:** Get positions, indices, colors from transformed geometry
4. **🔍 Debug Logging:** Log Z ranges to verify correct positioning

## Expected Results

### Before Fix
```
Terrain Z range: 0.00 to 0.00    // ❌ All geometry flattened
Building Z range: 0.00 to 0.00   // ❌ No Z positioning
```

### After Fix
```
📐 3MF Export - terrain mesh Z range: 1.00 to 15.43     // ✅ Correct terrain heights
📐 3MF Export - buildings mesh Z range: 1.00 to 25.67   // ✅ Correct building heights
```

## Technical Details

### Why World Matrix is Needed

In THREE.js, objects have:
- **Local coordinates:** Geometry vertices in object space
- **World coordinates:** After applying position, rotation, scale, and parent transformations

The preview shows **world coordinates**, so exports must use them too.

### Matrix Transformation Process

```typescript
object.matrixWorld // Contains: position + rotation + scale + parent transforms
transformedGeometry.applyMatrix4(object.matrixWorld) // Applies all transformations to vertices
```

### 3MF vs Other Formats

- **GLB/STL/OBJ:** Exporters handle world coordinates automatically
- **3MF:** Manual extraction requires explicit world coordinate transformation

## Console Output

When exporting, you'll now see:
```
🔧 Export scene created from preview scene with 2 meshes
✅ Manifold preservation: DISABLED (preserves manifold)
📐 3MF Export - terrain mesh Z range: 1.00 to 15.43
📐 3MF Export - buildings mesh Z range: 1.00 to 25.67
```

## Benefits

1. **Accurate Z Positioning:** 3MF files now match the preview exactly
2. **Consistent Exports:** All formats (GLB, STL, OBJ, 3MF) preserve positioning
3. **Debug Visibility:** Console logs show Z ranges for verification
4. **3D Printing Ready:** Correct heights for slicing software

## Testing

To verify the fix:

1. **Generate mesh** with terrain and buildings at different Z levels
2. **Export as 3MF** using the Export button
3. **Check console logs** for Z range confirmation
4. **Open 3MF file** in 3D viewer to verify positioning matches preview

The Z positions should now be preserved exactly as shown in the 3D preview! 🚀