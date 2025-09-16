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
  
  // State for download URLs
  const [objDownloadUrl, setObjDownloadUrl] = useState<string>("");
  const [stlDownloadUrl, setStlDownloadUrl] = useState<string>("");
  const [gltfDownloadUrl, setGltfDownloadUrl] = useState<string>("");
  const [threemfDownloadUrl, setThreemfDownloadUrl] = useState<string>("");
  
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

  // Cleanup function to revoke object URLs when component unmounts
  useEffect(() => {
    return () => {
      if (objDownloadUrl) URL.revokeObjectURL(objDownloadUrl);
      if (stlDownloadUrl) URL.revokeObjectURL(stlDownloadUrl);
      if (gltfDownloadUrl) URL.revokeObjectURL(gltfDownloadUrl);
      if (threemfDownloadUrl) URL.revokeObjectURL(threemfDownloadUrl);
    };
  }, [objDownloadUrl, stlDownloadUrl, gltfDownloadUrl, threemfDownloadUrl]);

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
    
    // Create non-indexed geometry if needed (safer for exports)
    if (validatedGeometry.index) {
      const nonIndexed = validatedGeometry.toNonIndexed();
      return nonIndexed;
    }
    
    return validatedGeometry;
  };

  // Create a scene with all meshes for export, skipping invalid geometries
  const createExportScene = (validateGeometries = false): THREE.Scene => {
    const currentScene = getCurrentScene();
    
    if (currentScene) {
      // Clone the current scene to preserve all real-time adjustments (positions, scales, colors)
      console.log("Using current ModelPreview scene with real-time adjustments");
      return currentScene.clone();
    }
    
    // Fallback to creating scene from geometry data
    console.warn("No current scene available, creating scene from geometry data");
    const scene = new THREE.Scene();

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

    // Add terrain if enabled
    if (geometryDataSets.terrainGeometry && terrainSettings.enabled) {
      const geomToUse = validateGeometries ? validateGeometry(geometryDataSets.terrainGeometry) : geometryDataSets.terrainGeometry;
      if (isValidGeometry(geomToUse)) {
        const terrainMaterial = new THREE.MeshStandardMaterial({
          vertexColors: true,
          flatShading: true
        });
        const terrainMesh = new THREE.Mesh(geomToUse, terrainMaterial);
        terrainMesh.name = "Terrain";
        scene.add(terrainMesh);
      }
    }

    // Add all enabled vector tile geometries (buildings, water, roads, landuse, etc.)
    if (geometryDataSets.polygonGeometries && geometryDataSets.polygonGeometries.length > 0) {
      geometryDataSets.polygonGeometries.forEach((vtDataset, index) => {
        if (!vtDataset?.geometry) {
          return;
        }
        // Check current enabled state from layer store instead of stored state
        const currentLayer = vtLayers.find(layer => layer.label === vtDataset.label);
        const isCurrentlyEnabled = currentLayer?.enabled !== false;
        
        if (!isCurrentlyEnabled) {
          return;
        }
        const geomToUse = validateGeometries ? validateGeometry(vtDataset.geometry) : vtDataset.geometry;

        // Type for geometry with individualGeometries in userData (matching actual data structure)
        type GeometryWithUserData = THREE.BufferGeometry & {
          userData?: {
            isContainer?: boolean;
            individualGeometries?: THREE.BufferGeometry[];
            geometryCount?: number;
          };
        };

        // Handle geometries with individualGeometries in userData (where the actual data is stored)
        if (geomToUse && (geomToUse as GeometryWithUserData).userData?.isContainer && Array.isArray((geomToUse as GeometryWithUserData).userData?.individualGeometries)) {
          // Process each individual geometry from userData
          (geomToUse as GeometryWithUserData).userData!.individualGeometries!.forEach((indGeom: THREE.BufferGeometry, indIdx: number) => {
            if (isValidGeometry(indGeom)) {
              const color = vtDataset.color instanceof THREE.Color ? vtDataset.color : new THREE.Color(0x87ceeb);
              const material = new THREE.MeshStandardMaterial({
                color,
                flatShading: true
              });
              const mesh = new THREE.Mesh(validateGeometries ? validateGeometry(indGeom) : indGeom, material);
              mesh.name = vtDataset.sourceLayer ? `${vtDataset.sourceLayer}_${index}_part${indIdx}` : `Polygon_${index}_part${indIdx}`;
              scene.add(mesh);
            }
          });
        } else if (isValidGeometry(geomToUse)) {
          // Use the color from the dataset if available, otherwise fallback
          const color = vtDataset.color instanceof THREE.Color ? vtDataset.color : new THREE.Color(0x87ceeb);
          const material = new THREE.MeshStandardMaterial({
            color,
            flatShading: true
          });
          const mesh = new THREE.Mesh(geomToUse, material);
          mesh.name = vtDataset.sourceLayer ? `${vtDataset.sourceLayer}_${index}` : `Polygon_${index}`;
          scene.add(mesh);
        }
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

  
  const generateOBJFile = (): void => {
    if (!geometryDataSets.terrainGeometry) return;
    
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
    if (!geometryDataSets.terrainGeometry) return;
    
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
    if (!geometryDataSets.terrainGeometry) return;
    
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
      
      // Create scene with validated geometries for 3MF
      const scene = createExportScene(true);
      
      // Extract mesh data for 3MF export
      const meshes: THREE.Mesh[] = [];
      
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && object.geometry) {
          const geometry = object.geometry;
          
          // Extract vertices
          const positions = geometry.attributes.position?.array;
          if (!positions) return;
          
          // Extract indices or generate them
          let indices: number[] = [];
          if (geometry.index) {
            indices = Array.from(geometry.index.array);
          } else {
            // Generate sequential indices for non-indexed geometry
            for (let i = 0; i < positions.length / 3; i++) {
              indices.push(i);
            }
          }
          
          // Validate that all indices are within valid range
          const maxVertexIndex = (positions.length / 3) - 1;
          const validIndices = indices.filter(idx => idx >= 0 && idx <= maxVertexIndex);
          if (validIndices.length !== indices.length) {
            console.warn(`Mesh has invalid indices. Original: ${indices.length}, Valid: ${validIndices.length}`);
            indices = validIndices;
          }
          
          // Extract colors if available
          let colors: number[] | null = null;
          if (geometry.attributes.color) {
            colors = Array.from(geometry.attributes.color.array);
          }
          
          meshes.push({
            vertices: Array.from(positions),
            indices: indices,
            colors: colors,
          });
        }
      });
      
      if (meshes.length === 0) {
        console.warn("No valid meshes found for 3MF export");
        setLoading(prev => ({ ...prev, threemf: false }));
        return;
      }
      
      // Prepare data for WASM 3MF export
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
      
      // Set the download URL
      setThreemfDownloadUrl(url);
      
      console.log("3MF file generated successfully");
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

  // Always auto-download when a new download URL is set
  useEffect(() => {
    if (objDownloadUrl) {
      const a = document.createElement('a');
      a.href = objDownloadUrl;
      a.download = 'model.obj';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [objDownloadUrl]);

  useEffect(() => {
    if (stlDownloadUrl) {
      const a = document.createElement('a');
      a.href = stlDownloadUrl;
      a.download = 'model.stl';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [stlDownloadUrl]);

  useEffect(() => {
    if (gltfDownloadUrl) {
      const a = document.createElement('a');
      a.href = gltfDownloadUrl;
      a.download = 'model.glb';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [gltfDownloadUrl]);

  useEffect(() => {
    if (threemfDownloadUrl) {
      const a = document.createElement('a');
      a.href = threemfDownloadUrl;
      a.download = 'model.3mf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [threemfDownloadUrl]);

  const isDisabled = !geometryDataSets.terrainGeometry;

  // Handle dialog open/close
  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  // Get download URL and handler for a specific format
  const getFormatData = (formatId: string) => {
    switch(formatId) {
      case 'obj':
        return {
          url: objDownloadUrl,
          isLoading: loading.obj,
          handler: handleObjExport,
        };
      case 'stl':
        return {
          url: stlDownloadUrl,
          isLoading: loading.stl,
          handler: handleStlExport,
        };
      case 'glb':
        return {
          url: gltfDownloadUrl,
          isLoading: loading.gltf,
          handler: handleGltfExport,
        };
      case '3mf':
        return {
          url: threemfDownloadUrl,
          isLoading: loading.threemf,
          handler: handle3MFExport,
        };
      default:
        return { url: '', isLoading: false, handler: () => {} };
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
              const { url, isLoading, handler } = getFormatData(format.id);
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
                      {url ? (
                        <Button
                          component="a"
                          variant="contained"
                          disabled={isDisabled || isLoading}
                          href={url}
                          download={`model.${format.fileExtension}`}
                          startIcon={<FileDownloadIcon />}
                          fullWidth={isMobile}
                          size={isMobile ? "small" : "medium"}
                        >
                          Download {format.fileExtension.toUpperCase()}
                        </Button>
                      ) : (
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
                      )}
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