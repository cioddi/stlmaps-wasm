// Test file for meshExporter utility
// This is a simple validation test to ensure the export functions are properly structured

import {
  exportWasmMeshAsGLB,
  exportTerrainMeshAsGLB,
  exportLayerGeometryAsGLB,
  type WasmMeshData
} from './meshExporter';

// Mock test data for a simple triangle
const createTestMeshData = (): WasmMeshData => {
  // Simple triangle mesh
  const positions = new Float32Array([
    0, 0, 0,    // vertex 0
    1, 0, 0,    // vertex 1
    0.5, 1, 0   // vertex 2
  ]);

  const indices = new Uint32Array([
    0, 1, 2   // triangle indices
  ]);

  const colors = new Float32Array([
    1, 0, 0,   // red
    0, 1, 0,   // green
    0, 0, 1    // blue
  ]);

  const normals = new Float32Array([
    0, 0, 1,   // normal pointing up
    0, 0, 1,
    0, 0, 1
  ]);

  return {
    positions,
    indices,
    colors,
    normals
  };
};

// Test terrain mesh export structure
const createTestTerrainResult = () => {
  const meshData = createTestMeshData();
  return {
    positions: meshData.positions,
    indices: meshData.indices,
    colors: meshData.colors,
    normals: meshData.normals,
    processedElevationGrid: [[0, 1], [1, 2]],
    processedMinElevation: 0,
    processedMaxElevation: 2,
    originalMinElevation: 0,
    originalMaxElevation: 2
  };
};

// Validation tests (not actual Jest tests, just structure validation)
export const validateExportFunctions = () => {
  const testMeshData = createTestMeshData();
  const testTerrainResult = createTestTerrainResult();

  console.log('🧪 Validating mesh export functions...');

  // Validate WasmMeshData structure
  if (!testMeshData.positions || !testMeshData.indices) {
    throw new Error('Invalid test mesh data structure');
  }

  // Validate function signatures exist
  if (typeof exportWasmMeshAsGLB !== 'function') {
    throw new Error('exportWasmMeshAsGLB function not found');
  }

  if (typeof exportTerrainMeshAsGLB !== 'function') {
    throw new Error('exportTerrainMeshAsGLB function not found');
  }

  if (typeof exportLayerGeometryAsGLB !== 'function') {
    throw new Error('exportLayerGeometryAsGLB function not found');
  }

  console.log('✅ All export functions are properly structured');

  // Test data validation
  console.log('Test mesh data:', {
    vertices: testMeshData.positions.length / 3,
    triangles: testMeshData.indices.length / 3,
    hasColors: !!testMeshData.colors,
    hasNormals: !!testMeshData.normals
  });

  return true;
};

// Simple demo function that could be called in browser console
export const demoExport = async () => {
  const testMeshData = createTestMeshData();

  try {
    console.log('🚀 Demo: Exporting test triangle as GLB...');

    const result = await exportWasmMeshAsGLB(testMeshData, {
      filename: 'test_triangle',
      autoDownload: false, // Don't auto-download in demo
      meshName: 'TestTriangle'
    });

    console.log('✅ Demo export successful:', {
      blobSize: result.blob.size,
      url: result.url
    });

    return result;
  } catch (error) {
    console.error('❌ Demo export failed:', error);
    throw error;
  }
};

// Export the validation function to be run during app initialization if needed
if (typeof window !== 'undefined') {
  // Make validation available in browser console for debugging
  (window as any).validateMeshExporter = validateExportFunctions;
  (window as any).demoMeshExport = demoExport;
}