import * as THREE from "three";
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export interface WasmMeshData {
  positions: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array;
  normals?: Float32Array;
}

export interface MeshExportOptions {
  filename?: string;
  autoDownload?: boolean;
  meshName?: string;
}

/**
 * Export raw WASM mesh data as GLB file
 * This function takes mesh data directly from WASM context and exports it as GLB
 * before it gets converted to THREE.js geometry for the 3D preview
 */
export async function exportWasmMeshAsGLB(
  meshData: WasmMeshData,
  options: MeshExportOptions = {}
): Promise<{ blob: Blob; url: string }> {
  const {
    filename = 'mesh_export',
    autoDownload = true,
    meshName = 'GeneratedMesh'
  } = options;

  try {
    // Create THREE.js geometry from WASM data
    const geometry = new THREE.BufferGeometry();

    // Set position attribute
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));

    // Set indices
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

    // Set color attribute if available
    if (meshData.colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    }

    // Set normal attribute if available, otherwise compute them
    if (meshData.normals) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }

    // Create material - use vertex colors if available
    const material = new THREE.MeshStandardMaterial({
      vertexColors: meshData.colors ? true : false,
      color: meshData.colors ? 0xffffff : 0x808080,
      roughness: 0.8,
      metalness: 0.1
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = meshName;

    // Create scene for export
    const scene = new THREE.Scene();
    scene.add(mesh);

    // Add basic lighting for better visualization
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(ambientLight);
    scene.add(directionalLight);

    // Export as GLB
    const exporter = new GLTFExporter();

    return new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        (gltf) => {
          try {
            // Create blob from binary GLB data
            const blob = new Blob([gltf as ArrayBuffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);

            console.log(`✅ GLB export successful: ${meshName}`, {
              vertices: meshData.positions.length / 3,
              triangles: meshData.indices.length / 3,
              hasColors: !!meshData.colors,
              hasNormals: !!meshData.normals,
              blobSize: blob.size,
              filename: autoDownload ? `${filename}.glb` : 'not downloaded'
            });

            // Auto-download if requested
            if (autoDownload) {
              downloadBlob(blob, `${filename}.glb`);
            }

            resolve({ blob, url });
          } catch (error) {
            
            reject(error);
          }
        },
        (error) => {
          
          reject(error);
        },
        {
          binary: true, // Export as GLB (binary format)
          onlyVisible: true,
          truncateDrawRange: true,
          animations: [],
          includeCustomExtensions: false
        }
      );
    });

  } catch (error) {
    
    throw error;
  }
}

/**
 * Export terrain mesh data from WASM as GLB
 */
export async function exportTerrainMeshAsGLB(terrainResult: any): Promise<{ blob: Blob; url: string }> {
  const meshData: WasmMeshData = {
    positions: terrainResult.positions,
    indices: terrainResult.indices,
    colors: terrainResult.colors,
    normals: terrainResult.normals
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `terrain_${timestamp}`;

  return exportWasmMeshAsGLB(meshData, {
    filename,
    autoDownload: true,
    meshName: 'TerrainMesh'
  });
}

/**
 * Export layer geometry from WASM as GLB
 */
export async function exportLayerGeometryAsGLB(
  meshData: WasmMeshData,
  layerName: string = 'layer'
): Promise<{ blob: Blob; url: string }> {
  // Validate that we have the minimum required data
  if (!meshData.positions || !meshData.indices) {
    throw new Error(`Invalid layer geometry data for ${layerName}: missing positions or indices`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${layerName}_${timestamp}`;

  return exportWasmMeshAsGLB(meshData, {
    filename,
    autoDownload: true,
    meshName: `${layerName}Mesh`
  });
}

/**
 * Helper function to trigger download of a blob
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL after a short delay
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Batch export multiple meshes as separate GLB files
 */
export async function batchExportMeshesAsGLB(
  meshes: Array<{ data: WasmMeshData; name: string }>
): Promise<Array<{ blob: Blob; url: string; name: string }>> {
  const results = [];

  for (const { data, name } of meshes) {
    try {
      const result = await exportWasmMeshAsGLB(data, {
        filename: name,
        autoDownload: false, // Don't auto-download for batch operations
        meshName: name
      });
      results.push({ ...result, name });
    } catch (error) {
      
    }
  }

  return results;
}