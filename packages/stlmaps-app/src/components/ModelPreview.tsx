import { useEffect, useRef, useState, version } from "react";
import { CircularProgress } from "@mui/material";
import * as THREE from "three";
// @ts-expect-error
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
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
        // Initialize Three.js scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);

        // Add lighting
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
        scene.add(hemiLight);

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
          alpha: true,
        });
        rendererRef.current.setSize(width, height);
        rendererRef.current.setPixelRatio(window.devicePixelRatio);
        rendererRef.current.shadowMap.enabled = true;
        rendererRef.current.shadowMap.type = THREE.PCFSoftShadowMap; // Better shadow quality
        containerRef.current.appendChild(rendererRef.current.domElement);

        // Add orbit controls with better settings
        const controls = new OrbitControls(
          camera,
          rendererRef.current.domElement
        );
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = true;
        controls.minDistance = 0.1;
        controls.maxDistance = 500; // Significantly increased to allow much more zoom out

        // Add an axes helper
        const axesHelper = new THREE.AxesHelper(10);
        scene.add(axesHelper);

        function createAxisLabel(text: string, color: string): Sprite {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx)
            throw new Error("Failed to get canvas context for axis label.");

          canvas.width = 256;
          canvas.height = 64;
          ctx.fillStyle = color;
          ctx.font = "28px Arial";
          ctx.fillText(text, 10, 40);

          const texture = new CanvasTexture(canvas);
          const spriteMaterial = new SpriteMaterial({
            map: texture,
            depthTest: false,
          });
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

        const modelGroup = new THREE.Group();
        const geometryMesh = new THREE.Mesh(
          geometryDataSets.terrainGeometry,
          new THREE.MeshPhongMaterial({ vertexColors: true })
        );
        modelGroup.add(geometryMesh);

        if (geometryDataSets.polygonGeometries) {
          geometryDataSets.polygonGeometries.forEach(({geometry, ...vtDataset}) => {
            const polygonMesh = new THREE.Mesh(
              geometry,
              new THREE.MeshPhongMaterial({
                color: vtDataset.color, // Light sky blue
                //VertexColors: true,
                flatShading: true, // Use flat shading for better definition
                shininess: 0, // Remove shininess for a matte look
              })
            );
            modelGroup.add(polygonMesh);
          });
        }

        scene.add(modelGroup);

        modelGroup.position.set(0, 0, 0);
        camera.position.set(0, -145, 30);

        //camera.position.set(80, 200, 600);
        camera.updateProjectionMatrix();

        // Animation loop
        const animate = () => {
          if (!rendererRef.current) return;

          animationFrameId = requestAnimationFrame(animate);
          controls.update();
          rendererRef.current.render(scene, camera);
        };

        // @ts-expect-error
        document.debug_camera = camera; // Expose camera to global scope for debugging
        animate();
        console.log("Animation started");
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
