import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, IconButton, CircularProgress } from "@mui/material";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import CloseIcon from "@mui/icons-material/Close";
import { Sprite, SpriteMaterial, CanvasTexture } from "three";

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
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);
        
        // Add second directional light from another angle for better illumination
        const secondaryLight = new THREE.DirectionalLight(0xffffff, 0.5);
        secondaryLight.position.set(-1, 0.5, -1);
        scene.add(secondaryLight);
        
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        
        console.log("Container dimensions:", { width, height });
        
        if (width === 0 || height === 0) {
          throw new Error("Container has zero width or height");
        }
        
        // Setup camera
        const camera = new THREE.PerspectiveCamera(
          50, // Reduced FOV for better perspective
          width / height,
          0.1,
          2000
        );
        camera.position.z = 5;
        
        // Setup renderer with better shadow settings
        rendererRef.current = new THREE.WebGLRenderer({ 
          antialias: true,
          alpha: true 
        });
        rendererRef.current.setSize(width, height);
        rendererRef.current.setPixelRatio(window.devicePixelRatio);
        rendererRef.current.shadowMap.enabled = true;
        rendererRef.current.shadowMap.type = THREE.PCFSoftShadowMap; // Better shadow quality
        containerRef.current.appendChild(rendererRef.current.domElement);
        
        // Add orbit controls with better settings
        const controls = new OrbitControls(camera, rendererRef.current.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = true;
        controls.minDistance = 0.1;
        controls.maxDistance = 500;   // Significantly increased to allow much more zoom out
        
        console.log("Parsing OBJ data", objData.substring(0, 100) + "...");

        // Add an axes helper
        const axesHelper = new THREE.AxesHelper(10);
        scene.add(axesHelper);

        function createAxisLabel(text: string, color: string): Sprite {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Failed to get canvas context for axis label.");
        
          canvas.width = 256; 
          canvas.height = 64; 
          ctx.fillStyle = color; 
          ctx.font = "28px Arial";
          ctx.fillText(text, 10, 40);
        
          const texture = new CanvasTexture(canvas);
          const spriteMaterial = new SpriteMaterial({ map: texture, depthTest: false });
          const sprite = new Sprite(spriteMaterial);
          sprite.scale.set(3, 1, 1); // Adjust scale as needed
          return sprite;
        }
        
        const xLabel = createAxisLabel("X", "#ff0000");
        xLabel.position.set(12, 0, 0);
        scene.add(xLabel);
        
        const yLabel = createAxisLabel("Y", "#00ff00");
        yLabel.position.set(0, 12, 0);
        scene.add(yLabel);
        
        const zLabel = createAxisLabel("Z", "#0000ff");
        zLabel.position.set(0, 0, 12);
        scene.add(zLabel);
        
        // Set up better directional light for shadows
        const shadowLight = new THREE.DirectionalLight(0xffffff, 0.6);
        shadowLight.position.set(5, 10, 7);
        shadowLight.castShadow = true;
        shadowLight.shadow.mapSize.width = 1024;
        shadowLight.shadow.mapSize.height = 1024;
        shadowLight.shadow.camera.near = 0.5;
        shadowLight.shadow.camera.far = 100; // Increased to match further camera distance
        shadowLight.shadow.camera.left = -20; // Wider shadow camera frustum
        shadowLight.shadow.camera.right = 20;
        shadowLight.shadow.camera.top = 20;
        shadowLight.shadow.camera.bottom = -20;
        scene.add(shadowLight);

        // Create a better gradient texture - brown to green
        const vertexTexture = new THREE.DataTexture(
          new Uint8Array([
            139, 69, 19, 255,    // Brown at bottom/back
            100, 140, 100, 255,  // Darker green
            150, 180, 150, 255,  // Medium green
            200, 220, 200, 255,  // Light green
            255, 255, 255, 255   // White at top/front
          ]),
          1, 5, THREE.RGBAFormat
        );
        vertexTexture.needsUpdate = true;
        
        // Load OBJ model
        const loader = new OBJLoader();
        
        try {
          const objModel = loader.parse(objData);
          console.log("OBJ parsed successfully", objModel);
          
          // Calculate global bounding box
          const globalBox = new THREE.Box3().setFromObject(objModel);
          const globalMin = globalBox.min;
          const globalMax = globalBox.max;
          
          objModel.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              // Create material with improved gradient based on view direction
              child.material = new THREE.MeshStandardMaterial({
                roughness: 0.7,
                metalness: 0.1,
                onBeforeCompile: (shader) => {
                  shader.uniforms.minZ = { value: globalMin.z };
                  shader.uniforms.maxZ = { value: globalMax.z };
                  shader.uniforms.minY = { value: globalMin.y };
                  shader.uniforms.maxY = { value: globalMax.y };
                  shader.uniforms.gradientMap = { value: vertexTexture };
                  
                  // Add custom vertex shader code for gradient
                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    `#include <common>
                    varying float vGradient;
                    uniform float minZ;
                    uniform float maxZ;
                    uniform float minY;
                    uniform float maxY;`
                  );
                  
                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
                    // Use only Z for a clean back-to-front gradient
                    float normalizedZ = (position.z - minZ) / (maxZ - minZ);
                    vGradient = normalizedZ;`
                  );
                  
                  // Add custom fragment shader code for gradient
                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `#include <common>
                    varying float vGradient;
                    uniform sampler2D gradientMap;`
                  );
                  
                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <color_fragment>',
                    `#include <color_fragment>
                    vec4 gradColor = texture2D(gradientMap, vec2(0.5, vGradient));
                    diffuseColor.rgb = gradColor.rgb;`
                  );
                }
              });
              
              // Enable shadows on the mesh
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          // Center the object
          const box = new THREE.Box3().setFromObject(objModel);
          const center = box.getCenter(new THREE.Vector3());
          objModel.position.sub(center);
          
          // Position slightly above the ground
          objModel.position.y = box.getSize(new THREE.Vector3()).y / 2;
          
          scene.add(objModel);
          
          // Create a helper function to properly fit the camera to the object
          const fitCameraToObject = (camera: THREE.PerspectiveCamera, object: THREE.Object3D, padding = 1.5) => {
            const boundingBox = new THREE.Box3().setFromObject(object);
            
            const center = boundingBox.getCenter(new THREE.Vector3());
            const size = boundingBox.getSize(new THREE.Vector3());
            
            // Get the max side of the bounding box
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            
            // Calculate the required distance
            let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
            cameraZ *= padding; // Add padding for rotation
            
            // Set camera position - adjusted for better viewing angle
            camera.position.set(center.x, center.y + (size.y / 3), center.z + cameraZ);
            camera.lookAt(center);
            
            // Update camera near and far planes to ensure the object remains visible during close zooming
            camera.near = 0.01; // Set very close near plane
            camera.far = cameraZ * 100;
            camera.updateProjectionMatrix();
            
            // Update controls target
            controls.target.copy(center);
            controls.update();
          };
          
          // Apply camera fitting with generous padding
          fitCameraToObject(camera, objModel, 2.2); // Increased padding for better rotation view
          
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
