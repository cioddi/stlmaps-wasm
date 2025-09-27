// GPU-accelerated polygon and LineString processing module using WebGPU compute shaders
use wasm_bindgen::prelude::*;
use wgpu::{
    BindGroupDescriptor, BindGroupEntry, BindGroupLayout, BindGroupLayoutDescriptor,
    BindGroupLayoutEntry, BindingType, BufferBindingType,
    BufferDescriptor, BufferUsages, ComputePassDescriptor, ComputePipeline,
    ComputePipelineDescriptor, Device, Queue, ShaderStages,
};
use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

// Note: These imports would be used for future polygon processing integrations
// use crate::polygon_geometry::{GeometryData, BufferGeometry, GridSize};

// GPU-compatible data structures
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Point2D {
    x: f32,
    y: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct BoundingBox {
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LineStringBufferParams {
    buffer_distance: f32,
    num_points: u32,
    _padding: [u32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PolygonClipParams {
    bbox: BoundingBox,
    num_polygons: u32,
    max_points_per_polygon: u32,
    _padding: [u32; 2],
}

// WebGPU compute shader for LineString buffering
const LINESTRING_BUFFER_SHADER: &str = r#"
@group(0) @binding(0) var<storage, read> input_points: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> params: LineStringBufferParams;
@group(0) @binding(2) var<storage, read_write> output_points: array<vec2<f32>>;

struct LineStringBufferParams {
    buffer_distance: f32,
    num_points: u32,
    padding: array<u32, 2>,
}

// Calculate perpendicular offset for a line segment
fn calculate_perpendicular(p1: vec2<f32>, p2: vec2<f32>, distance: f32) -> vec2<f32> {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    let length = sqrt(dx * dx + dy * dy);

    if (length < 1e-6) {
        return vec2<f32>(0.0, 0.0);
    }

    let perp_x = -dy / length * distance;
    let perp_y = dx / length * distance;

    return vec2<f32>(perp_x, perp_y);
}

// Calculate bisector for smooth corners
fn calculate_bisector(prev_dir: vec2<f32>, next_dir: vec2<f32>, distance: f32) -> vec2<f32> {
    let bisector = normalize(prev_dir + next_dir);
    let dot_product = dot(prev_dir, next_dir);

    // Avoid extreme scaling for sharp angles
    let scale_factor = distance / max(0.1, sqrt((1.0 + dot_product) * 0.5));

    return bisector * scale_factor;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let point_idx = global_id.x;

    if (point_idx >= params.num_points) {
        return;
    }

    let current_point = input_points[point_idx];
    let distance = params.buffer_distance;

    var offset: vec2<f32>;

    if (point_idx == 0u) {
        // First point - use perpendicular to first segment
        if (params.num_points > 1u) {
            offset = calculate_perpendicular(current_point, input_points[1], distance);
        } else {
            offset = vec2<f32>(distance, 0.0);
        }
    } else if (point_idx == params.num_points - 1u) {
        // Last point - use perpendicular to last segment
        offset = calculate_perpendicular(input_points[point_idx - 1u], current_point, distance);
    } else {
        // Middle point - use bisector for smooth corners
        let prev_point = input_points[point_idx - 1u];
        let next_point = input_points[point_idx + 1u];

        let prev_dir = normalize(current_point - prev_point);
        let next_dir = normalize(next_point - current_point);

        offset = calculate_bisector(prev_dir, next_dir, distance);
    }

    // Output both left and right offset points
    let left_point = current_point + offset;
    let right_point = current_point - offset;

    // Store left points first, then right points (reversed)
    output_points[point_idx] = left_point;
    output_points[params.num_points * 2u - 1u - point_idx] = right_point;
}
"#;

// WebGPU compute shader for polygon clipping (Sutherland-Hodgman algorithm)
const POLYGON_CLIP_SHADER: &str = r#"
@group(0) @binding(0) var<storage, read> input_polygons: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> polygon_offsets: array<u32>; // Start index for each polygon
@group(0) @binding(2) var<storage, read> polygon_counts: array<u32>;  // Point count for each polygon
@group(0) @binding(3) var<uniform> params: PolygonClipParams;
@group(0) @binding(4) var<storage, read_write> output_polygons: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> output_counts: array<u32>;

struct BoundingBox {
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
}

struct PolygonClipParams {
    bbox: BoundingBox,
    num_polygons: u32,
    max_points_per_polygon: u32,
    padding: array<u32, 2>,
}

// Check if point is inside clipping edge
fn is_inside_edge(point: vec2<f32>, edge_type: u32, clip_value: f32) -> bool {
    switch (edge_type) {
        case 0u: { return point.x >= clip_value; } // Left edge
        case 1u: { return point.x <= clip_value; } // Right edge
        case 2u: { return point.y >= clip_value; } // Bottom edge
        case 3u: { return point.y <= clip_value; } // Top edge
        default: { return false; }
    }
}

// Compute intersection with clipping edge
fn compute_intersection(p1: vec2<f32>, p2: vec2<f32>, edge_type: u32, clip_value: f32) -> vec2<f32> {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;

    switch (edge_type) {
        case 0u, 1u: { // Left or Right edge (vertical)
            if (abs(dx) < 1e-10) {
                return p1; // Parallel to edge
            }
            let t = (clip_value - p1.x) / dx;
            return vec2<f32>(clip_value, p1.y + t * dy);
        }
        case 2u, 3u: { // Bottom or Top edge (horizontal)
            if (abs(dy) < 1e-10) {
                return p1; // Parallel to edge
            }
            let t = (clip_value - p1.y) / dy;
            return vec2<f32>(p1.x + t * dx, clip_value);
        }
        default: {
            return p1;
        }
    }
}

@compute @workgroup_size(32, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let polygon_idx = global_id.x;

    if (polygon_idx >= params.num_polygons) {
        return;
    }

    let input_offset = polygon_offsets[polygon_idx];
    let input_count = polygon_counts[polygon_idx];
    let output_offset = polygon_idx * params.max_points_per_polygon;

    if (input_count < 3u) {
        output_counts[polygon_idx] = 0u;
        return;
    }

    // Working arrays for clipping (using local memory)
    var current_polygon: array<vec2<f32>, 64>; // Assuming max 64 points per polygon
    var temp_polygon: array<vec2<f32>, 64>;
    var current_count = input_count;

    // Load initial polygon
    for (var i = 0u; i < input_count && i < 64u; i++) {
        current_polygon[i] = input_polygons[input_offset + i];
    }

    // Clip against each edge of the bounding box
    let clip_edges = array<f32, 4>(
        params.bbox.min_x,  // Left edge
        params.bbox.max_x,  // Right edge
        params.bbox.min_y,  // Bottom edge
        params.bbox.max_y   // Top edge
    );

    for (var edge = 0u; edge < 4u; edge++) {
        if (current_count == 0u) {
            break;
        }

        var new_count = 0u;
        let clip_value = clip_edges[edge];

        if (current_count > 0u) {
            var prev = current_polygon[current_count - 1u];

            for (var i = 0u; i < current_count && new_count < 64u; i++) {
                let curr = current_polygon[i];
                let prev_inside = is_inside_edge(prev, edge, clip_value);
                let curr_inside = is_inside_edge(curr, edge, clip_value);

                if (curr_inside) {
                    if (!prev_inside && new_count < 63u) {
                        // Entering - add intersection point
                        temp_polygon[new_count] = compute_intersection(prev, curr, edge, clip_value);
                        new_count++;
                    }
                    // Add current point
                    temp_polygon[new_count] = curr;
                    new_count++;
                } else if (prev_inside && new_count < 64u) {
                    // Leaving - add intersection point
                    temp_polygon[new_count] = compute_intersection(prev, curr, edge, clip_value);
                    new_count++;
                }

                prev = curr;
            }
        }

        // Copy temp back to current
        for (var i = 0u; i < new_count; i++) {
            current_polygon[i] = temp_polygon[i];
        }
        current_count = new_count;
    }

    // Write output
    let final_count = min(current_count, params.max_points_per_polygon);
    output_counts[polygon_idx] = final_count;

    for (var i = 0u; i < final_count; i++) {
        output_polygons[output_offset + i] = current_polygon[i];
    }
}
"#;

pub struct GpuPolygonProcessor {
    device: Device,
    queue: Queue,
    linestring_pipeline: ComputePipeline,
    polygon_clip_pipeline: ComputePipeline,
    linestring_bind_group_layout: BindGroupLayout,
    polygon_clip_bind_group_layout: BindGroupLayout,
}

impl GpuPolygonProcessor {
    pub async fn new() -> Result<Self, JsValue> {

        // Request WebGPU adapter and device (reuse GPU device from elevation if available)
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
                    label: Some("GPU Polygon Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to create device: {:?}", e)))?;

        // Create LineString buffer shader
        let linestring_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("LineString Buffer Shader"),
            source: wgpu::ShaderSource::Wgsl(LINESTRING_BUFFER_SHADER.into()),
        });

        // Create polygon clipping shader
        let polygon_clip_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Polygon Clip Shader"),
            source: wgpu::ShaderSource::Wgsl(POLYGON_CLIP_SHADER.into()),
        });

        // Create bind group layouts
        let linestring_bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("LineString Bind Group Layout"),
            entries: &[
                // Input points
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
                // Parameters
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
                // Output points
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

        let polygon_clip_bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Polygon Clip Bind Group Layout"),
            entries: &[
                // Input polygons
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
                // Polygon offsets
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
                // Polygon counts
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Parameters
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: ShaderStages::COMPUTE,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Output polygons
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
                // Output counts
                BindGroupLayoutEntry {
                    binding: 5,
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

        // Create compute pipelines
        let linestring_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("LineString Buffer Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("LineString Pipeline Layout"),
                    bind_group_layouts: &[&linestring_bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &linestring_shader,
            entry_point: "main",
        });

        let polygon_clip_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("Polygon Clip Pipeline"),
            layout: Some(&device.create_pipeline_layout(
                &wgpu::PipelineLayoutDescriptor {
                    label: Some("Polygon Clip Pipeline Layout"),
                    bind_group_layouts: &[&polygon_clip_bind_group_layout],
                    push_constant_ranges: &[],
                },
            )),
            module: &polygon_clip_shader,
            entry_point: "main",
        });


        Ok(Self {
            device,
            queue,
            linestring_pipeline,
            polygon_clip_pipeline,
            linestring_bind_group_layout,
            polygon_clip_bind_group_layout,
        })
    }

    pub async fn buffer_linestring_gpu(
        &self,
        points: &[[f64; 2]],
        buffer_distance: f64,
    ) -> Result<Vec<[f64; 2]>, JsValue> {
        if points.len() < 2 {
            return Ok(Vec::new());
        }


        // Convert input points to GPU format
        let gpu_points: Vec<Point2D> = points
            .iter()
            .map(|p| Point2D {
                x: p[0] as f32,
                y: p[1] as f32,
            })
            .collect();

        let params = LineStringBufferParams {
            buffer_distance: buffer_distance as f32,
            num_points: points.len() as u32,
            _padding: [0; 2],
        };

        // Create GPU buffers
        let input_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("LineString Input Buffer"),
            contents: bytemuck::cast_slice(&gpu_points),
            usage: BufferUsages::STORAGE,
        });

        let params_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("LineString Params Buffer"),
            contents: bytemuck::cast_slice(&[params]),
            usage: BufferUsages::UNIFORM,
        });

        let output_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("LineString Output Buffer"),
            size: (points.len() * 2 * std::mem::size_of::<Point2D>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        // Create bind group
        let bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("LineString Bind Group"),
            layout: &self.linestring_bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: input_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: params_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 2,
                    resource: output_buffer.as_entire_binding(),
                },
            ],
        });

        // Dispatch compute shader
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("LineString Compute Encoder"),
        });

        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("LineString Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.linestring_pipeline);
            compute_pass.set_bind_group(0, &bind_group, &[]);

            // Dispatch with appropriate workgroup size (64 threads per workgroup)
            let num_workgroups = (points.len() as u32 + 63) / 64;
            compute_pass.dispatch_workgroups(num_workgroups, 1, 1);
        }

        // Create staging buffer to read back results
        let staging_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("LineString Staging Buffer"),
            size: output_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        encoder.copy_buffer_to_buffer(&output_buffer, 0, &staging_buffer, 0, output_buffer.size());
        self.queue.submit(std::iter::once(encoder.finish()));

        // Read back results
        let buffer_slice = staging_buffer.slice(..);
        buffer_slice.map_async(wgpu::MapMode::Read, |_| {});
        self.device.poll(wgpu::Maintain::Wait);

        let data = buffer_slice.get_mapped_range();
        let result_points: &[Point2D] = bytemuck::cast_slice(&data);

        // Convert back to f64 format
        let output: Vec<[f64; 2]> = result_points
            .iter()
            .map(|p| [p.x as f64, p.y as f64])
            .collect();


        Ok(output)
    }

    pub async fn clip_polygons_gpu(
        &self,
        polygons: &[Vec<[f64; 2]>],
        bbox: &[f64; 4],
    ) -> Result<Vec<Vec<[f64; 2]>>, JsValue> {
        if polygons.is_empty() {
            return Ok(Vec::new());
        }


        // Flatten polygons and create offset/count arrays
        let mut flattened_points = Vec::new();
        let mut polygon_offsets = Vec::new();
        let mut polygon_counts = Vec::new();
        let max_points_per_polygon = 128; // Reasonable limit for GPU memory

        for polygon in polygons {
            polygon_offsets.push(flattened_points.len() as u32);
            polygon_counts.push(polygon.len() as u32);

            for point in polygon {
                flattened_points.push(Point2D {
                    x: point[0] as f32,
                    y: point[1] as f32,
                });
            }
        }

        let params = PolygonClipParams {
            bbox: BoundingBox {
                min_x: bbox[0] as f32,
                min_y: bbox[1] as f32,
                max_x: bbox[2] as f32,
                max_y: bbox[3] as f32,
            },
            num_polygons: polygons.len() as u32,
            max_points_per_polygon: max_points_per_polygon as u32,
            _padding: [0; 2],
        };

        // Create GPU buffers
        let input_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Polygon Input Buffer"),
            contents: bytemuck::cast_slice(&flattened_points),
            usage: BufferUsages::STORAGE,
        });

        let offsets_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Polygon Offsets Buffer"),
            contents: bytemuck::cast_slice(&polygon_offsets),
            usage: BufferUsages::STORAGE,
        });

        let counts_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Polygon Counts Buffer"),
            contents: bytemuck::cast_slice(&polygon_counts),
            usage: BufferUsages::STORAGE,
        });

        let params_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Polygon Clip Params Buffer"),
            contents: bytemuck::cast_slice(&[params]),
            usage: BufferUsages::UNIFORM,
        });

        let output_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("Polygon Output Buffer"),
            size: (polygons.len() * max_points_per_polygon * std::mem::size_of::<Point2D>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let output_counts_buffer = self.device.create_buffer(&BufferDescriptor {
            label: Some("Polygon Output Counts Buffer"),
            size: (polygons.len() * std::mem::size_of::<u32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        // Create bind group
        let bind_group = self.device.create_bind_group(&BindGroupDescriptor {
            label: Some("Polygon Clip Bind Group"),
            layout: &self.polygon_clip_bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: input_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: offsets_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 2,
                    resource: counts_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 3,
                    resource: params_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 4,
                    resource: output_buffer.as_entire_binding(),
                },
                BindGroupEntry {
                    binding: 5,
                    resource: output_counts_buffer.as_entire_binding(),
                },
            ],
        });

        // Dispatch compute shader
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Polygon Clip Compute Encoder"),
        });

        {
            let mut compute_pass = encoder.begin_compute_pass(&ComputePassDescriptor {
                label: Some("Polygon Clip Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.polygon_clip_pipeline);
            compute_pass.set_bind_group(0, &bind_group, &[]);

            // Dispatch with appropriate workgroup size (32 threads per workgroup)
            let num_workgroups = (polygons.len() as u32 + 31) / 32;
            compute_pass.dispatch_workgroups(num_workgroups, 1, 1);
        }

        // Create staging buffers
        let points_staging = self.device.create_buffer(&BufferDescriptor {
            label: Some("Polygon Points Staging Buffer"),
            size: output_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let counts_staging = self.device.create_buffer(&BufferDescriptor {
            label: Some("Polygon Counts Staging Buffer"),
            size: output_counts_buffer.size(),
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        encoder.copy_buffer_to_buffer(&output_buffer, 0, &points_staging, 0, output_buffer.size());
        encoder.copy_buffer_to_buffer(&output_counts_buffer, 0, &counts_staging, 0, output_counts_buffer.size());

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read back results
        let points_slice = points_staging.slice(..);
        let counts_slice = counts_staging.slice(..);

        points_slice.map_async(wgpu::MapMode::Read, |_| {});
        counts_slice.map_async(wgpu::MapMode::Read, |_| {});

        self.device.poll(wgpu::Maintain::Wait);

        let points_data = points_slice.get_mapped_range();
        let counts_data = counts_slice.get_mapped_range();

        let result_points: &[Point2D] = bytemuck::cast_slice(&points_data);
        let result_counts: &[u32] = bytemuck::cast_slice(&counts_data);

        // Reconstruct polygons
        let mut output_polygons = Vec::new();
        for (polygon_idx, &count) in result_counts.iter().enumerate() {
            if count > 0 {
                let start_idx = polygon_idx * max_points_per_polygon;
                let end_idx = start_idx + count as usize;

                let polygon: Vec<[f64; 2]> = result_points[start_idx..end_idx]
                    .iter()
                    .map(|p| [p.x as f64, p.y as f64])
                    .collect();

                output_polygons.push(polygon);
            } else {
                output_polygons.push(Vec::new());
            }
        }


        Ok(output_polygons)
    }
}

// Global GPU polygon processor instance
static mut GPU_POLYGON_PROCESSOR: Option<GpuPolygonProcessor> = None;

// Initialize GPU polygon processor
#[wasm_bindgen]
pub async fn init_gpu_polygon_processor() -> Result<bool, JsValue> {
    match GpuPolygonProcessor::new().await {
        Ok(processor) => {
            unsafe {
                GPU_POLYGON_PROCESSOR = Some(processor);
            }
            Ok(true)
        }
        Err(e) => {
            Ok(false)
        }
    }
}

// GPU-accelerated LineString buffering function
pub async fn buffer_linestring_gpu(
    points: &[[f64; 2]],
    buffer_distance: f64,
) -> Result<Vec<[f64; 2]>, JsValue> {
    unsafe {
        match &GPU_POLYGON_PROCESSOR {
            Some(processor) => processor.buffer_linestring_gpu(points, buffer_distance).await,
            None => Err(JsValue::from_str("GPU polygon processor not initialized")),
        }
    }
}

// GPU-accelerated polygon clipping function
pub async fn clip_polygons_gpu(
    polygons: &[Vec<[f64; 2]>],
    bbox: &[f64; 4],
) -> Result<Vec<Vec<[f64; 2]>>, JsValue> {
    unsafe {
        match &GPU_POLYGON_PROCESSOR {
            Some(processor) => processor.clip_polygons_gpu(polygons, bbox).await,
            None => Err(JsValue::from_str("GPU polygon processor not initialized")),
        }
    }
}