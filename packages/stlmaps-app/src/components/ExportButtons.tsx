import { useState, useEffect } from "react";
import { 
  Button, 
  Box, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Typography, 
  Paper, 
  Grid2 as Grid, 
  Chip, 
  useTheme,
  IconButton,
  useMediaQuery
} from "@mui/material";
import * as THREE from "three";
import { useAppStore } from "../stores/useAppStore";
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { getWasmModule } from "@threegis/core";
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ModelTrainingIcon from '@mui/icons-material/ModelTraining';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import ThreeDRotationIcon from '@mui/icons-material/ThreeDRotation';

interface ExportFormat {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  fileExtension: string;
}

const ExportButtons: React.FC = () => {
  // Get geometry data and scene directly from the Zustand store
  const { geometryDataSets, vtLayers, terrainSettings, sceneGetter: getCurrentScene } = useAppStore();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  
  // State for dialog
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  
  // Downloads are now handled immediately in export functions
  
  // State for loading indicators
  const [loading, setLoading] = useState<{obj: boolean, stl: boolean, gltf: boolean, threemf: boolean}>({
    obj: false,
    stl: false,
    gltf: false,
    threemf: false
  });
  
  // Define export formats with their metadata
  const exportFormats: ExportFormat[] = [
    {
      id: 'stl',
      name: 'STL',
      description: '3D printing industry standard format. Ideal for 3D printing and CNC manufacturing.',
      icon: <ModelTrainingIcon fontSize="small" />,
      fileExtension: 'stl'
    },
    {
      id: 'glb',
      name: 'glTF/GLB',
      description: 'Separate geometries for each layer. Best for multi-color-FDM, web and game engines.',
      icon: <ThreeDRotationIcon fontSize="small" />,
      fileExtension: 'glb'
    },
    {
      id: 'obj',
      name: 'Wavefront OBJ',
      description: 'Standard 3D file format supported by most 3D applications. Good for general-purpose 3D models.',
      icon: <ScatterPlotIcon fontSize="small" />,
      fileExtension: 'obj'
    },
    {
      id: '3mf',
      name: '3MF',
      description: 'Microsoft 3D Manufacturing Format. Optimized for 3D printing with support for materials and textures.',
      icon: <ModelTrainingIcon fontSize="small" />,
      fileExtension: '3mf'
    },
  ];

  // No cleanup needed - URLs are revoked immediately after downloads

  // Helper function to validate and fix geometry indices
  const validateGeometry = (geometry: THREE.BufferGeometry): THREE.BufferGeometry => {
    if (!geometry) return geometry;
    
    // Create a clone to avoid modifying the original
    const validatedGeometry = geometry.clone();
    
    // If no position attribute, we can't validate
    if (!validatedGeometry.attributes.position) return validatedGeometry;
    
    const positionCount = validatedGeometry.attributes.position.count;
    
    // Check if we have an index buffer that needs validation
    if (validatedGeometry.index) {
      const indices = validatedGeometry.index.array;
      let maxIndex = 0;
      let hasInvalidIndex = false;
      
      // Check for out-of-bounds indices
      for (let i = 0; i < indices.length; i++) {
        maxIndex = Math.max(maxIndex, indices[i]);
        if (indices[i] >= positionCount) {
          hasInvalidIndex = true;
          break;
        }
      }
      
      // If indices are out of bounds, remove them and let Three.js create valid ones
      if (hasInvalidIndex || maxIndex >= positionCount) {
        validatedGeometry.setIndex(null);
      }
    }
    
    // Ensure all attribute arrays have the same count
    const attributeNames = Object.keys(validatedGeometry.attributes);
    for (const name of attributeNames) {
      if (name === 'position') continue; // Skip position as it's our reference
      
      const attribute = validatedGeometry.attributes[name];
      if (attribute.count !== positionCount) {
        console.warn(`Fixing mismatched attribute count for ${name}: ${attribute.count} vs position ${positionCount}`);
        // Remove problematic attributes
        validatedGeometry.deleteAttribute(name);
      }
    }
    
    // PRESERVE MANIFOLD: Keep indexed geometry to maintain manifold topology
    // toNonIndexed() destroys manifold property by duplicating vertices
    // Indexed geometry is actually better for manifold preservation
    
    return validatedGeometry;
  };

  // Create a scene using the same positioning logic as ModelPreview
  const createExportScene = (validateGeometries = false): THREE.Scene => {
    const exportScene = new THREE.Scene();

    const currentScene = typeof getCurrentScene === 'function' ? getCurrentScene() : null;
    if (currentScene) {
      currentScene.updateMatrixWorld(true);

      const meshesToExport: THREE.Mesh[] = [];
      currentScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const geometry = object.geometry;
          const positionAttribute = geometry?.attributes?.position as THREE.BufferAttribute | undefined;
          if (!object.visible || !geometry || !positionAttribute || positionAttribute.count === 0) {
            return;
          }
          if (object.name === 'terrain' && !terrainSettings.enabled) {
            return;
          }
          meshesToExport.push(object);
        }
      });

      if (meshesToExport.length > 0) {
        const extractMaterialColor = (material: THREE.Material | THREE.Material[] | undefined): THREE.Color => {
          if (!material) {
            return new THREE.Color('#ffffff');
          }
          if (Array.isArray(material)) {
            for (const mat of material) {
              if (mat && 'color' in mat) {
                const typed = mat as THREE.Material & { color?: THREE.Color };
                if (typed.color instanceof THREE.Color) {
                  return typed.color.clone();
                }
              }
            }
            return new THREE.Color('#ffffff');
          }
          const typed = material as THREE.Material & { color?: THREE.Color };
          if (typed.color instanceof THREE.Color) {
            return typed.color.clone();
          }
          return new THREE.Color('#ffffff');
        };

        const analyzeWatertightness = (geometry: THREE.BufferGeometry) => {
          const index = geometry.getIndex();
          const hasPositionAttribute = !!geometry.getAttribute('position');
          if (!index || !hasPositionAttribute) {
            return null;
          }

          const indexArray = Array.from(index.array as ArrayLike<number>);
          if (indexArray.length % 3 !== 0) {
            return {
              triangles: Math.floor(indexArray.length / 3),
              boundaryEdges: -1,
              reason: 'index length not divisible by 3'
            };
          }

          const edgeCounts = new Map<string, number>();
          for (let i = 0; i < indexArray.length; i += 3) {
            const tri = [indexArray[i], indexArray[i + 1], indexArray[i + 2]];
            for (let e = 0; e < 3; e++) {
              const a = tri[e];
              const b = tri[(e + 1) % 3];
              const key = a < b ? `${a}_${b}` : `${b}_${a}`;
              edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
            }
          }

          let boundaryEdgeCount = 0;
          edgeCounts.forEach((count) => {
            if (count !== 2) boundaryEdgeCount++;
          });

          return {
            triangles: indexArray.length / 3,
            boundaryEdges: boundaryEdgeCount,
            reason: boundaryEdgeCount === 0 ? undefined : 'non-manifold edge usage'
          };
        };

        meshesToExport.forEach((originalMesh) => {
          const watertightInfo = analyzeWatertightness(originalMesh.geometry);
          if (watertightInfo && watertightInfo.boundaryEdges > 0) {
            console.warn('🚧 Non-watertight geometry detected before export', {
              meshName: originalMesh.name,
              boundaryEdges: watertightInfo.boundaryEdges,
              triangles: watertightInfo.triangles,
              reason: watertightInfo.reason,
            });
          }

          // MANIFOLD PRESERVATION: Avoid transformations that break topology
          let preparedGeometry: THREE.BufferGeometry;

          if (validateGeometries) {
            // Only minimal validation when needed - avoid toNonIndexed()
            const clonedGeometry = originalMesh.geometry.clone();
            clonedGeometry.applyMatrix4(originalMesh.matrixWorld);
            preparedGeometry = validateGeometry(clonedGeometry);
          } else {
            // PRESERVE MANIFOLD: Use original geometry directly without cloning/transforming
            // Apply world matrix to mesh instead of geometry to preserve topology
            preparedGeometry = originalMesh.geometry;
          }

          const usesVertexColors = !!preparedGeometry.getAttribute('color');
          const baseColor = extractMaterialColor(originalMesh.material);

          const exportMaterial = new THREE.MeshLambertMaterial({
            color: baseColor,
            vertexColors: usesVertexColors,
            flatShading: true,
            side: THREE.FrontSide // Use FrontSide instead of DoubleSide for proper manifold
          });

          const exportMesh = new THREE.Mesh(preparedGeometry, exportMaterial);
          exportMesh.name = originalMesh.name;

          // Apply transformations to mesh instead of geometry to preserve topology
          if (!validateGeometries) {
            exportMesh.applyMatrix4(originalMesh.matrixWorld);
          }

          exportScene.add(exportMesh);
        });

        console.log(`🔧 Export scene created from preview scene with ${meshesToExport.length} meshes`);
        console.log(`✅ Manifold preservation: ${validateGeometries ? 'VALIDATION ENABLED (may break manifold)' : 'DISABLED (preserves manifold)'}`);
        return exportScene;
      }

      console.warn('Export scene fallback: no meshes found in current preview scene, reconstructing manually');
    }

    // Helper to check if geometry is valid for export
    const isValidGeometry = (geometry: THREE.BufferGeometry) => {
      return (
        geometry &&
        geometry.isBufferGeometry &&
        geometry.attributes &&
        geometry.attributes.position &&
        geometry.attributes.position.count > 0
      );
    };

    console.log("Creating export scene with ModelPreview positioning logic");
    console.log("Export context values:", {
      terrainBaseHeight: terrainSettings.baseHeight,
      terrainEnabled: terrainSettings.enabled,
      vtLayers: vtLayers.map(layer => ({
        sourceLayer: layer.sourceLayer,
        label: layer.label,
        zOffset: layer.zOffset,
        heightScaleFactor: layer.heightScaleFactor,
        enabled: layer.enabled,
        color: layer.color
      }))
    });

    // Add terrain if enabled (exactly like ModelPreview)
    if (geometryDataSets.terrainGeometry && terrainSettings.enabled) {
      const terrainMaterial = new THREE.MeshLambertMaterial({
        vertexColors: terrainSettings.color ? false : true,
        flatShading: true,
        side: THREE.FrontSide // Use FrontSide to preserve manifold topology
      });

      if (terrainSettings.color) {
        const terrainColor = new THREE.Color(terrainSettings.color);
        terrainMaterial.color = terrainColor.clone();
      }

      const geometryMesh = new THREE.Mesh(
        validateGeometries ? validateGeometry(geometryDataSets.terrainGeometry) : geometryDataSets.terrainGeometry,
        terrainMaterial
      );
      geometryMesh.name = 'terrain';
      geometryMesh.position.z = 0; // Terrain always at Z=0
      exportScene.add(geometryMesh);
    }

    // Add polygon geometries (exactly like ModelPreview positioning)
    if (geometryDataSets.polygonGeometries && geometryDataSets.polygonGeometries.length > 0) {
      geometryDataSets.polygonGeometries.forEach(({geometry, ...vtDataset}) => {
        if (!geometry) return;

        // Look up current layer configuration
        const currentLayerConfig = vtLayers.find(layer => layer.label === vtDataset.label);
        const isCurrentlyEnabled = currentLayerConfig?.enabled !== false;

        if (!isCurrentlyEnabled) return; // Skip disabled layers

        // Handle container geometries with individual parts
        if (geometry.userData?.isContainer && geometry.userData?.individualGeometries) {
          const individualGeometries = geometry.userData.individualGeometries as THREE.BufferGeometry[];

          individualGeometries.forEach((individualGeometry, index) => {
            if (!individualGeometry.attributes.position || individualGeometry.attributes.position.count === 0) {
              return;
            }

            const layerColor = currentLayerConfig?.color || "#81ecec";
            const baseColor = new THREE.Color(layerColor);

            const polygonMaterial = new THREE.MeshLambertMaterial({
              flatShading: true,
              side: THREE.DoubleSide
            });
            polygonMaterial.color = baseColor.clone();

            // Clone geometry to avoid modifying original
            const clonedGeometry = validateGeometries ? validateGeometry(individualGeometry.clone()) : individualGeometry.clone();

            // Adjust geometry origin to bottom (like ModelPreview)
            if (!clonedGeometry.boundingBox) {
              clonedGeometry.computeBoundingBox();
            }
            if (clonedGeometry.boundingBox) {
              const originalBottomZ = clonedGeometry.boundingBox.min.z;
              clonedGeometry.translate(0, 0, -originalBottomZ);
            }

            const polygonMesh = new THREE.Mesh(clonedGeometry, polygonMaterial);

            // Apply transforms directly to geometry vertices for export compatibility
            const layerZOffset = currentLayerConfig?.zOffset || 0;
            const layerHeightScaleFactor = currentLayerConfig?.heightScaleFactor || 1;

            // Apply height scaling to geometry
            clonedGeometry.scale(1, 1, layerHeightScaleFactor);

            // Apply z-positioning to geometry
            const finalZPosition = terrainSettings.baseHeight + layerZOffset;
            clonedGeometry.translate(0, 0, finalZPosition);

            console.log(`🏗️ EXPORT Individual mesh positioning (applied to geometry):`, {
              sourceLayer: vtDataset.sourceLayer,
              terrainBaseHeight: terrainSettings.baseHeight,
              layerZOffset: layerZOffset,
              layerHeightScaleFactor: layerHeightScaleFactor,
              finalZPosition: finalZPosition,
              calculation: `${terrainSettings.baseHeight} + ${layerZOffset} = ${finalZPosition}`
            });

            polygonMesh.name = `${vtDataset.sourceLayer}_${index}`;
            polygonMesh.userData = {
              sourceLayer: vtDataset.sourceLayer,
              label: vtDataset.label || vtDataset.sourceLayer
            };

            exportScene.add(polygonMesh);
          });
        } else if (isValidGeometry(geometry)) {
          // Single geometry processing (like ModelPreview)
          const layerColor = currentLayerConfig?.color || "#81ecec";
          const baseColor = new THREE.Color(layerColor);

          const polygonMaterial = new THREE.MeshLambertMaterial({
            flatShading: true,
            side: THREE.DoubleSide
          });
          polygonMaterial.color = baseColor.clone();

          // Clone geometry to avoid modifying original
          const clonedGeometry = validateGeometries ? validateGeometry(geometry.clone()) : geometry.clone();

          // Adjust geometry origin to bottom (like ModelPreview)
          if (!clonedGeometry.boundingBox) {
            clonedGeometry.computeBoundingBox();
          }
          if (clonedGeometry.boundingBox) {
            const originalBottomZ = clonedGeometry.boundingBox.min.z;
            clonedGeometry.translate(0, 0, -originalBottomZ);
          }

          const polygonMesh = new THREE.Mesh(clonedGeometry, polygonMaterial);

          // Apply transforms directly to geometry vertices for export compatibility
          const layerZOffset = currentLayerConfig?.zOffset || 0;
          const layerHeightScaleFactor = currentLayerConfig?.heightScaleFactor || 1;

          // Apply height scaling to geometry
          clonedGeometry.scale(1, 1, layerHeightScaleFactor);

          // Apply z-positioning to geometry
          const finalZPosition = terrainSettings.baseHeight + layerZOffset;
          clonedGeometry.translate(0, 0, finalZPosition);

          console.log(`🏗️ EXPORT Single mesh positioning (applied to geometry):`, {
            sourceLayer: vtDataset.sourceLayer,
            terrainBaseHeight: terrainSettings.baseHeight,
            layerZOffset: layerZOffset,
            layerHeightScaleFactor: layerHeightScaleFactor,
            finalZPosition: finalZPosition,
            calculation: `${terrainSettings.baseHeight} + ${layerZOffset} = ${finalZPosition}`
          });

          polygonMesh.name = vtDataset.sourceLayer;
          polygonMesh.userData = {
            sourceLayer: vtDataset.sourceLayer,
            label: vtDataset.label || vtDataset.sourceLayer
          };

          exportScene.add(polygonMesh);
        }
      });
    }

    console.log(`Export scene created with ${exportScene.children.length} meshes using ModelPreview positioning`);
    return exportScene;
  };

  
  const generateOBJFile = (): void => {
    if (!geometryDataSets.terrainGeometry) return;
    
    try {
      // Create scene without validation to preserve manifold geometry
      const scene = createExportScene(false);
      
      // Create OBJ exporter and export the scene
      const exporter = new OBJExporter();
      const objString = exporter.parse(scene);
      
      // Create downloadable Blob and URL
      const blob = new Blob([objString], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      // Trigger immediate download
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.obj';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up URL
      URL.revokeObjectURL(url);

      console.log("OBJ file generated and downloaded successfully");
    } catch (error) {
      console.error("Error generating OBJ file:", error);
    } finally {
      setLoading(prev => ({ ...prev, obj: false }));
    }
  };
  
  const generateSTLFile = (): void => {
    if (!geometryDataSets.terrainGeometry) return;
    
    try {
      // Create scene without validation to preserve manifold geometry
      const scene = createExportScene(false);
      
      // Create STL exporter and export the scene (binary format for smaller file size)
      const exporter = new STLExporter();
      const stlString = exporter.parse(scene, { binary: true });
      
      // Create downloadable Blob and URL
      const blob = new Blob([stlString], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      
      // Trigger immediate download
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.stl';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up URL
      URL.revokeObjectURL(url);

      console.log("STL file generated and downloaded successfully");
    } catch (error) {
      console.error("Error generating STL file:", error);
    } finally {
      setLoading(prev => ({ ...prev, stl: false }));
    }
  };
  
  const generateGLTFFile = (): void => {
    if (!geometryDataSets.terrainGeometry) return;
    
    try {
      // Create scene without validation to preserve manifold geometry
      const scene = createExportScene(false);
      
      // Create GLTF exporter with binary option for better compatibility
      const exporter = new GLTFExporter();
      exporter.parse(
        scene,
        (gltf) => {
          // Create downloadable Blob with appropriate type
          let blob;
          
          // Check if the export is binary (GLB) or JSON (GLTF)
          if (gltf instanceof ArrayBuffer) {
            blob = new Blob([gltf], { type: 'application/octet-stream' });
          } else {
            blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
          }
          
          const url = URL.createObjectURL(blob);

          // Trigger immediate download
          const a = document.createElement('a');
          a.href = url;
          a.download = 'model.glb';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // Clean up URL
          URL.revokeObjectURL(url);

          console.log("GLTF/GLB file generated and downloaded successfully");

          // Update loading state when complete
          setLoading(prev => ({ ...prev, gltf: false }));
        },
        (error) => {
          console.error("Error during GLTF export:", error);
          setLoading(prev => ({ ...prev, gltf: false }));
        },
        { 
          binary: true, // Use binary GLB format for better compatibility
          onlyVisible: true,
          truncateDrawRange: true, // Ensure proper buffer lengths
          animations: []
        }
      );
    } catch (error) {
      console.error("Error generating GLTF file:", error);
      setLoading(prev => ({ ...prev, gltf: false }));
    }
  };

  const generate3MFFile = async (): Promise<void> => {
    if (!geometryDataSets.terrainGeometry) return;
    
    try {
      setLoading(prev => ({ ...prev, threemf: true }));
      
      // Use GLB scene but extract individual objects for 3MF
      const scene = createExportScene(false);
      const meshes: any[] = [];

      // Extract individual objects from the positioned GLB scene
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && object.geometry) {
          console.log(`🎯 3MF Export - Object "${object.name || 'unnamed'}" position: x=${object.position.x.toFixed(2)}, y=${object.position.y.toFixed(2)}, z=${object.position.z.toFixed(2)}`);
          console.log(`🎯 3MF Export - Object "${object.name || 'unnamed'}" scale: x=${object.scale.x.toFixed(2)}, y=${object.scale.y.toFixed(2)}, z=${object.scale.z.toFixed(2)}`);

          const geometry = object.geometry;

          // Extract vertices from positioned geometry (already correctly transformed by createExportScene)
          const positionAttribute = geometry.attributes.position;
          if (!positionAttribute) return;

          const positions = positionAttribute.array;
          if (!positions) return;

          // Log Z position range for debugging
          const zValues = [];
          for (let i = 2; i < positions.length; i += 3) {
            zValues.push(positions[i]);
          }
          const minZ = Math.min(...zValues);
          const maxZ = Math.max(...zValues);
          console.log(`📐 3MF Export - ${object.name || 'unnamed'} positioned Z range: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)}`);

          // Sample first few vertices to see actual coordinates
          console.log(`🔍 3MF Export - ${object.name || 'unnamed'} sample vertices:`);
          for (let i = 0; i < Math.min(15, positions.length); i += 3) {
            console.log(`  Vertex ${i/3}: X=${positions[i].toFixed(2)}, Y=${positions[i+1].toFixed(2)}, Z=${positions[i+2].toFixed(2)}`);
          }

          // Extract indices
          let indices: number[] = [];
          if (geometry.index) {
            indices = Array.from(geometry.index.array);
          } else {
            // Generate sequential indices for non-indexed geometry
            for (let i = 0; i < positions.length / 3; i++) {
              indices.push(i);
            }
          }

          // Extract colors if available
          let colors: number[] | null = null;
          if (geometry.attributes.color) {
            const colorArray = geometry.attributes.color.array;
            colors = [];
            for (let i = 0; i < colorArray.length; i++) {
              colors.push(colorArray[i]);
            }
          }

          // Apply object transforms to vertices manually (in case createExportScene didn't bake them in)
          const transformedVertices = [];
          for (let i = 0; i < positions.length; i += 3) {
            // Apply object scale and position
            const x = positions[i] * object.scale.x + object.position.x;
            const y = positions[i + 1] * object.scale.y + object.position.y;
            const z = positions[i + 2] * object.scale.z + object.position.z;

            transformedVertices.push(x, y, z);
          }

          console.log(`🔄 3MF Export - ${object.name || 'unnamed'} applying object transforms:`);
          console.log(`  Original first vertex: X=${positions[0].toFixed(2)}, Y=${positions[1].toFixed(2)}, Z=${positions[2].toFixed(2)}`);
          console.log(`  Transformed first vertex: X=${transformedVertices[0].toFixed(2)}, Y=${transformedVertices[1].toFixed(2)}, Z=${transformedVertices[2].toFixed(2)}`);

          // Check transformed Z range
          const transformedZ = [];
          for (let i = 2; i < transformedVertices.length; i += 3) {
            transformedZ.push(transformedVertices[i]);
          }
          const transformedMinZ = Math.min(...transformedZ);
          const transformedMaxZ = Math.max(...transformedZ);
          console.log(`  Transformed Z range: ${transformedMinZ.toFixed(2)} to ${transformedMaxZ.toFixed(2)}`);

          const convertedVertices = transformedVertices;

          meshes.push({
            name: object.name || 'mesh',
            vertices: convertedVertices, // Use coordinate-converted vertices
            indices: indices,
            colors: colors,
            transform: null // No additional transform needed
          });
        }
      });

      if (meshes.length === 0) {
        console.warn("No valid meshes found for 3MF export");
        setLoading(prev => ({ ...prev, threemf: false }));
        return;
      }

      console.log(`🔧 3MF Export - Exporting ${meshes.length} individual objects with transforms`);

      // Prepare data for WASM 3MF export with individual meshes and transforms
      const modelData = {
        meshes: meshes,
        title: "STLMaps 3D Model",
        description: "3D terrain model generated by STLMaps"
      };
      
      // Generate 3MF files using WASM
      const wasmModule = getWasmModule();
      if (!wasmModule?.generate_3mf_model_xml) {
        throw new Error("3MF export not available in WASM module");
      }
      
      // Generate XML files using WASM
      const modelXml = wasmModule.generate_3mf_model_xml(JSON.stringify(modelData));
      const contentTypesXml = wasmModule.generate_3mf_content_types_xml();
      const relsXml = wasmModule.generate_3mf_rels_xml();
      
      // Create ZIP file using JSZip (we need to add this dependency)
      // For now, we'll create a simple 3MF file with just the model XML
      // In production, you'd want to use JSZip to create proper 3MF structure
      
      // Import JSZip dynamically
      const JSZip = (await import('jszip')).default;
      
      // Create proper 3MF ZIP structure
      const zip = new JSZip();
      
      // Add required folders and files
      zip.file("[Content_Types].xml", contentTypesXml);
      
      const relsFolder = zip.folder("_rels");
      relsFolder!.file(".rels", relsXml);
      
      const threeDFolder = zip.folder("3D");
      threeDFolder!.file("3dmodel.model", modelXml);
      
      // Generate ZIP as blob
      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 6
        },
        mimeType: "model/3mf"
      });
      
      const blob = zipBlob;
      const url = URL.createObjectURL(blob);

      // Trigger immediate download
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.3mf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up URL
      URL.revokeObjectURL(url);

      console.log("3MF file generated and downloaded successfully");
      setLoading(prev => ({ ...prev, threemf: false }));
    } catch (error) {
      console.error("Error generating 3MF file:", error);
      setLoading(prev => ({ ...prev, threemf: false }));
    }
  };

  // Handle generating and auto-downloading OBJ
  const handleObjExport = () => {
    setLoading(prev => ({ ...prev, obj: true }));
    generateOBJFile();
    setLoading(prev => ({ ...prev, obj: false }));
  };

  // Handle generating and auto-downloading STL
  const handleStlExport = () => {
    setLoading(prev => ({ ...prev, stl: true }));
    generateSTLFile();
    setLoading(prev => ({ ...prev, stl: false }));
  };

  // Handle generating and auto-downloading GLTF/GLB
  const handleGltfExport = () => {
    setLoading(prev => ({ ...prev, gltf: true }));
    generateGLTFFile();
  };

  // Handle generating and auto-downloading 3MF
  const handle3MFExport = async () => {
    setLoading(prev => ({ ...prev, threemf: true }));
    await generate3MFFile();
  };

  // Download is now handled manually by button clicks

  const isDisabled = !geometryDataSets.terrainGeometry;

  // Handle dialog open/close
  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  // Get handler and loading state for a specific format
  const getFormatData = (formatId: string) => {
    switch(formatId) {
      case 'obj':
        return {
          isLoading: loading.obj,
          handler: handleObjExport,
        };
      case 'stl':
        return {
          isLoading: loading.stl,
          handler: handleStlExport,
        };
      case 'glb':
        return {
          isLoading: loading.gltf,
          handler: handleGltfExport,
        };
      case '3mf':
        return {
          isLoading: loading.threemf,
          handler: handle3MFExport,
        };
      default:
        return { isLoading: false, handler: () => {} };
    }
  };

  return (
    <>
            <IconButton 
        onClick={handleOpenDialog}
        disabled={isDisabled}
            color="secondary">
              <FileDownloadIcon />
            </IconButton>
      
      <Dialog 
        open={dialogOpen} 
        onClose={handleCloseDialog} 
        maxWidth="md" 
        fullWidth
        fullScreen={isMobile}
        sx={{ zIndex: 10000 }}
        PaperProps={{
          sx: {
            borderRadius: isMobile ? 0 : 2,
            overflow: 'hidden'
          }
        }}
      >
        <DialogTitle 
          sx={{ 
            background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            color: 'white', 
            padding: isMobile ? 2 : 3,
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
          component={"div"}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: isMobile ? "center" : "flex-start",
              width: "100%",
            }}
          >
            <ThreeDRotationIcon sx={{ mr: 1 }} /> 
            <Typography 
              variant={isMobile ? "h6" : "h5"} 
              component="div"
              sx={{ fontWeight: "bold" }}
            >
              Export 3D Model
            </Typography>
          </Box>
        </DialogTitle>
        
        <DialogContent sx={{ p: isMobile ? 2 : 3 }}>
          
          <Grid container spacing={isMobile ? 2 : 3}>
            {exportFormats.map((format) => {
              const { isLoading, handler } = getFormatData(format.id);
              return (
                <Grid size={{ xs: 12, sm: 6 }} key={format.id}>
                  <Paper 
                    elevation={2}
                    sx={{
                      p: isMobile ? 2 : 3,
                      borderRadius: 2,
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: 'center',
                      gap: isMobile ? 2 : 3,
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        boxShadow: isMobile ? 4 : 6,
                        transform: isMobile ? 'translateY(-1px)' : 'translateY(-2px)'
                      }
                    }}
                  >
                    
                    <Box flex={1} sx={{ width: '100%' }}>
                      <Box display="flex" alignItems="center" mb={0.5} flexWrap={isMobile ? "wrap" : "nowrap"}>
                        <Typography variant={isMobile ? "subtitle1" : "h6"} fontWeight="bold">
                          {format.name}
                        </Typography>
                        <Chip 
                          label={`.${format.fileExtension}`}
                          size="small"
                          sx={{ ml: 1, mt: isMobile ? 0.5 : 0 }}
                          color="primary"
                        />
                      </Box>
                      <Typography variant="body2" color="text.secondary" mb={1}>
                        {format.description}
                      </Typography>
                      <Button
                        variant="outlined"
                        onClick={handler}
                        disabled={isDisabled || isLoading}
                        startIcon={isLoading ? null : <ModelTrainingIcon />}
                        fullWidth={isMobile}
                        size={isMobile ? "small" : "medium"}
                      >
                        {isLoading ? "Generating..." : `Generate ${format.fileExtension.toUpperCase()}`}
                      </Button>
                    </Box>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </DialogContent>
        
        <DialogActions sx={{ p: isMobile ? "12px 16px" : "16px 24px", bgcolor: theme.palette.grey[50] }}>
          <Button variant="outlined" onClick={handleCloseDialog} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ExportButtons;
