import { useState, useEffect } from "react";
import { Button, Box } from "@mui/material";
import * as THREE from "three";
import useLayerStore from "../stores/useLayerStore";
// @ts-expect-error
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
// @ts-expect-error
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
// @ts-expect-error
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ExportButtons: React.FC = () => {
  // Get geometry data directly from the Zustand store
  const { terrainGeometry, buildingsGeometry, polygonGeometries } = useLayerStore();
  const [objDownloadUrl, setObjDownloadUrl] = useState<string>("");
  const [stlDownloadUrl, setStlDownloadUrl] = useState<string>("");
  const [gltfDownloadUrl, setGltfDownloadUrl] = useState<string>("");

  useEffect(() => {
    // Generate export files when geometries change
    if (terrainGeometry) {
      generateExports();
    }
    
    // Cleanup function to revoke object URLs when component unmounts
    return () => {
      if (objDownloadUrl) URL.revokeObjectURL(objDownloadUrl);
      if (stlDownloadUrl) URL.revokeObjectURL(stlDownloadUrl);
      if (gltfDownloadUrl) URL.revokeObjectURL(gltfDownloadUrl);
    };
  }, [terrainGeometry, buildingsGeometry, polygonGeometries]);

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
        console.warn(`Fixing out-of-bounds indices: max index ${maxIndex} exceeds vertex count ${positionCount}`);
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
    
    // Create non-indexed geometry if needed (safer for exports)
    if (validatedGeometry.index) {
      const nonIndexed = validatedGeometry.toNonIndexed();
      return nonIndexed;
    }
    
    return validatedGeometry;
  };

  // Create a scene with all meshes for export
  const createExportScene = (validateGeometries = false): THREE.Scene => {
    const scene = new THREE.Scene();
    
    // Add terrain
    if (terrainGeometry) {
      const geomToUse = validateGeometries ? validateGeometry(terrainGeometry) : terrainGeometry;
      const terrainMaterial = new THREE.MeshStandardMaterial({ 
        vertexColors: true,
        flatShading: true
      });
      const terrainMesh = new THREE.Mesh(geomToUse, terrainMaterial);
      terrainMesh.name = "Terrain";
      scene.add(terrainMesh);
    }
    
    // Add buildings
    if (buildingsGeometry) {
      const geomToUse = validateGeometries ? validateGeometry(buildingsGeometry) : buildingsGeometry;
      const buildingsMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xaaaaaa,
        flatShading: true
      });
      const buildingsMesh = new THREE.Mesh(geomToUse, buildingsMaterial);
      buildingsMesh.name = "Buildings";
      scene.add(buildingsMesh);
    }
    
    // Add other polygon geometries
    if (polygonGeometries && polygonGeometries.length > 0) {
      polygonGeometries.forEach((vtDataset, index) => {
        if (!vtDataset?.geometry) return;
        
        const geomToUse = validateGeometries ? validateGeometry(vtDataset.geometry) : vtDataset.geometry;
        const material = new THREE.MeshStandardMaterial({
          color: 0x87ceeb, // Light sky blue
          flatShading: true
        });
        const mesh = new THREE.Mesh(geomToUse, material);
        mesh.name = `Polygon_${index}`;
        scene.add(mesh);
      });
    }
    
    // Add lights for better visualization in viewers
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);
    
    return scene;
  };

  // Generate all exports
  const generateExports = (): void => {
    generateOBJFile();
    generateSTLFile();
    generateGLTFFile();
  };
  
  const generateOBJFile = (): void => {
    if (!terrainGeometry) return;
    
    try {
      // Create scene with standard (non-validated) geometries for OBJ
      const scene = createExportScene(false);
      
      // Create OBJ exporter and export the scene
      const exporter = new OBJExporter();
      const objString = exporter.parse(scene);
      
      // Create downloadable Blob and URL
      const blob = new Blob([objString], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      // Set the download URL
      setObjDownloadUrl(url);
      
      console.log("OBJ file generated successfully");
    } catch (error) {
      console.error("Error generating OBJ file:", error);
    }
  };
  
  const generateSTLFile = (): void => {
    if (!terrainGeometry) return;
    
    try {
      // Create scene with standard (non-validated) geometries for STL
      const scene = createExportScene(false);
      
      // Create STL exporter and export the scene (binary format for smaller file size)
      const exporter = new STLExporter();
      const stlString = exporter.parse(scene, { binary: true });
      
      // Create downloadable Blob and URL
      const blob = new Blob([stlString], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      
      // Set the download URL
      setStlDownloadUrl(url);
      
      console.log("STL file generated successfully");
    } catch (error) {
      console.error("Error generating STL file:", error);
    }
  };
  
  const generateGLTFFile = (): void => {
    if (!terrainGeometry) return;
    
    try {
      // Create scene with validated geometries for GLTF/GLB
      const scene = createExportScene(true);
      
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
          setGltfDownloadUrl(url);
          console.log("GLTF/GLB file generated successfully");
        },
        (error) => {
          console.error("Error during GLTF export:", error);
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
    }
  };

  // Only show buttons when we have geometries to export
  if (!terrainGeometry) return null;

  return (
    <Box sx={{ mt: 2, mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {objDownloadUrl && (
        <Button
          variant="outlined"
          href={objDownloadUrl}
          download="model.obj"
        >
          Download OBJ
        </Button>
      )}
      {stlDownloadUrl && (
        <Button
          variant="outlined"
          href={stlDownloadUrl}
          download="model.stl"
        >
          Download STL
        </Button>
      )}
      {gltfDownloadUrl && (
        <Button
          variant="outlined"
          href={gltfDownloadUrl}
          download="model.glb"
        >
          Download GLB
        </Button>
      )}
    </Box>
  );
};

export default ExportButtons;