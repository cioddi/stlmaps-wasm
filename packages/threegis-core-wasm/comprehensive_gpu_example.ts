// Comprehensive example of GPU-accelerated STLMaps processing

import init, {
  init_all_gpu_processors,
  get_gpu_info,
  process_elevation_data_async,
  create_terrain_geometry,
  create_polygon_geometry,
  get_wasm_info
} from './pkg/threegis_core_wasm';

interface GPUCapabilities {
  gpu_acceleration_available: boolean;
  webgpu_support: boolean;
  acceleration_modules: {
    elevation_processing: boolean;
    terrain_generation: boolean;
    polygon_processing: boolean;
    linestring_buffering: boolean;
    polygon_clipping: boolean;
  };
  performance_improvements: {
    elevation_grid_processing: string;
    terrain_mesh_generation: string;
    polygon_operations: string;
  };
  fallback_strategy: string;
  browser_requirements: string;
}

interface ProcessingBenchmark {
  operation: string;
  gpu_time?: number;
  cpu_time?: number;
  speedup?: number;
  data_size: string;
}

class STLMapsGPUProcessor {
  private isInitialized = false;
  private gpuCapabilities: GPUCapabilities | null = null;

  async initialize(): Promise<boolean> {
    try {
      // Initialize the WASM module
      await init();

      // Initialize all GPU processors
      const initResult = await init_all_gpu_processors();
      const initData = JSON.parse(initResult);

      console.log('GPU Initialization Results:', initData);

      // Get detailed GPU capabilities
      const gpuInfoJson = await get_gpu_info();
      this.gpuCapabilities = JSON.parse(gpuInfoJson);

      console.log('GPU Capabilities:', this.gpuCapabilities);

      this.isInitialized = true;
      return true;

    } catch (error) {
      console.error('Failed to initialize GPU processor:', error);
      this.isInitialized = true; // Enable CPU fallback
      return true;
    }
  }

  async getCapabilities(): Promise<GPUCapabilities | null> {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }
    return this.gpuCapabilities;
  }

  async processCompleteWorkflow(
    bbox: [number, number, number, number], // [minLng, minLat, maxLng, maxLat]
    gridSize: { width: number; height: number } = { width: 256, height: 256 },
    verticalExaggeration: number = 50,
    terrainBaseHeight: number = 0
  ): Promise<{
    elevationResult: any;
    terrainResult: any;
    processingStats: ProcessingBenchmark[];
  }> {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }

    const processingStats: ProcessingBenchmark[] = [];
    const processId = `workflow_${Date.now()}`;

    // Step 1: Generate elevation tiles for the bounding box
    const tiles = this.generateTileList(bbox, 16); // Zoom level 16

    // Step 2: Process elevation data (GPU accelerated)
    console.log('Processing elevation data...');
    const elevationInput = {
      min_lng: bbox[0],
      min_lat: bbox[1],
      max_lng: bbox[2],
      max_lat: bbox[3],
      tiles: tiles,
      grid_width: gridSize.width,
      grid_height: gridSize.height,
      process_id: processId
    };

    console.time('Elevation Processing');
    const elevationResultJs = await process_elevation_data_async(JSON.stringify(elevationInput));
    console.timeEnd('Elevation Processing');

    const elevationResult = elevationResultJs as any;

    processingStats.push({
      operation: 'Elevation Grid Processing',
      data_size: `${gridSize.width}x${gridSize.height}`,
      // Note: Actual GPU vs CPU timing would require separate calls
    });

    // Step 3: Generate terrain mesh (GPU accelerated)
    console.log('Generating terrain mesh...');
    const terrainParams = {
      min_lng: bbox[0],
      min_lat: bbox[1],
      max_lng: bbox[2],
      max_lat: bbox[3],
      vertical_exaggeration: verticalExaggeration,
      terrain_base_height: terrainBaseHeight,
      process_id: processId,
      use_simple_mesh: false
    };

    console.time('Terrain Generation');
    const terrainResultJs = await create_terrain_geometry(terrainParams);
    console.timeEnd('Terrain Generation');

    const terrainResult = terrainResultJs as any;

    processingStats.push({
      operation: 'Terrain Mesh Generation',
      data_size: `${terrainResult.positions?.length / 3 || 0} vertices`,
    });

    console.log('Complete workflow processed successfully');

    return {
      elevationResult,
      terrainResult,
      processingStats
    };
  }

  async processPolygonGeometry(
    polygonData: any[],
    vtDataSet: any,
    bbox: [number, number, number, number],
    elevationGrid: number[][],
    gridSize: { width: number; height: number },
    minElevation: number,
    maxElevation: number,
    verticalExaggeration: number,
    terrainBaseHeight: number
  ): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }

    console.log(`Processing ${polygonData.length} polygon features...`);

    const polygonInput = {
      bbox: bbox,
      polygons: polygonData,
      terrainBaseHeight: terrainBaseHeight,
      verticalExaggeration: verticalExaggeration,
      elevationGrid: elevationGrid,
      gridSize: gridSize,
      minElevation: minElevation,
      maxElevation: maxElevation,
      vtDataSet: vtDataSet,
      useSameZOffset: false,
      processId: `polygon_${Date.now()}`,
      csgClipping: true // Enable GPU clipping
    };

    console.time('Polygon Processing');
    const result = await create_polygon_geometry(JSON.stringify(polygonInput));
    console.timeEnd('Polygon Processing');

    console.log('Polygon processing completed');
    return JSON.parse(result);
  }

  async benchmarkPerformance(): Promise<ProcessingBenchmark[]> {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }

    const benchmarks: ProcessingBenchmark[] = [];

    // Benchmark elevation processing with different grid sizes
    const testGridSizes = [
      { width: 64, height: 64 },
      { width: 128, height: 128 },
      { width: 256, height: 256 },
      { width: 512, height: 512 }
    ];

    const testBbox: [number, number, number, number] = [-74.01, 40.70, -73.99, 40.72]; // Manhattan

    for (const gridSize of testGridSizes) {
      console.log(`Benchmarking elevation processing for ${gridSize.width}x${gridSize.height} grid...`);

      const tiles = this.generateTileList(testBbox, 16);
      const elevationInput = {
        min_lng: testBbox[0],
        min_lat: testBbox[1],
        max_lng: testBbox[2],
        max_lat: testBbox[3],
        tiles: tiles,
        grid_width: gridSize.width,
        grid_height: gridSize.height,
        process_id: `benchmark_${gridSize.width}_${gridSize.height}`
      };

      const startTime = performance.now();
      await process_elevation_data_async(JSON.stringify(elevationInput));
      const endTime = performance.now();

      benchmarks.push({
        operation: 'Elevation Processing',
        gpu_time: endTime - startTime, // This includes GPU processing
        data_size: `${gridSize.width}x${gridSize.height}`,
      });
    }

    console.log('Performance benchmarking completed');
    return benchmarks;
  }

  private generateTileList(bbox: [number, number, number, number], zoom: number): Array<{x: number, y: number, z: number}> {
    const [minLng, minLat, maxLng, maxLat] = bbox;

    // Convert geographic bounds to tile coordinates
    const minTileX = Math.floor((minLng + 180) / 360 * Math.pow(2, zoom));
    const maxTileX = Math.floor((maxLng + 180) / 360 * Math.pow(2, zoom));

    const minTileY = Math.floor((1 - Math.log(Math.tan(maxLat * Math.PI / 180) + 1 / Math.cos(maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    const maxTileY = Math.floor((1 - Math.log(Math.tan(minLat * Math.PI / 180) + 1 / Math.cos(minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));

    const tiles = [];
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        tiles.push({ x, y, z: zoom });
      }
    }

    return tiles;
  }

  async demonstrateCapabilities(): Promise<void> {
    console.log('=== STLMaps GPU Acceleration Demo ===');

    // Show WASM info
    const wasmInfo = get_wasm_info();
    console.log('WASM Module Info:', JSON.parse(wasmInfo));

    // Show GPU capabilities
    const capabilities = await this.getCapabilities();
    console.log('GPU Capabilities:', capabilities);

    if (capabilities?.gpu_acceleration_available) {
      console.log('✅ GPU acceleration is available!');

      // Process a small Manhattan area
      const manhattanBbox: [number, number, number, number] = [-74.01, 40.70, -73.99, 40.72];

      try {
        const result = await this.processCompleteWorkflow(
          manhattanBbox,
          { width: 128, height: 128 },
          25, // vertical exaggeration
          0   // terrain base height
        );

        console.log('✅ Complete workflow processed successfully:');
        console.log('- Elevation grid processed:', result.elevationResult.grid_size);
        console.log('- Terrain mesh generated with', result.terrainResult.positions?.length / 3 || 0, 'vertices');
        console.log('- Processing stats:', result.processingStats);

      } catch (error) {
        console.error('❌ Workflow processing failed:', error);
      }

      // Run performance benchmark
      try {
        console.log('Running performance benchmarks...');
        const benchmarks = await this.benchmarkPerformance();
        console.log('📊 Performance Results:', benchmarks);
      } catch (error) {
        console.error('❌ Benchmarking failed:', error);
      }

    } else {
      console.log('⚠️ GPU acceleration not available, CPU fallback will be used');
    }
  }
}

// Usage example
async function runDemo() {
  const processor = new STLMapsGPUProcessor();

  console.log('Initializing STLMaps GPU processor...');
  const success = await processor.initialize();

  if (success) {
    await processor.demonstrateCapabilities();
  } else {
    console.error('Failed to initialize processor');
  }
}

// Specific examples for different use cases
export class STLMapsExamples {
  private processor: STLMapsGPUProcessor;

  constructor() {
    this.processor = new STLMapsGPUProcessor();
  }

  async init() {
    return await this.processor.initialize();
  }

  // Example 1: High-resolution terrain for 3D printing
  async generate3DPrintableTerrain(bbox: [number, number, number, number]) {
    console.log('Generating high-resolution terrain for 3D printing...');

    return await this.processor.processCompleteWorkflow(
      bbox,
      { width: 512, height: 512 }, // High resolution
      100, // High vertical exaggeration for dramatic effect
      2    // Base height for printability
    );
  }

  // Example 2: Real-time visualization terrain
  async generateVisualizationTerrain(bbox: [number, number, number, number]) {
    console.log('Generating real-time visualization terrain...');

    return await this.processor.processCompleteWorkflow(
      bbox,
      { width: 128, height: 128 }, // Balanced resolution
      50,  // Moderate vertical exaggeration
      0    // No base height needed
    );
  }

  // Example 3: Large area overview
  async generateOverviewTerrain(bbox: [number, number, number, number]) {
    console.log('Generating overview terrain for large area...');

    return await this.processor.processCompleteWorkflow(
      bbox,
      { width: 64, height: 64 }, // Lower resolution for performance
      25,  // Subtle vertical exaggeration
      0    // No base height
    );
  }
}

export { STLMapsGPUProcessor, runDemo };

// Auto-run demo if this is the main module
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).STLMapsGPUDemo = {
    runDemo,
    STLMapsGPUProcessor,
    STLMapsExamples
  };
}