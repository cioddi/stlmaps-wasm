import { useEffect, useRef, useState, version } from "react";
import { CircularProgress } from "@mui/material";
import * as THREE from "three";
// @ts-expect-error
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
// @ts-expect-error
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
// @ts-expect-error
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
// @ts-expect-error
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
// @ts-expect-error
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
// @ts-expect-error
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
// @ts-expect-error
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Sprite, SpriteMaterial, CanvasTexture } from "three";
import useLayerStore from "../stores/useLayerStore";

interface ModelPreviewProps {
}

const ModelPreview = ({
}: ModelPreviewProps) => {
  // Get geometry data and terrain settings from the Zustand store
  const { geometryDataSets, terrainSettings } = useLayerStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Store camera position and target to persist across re-renders
  const [cameraPosition, setCameraPosition] = useState<THREE.Vector3 | null>(null);
  const [cameraTarget, setCameraTarget] = useState<THREE.Vector3 | null>(null);

  // Clean up previous renderer when component unmounts or dialog closes
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        if (
          containerRef.current &&
          containerRef.current.contains(rendererRef.current.domElement)
        ) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  // Initialize Three.js scene when dialog is fully mounted
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    console.log("Starting model load - dialog fully mounted");
    setLoading(true);
    setError(null);

    // Resize handler function to update renderer when container size changes
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      if (width === 0 || height === 0) return;
      
      // Update camera aspect ratio
      if (rendererRef.current.userData.camera) {
        const camera = rendererRef.current.userData.camera as THREE.PerspectiveCamera;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      
      // Update renderer size
      rendererRef.current.setSize(width, height);
      
      // Update composer size if it exists
      if (rendererRef.current.userData.composer) {
        const composer = rendererRef.current.userData.composer as EffectComposer;
        composer.setSize(width, height);
      }
    };

    // Add resize event listener
    window.addEventListener('resize', handleResize);
    
    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

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
        // Initialize Three.js scene with enhanced visual quality
        const scene = new THREE.Scene();
        
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        console.log("Container dimensions:", { width, height });

        if (width === 0 || height === 0) {
          throw new Error("Container has zero width or height");
        }

        // Setup advanced renderer with high-quality settings
        rendererRef.current = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          precision: "highp",
        });
        rendererRef.current.setSize(width, height);
        rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance
        rendererRef.current.shadowMap.enabled = true;
        rendererRef.current.shadowMap.type = THREE.PCFSoftShadowMap;
        rendererRef.current.outputEncoding = THREE.sRGBEncoding;
        rendererRef.current.toneMapping = THREE.ACESFilmicToneMapping;
        rendererRef.current.toneMappingExposure = 0.8; // Reduced exposure for better contrast
        rendererRef.current.physicallyCorrectLights = true;
        // Initialize userData object to store references
        rendererRef.current.userData = {};
        containerRef.current.appendChild(rendererRef.current.domElement);

        // Setup camera with proper field of view
        const camera = new THREE.PerspectiveCamera(
          45, // Standard field of view
          width / height,
          0.1,
          2000
        );

        // Add orbit controls with cinematographer settings
        const controls = new OrbitControls(
          camera,
          rendererRef.current.domElement
        );
        controls.enableDamping = true;
        controls.dampingFactor = 0.07; // Smoother camera movement
        controls.screenSpacePanning = true;
        controls.minDistance = 0.1;
        controls.maxDistance = 500;
        controls.maxPolarAngle = Math.PI * 0.85; // Prevent going underground too much

        // Create post-processing composer for advanced effects
        const composer = new EffectComposer(rendererRef.current);
        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);
        
        // Store references to camera and composer for resize handling
        rendererRef.current.userData.camera = camera;
        rendererRef.current.userData.composer = composer;
        
        // Add bloom effect for that glossy bubblegum highlight glow
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.3,    // bloom strength
          0.35,   // bloom radius
          0.9     // bloom threshold
        );
        composer.addPass(bloomPass);

        // Add ambient occlusion for better depth perception
        const ssaoPass = new SSAOPass(
          scene,
          camera,
          width,
          height
        );
        ssaoPass.kernelRadius = 16;
        ssaoPass.minDistance = 0.005;
        ssaoPass.maxDistance = 0.1;
        composer.addPass(ssaoPass);
        
        // Final output pass with gamma correction
        const outputPass = new OutputPass();
        composer.addPass(outputPass);

        // Use HDRI environment map for realistic lighting
        // We'll use a placeholder until the user provides an actual HDRI image
        // You would normally load your own HDR map with the RGBELoader
        const pmremGenerator = new THREE.PMREMGenerator(rendererRef.current);
        pmremGenerator.compileEquirectangularShader();

        // Create a default colorful environment map to simulate studio lighting
        // This is a temporary solution until a proper HDRI is provided
        const envScene = new THREE.Scene();
        
        // Create a gradient background for the environment
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const context = canvas.getContext('2d');
        if (context) {
          // Create a gradient with more balanced colors including yellow and blue tones
          const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
          gradient.addColorStop(0, '#a1c4fd'); // Soft blueish-white
          gradient.addColorStop(0.4, '#f9d976'); // Warm yellow
          gradient.addColorStop(0.7, '#c2e9fb'); // Light blue
          gradient.addColorStop(1, '#81d8d0'); // Subtle cyan
          
          context.fillStyle = gradient;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        const envTexture = new THREE.CanvasTexture(canvas);
        envTexture.mapping = THREE.EquirectangularReflectionMapping;
        
        const envMap = pmremGenerator.fromEquirectangular(envTexture).texture;
        scene.environment = envMap;
        scene.background = envMap;
        
        pmremGenerator.dispose();
        
        // Add strategic studio-style lighting setup for professional rendering
        // Main key light (primary light source) - slightly warmer white
        const keyLight = new THREE.DirectionalLight(0xfffbf0, 0.9);
        keyLight.position.set(1, 2, 3);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.1;
        keyLight.shadow.camera.far = 100;
        keyLight.shadow.camera.left = -50;
        keyLight.shadow.camera.right = 50;
        keyLight.shadow.camera.top = 50;
        keyLight.shadow.camera.bottom = -50;
        keyLight.shadow.radius = 12;
        keyLight.shadow.blurSamples = 8;
        keyLight.shadow.bias = -0.0001;
        scene.add(keyLight);
        // Add a subtle blue rim light for color variation
        const rimLight = new THREE.DirectionalLight(0xc4e0ff, 0.3); // Blueish-white light
        rimLight.position.set(-3, 1, -2);
        scene.add(rimLight);
        
        // Add a subtle yellow fill light for warmth
        const fillLight = new THREE.DirectionalLight(0xfff0c0, 0.2); // Soft yellow light
        fillLight.position.set(2, -1, -1);
        scene.add(fillLight);
        
        // Ambient light to simulate global illumination bounce - more neutral
        const ambientLight = new THREE.HemisphereLight(0xffffff, 0xf0f5ff, 2.7);
        scene.add(ambientLight);

        // Create a model group for all geometry
        const modelGroup = new THREE.Group();
        
        // Create PBR materials with professional quality for terrain (less reflective)
        // Use color from the store if available, otherwise fall back to vertex colors
        const terrainMaterial = new THREE.MeshStandardMaterial({
          vertexColors: terrainSettings.color ? false : true,
          color: terrainSettings.color ? new THREE.Color(terrainSettings.color) : undefined,
          roughness: 0.8,
          metalness: 0.01,
          envMapIntensity: 0.4, // 50% less reflective
          flatShading: true,
          side: THREE.DoubleSide // Render both sides of the terrain
        });
        
        // Apply the material to the terrain mesh
        const geometryMesh = new THREE.Mesh(
          geometryDataSets.terrainGeometry,
          terrainMaterial
        );
        geometryMesh.castShadow = true;
        geometryMesh.receiveShadow = true;
        modelGroup.add(geometryMesh);

        // Process polygon geometries with shiny bubblegum-like materials
        if (geometryDataSets.polygonGeometries) {
          geometryDataSets.polygonGeometries.forEach(({geometry, ...vtDataset}) => {
            // Create a glossy, candy-like material based on the dataset's color
            const baseColor = vtDataset.color || new THREE.Color(0x81ecec);
            
            // Create slightly brightened color for bubblegum aesthetic
            const enhancedColor = new THREE.Color().copy(baseColor).convertSRGBToLinear();
            enhancedColor.r = Math.min(1, enhancedColor.r * 1.2);
            enhancedColor.g = Math.min(1, enhancedColor.g * 1.2);
            enhancedColor.b = Math.min(1, enhancedColor.b * 1.2);
            
            // Use PBR materials for realistic surfaces (with reduced reflectivity)
            const polygonMaterial = new THREE.MeshPhysicalMaterial({
              color: enhancedColor,
              roughness: 0.35,  // Slightly increased roughness for less glossiness
              metalness: 0.01,  // Reduced metalness for less reflections
              clearcoat: 0.06,   // Reduced clear coat for more subtle shine
              clearcoatRoughness: 2, // Increased clearcoat roughness for diffused reflections
              envMapIntensity: 0.7,    // Reduced reflection intensity by ~50%
              flatShading: false,      // Smooth shading for glossy look
              side: THREE.DoubleSide
            });
            
            const polygonMesh = new THREE.Mesh(geometry, polygonMaterial);
            polygonMesh.castShadow = true;
            polygonMesh.receiveShadow = true;
            modelGroup.add(polygonMesh);
          });
        }

        scene.add(modelGroup);
        modelGroup.position.set(0, 0, 0);
        
        // Set camera position - use saved position if available
        if (cameraPosition && cameraTarget) {
          // Restore saved camera position and target
          camera.position.copy(cameraPosition);
          controls.target.copy(cameraTarget);
        } else {
          // Set a default true top-down view
          camera.position.set(0, -200, 100);
          controls.target.set(0, 0, 0);
        }
        
        // Set appropriate field of view
        camera.fov = 45;
        camera.updateProjectionMatrix();
        
        // Add camera helper buttons for quick positioning
        const addCameraPositionButton = (label: string, position: [number, number, number]) => {
          const button = document.createElement('button');
          button.textContent = label;
          button.style.position = 'absolute';
          button.style.bottom = '10px';
          button.style.padding = '8px 12px';
          button.style.margin = '0 5px';
          button.style.backgroundColor = '#2196F3';
          button.style.color = 'white';
          button.style.border = 'none';
          button.style.borderRadius = '4px';
          button.style.cursor = 'pointer';
          button.style.zIndex = '100';
          button.style.fontSize = '12px';
          button.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
          
          button.addEventListener('click', () => {
            const [x, y, z] = position;
            camera.position.set(x, y, z);
            controls.target.set(0, 0, 0);
            camera.updateProjectionMatrix();
          });
          
          if (containerRef.current) {
            containerRef.current.appendChild(button);
          }
          
          return button;
        };
        
        // Position buttons at the bottom of the container
        const topButton = addCameraPositionButton('Top', [0, 50, 200]);
        topButton.style.left = '10px';
        
        const frontButton = addCameraPositionButton('Initial', [0, -200, 100]);
        frontButton.style.left = '60px';

        // Animation loop with enhanced rendering
        const animate = () => {
          if (!rendererRef.current) return;
          
          // Save camera position and target when it changes
          if (controls.target && camera.position) {
            if (!cameraPosition || 
                !camera.position.equals(cameraPosition) || 
                !controls.target.equals(cameraTarget || new THREE.Vector3())) {
              setCameraPosition(camera.position.clone());
              setCameraTarget(controls.target.clone());
            }
          }
          
          animationFrameId = requestAnimationFrame(animate);
          controls.update();
          
          // Use the composer for enhanced rendering with post-processing
          composer.render();
        };

        // @ts-expect-error
        document.debug_camera = camera; // Expose camera to global scope for debugging
        animate();
        console.log("Enhanced animation started");
        setLoading(false);
      } catch (setupError) {
        console.error("Error setting up 3D scene:", setupError);
        setError(
          `Failed to setup 3D viewer: ${
            setupError instanceof Error
              ? setupError.message
              : String(setupError)
          }`
        );
        setLoading(false);
      }
    }, 100); // Small delay to ensure container is ready

    return () => {
      clearTimeout(initTimer);
    };
  }, [geometryDataSets.polygonGeometries, geometryDataSets.terrainGeometry]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      data-testid="model-container"
    >
      {loading && (
        <div
          style={{
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
            zIndex: 1,
          }}
        >
          <CircularProgress size={48} />
          <p style={{ marginTop: 16 }}>Loading 3D model...</p>
        </div>
      )}
      {error && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "red",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default ModelPreview;
