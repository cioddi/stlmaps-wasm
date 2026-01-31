import { useEffect, useRef, useState, useCallback } from "react";
import { CircularProgress } from "@mui/material";
import * as THREE from "three";
// @ts-expect-error - Three.js types don't include examples
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
// @ts-expect-error - Three.js types don't include postprocessing
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
// @ts-expect-error - Three.js types don't include postprocessing
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
// @ts-expect-error - Three.js types don't include postprocessing
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
// @ts-expect-error - Three.js types don't include postprocessing
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
// @ts-expect-error - Three.js types don't include postprocessing
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { useAppStore } from "../stores/useAppStore";

// Maximum vertices per geometry for mobile devices without OES_element_index_uint
const MAX_VERTICES_16BIT = 65535;

/**
 * Splits a geometry that exceeds 65,535 vertices into multiple sub-geometries.
 * This is necessary for mobile devices that don't support the OES_element_index_uint extension.
 * 
 * @param geometry - The BufferGeometry to potentially split
 * @returns An array of geometries (may contain just the original if no split needed)
 */
function splitGeometryForMobile(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const positionAttribute = geometry.attributes.position;
  if (!positionAttribute) return [geometry];

  const vertexCount = positionAttribute.count;

  // ALWAYS sanitize geometries for mobile - creates clean buffers with proper 16-bit indices
  // This fixes buffer corruption issues, not just the 16-bit index limit
  const needsSplit = vertexCount > MAX_VERTICES_16BIT;

  if (needsSplit) {
    console.log(`🔧 Splitting geometry with ${vertexCount} vertices for mobile compatibility`);
  }

  const geometries: THREE.BufferGeometry[] = [];
  const hasNormals = !!geometry.attributes.normal;
  const hasColors = !!geometry.attributes.color;
  const hasUVs = !!geometry.attributes.uv;
  const hasIndices = !!geometry.index;

  // For indexed geometry, we need to split by faces
  if (hasIndices) {
    const indices = geometry.index!.array;
    const positions = positionAttribute.array as Float32Array;
    const normals = hasNormals ? (geometry.attributes.normal.array as Float32Array) : null;
    const colors = hasColors ? (geometry.attributes.color.array as Float32Array) : null;

    // Process triangles in chunks
    const triangleCount = indices.length / 3;
    const maxTrianglesPerChunk = Math.floor(MAX_VERTICES_16BIT / 3);

    for (let startTriangle = 0; startTriangle < triangleCount; startTriangle += maxTrianglesPerChunk) {
      const endTriangle = Math.min(startTriangle + maxTrianglesPerChunk, triangleCount);

      // Build vertex map for this chunk
      const vertexMap = new Map<number, number>();
      const newPositions: number[] = [];
      const newNormals: number[] = [];
      const newColors: number[] = [];
      const newIndices: number[] = [];

      for (let t = startTriangle; t < endTriangle; t++) {
        for (let v = 0; v < 3; v++) {
          const oldIndex = indices[t * 3 + v];

          if (!vertexMap.has(oldIndex)) {
            const newIndex = newPositions.length / 3;
            vertexMap.set(oldIndex, newIndex);

            // Copy position
            newPositions.push(
              positions[oldIndex * 3],
              positions[oldIndex * 3 + 1],
              positions[oldIndex * 3 + 2]
            );

            // Copy normal if exists
            if (normals) {
              newNormals.push(
                normals[oldIndex * 3],
                normals[oldIndex * 3 + 1],
                normals[oldIndex * 3 + 2]
              );
            }

            // Copy color if exists
            if (colors) {
              newColors.push(
                colors[oldIndex * 3],
                colors[oldIndex * 3 + 1],
                colors[oldIndex * 3 + 2]
              );
            }
          }

          newIndices.push(vertexMap.get(oldIndex)!);
        }
      }

      // Create new geometry for this chunk
      const chunkGeometry = new THREE.BufferGeometry();
      chunkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));

      if (newNormals.length > 0) {
        chunkGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
      }

      if (newColors.length > 0) {
        chunkGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
      }

      // Use 16-bit indices for mobile compatibility
      chunkGeometry.setIndex(new THREE.Uint16BufferAttribute(newIndices, 1));

      // Copy userData
      chunkGeometry.userData = { ...geometry.userData };

      geometries.push(chunkGeometry);
    }
  } else {
    // Non-indexed geometry: split vertices directly
    const positions = positionAttribute.array as Float32Array;
    const normals = hasNormals ? (geometry.attributes.normal.array as Float32Array) : null;
    const colors = hasColors ? (geometry.attributes.color.array as Float32Array) : null;

    // Split by triangles (3 vertices each)
    const triangleCount = vertexCount / 3;
    const maxTrianglesPerChunk = Math.floor(MAX_VERTICES_16BIT / 3);

    for (let startTriangle = 0; startTriangle < triangleCount; startTriangle += maxTrianglesPerChunk) {
      const endTriangle = Math.min(startTriangle + maxTrianglesPerChunk, triangleCount);
      const startVertex = startTriangle * 3;
      const endVertex = endTriangle * 3;

      const chunkGeometry = new THREE.BufferGeometry();
      chunkGeometry.setAttribute('position',
        new THREE.Float32BufferAttribute(positions.slice(startVertex * 3, endVertex * 3), 3));

      if (normals) {
        chunkGeometry.setAttribute('normal',
          new THREE.Float32BufferAttribute(normals.slice(startVertex * 3, endVertex * 3), 3));
      }

      if (colors) {
        chunkGeometry.setAttribute('color',
          new THREE.Float32BufferAttribute(colors.slice(startVertex * 3, endVertex * 3), 3));
      }

      // Copy userData
      chunkGeometry.userData = { ...geometry.userData };

      geometries.push(chunkGeometry);
    }
  }

  console.log(`✅ Split into ${geometries.length} sub-geometries`);
  return geometries;
}

/**
 * Checks if the WebGL context supports 32-bit indices
 */
function checkUint32IndexSupport(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  // WebGL2 always supports 32-bit indices
  if (gl instanceof WebGL2RenderingContext) {
    return true;
  }
  // WebGL1 requires the OES_element_index_uint extension
  const ext = gl.getExtension('OES_element_index_uint');
  return !!ext;
}// Interface for scene data to be stored in ref
interface SceneData {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  modelGroup: THREE.Group;
  composer: EffectComposer;
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

    }
  } catch (e) {

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


  // Special rule: Non-mobile devices with limited specs always get performance mode
  // This ensures older desktops/laptops with 4 cores and ≤8GB RAM don't get quality mode
  if (!isMobile && cpuCores <= 4 && deviceMemory <= 8) {

    return 'performance';
  }

  // Decision threshold - adjusted for better balance
  const qualityThreshold = isMobile ? 6 : 7; // Slightly higher bar for desktop
  const useQualityMode = totalScore >= qualityThreshold;

  const recommendedMode = useQualityMode ? 'quality' : 'performance';


  return recommendedMode;
};

const ModelPreview = () => {
  // Get geometry data and settings from the Zustand store
  const {
    geometryDataSets,
    vtLayers,
    terrainSettings,
    renderingSettings,
    colorOnlyUpdate,
    layerColorUpdates,
    setRenderingSettings,
    clearColorOnlyUpdate,
    setSceneGetter
  } = useAppStore();

  const setRenderingMode = (mode: 'quality' | 'performance') => {
    setRenderingSettings({ mode });
  };

  const setCurrentSceneGetter = (getter: (() => THREE.Scene | null) | null) => {
    setSceneGetter(getter);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneDataRef = useRef<SceneData | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const updateDebounceRef = useRef<NodeJS.Timeout | null>(null);
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
      rendererRef.current.outputColorSpace = THREE.SRGBColorSpace;
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
          0.15,
          0.25,
          1.2
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
      // Remove global environment mapping for matte materials - keep only background
      scene.environment = null; // No global environment reflections
      scene.background = envMap;  // Keep gradient background for aesthetics

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


      sceneDataRef.current = {
        scene,
        camera,
        controls,
        modelGroup,
        composer,
        initialized: true,
        buttons,
        isFirstRender: true
      };

      // Register scene getter for export functionality
      setCurrentSceneGetter(() => sceneDataRef.current?.scene || null);

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

      updateScene();

    } catch (setupError) {

      setError(
        `Failed to setup 3D viewer: ${setupError instanceof Error
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


    const { modelGroup } = sceneDataRef.current;

    modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Handle layer color updates (support both old and new layer identification)
        const layerKey = child.userData?.label || child.userData?.sourceLayer;
        if (layerKey) {
          const newColor = layerColorUpdates[layerKey];
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
        const layerKey2 = child.userData?.label || child.userData?.sourceLayer;
        if (layerKey2) {
          const zOffsetKey = `${layerKey2}_zOffset`;
          const heightScaleKey = `${layerKey2}_heightScaleFactor`;

          if (layerColorUpdates[zOffsetKey] !== undefined) {
            const zOffset = layerColorUpdates[zOffsetKey] as number;

            // Find the layer config to check if it has terrain alignment
            const currentLayerConfig = vtLayers.find(
              layer => layer.label === layerKey2 || layer.sourceLayer === layerKey2
            );
            const hasTerrainAlignment = currentLayerConfig?.alignVerticesToTerrain === true;

            if (hasTerrainAlignment) {
              // Terrain-aligned layers: only use zOffset (vertices already positioned on terrain)
              child.position.z = zOffset;
            } else {
              // Non-terrain-aligned layers: position at base height + zOffset
              child.position.z = terrainSettings.baseHeight + zOffset;
            }
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
  }, [layerColorUpdates, clearColorOnlyUpdate, terrainSettings.baseHeight, vtLayers]);

  // Debounced version of updateMaterialColors
  const debouncedUpdateMaterialColors = useCallback(() => {
    // Clear any existing debounce timeout
    if (updateDebounceRef.current) {
      clearTimeout(updateDebounceRef.current);
    }

    // Set a new debounce timeout
    updateDebounceRef.current = setTimeout(() => {
      updateMaterialColors();
      updateDebounceRef.current = null;
    }, 50); // 50ms debounce delay
  }, [updateMaterialColors]);

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

      console.log("🏔️ Layer positioning debug:", {
        terrainBaseHeight: terrainSettings.baseHeight,
        vtLayers: vtLayers.map(layer => ({
          sourceLayer: layer.sourceLayer,
          zOffset: layer.zOffset,
          enabled: layer.enabled
        }))
      });

      // Add terrain if available and enabled
      if (geometryDataSets.terrainGeometry && terrainSettings.enabled) {
        console.log("Adding terrain geometry to scene:", {
          vertexCount: geometryDataSets.terrainGeometry.attributes?.position?.count || 0,
          valid: !!geometryDataSets.terrainGeometry.attributes?.position?.count
        });

        // Split terrain geometry for mobile devices with 16-bit index limitation
        const terrainGeometries = splitGeometryForMobile(geometryDataSets.terrainGeometry);

        terrainGeometries.forEach((terrainGeo, index) => {
          // Create terrain material exactly like live updates do
          const terrainMaterial = new THREE.MeshLambertMaterial({
            vertexColors: terrainSettings.color ? false : true,
            flatShading: true,
            side: THREE.DoubleSide
          });

          // Set color after material creation (exactly like live updates)
          if (terrainSettings.color) {
            const terrainColor = new THREE.Color(terrainSettings.color);
            terrainMaterial.color = terrainColor.clone();
          }

          // Apply the material to the terrain mesh
          const geometryMesh = new THREE.Mesh(terrainGeo, terrainMaterial);
          geometryMesh.name = terrainGeometries.length > 1 ? `terrain_${index}` : 'terrain';
          geometryMesh.position.z = 0; // Terrain geometry always at Z=0
          geometryMesh.castShadow = renderingMode === 'quality';
          geometryMesh.receiveShadow = renderingMode === 'quality';

          modelGroup.add(geometryMesh);
        });
      }

      // Process polygon geometries
      if (geometryDataSets.polygonGeometries && geometryDataSets.polygonGeometries.length > 0) {
        geometryDataSets.polygonGeometries.forEach(({ geometry, ...vtDataset }) => {
          if (!geometry) return; // Skip if geometry is undefined

          // Look up current layer configuration once (used for enabled state, color, zOffset, etc.)
          const currentLayerConfig = vtLayers.find(layer => layer.label === vtDataset.label);
          const isCurrentlyEnabled = currentLayerConfig?.enabled !== false;


          // Check if this is a container geometry with individual geometries
          if (geometry.userData?.isContainer && geometry.userData?.individualGeometries) {

            // Process each individual geometry as a separate mesh
            const individualGeometries = geometry.userData.individualGeometries as THREE.BufferGeometry[];

            individualGeometries.forEach((individualGeometry, index) => {
              if (!individualGeometry.attributes.position || individualGeometry.attributes.position.count === 0) {
                return; // Skip empty geometries
              }

              // Split for mobile compatibility (in case any individual geometry is large)
              const splitGeoms = splitGeometryForMobile(individualGeometry);

              splitGeoms.forEach((splitGeom, splitIndex) => {
                // Create color for polygon exactly like live updates do
                const layerColor = currentLayerConfig?.color || "#81ecec";
                const baseColor = new THREE.Color(layerColor);

                // Use simple Lambert material like performance mode - it works perfectly
                const polygonMaterial = new THREE.MeshLambertMaterial({
                  flatShading: true,
                  side: THREE.DoubleSide
                });

                // Set color after material creation (exactly like live updates)
                polygonMaterial.color = baseColor.clone();

                // Check if this layer has per-vertex terrain alignment
                const hasTerrainAlignment = currentLayerConfig?.alignVerticesToTerrain === true;

                // Create mesh
                const polygonMesh = new THREE.Mesh(splitGeom, polygonMaterial);

                // Position mesh using the layer's configured zOffset value
                const layerZOffset = currentLayerConfig?.zOffset || 0;
                const layerHeightScaleFactor = currentLayerConfig?.heightScaleFactor || 1;

                // Apply height scale factor to the mesh
                polygonMesh.scale.z = layerHeightScaleFactor;

                if (hasTerrainAlignment) {
                  // Per-vertex terrain alignment: vertices already have correct Z positions
                  // Only apply a small zOffset to prevent z-fighting, don't reposition the mesh
                  polygonMesh.position.z = layerZOffset;

                  // Debug: log actual vertex Z range to verify alignment
                  if (!splitGeom.boundingBox) {
                    splitGeom.computeBoundingBox();
                  }
                } else {
                  // Non-terrain-aligned: adjust geometry origin and position at base height
                  let originalBottomZ = 0;
                  if (!splitGeom.boundingBox) {
                    splitGeom.computeBoundingBox();
                  }
                  if (splitGeom.boundingBox) {
                    originalBottomZ = splitGeom.boundingBox.min.z;
                    // Translate geometry so bottom is at origin (z=0)
                    splitGeom.translate(0, 0, -originalBottomZ);
                  }

                  // Position mesh using the layer's configured zOffset value
                  polygonMesh.position.z = terrainSettings.baseHeight + layerZOffset;
                }
                polygonMesh.castShadow = renderingMode === 'quality';
                polygonMesh.receiveShadow = renderingMode === 'quality';
                polygonMesh.name = `${vtDataset.sourceLayer}_${index}`;

                // Control visibility based on current layer enabled state
                polygonMesh.visible = isCurrentlyEnabled;


                // Set minimal userData needed for layer identification in live updates
                polygonMesh.userData = {
                  sourceLayer: vtDataset.sourceLayer,
                  label: vtDataset.label || vtDataset.sourceLayer
                };

                modelGroup.add(polygonMesh);
              }); // End of splitGeoms.forEach
            }); // End of individualGeometries.forEach

            return; // Skip the original processing for container geometries
          }

          // Original processing for non-container geometries
          // Create color for polygon exactly like live updates do
          const layerColor = currentLayerConfig?.color || "#81ecec";
          const baseColor = new THREE.Color(layerColor);

          // Use simple Lambert material like performance mode - it works perfectly
          const polygonMaterial = new THREE.MeshLambertMaterial({
            flatShading: true,
            side: THREE.DoubleSide
          });

          // Set color after material creation (exactly like live updates)
          polygonMaterial.color = baseColor.clone();

          // Check if this layer has per-vertex terrain alignment
          const hasTerrainAlignment = currentLayerConfig?.alignVerticesToTerrain === true;

          // Create mesh
          const polygonMesh = new THREE.Mesh(geometry, polygonMaterial);

          // Position mesh using the layer's configured zOffset value
          const layerZOffset = currentLayerConfig?.zOffset || 0;

          if (hasTerrainAlignment) {
            // Per-vertex terrain alignment: vertices already have correct Z positions
            // Only apply a small zOffset to prevent z-fighting, don't reposition the mesh
            polygonMesh.position.z = layerZOffset;
          } else {
            // Non-terrain-aligned: adjust geometry origin and position at base height
            let originalBottomZ = 0;
            if (!geometry.boundingBox) {
              geometry.computeBoundingBox();
            }
            if (geometry.boundingBox) {
              originalBottomZ = geometry.boundingBox.min.z;
              // Translate geometry so bottom is at origin (z=0)
              geometry.translate(0, 0, -originalBottomZ);
            }

            // Position mesh using the layer's configured zOffset value
            polygonMesh.position.z = terrainSettings.baseHeight + layerZOffset;
          }
          polygonMesh.castShadow = renderingMode === 'quality';
          polygonMesh.receiveShadow = renderingMode === 'quality';

          // Control visibility based on current layer enabled state
          polygonMesh.visible = isCurrentlyEnabled;


          // Set minimal userData needed for layer identification in live updates
          polygonMesh.userData = {
            sourceLayer: vtDataset.sourceLayer,
            label: vtDataset.label || vtDataset.sourceLayer
          };

          modelGroup.add(polygonMesh);
        });
      }

      setLoading(false);
    } catch (updateError) {

      setError(
        `Failed to update 3D scene: ${updateError instanceof Error
          ? updateError.message
          : String(updateError)
        }`
      );
      setLoading(false);
    }
  }, [geometryDataSets.terrainGeometry, geometryDataSets.polygonGeometries, terrainSettings, renderingMode]);

  // Update mesh visibility when layer enabled states change (without rebuilding geometry)
  useEffect(() => {
    if (!sceneDataRef.current) return;

    const { scene } = sceneDataRef.current;

    // Update visibility of existing meshes based on current layer enabled states
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && (object.userData?.sourceLayer || object.userData?.label)) {
        // Support both old (sourceLayer) and new (label) identification systems
        const layerIdentifier = object.userData.label || object.userData.sourceLayer;
        const currentLayer = vtLayers.find(layer =>
          layer.label === layerIdentifier || layer.sourceLayer === layerIdentifier
        );
        const isCurrentlyEnabled = currentLayer?.enabled !== false;

        // Update mesh visibility
        object.visible = isCurrentlyEnabled;
      }
    });

    // Also handle terrain visibility
    const terrainMesh = scene.getObjectByName('terrain');
    if (terrainMesh) {
      terrainMesh.visible = terrainSettings.enabled;
    }

  }, [vtLayers, terrainSettings.enabled]);

  // Initialize scene when component mounts
  useEffect(() => {
    if (!containerRef.current) return;



    // Auto-detect and set optimal rendering mode on first mount
    if (!hasSetInitialMode) {
      const detectedMode = detectDeviceCapabilities();

      setRenderingMode(detectedMode);
      setHasSetInitialMode(true);
    }

    // Clear any existing canvases in the container first
    containerRef.current.querySelectorAll('button').forEach(button => {

      button.remove();
    });
    // Clear any existing canvases in the container first
    containerRef.current.querySelectorAll('canvas').forEach(canvas => {

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

      window.removeEventListener('resize', handleResizeWrapper);

      // Clear debounce timeout
      if (updateDebounceRef.current) {
        clearTimeout(updateDebounceRef.current);
        updateDebounceRef.current = null;
      }

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
  // Handle color-only updates (debounced)
  useEffect(() => {
    if (colorOnlyUpdate && sceneDataRef.current?.initialized) {

      debouncedUpdateMaterialColors();
    }
  }, [colorOnlyUpdate, debouncedUpdateMaterialColors]);

  // Handle full geometry updates
  useEffect(() => {
    if (sceneDataRef.current?.initialized && !colorOnlyUpdate) {

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
    </div>
  );
};

export default ModelPreview;
