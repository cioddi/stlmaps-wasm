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
  // Get geometry data directly from the Zustand store
  const { geometryDataSets } = useLayerStore();
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
        rendererRef.current.toneMappingExposure = 1.2; // Brighter exposure for pop effect
        rendererRef.current.physicallyCorrectLights = true;
        containerRef.current.appendChild(rendererRef.current.domElement);

        // Setup camera for dramatic and professional angles
        const camera = new THREE.PerspectiveCamera(
          42, // Cinematic field of view
          width / height,
          0.1,
          2000
        );
        camera.position.z = 5;

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
        
        // Add bloom effect for that glossy bubblegum highlight glow
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.4,    // bloom strength
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
          // Create a gradient from pink to blue - bubblegum colors
          const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
          gradient.addColorStop(0, '#ff9ff3'); // Soft pink
          gradient.addColorStop(0.5, '#ffc0cb'); // Classic bubblegum pink
          gradient.addColorStop(1, '#81ecec'); // Bright cyan
          
          context.fillStyle = gradient;
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          // Add some "studio lights" as bright spots
          context.fillStyle = 'rgba(255, 255, 255, 0.8)';
          context.beginPath();
          context.arc(canvas.width * 0.2, canvas.height * 0.2, 200, 0, Math.PI * 2);
          context.fill();
          
          context.beginPath();
          context.arc(canvas.width * 0.7, canvas.height * 0.3, 150, 0, Math.PI * 2);
          context.fill();
        }
        
        const envTexture = new THREE.CanvasTexture(canvas);
        envTexture.mapping = THREE.EquirectangularReflectionMapping;
        
        const envMap = pmremGenerator.fromEquirectangular(envTexture).texture;
        scene.environment = envMap;
        scene.background = envMap;
        
        pmremGenerator.dispose();
        
        // Add strategic studio-style lighting setup for professional rendering
        // Main key light (primary light source)
        const keyLight = new THREE.DirectionalLight(0xffffff, 3); 
        keyLight.position.set(1, 2, 3);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.1;
        keyLight.shadow.camera.far = 500;
        keyLight.shadow.camera.left = -50;
        keyLight.shadow.camera.right = 50;
        keyLight.shadow.camera.top = 50;
        keyLight.shadow.camera.bottom = -50;
        keyLight.shadow.bias = -0.0001;
        scene.add(keyLight);
        
        // Fill light (softens shadows from the key light, opposite side)
        const fillLight = new THREE.DirectionalLight(0xffffcc, 1.2); // Slight warmth
        fillLight.position.set(-2, 1, 0);
        scene.add(fillLight);
        
        // Rim light (highlights edges, creates separation from background)
        const rimLight = new THREE.DirectionalLight(0xaaeeff, 2); // Cool light for edge highlights
        rimLight.position.set(0.5, 0, -2);
        scene.add(rimLight);
        
        // Ambient light to simulate global illumination bounce
        const ambientLight = new THREE.HemisphereLight(0xffffff, 0x8080ff, 0.4);
        scene.add(ambientLight);

        // Create a model group for all geometry
        const modelGroup = new THREE.Group();
        
        // Create PBR materials with professional quality for terrain
        const terrainMaterial = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.65,
          metalness: 0.2,
          envMapIntensity: 0.8,
          flatShading: true
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
            
            // Use PBR materials for realistic surfaces
            const polygonMaterial = new THREE.MeshPhysicalMaterial({
              color: enhancedColor,
              roughness: 0.2,  // Low roughness for glossy appearance
              metalness: 0.1,  // Slight metalness for more interesting reflections
              clearcoat: 0.8,  // Clear coat layer for candy/bubblegum shine
              clearcoatRoughness: 0.1,
              envMapIntensity: 1.5,  // Increased reflection intensity
              flatShading: false,    // Smooth shading for glossy look
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
          // Use dramatic cinematic default position
          camera.position.set(-80, -140, 60);
          controls.target.set(0, 0, 5);
        }
        
        camera.updateProjectionMatrix();

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
