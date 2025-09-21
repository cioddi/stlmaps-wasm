// GPU-accelerated elevation processing module using WebGPU compute shaders
use wasm_bindgen::prelude::*;
use wgpu::{
    BindGroupDescriptor, BindGroupEntry, BindGroupLayout, BindGroupLayoutDescriptor,
    BindGroupLayoutEntry, BindingType, BufferBindingType,
    BufferDescriptor, BufferUsages, ComputePassDescriptor, ComputePipeline,
    ComputePipelineDescriptor, Device, Queue, ShaderStages,
};
use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

use crate::elevation::{ElevationProcessingInput, ElevationProcessingResult, GridSize};
use crate::module_state::TileData;
use crate::console_log;

// GPU-compatible data structures using bytemuck for zero-copy serialization
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TileInfo {
    x: u32,
    y: u32,
    z: u32,
    width: u32,
    height: u32,
    min_lng: f32,
    max_lng: f32,
    min_lat: f32,
    max_lat: f32,
    _padding: [u32; 3], // Align to 16-byte boundary for GPU
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GridParams {
    grid_width: u32,
    grid_height: u32,
    bbox_min_lng: f32,
    bbox_min_lat: f32,
    bbox_max_lng: f32,
    bbox_max_lat: f32,
    num_tiles: u32,
    _padding: u32, // Align to 16-byte boundary
}

// WebGPU compute shader for elevation grid processing
const ELEVATION_COMPUTE_SHADER: &str = r#"
@group(0) @binding(0) var<storage, read> tile_infos: array<TileInfo>;
@group(0) @binding(1) var<storage, read> tile_data: array<u32>; // RGBA pixels as packed u32
@group(0) @binding(2) var<uniform> params: GridParams;
@group(0) @binding(3) var<storage, read_write> elevation_grid: array<f32>;
@group(0) @binding(4) var<storage, read_write> coverage_grid: array<f32>;

struct TileInfo {
    x: u32,
    y: u32,
    z: u32,
    width: u32,
    height: u32,
    min_lng: f32,
    max_lng: f32,
    min_lat: f32,
    max_lat: f32,
    padding: array<u32, 3>,
}

struct GridParams {
    grid_width: u32,
    grid_height: u32,
    bbox_min_lng: f32,
    bbox_min_lat: f32,
    bbox_max_lng: f32,
    bbox_max_lat: f32,
    num_tiles: u32,
    padding: u32,
}

// Convert RGBA pixel to elevation using Mapbox Terrain-RGB encoding
fn pixel_to_elevation(r: u32, g: u32, b: u32) -> f32 {
    let value = r * 65536u + g * 256u + b;
    return -10000.0 + f32(value) * 0.1;
}

// Unpack RGBA from u32 (assumes little-endian RGBA)
fn unpack_rgba(packed: u32) -> vec4<u32> {
    return vec4<u32>(
        (packed >> 0u) & 0xFFu,   // R
        (packed >> 8u) & 0xFFu,   // G
        (packed >> 16u) & 0xFFu,  // B
        (packed >> 24u) & 0xFFu   // A
    );
}

// Bilinear interpolation for elevation sampling
fn sample_tile_elevation(tile_idx: u32, frac_x: f32, frac_y: f32) -> f32 {
    let tile = tile_infos[tile_idx];
    let width = tile.width;
    let height = tile.height;

    let pixel_x = u32(floor(frac_x));
    let pixel_y = u32(floor(frac_y));

    // Bounds checking
    if (pixel_x >= (width - 1u) || pixel_y >= (height - 1u)) {
        return 0.0;
    }

    let dx = frac_x - f32(pixel_x);
    let dy = frac_y - f32(pixel_y);

    // Calculate tile data offset for this tile
    var tile_offset = 0u;
    for (var i = 0u; i < tile_idx; i++) {
        tile_offset += tile_infos[i].width * tile_infos[i].height;
    }

    // Sample the four corners for bilinear interpolation
    let idx_tl = tile_offset + pixel_y * width + pixel_x;
    let idx_tr = tile_offset + pixel_y * width + pixel_x + 1u;
    let idx_bl = tile_offset + (pixel_y + 1u) * width + pixel_x;
    let idx_br = tile_offset + (pixel_y + 1u) * width + pixel_x + 1u;

    let rgba_tl = unpack_rgba(tile_data[idx_tl]);
    let rgba_tr = unpack_rgba(tile_data[idx_tr]);
    let rgba_bl = unpack_rgba(tile_data[idx_bl]);
    let rgba_br = unpack_rgba(tile_data[idx_br]);

    let elev_tl = pixel_to_elevation(rgba_tl.x, rgba_tl.y, rgba_tl.z);
    let elev_tr = pixel_to_elevation(rgba_tr.x, rgba_tr.y, rgba_tr.z);
    let elev_bl = pixel_to_elevation(rgba_bl.x, rgba_bl.y, rgba_bl.z);
    let elev_br = pixel_to_elevation(rgba_br.x, rgba_br.y, rgba_br.z);

    // Bilinear interpolation
    let top = elev_tl * (1.0 - dx) + elev_tr * dx;
    let bottom = elev_bl * (1.0 - dx) + elev_br * dx;
    return top * (1.0 - dy) + bottom * dy;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let gx = global_id.x;
    let gy = global_id.y;

    if (gx >= params.grid_width || gy >= params.grid_height) {
        return;
    }

    let grid_idx = gy * params.grid_width + gx;

    // Calculate geographic coordinates for this grid cell
    let norm_x = f32(gx) / f32(params.grid_width - 1u);
    let norm_y = f32(gy) / f32(params.grid_height - 1u);

    let lng = params.bbox_min_lng + (params.bbox_max_lng - params.bbox_min_lng) * norm_x;
    let lat = params.bbox_min_lat + (params.bbox_max_lat - params.bbox_min_lat) * norm_y;

    var total_elevation = 0.0;
    var total_weight = 0.0;

    // Process all tiles that contain this geographic point
    for (var tile_idx = 0u; tile_idx < params.num_tiles; tile_idx++) {
        let tile = tile_infos[tile_idx];

        // Check if point is within tile bounds
        if (lng < tile.min_lng || lng > tile.max_lng ||
            lat < tile.min_lat || lat > tile.max_lat) {
            continue;
        }

        // Convert geographic coordinate to fractional pixel coordinates
        let norm_tile_x = (lng - tile.min_lng) / (tile.max_lng - tile.min_lng);
        let norm_tile_y = 1.0 - ((lat - tile.min_lat) / (tile.max_lat - tile.min_lat));

        let frac_x = norm_tile_x * f32(tile.width - 1u);
        let frac_y = norm_tile_y * f32(tile.height - 1u);

        // Sample elevation with bilinear interpolation
        let elevation = sample_tile_elevation(tile_idx, frac_x, frac_y);

        // Compute edge weighting based on proximity to tile center
        let dist_from_center_x = abs(2.0 * norm_tile_x - 1.0);
        let dist_from_center_y = abs(2.0 * norm_tile_y - 1.0);
        let max_dist = max(dist_from_center_x, dist_from_center_y);
        let edge_weight = 1.0 - (max_dist * max_dist * 0.7);

        total_elevation += elevation * edge_weight;
        total_weight += edge_weight;
    }

    // Store results
    elevation_grid[grid_idx] = total_elevation;
    coverage_grid[grid_idx] = total_weight;
}
"#;

pub struct GpuElevationProcessor {
    device: Device,
    queue: Queue,
    compute_pipeline: ComputePipeline,
    bind_group_layout: BindGroupLayout,
}

impl GpuElevationProcessor {
    pub async fn new() -> Result<Self, JsValue> {
        console_log!("Initializing GPU elevation processor...");

        // Request WebGPU adapter and device
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| JsValue::from_str("Failed to find WebGPU adapter"))?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("GPU Elevation Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to create device: {:?}", e)))?;

        // Create compute shader
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Elevation Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(ELEVATION_COMPUTE_SHADER.into()),
        });

        // Create bind group layout
        let bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Elevation Bind Group Layout"),
            entries: &[
                // Tile infos buffer
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Tile data buffer
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Grid parameters uniform
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Elevation grid output
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Coverage grid output
                BindGroupLayoutEntry {
                    binding: 4,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // Create compute pipeline
        let compute_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("Elevation Compute Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("Elevation Pipeline Layout"),
                    bind_group_layouts: &[&bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &shader,
            entry_point: "main",
        });

        console_log!("GPU elevation processor initialized successfully");

        Ok(Self {
            device,
            queue,
            compute_pipeline,
            bind_group_layout,
        })
    }

    pub async fn process_elevation_gpu(
        &self,
        input: &ElevationProcessingInput,
        tile_data: &[TileData],
    ) -> Result<ElevationProcessingResult, JsValue> {
        console_log!("Processing elevation data on GPU...");

        let grid_width = input.grid_width as usize;
        let grid_height = input.grid_height as usize;

        // Prepare tile info data
        let mut tile_infos = Vec::with_capacity(tile_data.len());
        let mut all_pixel_data = Vec::new();

        for tile in tile_data {
            // Calculate tile geographic bounds
            let tile_min_lng = crate::elevation::tile_x_to_lng(tile.x, tile.z) as f32;
            let tile_max_lng = crate::elevation::tile_x_to_lng(tile.x + 1, tile.z) as f32;
            let tile_max_lat = crate::elevation::tile_y_to_lat(tile.y, tile.z) as f32;
            let tile_min_lat = crate::elevation::tile_y_to_lat(tile.y + 1, tile.z) as f32;

            tile_infos.push(TileInfo {
                x: tile.x,
                y: tile.y,
                z: tile.z,
                width: tile.width,
                height: tile.height,
                min_lng: tile_min_lng,
                max_lng: tile_max_lng,
                min_lat: tile_min_lat,
                max_lat: tile_max_lat,
                _padding: [0; 3],
            });

            // Pack RGBA pixel data as u32 values
            for chunk in tile.data.chunks_exact(4) {
                let packed = (chunk[0] as u32)
                    | ((chunk[1] as u32) << 8)
                    | ((chunk[2] as u32) << 16)
                    | ((chunk[3] as u32) << 24);
                all_pixel_data.push(packed);
            }
        }

        let grid_params = GridParams {
            grid_width: input.grid_width,
            grid_height: input.grid_height,
            bbox_min_lng: input.min_lng as f32,
            bbox_min_lat: input.min_lat as f32,
            bbox_max_lng: input.max_lng as f32,
            bbox_max_lat: input.max_lat as f32,
            num_tiles: tile_data.len() as u32,
            _padding: 0,
        };

        // Create GPU buffers
        let tile_info_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Tile Info Buffer"),
            contents: bytemuck::cast_slice(&tile_infos),
            usage: BufferUsages::STORAGE,
        });

        let tile_data_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Tile Data Buffer"),
            contents: bytemuck::cast_slice(&all_pixel_data),
            usage: BufferUsages::STORAGE,
        });

        let params_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Grid Params Buffer"),
            contents: bytemuck::cast_slice(&[grid_params]),
            usage: BufferUsages::UNIFORM,
        });

        let elevation_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("Elevation Grid Buffer"),
            size: (grid_width * grid_height * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let coverage_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("Coverage Grid Buffer"),
            size: (grid_width * grid_height * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        // Create bind group
        let bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("Elevation Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: tile_info_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: tile_data_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 2,
                    resource: params_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 3,
                    resource: elevation_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 4,
                    resource: coverage_buffer.as_entire_binding(),
                },
            ],
        });

        // Dispatch compute shader
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Elevation Compute Encoder"),
        });

        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("Elevation Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.compute_pipeline);
            compute_pass.set_bind_group(0, &bind_group, &[]);

            // Dispatch with appropriate workgroup size
            let workgroup_size_x = 8;
            let workgroup_size_y = 8;
            let num_workgroups_x = (grid_width + workgroup_size_x - 1) / workgroup_size_x;
            let num_workgroups_y = (grid_height + workgroup_size_y - 1) / workgroup_size_y;

            compute_pass.dispatch_workgroups(num_workgroups_x as u32, num_workgroups_y as u32, 1);
        }

        // Create staging buffers to read back results
        let elevation_staging = self.device.create_buffer(&BufferDescriptor {
            label: Some("Elevation Staging Buffer"),
            size: elevation_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let coverage_staging = self.device.create_buffer(&BufferDescriptor {
            label: Some("Coverage Staging Buffer"),
            size: coverage_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        encoder.copy_buffer_to_buffer(&elevation_buffer, 0, &elevation_staging, 0, elevation_buffer.size());
        encoder.copy_buffer_to_buffer(&coverage_buffer, 0, &coverage_staging, 0, coverage_buffer.size());

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read back results
        let elevation_slice = elevation_staging.slice(..);
        let coverage_slice = coverage_staging.slice(..);

        elevation_slice.map_async(wgpu::MapMode::Read, |_| {});
        coverage_slice.map_async(wgpu::MapMode::Read, |_| {});

        self.device.poll(wgpu::Maintain::Wait);

        let elevation_data = elevation_slice.get_mapped_range();
        let coverage_data = coverage_slice.get_mapped_range();

        let elevation_values: &[f32] = bytemuck::cast_slice(&elevation_data);
        let coverage_values: &[f32] = bytemuck::cast_slice(&coverage_data);

        // Convert to grid format and normalize
        let mut elevation_grid = vec![vec![0.0; grid_width]; grid_height];
        let mut min_elevation = f64::INFINITY;
        let mut max_elevation = f64::NEG_INFINITY;

        for y in 0..grid_height {
            for x in 0..grid_width {
                let idx = y * grid_width + x;
                let elevation = elevation_values[idx] as f64;
                let coverage = coverage_values[idx] as f64;

                let final_elevation = if coverage > 0.0 {
                    elevation / coverage
                } else {
                    0.0 // Default for uncovered areas
                };

                elevation_grid[y][x] = final_elevation;
                min_elevation = min_elevation.min(final_elevation);
                max_elevation = max_elevation.max(final_elevation);
            }
        }

        console_log!("GPU elevation processing completed successfully");

        Ok(ElevationProcessingResult {
            elevation_grid,
            grid_size: GridSize {
                width: input.grid_width,
                height: input.grid_height,
            },
            min_elevation,
            max_elevation,
            processed_min_elevation: min_elevation,
            processed_max_elevation: max_elevation,
            cache_hit_rate: 1.0, // GPU processing doesn't use cache directly
        })
    }
}

// Global GPU processor instance
static mut GPU_PROCESSOR: Option<GpuElevationProcessor> = None;

// Check if WebGPU is available and initialize GPU processor
#[wasm_bindgen]
pub async fn init_gpu_elevation_processor() -> Result<bool, JsValue> {
    match GpuElevationProcessor::new().await {
        Ok(processor) => {
            unsafe {
                GPU_PROCESSOR = Some(processor);
            }
            console_log!("GPU elevation processor initialized successfully");
            Ok(true)
        }
        Err(e) => {
            console_log!("Failed to initialize GPU processor: {:?}", e);
            Ok(false)
        }
    }
}

// GPU-accelerated elevation processing function
pub async fn process_elevation_gpu(
    input: &ElevationProcessingInput,
    tile_data: &[TileData],
) -> Result<ElevationProcessingResult, JsValue> {
    unsafe {
        match &GPU_PROCESSOR {
            Some(processor) => processor.process_elevation_gpu(input, tile_data).await,
            None => Err(JsValue::from_str("GPU processor not initialized")),
        }
    }
}