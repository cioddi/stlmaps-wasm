import { useState, useEffect } from "react";
import {
  GeometryData,
  extractGeojsonFeaturesFromVectorTiles,
} from "./VectorTileFunctions";
import * as THREE from "three";
//@ts-expect-error
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import { createPolygonGeometryAsync } from "../three_maps/createPolygonGeometryAsync";
import { bufferLineString } from "../three_maps/bufferLineString";
import useLayerStore from "../stores/useLayerStore";
import {
  createComponentHashes,
  createConfigHash,
  hashBbox,
} from "../utils/configHashing";
import { WorkerService } from "../workers/WorkerService";
import { tokenManager } from "../utils/CancellationToken";
// Import WASM functionality
import { 
  useWasm, 
  useElevationProcessor, 
  getWasmModule,
  fetchVtData,
  calculateTileCount,
  getTilesForBbox
} from "@threegis/core";

// Define interfaces for our data structures
export interface GridSize {
  width: number;
  height: number;
}

interface TerrainGeometryResult {
  geometry: THREE.BufferGeometry;
  processedElevationGrid: number[][];
  processedMinElevation: number;
  processedMaxElevation: number;
}

interface GeoJSONFeature {
  geometry: {
    type: string;
    coordinates: number[][][];
  };
  properties?: Record<string, any>;
  type: string;
}

interface ElevationProcessingResult {
  elevationGrid: number[][];
  gridSize: GridSize;
  minElevation: number;
  maxElevation: number;
}

interface ConfigHashes {
  fullConfigHash: string;
  terrainHash: string;
  layerHashes: { index: number; hash: string }[];
}

// VtDataSet interface for type safety
interface VtDataSet {
  sourceLayer: string;
  subClass?: string;
  geometry?: THREE.BufferGeometry;
  // Add other properties as needed
  enabled?: boolean;
  color?: string;
  bufferSize?: number;
}

// Helper function to convert JS VtDataSet to Rust-compatible format
function convertToRustVtDataSet(jsVtDataSet: VtDataSet) {
  return {
    source_layer: jsVtDataSet.sourceLayer,
    sub_class: jsVtDataSet.subClass ? [jsVtDataSet.subClass] : undefined,
    enabled: jsVtDataSet.enabled,
    buffer_size: jsVtDataSet.bufferSize,
    //color: jsVtDataSet.color ?? "#4B85AA",
    extrusion_depth: jsVtDataSet.extrusionDepth ?? null,
    min_extrusion_depth: jsVtDataSet.minExtrusionDepth ?? null,
    height_scale_factor: jsVtDataSet.heightScaleFactor ?? null,
    use_adaptive_scale_factor: jsVtDataSet.useAdaptiveScaleFactor ?? null,
    z_offset: jsVtDataSet.zOffset ?? null,
    align_vertices_to_terrain: jsVtDataSet.alignVerticesToTerrain ?? null,
    csg_clipping: jsVtDataSet.csgClipping ?? null,
  };
}

export const GenerateMeshButton = function () {
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(
    null
  );

  // Store the last processed bbox hash to detect changes for cache management
  const [lastProcessedBboxHash, setLastProcessedBboxHash] =
    useState<string>("");

  // Get WASM-related hooks
  const { isInitialized: isWasmInitialized, isLoading: isWasmLoading } =
    useWasm();
  const { processElevationForBbox } = useElevationProcessor();

  // Get settings and setter functions directly from Zustand store
  const {
    bbox,
    vtLayers,
    terrainSettings,
    buildingSettings,
    setGeometryDataSets,
    geometryDataSets,
    setIsProcessing,
    updateProcessingState,
    configHashes,
    setConfigHashes,
    processedTerrainData,
    setProcessedTerrainData,
  } = useLayerStore();

  // Modify generate3DModel function to include buildings
  const generate3DModel = async (): Promise<void> => {
    if (!bbox) {
      console.error("Cannot generate 3D model: bbox is undefined");
      return;
    }

    // Create a new cancellation token for this operation
    // This will automatically cancel any previously running operations
    const cancellationToken = tokenManager.getNewToken("generate3DModel");

    // Cancel any ongoing polygon geometry tasks as well
    try {
      WorkerService.cancelActiveTasks("polygon-geometry");
    } catch (err) {
      console.warn("Error cancelling existing worker tasks:", err);
    }

    setIsProcessing(true);
    updateProcessingState({
      status: "Starting 3D model generation...",
      progress: 0,
    });

    console.log(
      "%c 🏗️ STARTING 3D MODEL GENERATION",
      "background: #4CAF50; color: white; padding: 4px; font-weight: bold;"
    );

    // Generate configuration hashes for efficiency checks
    const currentFullConfigHash = createConfigHash(
      bbox,
      terrainSettings,
      vtLayers
    );
    const { terrainHash: currentTerrainHash, layerHashes: currentLayerHashes } =
      createComponentHashes(bbox, terrainSettings, vtLayers);

    // Skip full regeneration if configuration hasn't changed
    if (currentFullConfigHash === configHashes.fullConfigHash) {
      console.log(
        "%c ✅ SKIPPING 3D MODEL GENERATION - No config changes detected",
        "background: #2196F3; color: white; padding: 4px; font-weight: bold;"
      );
      return;
    }

    // Log what components have changed
    console.log("Generating 3D model for:", bbox);
    console.log("Using terrain settings:", terrainSettings);
    console.log("Using building settings:", buildingSettings);

    // Check which specific components need regeneration
    const terrainChanged = currentTerrainHash !== configHashes.terrainHash;
    const changedLayerIndices = currentLayerHashes
      .filter((layerHash) => {
        const previousHash = configHashes.layerHashes.find(
          (lh) => lh.index === layerHash.index
        )?.hash;
        return previousHash !== layerHash.hash;
      })
      .map((lh) => lh.index);

    if (terrainChanged) {
      console.log(
        "%c 🏔️ Terrain configuration changed - regenerating terrain",
        "color: #FF9800;"
      );
    } else if (terrainSettings.enabled && geometryDataSets.terrainGeometry) {
      console.log(
        "%c ✅ Terrain configuration unchanged - reusing existing terrain geometry",
        "color: #4CAF50;"
      );
    }

    if (changedLayerIndices.length > 0) {
      console.log(
        "%c 🔄 Changed layers:",
        "color: #FF9800;",
        changedLayerIndices
          .map((i) => vtLayers[i]?.sourceLayer || `Layer ${i}`)
          .join(", ")
      );
    }

    try {
      // Extract bbox coordinates from the feature
      const feature = bbox;

      if (!feature.geometry || feature.geometry.type !== "Polygon") {
        console.error("Invalid geometry: expected a Polygon");
        return;
      }

      // Check for cancellation before continuing
      cancellationToken.throwIfCancelled();

      const coordinates = feature.geometry.coordinates[0]; // First ring of the polygon

      // Find min/max coordinates
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      coordinates.forEach((coord: number[]) => {
        const [lng, lat] = coord;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      });

      // Find appropriate zoom level where we get at most 4 tiles
      // Start with maximum supported zoom level (12)
      let zoom = 12;
      while (zoom > 0) {
        const tileCount = calculateTileCount(
          minLng,
          minLat,
          maxLng,
          maxLat,
          zoom
        );
        if (tileCount <= 4) break;
        zoom--;
      }

      console.log(`Using zoom level ${zoom} for the 3D model`);

      // Update processing status
      updateProcessingState({
        status: "Calculating tile coordinates...",
        progress: 10,
      });

      // Get tile coordinates
      const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
      console.log(`Using ${tiles.length} tiles for elevation data`);

      // Update processing status
      updateProcessingState({
        status: `Processing elevation data...`,
        progress: 20,
      });

      // Check for cancellation before processing elevation data
      cancellationToken.throwIfCancelled();

      // Get the bbox hash to check for changes
      const currentBboxHash = hashBbox(bbox);
      const bboxChanged = currentBboxHash !== lastProcessedBboxHash;

      if (bboxChanged) {
        console.log(
          "%c 🔄 New bbox detected - previous cache will be freed automatically",
          "color: #FF9800;"
        );
        setLastProcessedBboxHash(currentBboxHash);
      } else {
        console.log(
          "%c ♻️ Using existing cached elevation data for bbox",
          "color: #4CAF50;"
        );
      }

      // Only attempt to process elevation data if WASM is initialized
      if (!isWasmInitialized) {
        throw new Error("WASM module not initialized. Please try again later.");
      }

      // Use the WASM-based elevation processing with the bboxHash as bbox_key
      console.log(
        "🌍 Processing elevation data with WASM for bbox:",
        currentBboxHash
      );

      updateProcessingState({
        status: "Processing elevation data with WASM...",
        progress: 25,
      });
      let elevationResult;
      try {
        // Pass the currentBboxHash as the bbox_key to store data in WASM
        // This will automatically register the data with this ID in the WASM context
        elevationResult = await processElevationForBbox(bbox, currentBboxHash);

        console.log(
          "✅ Successfully processed and stored elevation data in WASM context"
        );

        // Store just the metadata for JavaScript-side operations, the actual grid
        // remains in WASM memory and is accessible via the bbox_key (currentBboxHash)
        setProcessedTerrainData({
          processedElevationGrid: elevationResult.elevationGrid,
          processedMinElevation: elevationResult.minElevation,
          processedMaxElevation: elevationResult.maxElevation,
        });
      } catch (error) {
        console.error("Error processing elevation data with WASM:", error);
        throw new Error(
          `Elevation processing failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Update processing status
      updateProcessingState({
        status: "Generating terrain geometry...",
        progress: 40,
      });

      // Check for cancellation before generating terrain geometry
      cancellationToken.throwIfCancelled();

      // Check if terrain needs to be regenerated
      let terrainGeometry = terrainSettings.enabled
        ? geometryDataSets.terrainGeometry
        : undefined;
      let processedElevationGrid = elevationResult.elevationGrid;
      let processedMinElevation = elevationResult.minElevation;
      let processedMaxElevation = elevationResult.maxElevation;
      let elevationGrid = elevationResult.elevationGrid;
      let gridSize = elevationResult.gridSize;

      // Re-calculate the current terrain hash here to ensure it's available
      const { terrainHash: currentTerrainHashHere } = createComponentHashes(
        bbox,
        terrainSettings,
        vtLayers
      );

      // Compare current and previous terrain hash
      const terrainConfigChanged =
        currentTerrainHashHere !== configHashes.terrainHash;

      // Generate three.js geometry from elevation grid using WASM
      console.log("🗻 Creating terrain geometry with WASM...");

      try {
        // Get the WASM module instance
        const wasmModule = getWasmModule();

        // First, we need to process and register the elevation data with the bbox_key
        // This step is crucial - create_terrain_geometry expects this data to be pre-registered
        console.log(
          "Registering elevation data with bbox_key:",
          currentBboxHash
        );

        // We need to explicitly register the elevation data again for terrain generation
        // Even though processElevationForBbox was called earlier, we need to ensure
        // the elevation data is registered specifically for terrain generation
        try {
          // Call processElevationForBbox again to ensure the data is properly registered
          // This will register the data with the same bbox_key (currentBboxHash)
          console.log(
            "Re-registering elevation data for terrain generation..."
          );
          await processElevationForBbox(bbox, currentBboxHash);
          console.log(
            "✅ Successfully re-registered elevation data for terrain generation"
          );
        } catch (error) {
          console.error(
            "Failed to register elevation data for terrain:",
            error
          );
          throw new Error(
            `Failed to register elevation data: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Now we can create the terrain geometry
        const terrainParams = {
          min_lng: minLng,
          min_lat: minLat,
          max_lng: maxLng,
          max_lat: maxLat,
          vertical_exaggeration: terrainSettings.verticalExaggeration,
          terrain_base_height: terrainSettings.baseHeight,
          bbox_key: currentBboxHash, // Use the bbox hash as the cache key
        };

        // Call the WASM terrain geometry generator
        const wasmTerrainResult =
          wasmModule.create_terrain_geometry(terrainParams);

        // Convert WASM TypedArrays to THREE.js BufferGeometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(wasmTerrainResult.positions, 3)
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(wasmTerrainResult.normals, 3)
        );
        geometry.setAttribute(
          "color",
          new THREE.BufferAttribute(wasmTerrainResult.colors, 3)
        );
        geometry.setIndex(Array.from(wasmTerrainResult.indices));

        terrainGeometry = geometry;
        processedElevationGrid = wasmTerrainResult.processedElevationGrid;
        processedMinElevation = wasmTerrainResult.processedMinElevation;
        processedMaxElevation = wasmTerrainResult.processedMaxElevation;

        console.log("✅ Terrain geometry created successfully with WASM:", {
          geometryExists: !!terrainGeometry,
          vertexCount: terrainGeometry?.attributes?.position?.count || 0,
        });
      } catch (error) {
        console.error("Error creating terrain geometry with WASM:", error);
        throw new Error(
          `Failed to create terrain geometry: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      // Set generated geometries based on settings
      console.log("🔄 Setting output geometries:", {
        terrainEnabled: terrainSettings.enabled,
        terrainGeometryExists: !!terrainGeometry,
        buildingsEnabled: buildingSettings.enabled,
      });

      // Fetch vt data for this bbox
      let vtData = await fetchVtData({
        bbox: [minLng, minLat, maxLng, maxLat],
        zoom: 14,
        gridSize,
      });

      // Initialize or get existing polygon geometries
      let vtPolygonGeometries: VtDataSet[] = [];

      // Array to store geometry generation promises
      const geometryPromises: {
        layer: VtDataSet;
        promise: Promise<THREE.BufferGeometry>;
      }[] = [];

      // Check if we have existing geometries to reuse
      const existingGeometries = geometryDataSets.polygonGeometries || [];

      // Get changed layer indices from our hash comparison
      const changedLayerIndices = currentLayerHashes
        .filter((layerHash) => {
          const previousHash = configHashes.layerHashes.find(
            (lh) => lh.index === layerHash.index
          )?.hash;
          return previousHash !== layerHash.hash;
        })
        .map((lh) => lh.index);

      // Process vector tile layers
      for (let i = 0; i < vtLayers.length; i++) {
        // Check for cancellation before processing each layer
        cancellationToken.throwIfCancelled();

        const currentLayer = vtLayers[i];
        updateProcessingState({
          status: "Processing " + currentLayer.sourceLayer + " layer",
          progress: 75 + (i * 10) / vtLayers.length,
        });

        // Skip disabled layers
        if (currentLayer.enabled === false) {
          console.log(`Skipping disabled layer: ${currentLayer.sourceLayer}`);
          continue;
        }

        // Check if this layer's configuration has changed
        const layerNeedsUpdate =
          changedLayerIndices.includes(i) || terrainConfigChanged;
        const existingLayerGeometry = existingGeometries.find(
          (g) =>
            g.sourceLayer === currentLayer.sourceLayer &&
            g.subClass?.toString() === currentLayer.subClass?.toString()
        );

        // If layer config hasn't changed and we have existing geometry, reuse it
        if (!layerNeedsUpdate && existingLayerGeometry?.geometry) {
          console.log(
            `%c ♻️ Reusing existing ${currentLayer.sourceLayer} geometry - configuration unchanged`,
            "color: #4CAF50;"
          );

          // Update with the current color but keep the existing geometry
          vtPolygonGeometries.push({
            ...currentLayer,
            geometry: existingLayerGeometry.geometry,
          });
          continue;
        }

        // Otherwise, regenerate the geometry
        console.log(
          `%c 🔄 Generating ${currentLayer.sourceLayer} geometry - configuration changed`,
          "color: #FF9800;"
        );
        console.log(`Fetching ${currentLayer.sourceLayer} data...`);

        // Check for cancellation before fetching layer data
        cancellationToken.throwIfCancelled();

        // Fetch data for this layer using our new Rust/WASM implementation
        let layerData = await getWasmModule().extract_features_from_vector_tiles({
          bbox: [minLng, minLat, maxLng, maxLat],
          vt_dataset: convertToRustVtDataSet(currentLayer),
          bbox_key: currentBboxHash,
          elevation_bbox_key: currentBboxHash // assuming elevation data is stored under the same ID
        });

        console.log(
          `Received ${layerData?.length || 0} ${currentLayer.sourceLayer} features`
        );

        if (layerData && layerData.length > 0) {
          // Convert LineString geometries to polygons using a buffer
          layerData = layerData.map((feature) => {
            if (feature.type === "LineString") {
              const bufferedPolygon = bufferLineString(
                feature.geometry,
                currentLayer.bufferSize || 1
              );
              return { ...feature, type: "Polygon", geometry: bufferedPolygon };
            }
            return feature;
          });

          // Check for cancellation before creating polygon geometry
          cancellationToken.throwIfCancelled();

          // Use the Rust implementation to create polygon geometry
          // This will reuse the cached features from extract_features_from_vector_tiles
          console.log(`Creating polygon geometry for ${currentLayer.sourceLayer} using Rust implementation`);
          let layerGeometryPromise = Promise.resolve(new THREE.BufferGeometry());
          
          try {
            // Prepare the input for the Rust function
            const polygonGeometryInput = {
              polygons: layerData as GeometryData[], // Fallback data in case cache fails
              terrainBaseHeight: terrainSettings.baseHeight,
              bbox: [minLng, minLat, maxLng, maxLat],
              elevationGrid: processedElevationGrid,
              gridSize,
              minElevation: processedMinElevation,
              maxElevation: processedMaxElevation,
              vtDataSet: convertToRustVtDataSet(currentLayer), // Convert to format compatible with Rust
              useSameZOffset: true,
              bbox_key: currentBboxHash, // Pass the bbox key to access cached features
            };

            const serializedInput = JSON.stringify(polygonGeometryInput);
            
            // Call the Rust implementation directly
            const geometryJson = await getWasmModule().process_polygon_geometry(serializedInput);
            const geometryData = JSON.parse(geometryJson) as {
              vertices: number[];
              normals: number[] | null;
              colors: number[] | null;
              indices: number[] | null;
              uvs: number[] | null;
              hasData: boolean;
            };

            // Convert the result to a Three.js buffer geometry
            const geometry = new THREE.BufferGeometry();
            
            // Add position attribute (vertices)
            if (geometryData.vertices && geometryData.vertices.length > 0) {
              geometry.setAttribute(
                "position", 
                new THREE.BufferAttribute(new Float32Array(geometryData.vertices), 3)
              );
            }
            
            // Add normal attribute if available
            if (geometryData.normals && geometryData.normals.length > 0) {
              geometry.setAttribute(
                "normal",
                new THREE.BufferAttribute(new Float32Array(geometryData.normals), 3)
              );
            } else {
              // Compute normals if not provided
              geometry.computeVertexNormals();
            }
            
            // Add color attribute if available
            if (geometryData.colors && geometryData.colors.length > 0) {
              geometry.setAttribute(
                "color",
                new THREE.BufferAttribute(new Float32Array(geometryData.colors), 3)
              );
            }
            
            // Add index attribute if available
            if (geometryData.indices && geometryData.indices.length > 0) {
              geometry.setIndex(Array.from(geometryData.indices));
            }
            
            console.log(`Successfully created ${currentLayer.sourceLayer} geometry with Rust: ${geometry.attributes.position?.count || 0} vertices`);
            
            // Use the created geometry as the promise result
            layerGeometryPromise = Promise.resolve(geometry);
          } catch (error) {
            console.error(`Error creating ${currentLayer.sourceLayer} geometry with Rust:`, error);
            
          }

          // Store the promise for later resolution
          geometryPromises.push({
            layer: currentLayer,
            promise: layerGeometryPromise,
          });

          // Create a placeholder entry in the polygon geometries array
          // It will be updated when all promises are resolved
          vtPolygonGeometries.push({
            ...currentLayer,
            // Initially use an empty geometry that will be replaced later
            geometry: new THREE.BufferGeometry(),
          });
        } else {
          console.warn(`No ${currentLayer.sourceLayer} features found`);
        }
      }

      // Wait for all async geometry promises to resolve before updating the UI
      if (geometryPromises.length > 0) {
        console.log(
          `Waiting for ${geometryPromises.length} geometries to be generated by web workers...`
        );

        // Check for cancellation before waiting for worker results
        cancellationToken.throwIfCancelled();

        try {
          // Wait for all geometry promises to complete
          setIsProcessing(true);
          const results = await Promise.all(
            geometryPromises.map(async ({ layer, promise }) => {
              try {
                // Wait for this specific geometry to be created
                const geometry = await promise;
                return { layer, geometry, success: true };
              } catch (error) {
                // Handle individual geometry failures
                console.error(
                  `Error generating ${layer.sourceLayer} geometry:`,
                  error
                );
                return {
                  layer,
                  geometry: new THREE.BufferGeometry(),
                  success: false,
                };
              }
            })
          );

          updateProcessingState({
            status: "Finalizing geometries...",
            progress: 90,
          });
          // Update the placeholder geometries with actual results
          results.forEach(({ layer, geometry, success }) => {
            if (success) {
              console.log(
                `Created valid ${layer.sourceLayer} geometry with ${geometry.attributes.position?.count || 0} vertices`
              );
            } else {
              console.warn(
                `Failed to create ${layer.sourceLayer} geometry with web worker`
              );
            }

            // Find and update the placeholder entry for this layer
            const layerIndex = vtPolygonGeometries.findIndex(
              (item) =>
                item.sourceLayer === layer.sourceLayer &&
                JSON.stringify(item.subClass) === JSON.stringify(layer.subClass)
            );

            if (layerIndex !== -1) {
              vtPolygonGeometries[layerIndex].geometry = geometry;
            }
          });

          console.log(
            "All worker geometries have been generated and integrated"
          );
        } catch (error) {
          console.error("Error waiting for geometry workers:", error);
        }
      }

      cancellationToken.throwIfCancelled();

      // Update the Zustand store with our geometries
      setGeometryDataSets({
        terrainGeometry: terrainSettings.enabled ? terrainGeometry : undefined,
        polygonGeometries: vtPolygonGeometries,
      });
      setIsProcessing(false);

      // Store the hashes for future comparisons
      setConfigHashes({
        fullConfigHash: currentFullConfigHash,
        terrainHash: currentTerrainHash,
        layerHashes: currentLayerHashes,
      });

      // Update processing state to show completion
      updateProcessingState({
        status: "3D model generation complete!",
        progress: 100,
      });

      console.log(
        "%c ✅ 3D model generation complete!",
        "background: #4CAF50; color: white; padding: 4px; font-weight: bold;"
      );

      // Hide the processing indicator after a short delay to let users see the completion
      setTimeout(() => {
        setIsProcessing(false);
      }, 2000);
    } catch (error: unknown) {
      // Check if this was a cancellation error (which is expected when the user changes the selection)
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Operation was cancelled")) {
        console.log("3D model generation was cancelled by user action");
        // Don't update UI state for cancelled operations
        return;
      }

      console.error("Error generating 3D model:", error);

      // Only show error in processing indicator for non-cancellation errors
      const displayErrorMessage =
        error instanceof Error ? error.message : "Failed to generate 3D model";
      updateProcessingState({
        status: `Error: ${displayErrorMessage}`,
        progress: 100,
      });

      // Hide the indicator after showing the error
      setTimeout(() => {
        setIsProcessing(false);
      }, 3000);
    }
  };

  useEffect(() => {
    console.log("GenerateMeshButton dependencies changed:", {
      hasBbox: !!bbox,
      terrainEnabled: terrainSettings?.enabled,
      buildingsEnabled: buildingSettings?.enabled,
      layerCount: vtLayers?.length,
    });

    // Cancel any previous operations when dependencies change
    tokenManager.cancelCurrentOperation();

    if (debounceTimer) clearTimeout(debounceTimer);
    if (!bbox) {
      console.warn("No bbox available, skipping model generation");
      return;
    }

    const timer = setTimeout(() => {
      console.log("Debounce timer expired, generating 3D model");
      generate3DModel();
    }, 1000);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [bbox, vtLayers, terrainSettings]); // Only trigger on bbox changes, not on store state changes

  return <></>;
};
