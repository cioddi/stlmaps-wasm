import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, IconButton, CircularProgress } from "@mui/material";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import CloseIcon from "@mui/icons-material/Close";

interface ModelPreviewProps {
  objData: string;
  open: boolean;
  onClose: () => void;
}

const ModelPreview = ({ objData, open, onClose }: ModelPreviewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogMounted, setDialogMounted] = useState<boolean>(false);
  
  // Clean up previous renderer when component unmounts or dialog closes
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        if (containerRef.current && containerRef.current.contains(rendererRef.current.domElement)) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);
  
  // Reset dialog mounted state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setDialogMounted(false);
    }
  }, [open]);
  
  // Initialize Three.js scene when dialog is fully mounted
  useEffect(() => {
    if (!open || !dialogMounted || !containerRef.current) {
      return;
    }
    
    console.log("Starting model load - dialog fully mounted");
    setLoading(true);
    setError(null);
    
    // Small timeout to ensure container is fully laid out
    const initTimer = setTimeout(() => {
      if (!containerRef.current) return;
      
      // Clean up previous renderer
      if (rendererRef.current) {
        if (containerRef.current.contains(rendererRef.current.domElement)) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      
      let animationFrameId: number;
      
      try {
        // Initialize Three.js scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);
        
        // Add lighting
        const ambientLight = new THREE.AmbientLight(0x404040);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);
        
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        
        console.log("Container dimensions:", { width, height });
        
        if (width === 0 || height === 0) {
          throw new Error("Container has zero width or height");
        }
        
        // Setup camera
        const camera = new THREE.PerspectiveCamera(
          75,
          width / height,
          0.1,
          1000
        );
        camera.position.z = 5;
        
        // Setup renderer
        rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
        rendererRef.current.setSize(width, height);
        containerRef.current.appendChild(rendererRef.current.domElement);
        
        // Add orbit controls
        const controls = new OrbitControls(camera, rendererRef.current.domElement);
        controls.enableDamping = true;
        
        console.log("Parsing OBJ data", objData.substring(0, 100) + "...");
        
        // Load OBJ model
        const loader = new OBJLoader();
        
        try {
          const objModel = loader.parse(objData);
          console.log("OBJ parsed successfully", objModel);
          
          // Center the object
          const box = new THREE.Box3().setFromObject(objModel);
          const center = box.getCenter(new THREE.Vector3());
          
          objModel.position.sub(center);
          scene.add(objModel);
          
          // Adjust camera to fit the object
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const fov = camera.fov * (Math.PI / 180);
          const cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
          
          camera.position.z = cameraZ * 1.5; // Add margin
          camera.updateProjectionMatrix();
          
          // Animation loop
          const animate = () => {
            if (!rendererRef.current) return;
            
            animationFrameId = requestAnimationFrame(animate);
            controls.update();
            rendererRef.current.render(scene, camera);
          };
          
          animate();
          console.log("Animation started");
          setLoading(false);
        } catch (parseError) {
          console.error("Error parsing OBJ:", parseError);
          setError(`Failed to parse 3D model: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          setLoading(false);
        }
        
        // Handle window resize
        const handleResize = () => {
          if (!containerRef.current || !rendererRef.current) return;
          
          const width = containerRef.current.clientWidth;
          const height = containerRef.current.clientHeight;
          
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          rendererRef.current.setSize(width, height);
        };
        
        window.addEventListener('resize', handleResize);
        
        // Return cleanup function
        return () => {
          console.log("Cleaning up");
          window.removeEventListener('resize', handleResize);
          
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
          }
        };
        
      } catch (setupError) {
        console.error("Error setting up 3D scene:", setupError);
        setError(`Failed to setup 3D viewer: ${setupError instanceof Error ? setupError.message : String(setupError)}`);
        setLoading(false);
      }
    }, 100); // Small delay to ensure container is ready
    
    return () => {
      clearTimeout(initTimer);
    };
  }, [objData, open, dialogMounted]);

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="lg" 
      fullWidth 
      sx={{zIndex: 10000}}
      TransitionProps={{
        onEntered: () => {
          console.log("Dialog fully entered, setting dialogMounted");
          setDialogMounted(true);
        }
      }}
    >
      <DialogTitle>
        3D Model Preview
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent style={{ height: "70vh", padding: 0 }}>
        <div 
          ref={containerRef} 
          style={{ width: "100%", height: "100%", position: "relative" }}
          data-testid="model-container"
        >
          {loading && (
            <div style={{ 
              display: "flex", 
              flexDirection: "column",
              alignItems: "center", 
              justifyContent: "center",
              height: "100%",
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(255,255,255,0.7)",
              zIndex: 1
            }}>
              <CircularProgress size={48} />
              <p style={{ marginTop: 16 }}>Loading 3D model...</p>
            </div>
          )}
          {error && (
            <div style={{ 
              display: "flex", 
              flexDirection: "column",
              alignItems: "center", 
              justifyContent: "center",
              height: "100%",
              color: "red"
            }}>
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ModelPreview;
