// Example TypeScript usage of GPU-accelerated elevation processing

// First, import your WASM module
import init, {
  get_gpu_info,
  init_gpu_elevation_processor,
  check_gpu_support,
  process_elevation_data_async
} from './pkg/threegis_core_wasm';

interface GPUInfo {
  gpu_acceleration_available: boolean;
  webgpu_support: boolean;
  acceleration_modules: {
    elevation_processing: boolean;
    terrain_generation: boolean;
    polygon_processing: boolean;
  };
  fallback_strategy: string;
  browser_requirements: string;
}

interface ElevationProcessingInput {
  min_lng: number;
  min_lat: number;
  max_lng: number;
  max_lat: number;
  tiles: Array<{ x: number; y: number; z: number }>;
  grid_width: number;
  grid_height: number;
  process_id: string;
}

interface ElevationProcessingResult {
  elevation_grid: number[][];
  grid_size: { width: number; height: number };
  min_elevation: number;
  max_elevation: number;
  processed_min_elevation: number;
  processed_max_elevation: number;
  cache_hit_rate: number;
}

class GPUElevationProcessor {
  private isInitialized = false;
  private gpuSupported = false;

  async initialize(): Promise<boolean> {
    try {
      // Initialize the WASM module
      await init();

      // Check if GPU support is available
      this.gpuSupported = await check_gpu_support();

      if (this.gpuSupported) {
        // Initialize GPU processor
        const initResult = await init_gpu_elevation_processor();
        this.isInitialized = initResult;

        
        return this.isInitialized;
      } else {
        
        this.isInitialized = true; // CPU fallback is always available
        return true;
      }
    } catch (error) {
      
      this.isInitialized = true; // Enable CPU fallback
      return true;
    }
  }

  async getGPUInfo(): Promise<GPUInfo> {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }

    const infoJson = await get_gpu_info();
    return JSON.parse(infoJson);
  }

  async processElevationData(input: ElevationProcessingInput): Promise<ElevationProcessingResult> {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }

    // Convert input to JSON string as expected by WASM
    const inputJson = JSON.stringify(input);

    // Call the WASM function - it will automatically use GPU if available, CPU otherwise
    const resultJs = await process_elevation_data_async(inputJson);

    // Convert result back from JS value
    return resultJs as ElevationProcessingResult;
  }

  isGPUSupported(): boolean {
    return this.gpuSupported;
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}

// Example usage
async function example() {
  const processor = new GPUElevationProcessor();

  // Initialize the processor
  const initSuccess = await processor.initialize();
  if (!initSuccess) {
    
    return;
  }

  // Get GPU information
  const gpuInfo = await processor.getGPUInfo();
  

  // Example elevation processing input
  const elevationInput: ElevationProcessingInput = {
    min_lng: -74.01,
    min_lat: 40.70,
    max_lng: -73.99,
    max_lat: 40.72,
    tiles: [
      { x: 19297, y: 24633, z: 16 },
      { x: 19298, y: 24633, z: 16 },
      // Add more tiles as needed
    ],
    grid_width: 256,
    grid_height: 256,
    process_id: 'manhattan_elevation_001'
  };

  try {
    // Process elevation data (will use GPU if available)
    
    const result = await processor.processElevationData(elevationInput);
    

    
    
    
    

    // The result.elevation_grid contains the processed elevation data
    // that can be used for terrain generation or other processing

  } catch (error) {
    
  }
}

// Performance comparison function
async function benchmarkGPUvsCPU() {
  const processor = new GPUElevationProcessor();
  await processor.initialize();

  // Create a large grid for meaningful performance comparison
  const largeInput: ElevationProcessingInput = {
    min_lng: -74.1,
    min_lat: 40.6,
    max_lng: -73.9,
    max_lat: 40.8,
    tiles: [
      // Add multiple tiles for a larger dataset
      { x: 19297, y: 24633, z: 16 },
      { x: 19298, y: 24633, z: 16 },
      { x: 19297, y: 24634, z: 16 },
      { x: 19298, y: 24634, z: 16 },
    ],
    grid_width: 512,  // Larger grid for better GPU utilization
    grid_height: 512,
    process_id: 'benchmark_test'
  };

  

  // GPU processing
  
  const gpuResult = await processor.processElevationData(largeInput);
  

  // To test CPU-only processing, you could set an environment variable
  // or modify the WASM code to force CPU processing for comparison

  
  
  
}

export { GPUElevationProcessor, example, benchmarkGPUvsCPU };