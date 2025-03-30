import { useState, useEffect } from "react";
import { Button, Box } from "@mui/material";
import * as THREE from "three";
// @ts-expect-error
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
// @ts-expect-error
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

interface ExportButtonsProps {
  terrainGeometry: THREE.BufferGeometry | null;
  buildingsGeometry: THREE.BufferGeometry | null;
  onPreviewClick: () => void;
}

const ExportButtons: React.FC<ExportButtonsProps> = ({
  terrainGeometry,
  buildingsGeometry,
}) => {
  const [objDownloadUrl, setObjDownloadUrl] = useState<string>("");
  const [stlDownloadUrl, setStlDownloadUrl] = useState<string>("");

  useEffect(() => {
    // Generate export files when geometries change
    if (terrainGeometry) {
      generateOBJFile();
      generateSTLFile();
    }
    
    // Cleanup function to revoke object URLs when component unmounts
    return () => {
      if (objDownloadUrl) URL.revokeObjectURL(objDownloadUrl);
      if (stlDownloadUrl) URL.revokeObjectURL(stlDownloadUrl);
    };
  }, [terrainGeometry, buildingsGeometry]);

  const generateOBJFile = (): void => {
    if (!terrainGeometry) return;
    
    try {
      // Create a scene for the exporter
      const scene = new THREE.Scene();
      
      // Create a mesh for the terrain with vertex colors
      const terrainMaterial = new THREE.MeshStandardMaterial({ 
        vertexColors: true,
        flatShading: true
      });
      const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
      scene.add(terrainMesh);
      
      // Add buildings if available
      if (buildingsGeometry) {
        const buildingsMaterial = new THREE.MeshStandardMaterial({ 
          color: 0xaaaaaa,
          flatShading: true
        });
        const buildingsMesh = new THREE.Mesh(buildingsGeometry, buildingsMaterial);
        scene.add(buildingsMesh);
      }
      
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
      // Create a scene for the exporter
      const scene = new THREE.Scene();
      
      // Create a mesh for the terrain
      const terrainMaterial = new THREE.MeshStandardMaterial({ 
        vertexColors: true,
        flatShading: true
      });
      const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
      scene.add(terrainMesh);
      
      // Add buildings if available
      if (buildingsGeometry) {
        const buildingsMaterial = new THREE.MeshStandardMaterial({ 
          color: 0xaaaaaa,
          flatShading: true
        });
        const buildingsMesh = new THREE.Mesh(buildingsGeometry, buildingsMaterial);
        scene.add(buildingsMesh);
      }
      
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

  // Only show buttons when we have geometries to export
  if (!terrainGeometry) return null;

  return (
    <Box sx={{ mt: 2, mb: 2, display: 'flex', gap: 1 }}>
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
    </Box>
  );
};

export default ExportButtons;