import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import HoverTooltip from "./HoverTooltip";

interface ModelPreviewProps {}

// Interface for scene data to be stored in ref
interface SceneData {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  modelGroup: THREE.Group;
  composer: EffectComposer;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  hoveredMesh: THREE.Object3D | null;
  originalMaterials: Map<THREE.Object3D, THREE.Material | THREE.Material[]>;
  handleMouseMove?: (event: MouseEvent) => void;
  handleMouseLeave?: () => void;
  animationFrameId?: number;
  initialized: boolean;
  buttons: HTMLButtonElement[];
  savedCameraPosition?: THREE.Vector3;
  savedCameraTarget?: THREE.Vector3;
  cameraUpdateTimeoutId?: NodeJS.Timeout | null;
  isFirstRender?: boolean;
}

/**
 * Checks battery status synchronously if available
 */
const getBatteryPenalty = (): number => {
  try {
    // @ts-expect-error - Some browsers expose battery directly (deprecated but still used)
    const battery = navigator.battery;
    if (battery && battery.charging === false && battery.level < 0.3) {
      return -1; // Small penalty for low battery
    }
  } catch {
    // Ignore errors - battery API not available or failed
  }
  return 0;
};

/**
 * Detects device capabilities and recommends the appropriate rendering mode
 * Improved algorithm that better distinguishes between capable and less capable devices
 */
const detectDeviceCapabilities = (): 'quality' | 'performance' => {
  console.log("Detecting device capabilities for optimal rendering mode");
  
  // Device classification
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent);
  const isTablet = /ipad|android(?!.*mobile)/i.test(navigator.userAgent);
  const isDesktop = !isMobile && !isTablet;
  
  // Get device specs
  // @ts-expect-error - navigator.deviceMemory is not in TypeScript defs
  const deviceMemory = navigator.deviceMemory || (isMobile ? 3 : 8); // Better defaults based on device type
  const cpuCores = navigator.hardwareConcurrency || (isMobile ? 4 : 8);
  
  // Screen metrics
  const pixelCount = window.screen.width * window.screen.height;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const effectivePixels = pixelCount * devicePixelRatio;
  
  console.log(`Device info: ${isMobile ? 'Mobile' : isTablet ? 'Tablet' : 'Desktop'}, RAM: ${deviceMemory}GB, Cores: ${cpuCores}, Resolution: ${window.screen.width}x${window.screen.height}, DPR: ${devicePixelRatio}`);
  
  // GPU Performance Assessment
  let gpuCapabilityScore = 0;
  let gpuRenderer = '';
  
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (gl) {
      // Get GPU renderer info
      // @ts-expect-error - This property exists on WebGL contexts
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        // @ts-expect-error - This constant exists when the extension is available
        gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        console.log("Detected GPU:", gpuRenderer);
        
        // High-end desktop GPUs
        const highEndDesktopGPUs = [
          // NVIDIA
          'rtx 4090', 'rtx 4080', 'rtx 4070', 'rtx 4060',
          'rtx 3090', 'rtx 3080', 'rtx 3070', 'rtx 3060',
          'rtx 2080', 'rtx 2070', 'rtx 2060',
          'gtx 1080', 'gtx 1070', 'gtx 1660',
          // AMD
          'rx 7900', 'rx 7800', 'rx 7700', 'rx 7600',
          'rx 6900', 'rx 6800', 'rx 6700', 'rx 6600',
          'rx 5700', 'rx 5600', 'rx 580', 'rx 570'
        ];
        
        // Mid-range desktop GPUs
        const midRangeDesktopGPUs = [
          'gtx 1650', 'gtx 1050', 'gtx 960', 'gtx 950',
          'rx 560', 'rx 550', 'intel iris xe', 'intel arc'
        ];
        
        // Modern mobile GPUs (capable of quality rendering)
        const capableMobileGPUs = [
          // Apple
          'apple m3', 'apple m2', 'apple m1',
          'apple a17', 'apple a16', 'apple a15', 'apple a14',
          // Qualcomm Adreno (newer generations)
          'adreno 740', 'adreno 730', 'adreno 725', 'adreno 720',
          'adreno 660', 'adreno 650', 'adreno 640', 'adreno 630',
          // ARM Mali (newer generations)
          'mali-g720', 'mali-g715', 'mali-g710', 'mali-g78', 'mali-g77',
          'mali-g76', 'mali-g72',
          // Samsung Xclipse
          'xclipse 940', 'xclipse 920'
        ];
        
        // Lower-end mobile GPUs
        const basicMobileGPUs = [
          'adreno 610', 'adreno 530', 'adreno 520', 'adreno 510',
          'mali-g57', 'mali-g52', 'mali-g51', 'mali-g31',
          'powervr'
        ];
        
        const rendererLower = gpuRenderer.toLowerCase();
        
        // Score based on GPU tier
        if (highEndDesktopGPUs.some(gpu => rendererLower.includes(gpu))) {
          gpuCapabilityScore = 8; // Excellent
        } else if (midRangeDesktopGPUs.some(gpu => rendererLower.includes(gpu))) {
          gpuCapabilityScore = 6; // Good
        } else if (capableMobileGPUs.some(gpu => rendererLower.includes(gpu))) {
          gpuCapabilityScore = 5; // Capable mobile
        } else if (basicMobileGPUs.some(gpu => rendererLower.includes(gpu))) {
          gpuCapabilityScore = 2; // Basic mobile
        } else if (rendererLower.includes('intel') && !rendererLower.includes('iris')) {
          gpuCapabilityScore = 3; // Integrated Intel (older)
        } else {
          gpuCapabilityScore = 4; // Unknown/generic
        }
      }
      
      // WebGL capabilities test
      const extensions = gl.getSupportedExtensions() || [];
      const modernExtensions = [
        'EXT_color_buffer_float',
        'OES_texture_float',
        'WEBGL_color_buffer_float',
        'WEBGL_compressed_texture_s3tc',
        'WEBGL_depth_texture',
        'EXT_texture_filter_anisotropic'
      ];
      
      const supportedModernExtensions = modernExtensions.filter(ext => extensions.includes(ext));
      const extensionScore = Math.min(supportedModernExtensions.length * 0.3, 2);
      gpuCapabilityScore += extensionScore;
      
      // Performance benchmark (quick test)
      const startTime = performance.now();
      let drawCalls = 0;
      while (performance.now() - startTime < 16) { // 16ms = one frame at 60fps
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.flush();
        drawCalls++;
      }
      
      if (drawCalls > 200) {
        gpuCapabilityScore += 1;
      } else if (drawCalls > 100) {
        gpuCapabilityScore += 0.5;
      }
      
      console.log(`GPU benchmark: ${drawCalls} draw calls in 16ms, extensions: ${supportedModernExtensions.length}/${modernExtensions.length}`);
    }
  } catch (e) {
    console.warn("Error during GPU capability detection:", e);
    gpuCapabilityScore = isMobile ? 3 : 5; // Conservative fallback
  }
  
  // Calculate total capability score
  let totalScore = 0;
  
  // Base scores by device type
  if (isDesktop) {
    totalScore += 3; // Desktop base advantage
  } else if (isTablet) {
    totalScore += 1; // Tablets are middle ground
  }
  // Mobile gets no base bonus/penalty - judge by specs
  
  // Memory score (more nuanced)
  if (deviceMemory >= 8) {
    totalScore += 3;
  } else if (deviceMemory >= 6) {
    totalScore += 2;
  } else if (deviceMemory >= 4) {
    totalScore += 1;
  }
  // Below 4GB gets no bonus
  
  // CPU score
  if (cpuCores >= 8) {
    totalScore += 2;
  } else if (cpuCores >= 6) {
    totalScore += 1;
  } else if (cpuCores >= 4) {
    totalScore += 0.5;
  }
  
  // GPU score (most important factor)
  totalScore += gpuCapabilityScore;
  
  // Resolution penalty (only for very high resolutions)
  if (effectivePixels > 4000000) { // ~4K territory
    totalScore -= 1;
  } else if (effectivePixels > 8000000) { // 4K+
    totalScore -= 2;
  }
  
  // Battery status penalty (if available)
  const batteryPenalty = getBatteryPenalty();
  totalScore += batteryPenalty;
  
  // Device age estimation (very rough)
  const currentYear = new Date().getFullYear();
  if (userAgent.includes('chrome/')) {
    const chromeVersion = parseInt(userAgent.match(/chrome\/(\d+)/)?.[1] || '0');
    const estimatedAge = Math.max(0, currentYear - 2008 - Math.floor(chromeVersion / 6));
    if (estimatedAge > 8) { // Very old device
      totalScore -= 2;
    } else if (estimatedAge > 5) {
      totalScore -= 1;
    }
  }
  
  console.log(`Capability scores - Base: ${isDesktop ? 3 : isTablet ? 1 : 0}, Memory: ${deviceMemory >= 8 ? 3 : deviceMemory >= 6 ? 2 : deviceMemory >= 4 ? 1 : 0}, CPU: ${cpuCores >= 8 ? 2 : cpuCores >= 6 ? 1 : cpuCores >= 4 ? 0.5 : 0}, GPU: ${gpuCapabilityScore}, Battery: ${batteryPenalty}, Total: ${totalScore}`);
  
  // Special rule: Non-mobile devices with limited specs always get performance mode
  // This ensures older desktops/laptops with 4 cores and ≤8GB RAM don't get quality mode
  if (!isMobile && cpuCores <= 4 && deviceMemory <= 8) {
    console.log("Forcing performance mode for non-mobile device with limited specs (≤4 cores, ≤8GB RAM)");
    return 'performance';
  }
  
  // Decision threshold - adjusted for better balance
  const qualityThreshold = isMobile ? 6 : 7; // Slightly higher bar for desktop
  const useQualityMode = totalScore >= qualityThreshold;
  
  const recommendedMode = useQualityMode ? 'quality' : 'performance';
  console.log(`Recommended rendering mode: ${recommendedMode} (score: ${totalScore}/${qualityThreshold})`);
  
  return recommendedMode;
};

const ModelPreview = ({}: ModelPreviewProps) => {
  // Get geometry data and settings from the Zustand store
  const { 
    geometryDataSets, 
    terrainSettings, 
    renderingSettings, 
    debugSettings, 
    hoverState,
    colorOnlyUpdate,
    layerColorUpdates,
    setRenderingMode,
    setHoveredMesh,
    setMousePosition,
    clearHover,
    clearColorOnlyUpdate,
    setCurrentSceneGetter
  } = useLayerStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneDataRef = useRef<SceneData | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastMouseMoveTime = useRef<number>(0); // For throttling hover performance
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hasSetInitialMode, setHasSetInitialMode] = useState<boolean>(false);
  
  // Access the current rendering mode
  const renderingMode = renderingSettings.mode;
  
  // Store camera position and target to persist across re-renders
  const [cameraPosition, setCameraPosition] = useState<THREE.Vector3 | null>(null);
  const [cameraTarget, setCameraTarget] = useState<THREE.Vector3 | null>(null);

  // Resize handler function to update renderer when container size changes
  const handleResize = useCallback(() => {
    if (!containerRef.current || !rendererRef.current || !sceneDataRef.current) return;
    
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    if (width === 0 || height === 0) return;
    
    // Update camera aspect ratio
    const { camera, composer } = sceneDataRef.current;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    // Update renderer size
    rendererRef.current.setSize(width, height);
    
    // Update composer size
    composer.setSize(width, height);
  }, []);

  // Initialize Three.js scene
  const initScene = useCallback(() => {
    // Only initialize if we don't have a renderer yet or if rendering mode has changed
    const shouldInitialize = !rendererRef.current || 
      (sceneDataRef.current && sceneDataRef.current.renderingMode !== renderingMode);
    
    if (!containerRef.current || !shouldInitialize) return;
    
    // Clean up existing renderer and scene if they exist
    if (rendererRef.current) {
      console.log("Cleaning up existing Three.js scene before re-initialization");
      if (containerRef.current.contains(rendererRef.current.domElement)) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current.dispose();
      rendererRef.current = null;
      
      if (sceneDataRef.current?.animationFrameId) {
        cancelAnimationFrame(sceneDataRef.current.animationFrameId);
      }
    }
    
    try {
      console.log("Initializing Three.js scene");
      setLoading(true);
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      if (width === 0 || height === 0) {
        throw new Error("Container has zero width or height");
      }
      
      // Setup renderer with settings based on rendering mode
      rendererRef.current = new THREE.WebGLRenderer({
        antialias: renderingMode === 'quality',
        alpha: true,
        powerPreference: "high-performance",
        precision: renderingMode === 'quality' ? "highp" : "mediump",
      });
      rendererRef.current.setSize(width, height);
      rendererRef.current.setPixelRatio(
        renderingMode === 'quality' 
          ? Math.min(window.devicePixelRatio, 2) 
          : Math.min(window.devicePixelRatio, 1)
      );
      rendererRef.current.shadowMap.enabled = renderingMode === 'quality';
      rendererRef.current.shadowMap.type = renderingMode === 'quality' 
        ? THREE.PCFSoftShadowMap 
        : THREE.BasicShadowMap;
      rendererRef.current.outputEncoding = THREE.sRGBEncoding;
      rendererRef.current.toneMapping = renderingMode === 'quality'
        ? THREE.ACESFilmicToneMapping
        : THREE.LinearToneMapping;
      rendererRef.current.toneMappingExposure = renderingMode === 'quality' ? 0.8 : 1.0;
      rendererRef.current.physicallyCorrectLights = renderingMode === 'quality';
      containerRef.current.appendChild(rendererRef.current.domElement);
      
      // Create scene
      const scene = new THREE.Scene();
      
      // Setup camera
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      
      // Add orbit controls
      const controls = new OrbitControls(camera, rendererRef.current.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.screenSpacePanning = true;
      controls.minDistance = 0.1;
      controls.maxDistance = 500;
      controls.maxPolarAngle = Math.PI * 0.85;
      
      // Create post-processing composer
      const composer = new EffectComposer(rendererRef.current);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      
      // Configure post-processing based on rendering mode
      if (renderingMode === 'quality') {
        // Add bloom effect (quality mode only)
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.3,
          0.35,
          0.9
        );
        composer.addPass(bloomPass);
        
        // Add ambient occlusion (quality mode only)
        const ssaoPass = new SSAOPass(scene, camera, width, height);
        ssaoPass.kernelRadius = 16;
        ssaoPass.minDistance = 0.005;
        ssaoPass.maxDistance = 0.1;
        composer.addPass(ssaoPass);
      }
      
      // Final output pass
      const outputPass = new OutputPass();
      composer.addPass(outputPass);
      
      // Setup environment map
      const pmremGenerator = new THREE.PMREMGenerator(rendererRef.current);
      pmremGenerator.compileEquirectangularShader();
      
      // Create a default environment map
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#a1c4fd');
        gradient.addColorStop(0.4, '#f9d976');
        gradient.addColorStop(0.7, '#c2e9fb');
        gradient.addColorStop(1, '#81d8d0');
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      const envTexture = new THREE.CanvasTexture(canvas);
      envTexture.mapping = THREE.EquirectangularReflectionMapping;
      
      const envMap = pmremGenerator.fromEquirectangular(envTexture).texture;
      scene.environment = envMap;
      scene.background = envMap;
      
      pmremGenerator.dispose();
      
      // Add strategic lighting with settings based on rendering mode
      const keyLight = new THREE.DirectionalLight(0xfffbf0, 0.9);
      keyLight.position.set(1, 2, 3);
      
      if (renderingMode === 'quality') {
        // High-quality shadow settings
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
      } else {
        // No shadows in performance mode
        keyLight.castShadow = false;
      }
      scene.add(keyLight);
      
      // Only add extra lights in quality mode
      if (renderingMode === 'quality') {
        const rimLight = new THREE.DirectionalLight(0xc4e0ff, 0.3);
        rimLight.position.set(-3, 1, -2);
        scene.add(rimLight);
        
        const sunsetLight = new THREE.DirectionalLight(0xff7e47, 1.8);
        sunsetLight.position.set(-5, 30, 30);
        sunsetLight.castShadow = true;
        sunsetLight.shadow.mapSize.width = 2048;
        sunsetLight.shadow.mapSize.height = 2048;
        sunsetLight.shadow.camera.near = 0.1;
        sunsetLight.shadow.camera.far = 500;
        sunsetLight.shadow.camera.left = -120;
        sunsetLight.shadow.camera.right = 120;
        sunsetLight.shadow.camera.top = 120;
        sunsetLight.shadow.camera.bottom = -120;
        sunsetLight.shadow.bias = -0.0003;
        sunsetLight.shadow.radius = 4;
        scene.add(sunsetLight);
        
        const fillLight = new THREE.DirectionalLight(0xfff0c0, 0.2);
        fillLight.position.set(2, -1, -1);
        scene.add(fillLight);
      } else {
        // Add a basic directional light for performance mode
        const simpleLight = new THREE.DirectionalLight(0xffffff, 1.0);
        simpleLight.position.set(-5, 10, 7);
        scene.add(simpleLight);
      }
      
      // Always add ambient light but with different intensity
      const ambientLight = new THREE.HemisphereLight(
        0xffffff, 
        0xf0f5ff, 
        renderingMode === 'quality' ? 2.7 : 3.5
      );
      scene.add(ambientLight);
      
      // Create a model group for all geometry
      const modelGroup = new THREE.Group();
      scene.add(modelGroup);
      
      // Set camera position
      if (cameraPosition && cameraTarget) {
        camera.position.copy(cameraPosition);
        controls.target.copy(cameraTarget);
      } else {
        camera.position.set(0, -200, 100);
        controls.target.set(0, 0, 0);
      }
      camera.updateProjectionMatrix();
      
      // Add camera helper buttons
      const buttons: HTMLButtonElement[] = [];
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
          buttons.push(button);
        }
        
        return button;
      };
      
      const topButton = addCameraPositionButton('Top', [0, 50, 200]);
      topButton.style.left = '10px';
      
      const frontButton = addCameraPositionButton('Initial', [0, -200, 100]);
      frontButton.style.left = '60px';
      
      // Store all the scene data in the ref
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();

  // Mouse interaction handlers for hover detection
  const handleMouseMove = (event: MouseEvent) => {
    const now = Date.now();
    if (now - lastMouseMoveTime.current < 16) {
      return; // Skip if called too frequently
    }
    lastMouseMoveTime.current = now;
    
    if (!containerRef.current || !sceneDataRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    sceneDataRef.current.mouse.set(x, y);
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    // Perform raycasting with performance optimization
    sceneDataRef.current.raycaster.setFromCamera(sceneDataRef.current.mouse, camera);
    
    // Only intersect with visible objects and limit depth for performance
    const visibleObjects = modelGroup.children.filter(child => child.visible);
    const intersects = sceneDataRef.current.raycaster.intersectObjects(visibleObjects, false); // Don't recurse for performance
    
    if (intersects.length > 0) {
      const intersectedObject = intersects[0].object;
      
      // Skip hover effects for terrain meshes
      if (intersectedObject.name === 'terrain') {
        // Clear any existing hover state and return early
        if (sceneDataRef.current.hoveredMesh) {
          restoreOriginalMaterial(sceneDataRef.current.hoveredMesh);
          sceneDataRef.current.hoveredMesh = null;
          clearHover();
        }
        return;
      }
      
      // Check if this is a different mesh than currently hovered
      if (sceneDataRef.current.hoveredMesh !== intersectedObject) {
        // Clear previous hover state
        if (sceneDataRef.current.hoveredMesh) {
          restoreOriginalMaterial(sceneDataRef.current.hoveredMesh);
        }
        
        // Set new hover state
        sceneDataRef.current.hoveredMesh = intersectedObject;
        
        // Store original material and apply hover effect
        applyHoverMaterial(intersectedObject);
        
        // Extract properties directly from the intersected mesh
        // Since we now create individual meshes for each feature, this is straightforward
        let properties = null;
        
        // Check mesh userData first (most direct)
        if (intersectedObject.userData && intersectedObject.userData.properties) {
          properties = intersectedObject.userData.properties;
          console.log('✅ Found mesh properties:', properties);
        } 
        // Fallback to geometry userData (cast to Mesh for type safety)
        else if ((intersectedObject as THREE.Mesh).geometry?.userData?.properties) {
          properties = (intersectedObject as THREE.Mesh).geometry.userData.properties;
          console.log('✅ Found geometry properties:', properties);
        } else {
          console.log('❌ No properties found on geometry or mesh. Checking available data:');
          console.log('  - intersectedObject.userData:', intersectedObject.userData);
          console.log('  - geometry.userData:', (intersectedObject as THREE.Mesh).geometry?.userData);
        }
        
        setHoveredMesh(intersectedObject, properties);
      }
    } else {
      // No intersection, clear hover state
      if (sceneDataRef.current.hoveredMesh) {
        restoreOriginalMaterial(sceneDataRef.current.hoveredMesh);
        sceneDataRef.current.hoveredMesh = null;
        clearHover();
      }
    }
  };      const handleMouseLeave = () => {
        if (sceneDataRef.current?.hoveredMesh) {
          restoreOriginalMaterial(sceneDataRef.current.hoveredMesh);
          sceneDataRef.current.hoveredMesh = null;
        }
        clearHover();
      };

      // Material manipulation functions
      const applyHoverMaterial = (object: THREE.Object3D) => {
        if (!sceneDataRef.current) return;
        
        const mesh = object as THREE.Mesh;
        if (!mesh.material) return;
        
        // Store original material
        sceneDataRef.current.originalMaterials.set(object, mesh.material);
        
        // Create highlight material
        const isArray = Array.isArray(mesh.material);
        if (isArray) {
          const materials = mesh.material as THREE.Material[];
          const highlightMaterials = materials.map(material => {
            if (material instanceof THREE.LineBasicMaterial) {
              return new THREE.LineBasicMaterial({
                color: 0xffff00,
                linewidth: 4
              });
            } else {
              return new THREE.MeshStandardMaterial({
                color: 0xffff00,
                emissive: 0x444400,
                transparent: true,
                opacity: 0.8
              });
            }
          });
          mesh.material = highlightMaterials;
        } else {
          const material = mesh.material as THREE.Material;
          if (material instanceof THREE.LineBasicMaterial) {
            mesh.material = new THREE.LineBasicMaterial({
              color: 0xffff00,
              linewidth: 4
            });
          } else {
            mesh.material = new THREE.MeshStandardMaterial({
              color: 0xffff00,
              emissive: 0x444400,
              transparent: true,
              opacity: 0.8
            });
          }
        }
      };

      const restoreOriginalMaterial = (object: THREE.Object3D) => {
        if (!sceneDataRef.current) return;
        
        const originalMaterial = sceneDataRef.current.originalMaterials.get(object);
        if (originalMaterial) {
          const mesh = object as THREE.Mesh;
          mesh.material = originalMaterial;
          sceneDataRef.current.originalMaterials.delete(object);
        }
      };

      sceneDataRef.current = {
        scene,
        camera,
        controls,
        modelGroup,
        composer,
        raycaster,
        mouse,
        hoveredMesh: null,
        originalMaterials,
        initialized: true,
        buttons,
        isFirstRender: true,
        // Store event handlers for cleanup
        handleMouseMove,
        handleMouseLeave
      };

      // Register scene getter for export functionality
      setCurrentSceneGetter(() => sceneDataRef.current?.scene || null);

      // Add event listeners
      if (containerRef.current) {
        containerRef.current.addEventListener('mousemove', handleMouseMove);
        containerRef.current.addEventListener('mouseleave', handleMouseLeave);
      }
      
      // Animation loop
      const animate = () => {
        if (!rendererRef.current || !sceneDataRef.current) return;
        
        const { controls, camera, composer } = sceneDataRef.current;
        
        // Save camera position and target when it changes, with debouncing
        if (controls.target && camera.position) {
          // Store the camera position and target in a ref to avoid state updates during animation
          if (!sceneDataRef.current.savedCameraPosition ||
              !camera.position.equals(sceneDataRef.current.savedCameraPosition) || 
              !controls.target.equals(sceneDataRef.current.savedCameraTarget || new THREE.Vector3())) {
            
            // Store the current position and target in the ref
            sceneDataRef.current.savedCameraPosition = camera.position.clone();
            sceneDataRef.current.savedCameraTarget = controls.target.clone();
            
            // Only update the state occasionally to avoid re-renders
            if (!sceneDataRef.current.cameraUpdateTimeoutId) {
              sceneDataRef.current.cameraUpdateTimeoutId = setTimeout(() => {
                setCameraPosition(camera.position.clone());
                setCameraTarget(controls.target.clone());
                if (sceneDataRef.current) {
                  sceneDataRef.current.cameraUpdateTimeoutId = null;
                }
              }, 500); // Update state after 500ms of no camera movement
            }
          }
        }
        
        sceneDataRef.current.animationFrameId = requestAnimationFrame(animate);
        controls.update();
        
        // Use the composer for enhanced rendering with post-processing
        composer.render();
      };
      
      // @ts-expect-error Debug camera exposure to global scope
      document.debug_camera = camera; // Expose camera to global scope for debugging
      
      animate();
      console.log("Scene initialization completed");
      updateScene();
      
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
  }, [renderingMode]); // Only depend on rendering mode, not camera position
  
  // Update scene geometry with latest data
  // Function to update only material colors without recreating geometry
  const updateMaterialColors = useCallback(() => {
    if (!sceneDataRef.current || !Object.keys(layerColorUpdates).length) return;
    
    console.log("Updating material colors only", layerColorUpdates);
    const { modelGroup } = sceneDataRef.current;
    
    modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Handle layer color updates
        if (child.userData?.sourceLayer) {
          const newColor = layerColorUpdates[child.userData.sourceLayer];
          if (newColor && child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => {
                if ('color' in mat) mat.color = newColor.clone();
              });
            } else if ('color' in child.material) {
              child.material.color = newColor.clone();
            }
          }
        }
        
        // Handle terrain color updates
        if (child.name === 'terrain' && layerColorUpdates.terrain) {
          const terrainColor = layerColorUpdates.terrain;
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => {
                if ('color' in mat) mat.color = terrainColor.clone();
              });
            } else if ('color' in child.material) {
              child.material.color = terrainColor.clone();
            }
          }
        }

        // Handle terrain base height updates (real-time z-translation)
        if (child.name === 'terrain' && layerColorUpdates.terrainBaseHeight !== undefined) {
          const baseHeight = layerColorUpdates.terrainBaseHeight as number;
          child.position.z = baseHeight;
        }

        // Handle layer z-offset updates (real-time z-translation)
        if (child.userData?.sourceLayer) {
          const zOffsetKey = `${child.userData.sourceLayer}_zOffset`;
          const heightScaleKey = `${child.userData.sourceLayer}_heightScaleFactor`;
          
          if (layerColorUpdates[zOffsetKey] !== undefined) {
            const zOffset = layerColorUpdates[zOffsetKey] as number;
            child.position.z = zOffset;
          }

          // Handle height scale factor updates (real-time scaling)
          if (layerColorUpdates[heightScaleKey] !== undefined) {
            const heightScale = layerColorUpdates[heightScaleKey] as number;
            child.scale.z = heightScale;
          }
        }
      }
    });
    
    clearColorOnlyUpdate();
  }, [layerColorUpdates, clearColorOnlyUpdate]);

  const updateScene = useCallback(() => {
    if (!sceneDataRef.current || !rendererRef.current) return;
    
    try {
      console.log("Updating model geometry", {
        hasTerrainGeometry: !!geometryDataSets.terrainGeometry,
        hasPolygonGeometries: !!geometryDataSets.polygonGeometries?.length,
        renderingMode
      });
      const { modelGroup } = sceneDataRef.current;
      
      // Clear existing geometry
      while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        modelGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(material => material.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      }
      
      // Add terrain if available
      if (geometryDataSets.terrainGeometry) {
        console.log("Adding terrain geometry to scene:", {
          vertexCount: geometryDataSets.terrainGeometry.attributes?.position?.count || 0,
          valid: !!geometryDataSets.terrainGeometry.attributes?.position?.count
        });
        // Create terrain material based on rendering mode
        let terrainMaterial;
        
        if (renderingMode === 'quality') {
          // High-quality material with more complex properties
          terrainMaterial = new THREE.MeshStandardMaterial({
            vertexColors: terrainSettings.color ? false : true,
            color: terrainSettings.color ? new THREE.Color(terrainSettings.color) : undefined,
            roughness: 0.8,
            metalness: 0.01,
            envMapIntensity: 0.4,
            flatShading: true,
            side: THREE.DoubleSide
          });
        } else {
          // Performance-optimized material with simpler properties
          terrainMaterial = new THREE.MeshLambertMaterial({
            vertexColors: terrainSettings.color ? false : true,
            color: terrainSettings.color ? new THREE.Color(terrainSettings.color) : undefined,
            flatShading: true,
            side: THREE.DoubleSide
          });
        }
        
        // Apply the material to the terrain mesh
        const geometryMesh = new THREE.Mesh(
          geometryDataSets.terrainGeometry,
          terrainMaterial
        );
        geometryMesh.name = 'terrain'; // Identify this as terrain mesh
        geometryMesh.castShadow = renderingMode === 'quality';
        geometryMesh.receiveShadow = renderingMode === 'quality';
        modelGroup.add(geometryMesh);
      }
      
      // Process polygon geometries
      if (geometryDataSets.polygonGeometries && geometryDataSets.polygonGeometries.length > 0) {
        geometryDataSets.polygonGeometries.forEach(({geometry, ...vtDataset}) => {
          if (!geometry) return; // Skip if geometry is undefined
          
          // Check if this is a container geometry with individual geometries
          if (geometry.userData?.isContainer && geometry.userData?.individualGeometries) {
            console.log(`Processing container with ${geometry.userData.geometryCount} individual geometries for ${vtDataset.sourceLayer}`);
            
            // Process each individual geometry as a separate mesh
            const individualGeometries = geometry.userData.individualGeometries as THREE.BufferGeometry[];
            
            individualGeometries.forEach((individualGeometry, index) => {
              if (!individualGeometry.attributes.position || individualGeometry.attributes.position.count === 0) {
                return; // Skip empty geometries
              }
              
              // Create color for polygon
              const baseColor = vtDataset.color || new THREE.Color(0x81ecec);
              
              // Always render as solid mesh
              const enhancedColor = new THREE.Color().copy(baseColor).convertSRGBToLinear();
              enhancedColor.r = Math.min(1, enhancedColor.r * 1.2);
              enhancedColor.g = Math.min(1, enhancedColor.g * 1.2);
              enhancedColor.b = Math.min(1, enhancedColor.b * 1.2);
              
              // Create material based on rendering mode
              let polygonMaterial;
              if (renderingMode === 'quality') {
                polygonMaterial = new THREE.MeshPhysicalMaterial({
                  color: enhancedColor,
                  roughness: 0.35,
                  metalness: 0.01,
                  clearcoat: 0.06,
                  clearcoatRoughness: 2,
                  side: THREE.DoubleSide
                });
              } else {
                polygonMaterial = new THREE.MeshStandardMaterial({
                  color: enhancedColor,
                  roughness: 0.35,
                  metalness: 0,
                  flatShading: true,
                  side: THREE.DoubleSide
                });
              }
              
              // Create mesh
              const polygonMesh = new THREE.Mesh(individualGeometry, polygonMaterial);
              polygonMesh.castShadow = renderingMode === 'quality';
              polygonMesh.receiveShadow = renderingMode === 'quality';
              polygonMesh.name = `${vtDataset.sourceLayer}_${index}`;
              
              // Preserve individual properties for hover interaction
              // Prioritize MVT feature properties over layer configuration
              const mvtProperties = individualGeometry.userData?.properties || {};
              const properties = {
                // First add MVT feature properties (these are what we want to show)
                ...mvtProperties,
                // Then add only essential layer info (but don't override MVT properties)
                _sourceLayer: vtDataset.sourceLayer,
                _layerType: "solid",
                _geometryIndex: index,
              };
              
              individualGeometry.userData = { properties };
              polygonMesh.userData = { properties, sourceLayer: vtDataset.sourceLayer };
              
              modelGroup.add(polygonMesh);
            });
            
            return; // Skip the original processing for container geometries
          }
          
          // Original processing for non-container geometries
          // Create color for polygon
          const baseColor = vtDataset.color || new THREE.Color(0x81ecec);
          
          // Always render as solid mesh
          // Create slightly brightened color
          const enhancedColor = new THREE.Color().copy(baseColor).convertSRGBToLinear();
          enhancedColor.r = Math.min(1, enhancedColor.r * 1.2);
          enhancedColor.g = Math.min(1, enhancedColor.g * 1.2);
          enhancedColor.b = Math.min(1, enhancedColor.b * 1.2);
          
          // Create material based on rendering mode
          let polygonMaterial;
          
          if (renderingMode === 'quality') {
            // High-quality material with physically-based properties
            polygonMaterial = new THREE.MeshPhysicalMaterial({
              color: enhancedColor,
              roughness: 0.35,
              metalness: 0.01,
              clearcoat: 0.06,
              clearcoatRoughness: 2,
              envMapIntensity: 0.7,
              flatShading: false,
              side: THREE.DoubleSide
            });
          } else {
            // Performance-optimized simpler material
            polygonMaterial = new THREE.MeshStandardMaterial({
              color: enhancedColor,
              roughness: 0.5,
              metalness: 0,
              flatShading: true,
              side: THREE.DoubleSide
            });
          }
          
          // Create mesh
          const polygonMesh = new THREE.Mesh(geometry, polygonMaterial);
          polygonMesh.castShadow = renderingMode === 'quality';
          polygonMesh.receiveShadow = renderingMode === 'quality';
          
          // Attach properties to the geometry and mesh for hover interaction  
          const mvtProperties = geometry.userData?.properties || {};
          console.log('Existing geometry properties from userData:', mvtProperties);
          
          // Prioritize MVT feature properties over layer configuration
          const properties = {
            // First add MVT feature properties (these are what we want to show)
            ...mvtProperties,
            // Then add only essential layer info (but don't override MVT properties)
            _sourceLayer: vtDataset.sourceLayer,
            _layerType: "solid",
          };
          
          geometry.userData = { properties };
          polygonMesh.userData = { properties, sourceLayer: vtDataset.sourceLayer };
          
          modelGroup.add(polygonMesh);
        });
      }
      
      setLoading(false);
    } catch (updateError) {
      console.error("Error updating scene:", updateError);
      setError(
        `Failed to update 3D scene: ${
          updateError instanceof Error
            ? updateError.message
            : String(updateError)
        }`
      );
      setLoading(false);
    }
  }, [geometryDataSets.terrainGeometry, geometryDataSets.polygonGeometries, terrainSettings, renderingMode]);
  
  // Initialize scene when component mounts
  useEffect(() => {
    if (!containerRef.current) return;
    
    console.log("ModelPreview mounted");

    // Auto-detect and set optimal rendering mode on first mount
    if (!hasSetInitialMode) {
      const detectedMode = detectDeviceCapabilities();
      console.log(`Setting initial rendering mode to ${detectedMode} based on device capabilities`);
      setRenderingMode(detectedMode);
      setHasSetInitialMode(true);
    }
    
    // Clear any existing canvases in the container first
    containerRef.current.querySelectorAll('button').forEach(button => {
      console.log("Removing existing buttons before initialization");
      button.remove();
    });
    // Clear any existing canvases in the container first
    containerRef.current.querySelectorAll('canvas').forEach(canvas => {
      console.log("Removing existing canvas before initialization");
      canvas.remove();
    });
    
    initScene();
    
    // Setup resize handler
    const handleResizeWrapper = () => handleResize();
    window.addEventListener('resize', handleResizeWrapper);
    
    // Setup ResizeObserver
    const resizeObserver = new ResizeObserver(handleResizeWrapper);
    resizeObserverRef.current = resizeObserver;
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    // Cleanup when component unmounts
    return () => {
      console.log("Cleaning up ModelPreview resources");
      window.removeEventListener('resize', handleResizeWrapper);
      
      if (resizeObserverRef.current && containerRef.current) {
        resizeObserverRef.current.unobserve(containerRef.current);
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      
      if (sceneDataRef.current?.animationFrameId) {
        cancelAnimationFrame(sceneDataRef.current.animationFrameId);
      }
      
      // Remove buttons
      if (sceneDataRef.current?.buttons) {
        sceneDataRef.current.buttons.forEach(button => {
          if (containerRef.current?.contains(button)) {
            containerRef.current.removeChild(button);
          }
        });
      }

      // Remove event listeners
      if (sceneDataRef.current?.handleMouseMove && sceneDataRef.current?.handleMouseLeave) {
        const container = containerRef.current;
        if (container) {
          container.removeEventListener('mousemove', sceneDataRef.current.handleMouseMove);
          container.removeEventListener('mouseleave', sceneDataRef.current.handleMouseLeave);
        }
      }

      // Dispose of ThreeJS resources
      if (sceneDataRef.current) {
        const { scene, modelGroup } = sceneDataRef.current;
        
        // Dispose of all geometries and materials in the model group
        while (modelGroup.children.length > 0) {
          const child = modelGroup.children[0];
          modelGroup.remove(child);
          if (child instanceof THREE.Mesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(material => material.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        }
        
        scene.clear();
        sceneDataRef.current = null;
      }
      
      if (rendererRef.current) {
        if (containerRef.current && containerRef.current.contains(rendererRef.current.domElement)) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [initScene, handleResize]);
  
  // Update scene when geometry data or rendering mode changes
  // Handle color-only updates
  useEffect(() => {
    if (colorOnlyUpdate && sceneDataRef.current?.initialized) {
      console.log("Handling color-only update");
      updateMaterialColors();
    }
  }, [colorOnlyUpdate, updateMaterialColors]);

  // Handle full geometry updates
  useEffect(() => {
    if (sceneDataRef.current?.initialized && !colorOnlyUpdate) {
      console.log("Triggering updateScene due to dependency changes");
      updateScene();
    }
  }, [updateScene, geometryDataSets.terrainGeometry, geometryDataSets.polygonGeometries, renderingMode]);

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
      <HoverTooltip />
    </div>
  );
};

export default ModelPreview;
