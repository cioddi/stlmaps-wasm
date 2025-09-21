// GPU-accelerated terrain mesh generation using WebGPU compute shaders
use wasm_bindgen::prelude::*;
use wgpu::{
    BindGroupDescriptor, BindGroupEntry, BindGroupLayout, BindGroupLayoutDescriptor,
    BindGroupLayoutEntry, BindingType, BufferBindingType,
    BufferDescriptor, BufferUsages, ComputePassDescriptor, ComputePipeline,
    ComputePipelineDescriptor, Device, Queue, ShaderStages,
};
use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

use crate::elevation::ElevationProcessingResult;
use crate::terrain::{TerrainGeometryParams, TerrainGeometryResult};
use crate::console_log;

// GPU-compatible data structures
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TerrainParams {
    grid_width: u32,
    grid_height: u32,
    target_width: u32,
    target_height: u32,
    vertical_exaggeration: f32,
    terrain_base_height: f32,
    min_elevation: f32,
    max_elevation: f32,
    elevation_range: f32,
    min_terrain_thickness: f32,
    _padding: [u32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 3],
    normal: [f32; 3],
    color: [f32; 3],
    _padding: f32,
}

// WebGPU compute shader for terrain vertex generation
const TERRAIN_VERTEX_SHADER: &str = r#"
@group(0) @binding(0) var<storage, read> elevation_grid: array<f32>;
@group(0) @binding(1) var<uniform> params: TerrainParams;
@group(0) @binding(2) var<storage, read_write> vertices: array<Vertex>;

struct TerrainParams {
    grid_width: u32,
    grid_height: u32,
    target_width: u32,
    target_height: u32,
    vertical_exaggeration: f32,
    terrain_base_height: f32,
    min_elevation: f32,
    max_elevation: f32,
    elevation_range: f32,
    min_terrain_thickness: f32,
    padding: array<u32, 2>,
}

struct Vertex {
    position: array<f32, 3>,
    normal: array<f32, 3>,
    color: array<f32, 3>,
    padding: f32,
}

// Sample elevation from grid with bilinear interpolation
fn sample_elevation(src_x: f32, src_y: f32) -> f32 {
    let max_source_x = f32(params.grid_width - 1u);
    let max_source_y = f32(params.grid_height - 1u);

    let sx = clamp(src_x, 0.0, max_source_x);
    let sy = clamp(src_y, 0.0, max_source_y);

    let x0 = u32(floor(sx));
    let y0 = u32(floor(sy));
    let x1 = min(x0 + 1u, params.grid_width - 1u);
    let y1 = min(y0 + 1u, params.grid_height - 1u);

    let dx = sx - f32(x0);
    let dy = sy - f32(y0);

    let v00 = elevation_grid[y0 * params.grid_width + x0];
    let v10 = elevation_grid[y0 * params.grid_width + x1];
    let v01 = elevation_grid[y1 * params.grid_width + x0];
    let v11 = elevation_grid[y1 * params.grid_width + x1];

    let v0 = v00 * (1.0 - dx) + v10 * dx;
    let v1 = v01 * (1.0 - dx) + v11 * dx;

    return v0 * (1.0 - dy) + v1 * dy;
}

// Calculate terrain height with proper scaling
fn calculate_terrain_height(elevation: f32) -> f32 {
    let normalized_elevation = clamp((elevation - params.min_elevation) / params.elevation_range, 0.0, 1.0);
    let elevation_variation = normalized_elevation * params.vertical_exaggeration;
    let mut top_z = params.terrain_base_height + elevation_variation;

    // Ensure minimum thickness
    if (top_z - 0.0 < params.min_terrain_thickness) {
        top_z = 0.0 + params.min_terrain_thickness;
    }

    return top_z;
}

// Calculate color based on elevation
fn calculate_color(normalized_elevation: f32) -> array<f32, 3> {
    let light_brown = array<f32, 3>(0.82, 0.71, 0.55);
    let dark_brown = array<f32, 3>(0.66, 0.48, 0.30);

    let inv_norm = 1.0 - normalized_elevation;
    return array<f32, 3>(
        light_brown[0] * inv_norm + dark_brown[0] * normalized_elevation,
        light_brown[1] * inv_norm + dark_brown[1] * normalized_elevation,
        light_brown[2] * inv_norm + dark_brown[2] * normalized_elevation
    );
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.target_width || y >= params.target_height) {
        return;
    }

    // Calculate normalized coordinates
    let normalized_x = f32(x) / f32(params.target_width - 1u);
    let normalized_y = f32(y) / f32(params.target_height - 1u);

    // Map to source grid coordinates
    let source_x = normalized_x * f32(params.grid_width - 1u);
    let source_y = normalized_y * f32(params.grid_height - 1u);

    // Sample elevation
    let elevation = sample_elevation(source_x, source_y);
    let top_z = calculate_terrain_height(elevation);

    // Calculate mesh coordinates (terrain is 200x200 units centered at origin)
    let mesh_x = (normalized_x - 0.5) * 200.0;
    let mesh_y = (normalized_y - 0.5) * 200.0;

    // Calculate normalized elevation for coloring
    let normalized_elevation = clamp((elevation - params.min_elevation) / params.elevation_range, 0.0, 1.0);
    let color = calculate_color(normalized_elevation);

    // Calculate vertex indices (top and bottom vertices)
    let vertex_idx = (y * params.target_width + x) * 2u;

    // Top vertex
    vertices[vertex_idx] = Vertex(
        array<f32, 3>(mesh_x, mesh_y, top_z),
        array<f32, 3>(0.0, 0.0, 1.0), // Will be calculated in normal pass
        color,
        0.0
    );

    // Bottom vertex
    let bottom_shade_factor = 0.6;
    let bottom_color = array<f32, 3>(
        color[0] * bottom_shade_factor,
        color[1] * bottom_shade_factor,
        color[2] * bottom_shade_factor
    );

    vertices[vertex_idx + 1u] = Vertex(
        array<f32, 3>(mesh_x, mesh_y, 0.0),
        array<f32, 3>(0.0, 0.0, -1.0), // Will be calculated in normal pass
        bottom_color,
        0.0
    );
}
"#;

// WebGPU compute shader for terrain index generation
const TERRAIN_INDEX_SHADER: &str = r#"
@group(0) @binding(0) var<uniform> params: TerrainParams;
@group(0) @binding(1) var<storage, read_write> indices: array<u32>;

struct TerrainParams {
    grid_width: u32,
    grid_height: u32,
    target_width: u32,
    target_height: u32,
    vertical_exaggeration: f32,
    terrain_base_height: f32,
    min_elevation: f32,
    max_elevation: f32,
    elevation_range: f32,
    min_terrain_thickness: f32,
    padding: array<u32, 2>,
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.target_width - 1u || y >= params.target_height - 1u) {
        return;
    }

    let width = params.target_width;
    let height = params.target_height;

    // Calculate quad indices
    let quad_idx = y * (width - 1u) + x;
    let base_index = quad_idx * 12u; // 4 triangles * 3 indices each

    // Top face vertices (even indices)
    let top_left = ((y * width + x) * 2u);
    let top_right = ((y * width + x + 1u) * 2u);
    let bottom_left = (((y + 1u) * width + x) * 2u);
    let bottom_right = (((y + 1u) * width + x + 1u) * 2u);

    // Bottom face vertices (odd indices)
    let bottom_top_left = top_left + 1u;
    let bottom_top_right = top_right + 1u;
    let bottom_bottom_left = bottom_left + 1u;
    let bottom_bottom_right = bottom_right + 1u;

    // Top face triangles (counter-clockwise)
    indices[base_index + 0u] = top_left;
    indices[base_index + 1u] = bottom_left;
    indices[base_index + 2u] = top_right;

    indices[base_index + 3u] = top_right;
    indices[base_index + 4u] = bottom_left;
    indices[base_index + 5u] = bottom_right;

    // Bottom face triangles (clockwise for correct winding)
    indices[base_index + 6u] = bottom_top_left;
    indices[base_index + 7u] = bottom_top_right;
    indices[base_index + 8u] = bottom_bottom_left;

    indices[base_index + 9u] = bottom_top_right;
    indices[base_index + 10u] = bottom_bottom_right;
    indices[base_index + 11u] = bottom_bottom_left;
}
"#;

// WebGPU compute shader for normal calculation
const TERRAIN_NORMAL_SHADER: &str = r#"
@group(0) @binding(0) var<storage, read_write> vertices: array<Vertex>;
@group(0) @binding(1) var<storage, read> indices: array<u32>;
@group(0) @binding(2) var<uniform> params: TerrainParams;

struct Vertex {
    position: array<f32, 3>,
    normal: array<f32, 3>,
    color: array<f32, 3>,
    padding: f32,
}

struct TerrainParams {
    grid_width: u32,
    grid_height: u32,
    target_width: u32,
    target_height: u32,
    vertical_exaggeration: f32,
    terrain_base_height: f32,
    min_elevation: f32,
    max_elevation: f32,
    elevation_range: f32,
    min_terrain_thickness: f32,
    padding: array<u32, 2>,
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let triangle_idx = global_id.x;
    let total_triangles = (params.target_width - 1u) * (params.target_height - 1u) * 4u;

    if (triangle_idx >= total_triangles) {
        return;
    }

    let base_idx = triangle_idx * 3u;
    let i0 = indices[base_idx];
    let i1 = indices[base_idx + 1u];
    let i2 = indices[base_idx + 2u];

    let p0 = vertices[i0].position;
    let p1 = vertices[i1].position;
    let p2 = vertices[i2].position;

    // Calculate face normal using cross product
    let edge1 = array<f32, 3>(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    let edge2 = array<f32, 3>(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);

    let face_normal = array<f32, 3>(
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
    );

    // Accumulate normals for each vertex (atomic operations would be better but not available)
    // This is a simplified approach - in practice, you'd want to use atomic operations
    // or a two-pass algorithm for proper normal accumulation
    vertices[i0].normal[0] += face_normal[0];
    vertices[i0].normal[1] += face_normal[1];
    vertices[i0].normal[2] += face_normal[2];

    vertices[i1].normal[0] += face_normal[0];
    vertices[i1].normal[1] += face_normal[1];
    vertices[i1].normal[2] += face_normal[2];

    vertices[i2].normal[0] += face_normal[0];
    vertices[i2].normal[1] += face_normal[1];
    vertices[i2].normal[2] += face_normal[2];
}
"#;

// WebGPU compute shader for normal normalization
const TERRAIN_NORMAL_NORMALIZE_SHADER: &str = r#"
@group(0) @binding(0) var<storage, read_write> vertices: array<Vertex>;
@group(0) @binding(1) var<uniform> params: TerrainParams;

struct Vertex {
    position: array<f32, 3>,
    normal: array<f32, 3>,
    color: array<f32, 3>,
    padding: f32,
}

struct TerrainParams {
    grid_width: u32,
    grid_height: u32,
    target_width: u32,
    target_height: u32,
    vertical_exaggeration: f32,
    terrain_base_height: f32,
    min_elevation: f32,
    max_elevation: f32,
    elevation_range: f32,
    min_terrain_thickness: f32,
    padding: array<u32, 2>,
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let vertex_idx = global_id.x;
    let total_vertices = params.target_width * params.target_height * 2u;

    if (vertex_idx >= total_vertices) {
        return;
    }

    let normal = vertices[vertex_idx].normal;
    let length = sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);

    if (length > 1e-6) {
        let inv_length = 1.0 / length;
        vertices[vertex_idx].normal[0] = normal[0] * inv_length;
        vertices[vertex_idx].normal[1] = normal[1] * inv_length;
        vertices[vertex_idx].normal[2] = normal[2] * inv_length;
    } else {
        // Default normals for degenerate cases
        if (vertex_idx % 2u == 0u) {
            // Top vertices point up
            vertices[vertex_idx].normal = array<f32, 3>(0.0, 0.0, 1.0);
        } else {
            // Bottom vertices point down
            vertices[vertex_idx].normal = array<f32, 3>(0.0, 0.0, -1.0);
        }
    }
}
"#;

pub struct GpuTerrainProcessor {
    device: Device,
    queue: Queue,
    vertex_pipeline: ComputePipeline,
    index_pipeline: ComputePipeline,
    normal_pipeline: ComputePipeline,
    normal_normalize_pipeline: ComputePipeline,
    vertex_bind_group_layout: BindGroupLayout,
    index_bind_group_layout: BindGroupLayout,
    normal_bind_group_layout: BindGroupLayout,
    normal_normalize_bind_group_layout: BindGroupLayout,
}

impl GpuTerrainProcessor {
    pub async fn new() -> Result<Self, JsValue> {
        console_log!("Initializing GPU terrain processor...");

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
                    label: Some("GPU Terrain Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to create device: {:?}", e)))?;

        // Create shaders
        let vertex_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Terrain Vertex Shader"),
            source: wgpu::ShaderSource::Wgsl(TERRAIN_VERTEX_SHADER.into()),
        });

        let index_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Terrain Index Shader"),
            source: wgpu::ShaderSource::Wgsl(TERRAIN_INDEX_SHADER.into()),
        });

        let normal_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Terrain Normal Shader"),
            source: wgpu::ShaderSource::Wgsl(TERRAIN_NORMAL_SHADER.into()),
        });

        let normal_normalize_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Terrain Normal Normalize Shader"),
            source: wgpu::ShaderSource::Wgsl(TERRAIN_NORMAL_NORMALIZE_SHADER.into()),
        });

        // Create bind group layouts
        let vertex_bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Terrain Vertex Bind Group Layout"),
            entries: &[
                // Elevation grid
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
                // Terrain parameters
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Vertices output
                BindGroupLayoutEntry {
                    binding: 2,
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

        let index_bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Terrain Index Bind Group Layout"),
            entries: &[
                // Terrain parameters
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Indices output
                BindGroupLayoutEntry {
                    binding: 1,
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

        let normal_bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Terrain Normal Bind Group Layout"),
            entries: &[
                // Vertices
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Indices
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
                // Terrain parameters
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
            ],
        });

        let normal_normalize_bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Terrain Normal Normalize Bind Group Layout"),
            entries: &[
                // Vertices
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Terrain parameters
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // Create compute pipelines
        let vertex_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("Terrain Vertex Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("Terrain Vertex Pipeline Layout"),
                    bind_group_layouts: &[&vertex_bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &vertex_shader,
            entry_point: "main",
        });

        let index_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("Terrain Index Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("Terrain Index Pipeline Layout"),
                    bind_group_layouts: &[&index_bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &index_shader,
            entry_point: "main",
        });

        let normal_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("Terrain Normal Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("Terrain Normal Pipeline Layout"),
                    bind_group_layouts: &[&normal_bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &normal_shader,
            entry_point: "main",
        });

        let normal_normalize_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("Terrain Normal Normalize Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("Terrain Normal Normalize Pipeline Layout"),
                    bind_group_layouts: &[&normal_normalize_bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &normal_normalize_shader,
            entry_point: "main",
        });

        console_log!("GPU terrain processor initialized successfully");

        Ok(Self {
            device,
            queue,
            vertex_pipeline,
            index_pipeline,
            normal_pipeline,
            normal_normalize_pipeline,
            vertex_bind_group_layout,
            index_bind_group_layout,
            normal_bind_group_layout,
            normal_normalize_bind_group_layout,
        })
    }

    pub async fn generate_terrain_mesh_gpu(
        &self,
        elevation_data: &ElevationProcessingResult,
        params: &TerrainGeometryParams,
    ) -> Result<TerrainGeometryResult, JsValue> {
        console_log!("Generating terrain mesh on GPU...");

        let source_width = elevation_data.grid_size.width as usize;
        let source_height = elevation_data.grid_size.height as usize;
        let target_width = source_width.min(64).max(2); // Reasonable target resolution
        let target_height = source_height.min(64).max(2);

        let elevation_range = f64::max(1.0, elevation_data.max_elevation - elevation_data.min_elevation);

        // Flatten elevation grid for GPU
        let flattened_elevation: Vec<f32> = elevation_data
            .elevation_grid
            .iter()
            .flat_map(|row| row.iter().map(|&val| val as f32))
            .collect();

        let terrain_params = TerrainParams {
            grid_width: source_width as u32,
            grid_height: source_height as u32,
            target_width: target_width as u32,
            target_height: target_height as u32,
            vertical_exaggeration: params.vertical_exaggeration as f32,
            terrain_base_height: params.terrain_base_height as f32,
            min_elevation: elevation_data.min_elevation as f32,
            max_elevation: elevation_data.max_elevation as f32,
            elevation_range: elevation_range as f32,
            min_terrain_thickness: 0.3,
            _padding: [0; 2],
        };

        // Create GPU buffers
        let elevation_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Terrain Elevation Buffer"),
            contents: bytemuck::cast_slice(&flattened_elevation),
            usage: BufferUsages::STORAGE,
        });

        let params_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Terrain Params Buffer"),
            contents: bytemuck::cast_slice(&[terrain_params]),
            usage: BufferUsages::UNIFORM,
        });

        let vertex_count = target_width * target_height * 2; // Top and bottom vertices
        let vertices_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("Terrain Vertices Buffer"),
            size: (vertex_count * std::mem::size_of::<Vertex>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let triangle_count = (target_width - 1) * (target_height - 1) * 4; // 4 triangles per quad
        let index_count = triangle_count * 3;
        let indices_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("Terrain Indices Buffer"),
            size: (index_count * std::mem::size_of::<u32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        // Create bind groups
        let vertex_bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("Terrain Vertex Bind Group"),
            layout: &self.vertex_bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: elevation_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: params_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 2,
                    resource: vertices_buffer.as_entire_binding(),
                },
            ],
        });

        let index_bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("Terrain Index Bind Group"),
            layout: &self.index_bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: params_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: indices_buffer.as_entire_binding(),
                },
            ],
        });

        let normal_bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("Terrain Normal Bind Group"),
            layout: &self.normal_bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: vertices_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: indices_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 2,
                    resource: params_buffer.as_entire_binding(),
                },
            ],
        });

        let normal_normalize_bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("Terrain Normal Normalize Bind Group"),
            layout: &self.normal_normalize_bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: vertices_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: params_buffer.as_entire_binding(),
                },
            ],
        });

        // Execute compute shaders
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Terrain Compute Encoder"),
        });

        // Generate vertices
        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("Terrain Vertex Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.vertex_pipeline);
            compute_pass.set_bind_group(0, &vertex_bind_group, &[]);

            let workgroup_size_x = 8;
            let workgroup_size_y = 8;
            let num_workgroups_x = (target_width + workgroup_size_x - 1) / workgroup_size_x;
            let num_workgroups_y = (target_height + workgroup_size_y - 1) / workgroup_size_y;

            compute_pass.dispatch_workgroups(num_workgroups_x as u32, num_workgroups_y as u32, 1);
        }

        // Generate indices
        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("Terrain Index Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.index_pipeline);
            compute_pass.set_bind_group(0, &index_bind_group, &[]);

            let workgroup_size_x = 8;
            let workgroup_size_y = 8;
            let num_workgroups_x = ((target_width - 1) + workgroup_size_x - 1) / workgroup_size_x;
            let num_workgroups_y = ((target_height - 1) + workgroup_size_y - 1) / workgroup_size_y;

            compute_pass.dispatch_workgroups(num_workgroups_x as u32, num_workgroups_y as u32, 1);
        }

        // Calculate normals
        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("Terrain Normal Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.normal_pipeline);
            compute_pass.set_bind_group(0, &normal_bind_group, &[]);

            let num_workgroups = (triangle_count + 63) / 64;
            compute_pass.dispatch_workgroups(num_workgroups as u32, 1, 1);
        }

        // Normalize normals
        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("Terrain Normal Normalize Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.normal_normalize_pipeline);
            compute_pass.set_bind_group(0, &normal_normalize_bind_group, &[]);

            let num_workgroups = (vertex_count + 63) / 64;
            compute_pass.dispatch_workgroups(num_workgroups as u32, 1, 1);
        }

        // Create staging buffers
        let vertices_staging = self.device.create_buffer(&BufferDescriptor {
            label: Some("Terrain Vertices Staging"),
            size: vertices_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let indices_staging = self.device.create_buffer(&BufferDescriptor {
            label: Some("Terrain Indices Staging"),
            size: indices_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        encoder.copy_buffer_to_buffer(&vertices_buffer, 0, &vertices_staging, 0, vertices_buffer.size());
        encoder.copy_buffer_to_buffer(&indices_buffer, 0, &indices_staging, 0, indices_buffer.size());

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read back results
        let vertices_slice = vertices_staging.slice(..);
        let indices_slice = indices_staging.slice(..);

        vertices_slice.map_async(wgpu::MapMode::Read, |_| {});
        indices_slice.map_async(wgpu::MapMode::Read, |_| {});

        self.device.poll(wgpu::Maintain::Wait);

        let vertices_data = vertices_slice.get_mapped_range();
        let indices_data = indices_slice.get_mapped_range();

        let gpu_vertices: &[Vertex] = bytemuck::cast_slice(&vertices_data);
        let gpu_indices: &[u32] = bytemuck::cast_slice(&indices_data);

        // Convert to output format
        let mut positions = Vec::with_capacity(vertex_count * 3);
        let mut normals = Vec::with_capacity(vertex_count * 3);
        let mut colors = Vec::with_capacity(vertex_count * 3);

        for vertex in gpu_vertices {
            positions.extend_from_slice(&vertex.position);
            normals.extend_from_slice(&vertex.normal);
            colors.extend_from_slice(&vertex.color);
        }

        let indices: Vec<u32> = gpu_indices.to_vec();

        // Create processed elevation grid (simplified for now)
        let processed_elevation_grid = elevation_data.elevation_grid.clone();

        console_log!("GPU terrain mesh generation completed successfully");

        Ok(TerrainGeometryResult {
            positions,
            indices,
            colors,
            normals,
            processed_elevation_grid,
            processed_min_elevation: elevation_data.min_elevation,
            processed_max_elevation: elevation_data.max_elevation,
            original_min_elevation: elevation_data.min_elevation,
            original_max_elevation: elevation_data.max_elevation,
        })
    }
}

// Global GPU terrain processor instance
static mut GPU_TERRAIN_PROCESSOR: Option<GpuTerrainProcessor> = None;

// Initialize GPU terrain processor
#[wasm_bindgen]
pub async fn init_gpu_terrain_processor() -> Result<bool, JsValue> {
    match GpuTerrainProcessor::new().await {
        Ok(processor) => {
            unsafe {
                GPU_TERRAIN_PROCESSOR = Some(processor);
            }
            console_log!("GPU terrain processor initialized successfully");
            Ok(true)
        }
        Err(e) => {
            console_log!("Failed to initialize GPU terrain processor: {:?}", e);
            Ok(false)
        }
    }
}

// GPU-accelerated terrain generation function
pub async fn generate_terrain_mesh_gpu(
    elevation_data: &ElevationProcessingResult,
    params: &TerrainGeometryParams,
) -> Result<TerrainGeometryResult, JsValue> {
    unsafe {
        match &GPU_TERRAIN_PROCESSOR {
            Some(processor) => processor.generate_terrain_mesh_gpu(elevation_data, params).await,
            None => Err(JsValue::from_str("GPU terrain processor not initialized")),
        }
    }
}