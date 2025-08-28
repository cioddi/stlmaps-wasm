import { useState, useEffect, useMemo } from "react";
import {
  GeometryData,
} from "./VectorTileFunctions";
import * as THREE from "three";
//@ts-expect-error No types available for BufferGeometryUtils
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import { bufferLineString } from "../three_maps/bufferLineString";
import { createDebugGeometry } from "../three_maps/createDebugGeometry";
import useLayerStore from "../stores/useLayerStore";
import {
  createComponentHashes,
  createConfigHash,
  hashBbox,
  hashVtLayerConfig,
  hashTerrainConfig,
} from "../utils/configHashing";
import { WorkerService } from "../workers/WorkerService";
import { tokenManager } from "../utils/CancellationToken";
import { VtDataSet } from "../types/VtDataSet";
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

// Helper function to convert JS VtDataSet to Rust-compatible format
function convertToRustVtDataSet(jsVtDataSet: VtDataSet) {
  return {
    sourceLayer: jsVtDataSet.sourceLayer,
    subClass: jsVtDataSet.subClass ? [jsVtDataSet.subClass] : undefined,
    enabled: jsVtDataSet.enabled,
    bufferSize: jsVtDataSet.bufferSize,
    extrusionDepth: jsVtDataSet.extrusionDepth ?? null,
    minExtrusionDepth: jsVtDataSet.minExtrusionDepth ?? null,
    heightScaleFactor: jsVtDataSet.heightScaleFactor ?? null,
    useAdaptiveScaleFactor: jsVtDataSet.useAdaptiveScaleFactor ?? null,
    zOffset: jsVtDataSet.zOffset ?? null,
    alignVerticesToTerrain: jsVtDataSet.alignVerticesToTerrain ?? null,
    csgClipping: jsVtDataSet.csgClipping ?? null,
    filter: jsVtDataSet.filter ?? null, // Pass the filter to Rust
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
    debugSettings,
    setGeometryDataSets,
    geometryDataSets,
    setIsProcessing,
    updateProgress,
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
      // Also cancel any WASM operations
      const wasmModule = getWasmModule();
      if (wasmModule?.cancel_operation) {
        wasmModule.cancel_operation("polygon_processing");
        wasmModule.cancel_operation("terrain_generation");
      }
    } catch (err) {
      console.warn("Error cancelling existing tasks:", err);
    }

    updateProgress("Starting 3D model generation...", 0);


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
      return;
    }


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


      // Update processing status
      updateProgress("Calculating tile coordinates...", 10);

      // Get tile coordinates
      const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);

      // Update processing status
      updateProgress("Processing elevation data...", 20);

      // Check for cancellation before processing elevation data
      cancellationToken.throwIfCancelled();

      // Get the bbox hash to check for changes
      const currentBboxHash = hashBbox(bbox);
      const bboxChanged = currentBboxHash !== lastProcessedBboxHash;

      if (bboxChanged) {
        setLastProcessedBboxHash(currentBboxHash);
      } else {
      }

      // Only attempt to process elevation data if WASM is initialized
      if (!isWasmInitialized) {
        throw new Error("WASM module not initialized. Please try again later.");
      }

      // Use the WASM-based elevation processing with the bboxHash as bbox_key

      updateProgress("Fetching elevation data...", 25);
      let elevationResult;
      try {
        // Pass the currentBboxHash as the bbox_key to store data in WASM
        // This will automatically register the data with this ID in the WASM context
        elevationResult = await processElevationForBbox(bbox, currentBboxHash);

        updateProgress("Processing elevation data...", 35);

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

      // Check for cancellation before generating terrain geometry
      cancellationToken.throwIfCancelled();

      // Always process terrain geometry (visibility controlled in 3D preview)
      let terrainGeometry = geometryDataSets.terrainGeometry;
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
      updateProgress("Generating terrain mesh...", 40);

      try {
        // Get the WASM module instance
        const wasmModule = getWasmModule();

        // First, we need to process and register the elevation data with the bbox_key
        // This step is crucial - create_terrain_geometry expects this data to be pre-registered

        // We need to explicitly register the elevation data again for terrain generation
        // Even though processElevationForBbox was called earlier, we need to ensure
        // the elevation data is registered specifically for terrain generation
        try {
          // Call processElevationForBbox again to ensure the data is properly registered
          // This will register the data with the same bbox_key (currentBboxHash)
          await processElevationForBbox(bbox, currentBboxHash);
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

        // Call the WASM terrain geometry generator (now async)
        const wasmTerrainResult = await wasmModule.create_terrain_geometry(terrainParams);

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

      } catch (error) {
        console.error("Error creating terrain geometry with WASM:", error);
        throw new Error(
          `Failed to create terrain geometry: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      // Set generated geometries based on settings

      // Fetch vt data for this bbox
      await fetchVtData({
        bbox: [minLng, minLat, maxLng, maxLat],
        zoom: 14,
        gridSize,
      });

      // Update progress after terrain/VT data is complete
      updateProgress("Processing vector data...", 50);

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
        const layerProgress = 50 + ((i + 1) * 40) / vtLayers.length;
        
        updateProgress("Processing vector data...", Math.round(layerProgress));

        // Process all layers regardless of enabled state for 3D preview
        // (Disabled layers will be hidden in the 3D preview but geometry is still generated)
        console.log(`Processing layer: ${currentLayer.sourceLayer} (enabled: ${currentLayer.enabled !== false})`);

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


        // First, extract and cache features using WASM
        console.log(`Extracting and caching ${currentLayer.sourceLayer} features...`);
        
        try {
          // This call extracts and caches features in WASM memory - it doesn't return them
          await getWasmModule().extract_features_from_vector_tiles({
            bbox: [minLng, minLat, maxLng, maxLat],
            vtDataSet: convertToRustVtDataSet(currentLayer),
            bboxKey: currentBboxHash,
            elevationBBoxKey: currentBboxHash // Note: correct capitalization
          });
          
          console.log(`✅ Features extracted and cached for ${currentLayer.sourceLayer}`);
        } catch (error) {
          console.error(`Failed to extract features for ${currentLayer.sourceLayer}:`, error);
          continue; // Skip this layer if feature extraction fails
        }


        // Check for cancellation before creating polygon geometry
        cancellationToken.throwIfCancelled();

        // Check if debug mode is enabled for this layer or globally
        const useDebugMode = debugSettings.geometryDebugMode || currentLayer.geometryDebugMode;
        let layerGeometryPromise = Promise.resolve(new THREE.BufferGeometry());

        if (useDebugMode) {
          // Debug mode: use WASM but with debug flag to skip complex processing
          console.log(`Creating debug geometry for ${currentLayer.sourceLayer} (skipping extrusion and buffering)`);
          
          try {
            // Prepare the input for the Rust function but with debug flag
            const polygonGeometryInput = {
              terrainBaseHeight: terrainSettings.baseHeight,
              bbox: [minLng, minLat, maxLng, maxLat],
              elevationGrid: processedElevationGrid,
              gridSize,
              minElevation: processedMinElevation,
              maxElevation: processedMaxElevation,
              vtDataSet: { 
                ...convertToRustVtDataSet(currentLayer),
                geometryDebugMode: true // Enable debug mode in WASM
              },
              useSameZOffset: true,
              bbox_key: currentBboxHash,
            };

            const serializedInput = JSON.stringify(polygonGeometryInput);
            
            // Call the Rust implementation with debug mode
            const geometryJson = await getWasmModule().process_polygon_geometry(serializedInput);
            const geometryDataArray = JSON.parse(geometryJson) as Array<{
              vertices: number[];
              normals: number[] | null;
              colors: number[] | null;
              indices: number[] | null;
              uvs: number[] | null;
              hasData: boolean;
              properties?: Record<string, unknown>;
            }>;

            // For debug mode, we still need to handle individual geometries
            // Create a container geometry similar to normal mode
            const geometries: THREE.BufferGeometry[] = [];
            
            for (const geometryData of geometryDataArray) {
              if (!geometryData.hasData || !geometryData.vertices || geometryData.vertices.length === 0) {
                continue;
              }

              const geometry = new THREE.BufferGeometry();
              
              // Add position attribute (vertices)
              geometry.setAttribute(
                "position", 
                new THREE.BufferAttribute(new Float32Array(geometryData.vertices), 3)
              );
              
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

              // Add properties to userData for hover interaction
              if (geometryData.properties) {
                console.log(`Debug geometry ${geometries.length} properties:`, geometryData.properties);
                geometry.userData = {
                  properties: geometryData.properties
                };
              } else {
                console.log(`Debug geometry ${geometries.length} has NO properties`);
              }
              
              geometries.push(geometry);
            }

            // Create a container geometry that holds individual geometries as userData
            const containerGeometry = new THREE.BufferGeometry();
            containerGeometry.userData = {
              isContainer: true,
              individualGeometries: geometries,
              geometryCount: geometries.length
            };

            layerGeometryPromise = Promise.resolve(containerGeometry);
            console.log(`✅ Debug geometry created for ${currentLayer.sourceLayer} with ${geometries.length} individual meshes`);
          } catch (error) {
            console.error(`Failed to create debug geometry for ${currentLayer.sourceLayer}:`, error);
            // Fallback to empty geometry
            layerGeometryPromise = Promise.resolve(new THREE.BufferGeometry());
          }
        } else {
          // Normal mode: use the Rust implementation to create polygon geometry
          // This will retrieve the cached features from WASM memory
          console.log(`Creating polygon geometry for ${currentLayer.sourceLayer} using Rust implementation`);
        
          try {
          // Prepare the input for the Rust function
          const polygonGeometryInput = {
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
          
          // Create cancellation token for this layer processing
          const layerToken = `layer_${currentLayer.sourceLayer}_${cancellationToken.id}`;
          getWasmModule().create_cancellation_token(layerToken);
          
          // Call the Rust implementation directly with cancellation support
          const geometryJson = await getWasmModule().process_polygon_geometry(serializedInput);
          const geometryDataArray = JSON.parse(geometryJson) as Array<{
            vertices: number[];
            normals: number[] | null;
            colors: number[] | null;
            indices: number[] | null;
            uvs: number[] | null;
            hasData: boolean;
            properties?: Record<string, unknown>;
          }>;

          console.log(`WASM returned ${geometryDataArray.length} individual geometries`);

          // Convert each geometry and merge them into a single Three.js buffer geometry
          // Process in batches to avoid blocking the main thread
          const geometries: THREE.BufferGeometry[] = [];
          const batchSize = 50; // Process 50 geometries per batch
          
          for (let i = 0; i < geometryDataArray.length; i += batchSize) {
            const batch = geometryDataArray.slice(i, i + batchSize);
            
            // Process current batch
            for (const geometryData of batch) {
              if (!geometryData.hasData || !geometryData.vertices || geometryData.vertices.length === 0) {
                continue;
              }

              const geometry = new THREE.BufferGeometry();
              
              // Add position attribute (vertices)
              geometry.setAttribute(
                "position", 
                new THREE.BufferAttribute(new Float32Array(geometryData.vertices), 3)
              );
              
              // Add normal attribute if available
              if (geometryData.normals && geometryData.normals.length > 0) {
                geometry.setAttribute(
                  "normal",
                  new THREE.BufferAttribute(new Float32Array(geometryData.normals), 3)
                );
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

              // Add properties to userData for hover interaction
              if (geometryData.properties) {
                geometry.userData = {
                  properties: geometryData.properties
                };
              }
              
              // Compute normals if not provided
              if (!geometryData.normals) {
                geometry.computeVertexNormals();
              }

              geometries.push(geometry);
            }
            
            // Yield control to the event loop after each batch
            if (i + batchSize < geometryDataArray.length) {
              updateProcessingState({
                status: `Processing geometries... (${Math.min(i + batchSize, geometryDataArray.length)}/${geometryDataArray.length})`,
                progress: (i + batchSize) / geometryDataArray.length * 0.8 + 0.1 // 10-90% of progress
              });
              
              // Yield to event loop
              await new Promise(resolve => setTimeout(resolve, 0));
              
              // Check for cancellation
              if (cancellationToken.isCancelled()) {
                console.log("Geometry processing cancelled by user");
                return;
              }
            }
          }

          console.log(`Created ${geometries.length} individual Three.js geometries`);

          // Create a container geometry that holds individual geometries as userData
          // This allows the system to expect a single geometry while preserving individual ones
          const containerGeometry = new THREE.BufferGeometry();
          containerGeometry.userData = {
            isContainer: true,
            individualGeometries: geometries,
            geometryCount: geometries.length
          };
          
          console.log(`Successfully created ${currentLayer.sourceLayer} container with ${geometries.length} individual geometries`);
          
          // Use the container geometry as the promise result
          layerGeometryPromise = Promise.resolve(containerGeometry);
          } catch (error) {
            console.error(`Error creating ${currentLayer.sourceLayer} geometry with Rust:`, error);
            // Keep the empty geometry as fallback
          }
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

          updateProgress("Finalizing geometries...", 90);
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
          
          // CSG union is now handled automatically in the WASM module
          console.log("✅ Geometry processing completed with integrated CSG union optimization");
        } catch (error) {
          console.error("Error waiting for geometry workers:", error);
        }
      }

      cancellationToken.throwIfCancelled();

      // Update the Zustand store with our geometries
      // Final step - updating 3D model
      updateProgress("Updating 3D model...", 95);

      setGeometryDataSets({
        terrainGeometry: terrainGeometry, // Always store terrain geometry, visibility controlled in 3D preview
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
      updateProgress("3D model generation complete!", 100);

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
      updateProgress(`Error: ${displayErrorMessage}`, 100);

      // Hide the indicator after showing the error
      setTimeout(() => {
        setIsProcessing(false);
      }, 3000);
    }
  };

  // Create a geometry-only hash that excludes color changes
  const geometryOnlyLayersHash = useMemo(() => {
    return vtLayers.map(hashVtLayerConfig).join(':');
  }, [vtLayers]);

  // Create a geometry-only terrain hash that excludes color changes
  const geometryOnlyTerrainHash = useMemo(() => {
    return hashTerrainConfig(terrainSettings);
  }, [terrainSettings]);

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
  }, [
    bbox, 
    // Use useMemo to create stable geometry-only hashes
    geometryOnlyLayersHash,
    geometryOnlyTerrainHash
  ]); // Only trigger on geometry-affecting changes, not color changes

  return <></>;
};
