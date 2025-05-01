use earcutr::earcut;
use js_sys::{Array, Float32Array, Object};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

use crate::console_log;

const EPSILON: f64 = 1e-10;

/// Simple 2D vector struct
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct Vector2 {
    x: f64,
    y: f64,
}

impl Vector2 {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn clone(&self) -> Self {
        Self {
            x: self.x,
            y: self.y,
        }
    }

    fn add_scaled_vector(&self, v: &Vector2, s: f64) -> Self {
        Self {
            x: self.x + v.x * s,
            y: self.y + v.y * s,
        }
    }
}

/// Simple 3D vector struct
#[derive(Clone, Copy, Debug)]
struct Vector3 {
    x: f64,
    y: f64,
    z: f64,
}

impl Vector3 {
    fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    fn copy(&mut self, v: &Vector3) {
        self.x = v.x;
        self.y = v.y;
        self.z = v.z;
    }

    fn add(&self, v: &Vector3) -> Self {
        Self {
            x: self.x + v.x,
            y: self.y + v.y,
            z: self.z + v.z,
        }
    }

    fn multiply_scalar(&self, s: f64) -> Self {
        Self {
            x: self.x * s,
            y: self.y * s,
            z: self.z * s,
        }
    }
}

/// Spline tube data for path extrusion
struct SplineTube {
    normals: Vec<Vector3>,
    binormals: Vec<Vector3>,
}

/// Raw shape structure: first vector is contour, remaining vectors are holes.
#[derive(Deserialize)]
pub struct RawShape(pub Vec<Vec<[f64; 2]>>);

/// Extrusion options.
#[derive(Clone, Debug)]
pub struct ExtrudeOptions {
    pub curve_segments: u32,
    pub steps: u32,
    pub depth: f64,
    pub extrude_path: Option<()>, // For future path extrusion support
}

impl Default for ExtrudeOptions {
    fn default() -> Self {
        Self {
            curve_segments: 12,
            steps: 1,
            depth: 1.0,
            extrude_path: None,
        }
    }
}

// For JSON deserialization compatibility
#[derive(Deserialize)]
struct ExtrudeOptionsJson {
    #[serde(default = "default_curve_segments")]
    curveSegments: u32,
    #[serde(default = "default_steps")]
    steps: u32,
    #[serde(default = "default_depth")]
    depth: f64,
    #[serde(skip)]
    extrudePath: Option<()>,
}

// Default values for JSON options
fn default_curve_segments() -> u32 {
    12
}
fn default_steps() -> u32 {
    1
}
fn default_depth() -> f64 {
    1.0
}

// UV Generator similar to WorldUVGenerator in JS
struct UVGenerator;

impl UVGenerator {
    fn generate_top_uv(
        vertices: &[f32],
        index_a: usize,
        index_b: usize,
        index_c: usize,
    ) -> Vec<Vector2> {
        // Bounds checking
        let vertices_len = vertices.len();
        if (index_a * 3 + 2 >= vertices_len)
            || (index_b * 3 + 2 >= vertices_len)
            || (index_c * 3 + 2 >= vertices_len)
        {
            // Return default UVs if any index is out of bounds
            return vec![
                Vector2::new(0.0, 0.0),
                Vector2::new(0.0, 0.0),
                Vector2::new(0.0, 0.0),
            ];
        }

        let a_x = vertices[index_a * 3] as f64;
        let a_y = vertices[index_a * 3 + 1] as f64;
        let b_x = vertices[index_b * 3] as f64;
        let b_y = vertices[index_b * 3 + 1] as f64;
        let c_x = vertices[index_c * 3] as f64;
        let c_y = vertices[index_c * 3 + 1] as f64;

        vec![
            Vector2::new(a_x, a_y),
            Vector2::new(b_x, b_y),
            Vector2::new(c_x, c_y),
        ]
    }

}

/// Helper function to check if points are in clockwise order
fn is_clockwise(points: &[Vector2]) -> bool {
    let mut area = 0.0;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    area <= 0.0
}

/// Merge overlapping points in a contour
fn merge_overlapping_points(points: &mut Vec<Vector2>) {
    if points.is_empty() {
        return;
    }

    let threshold_sq = EPSILON * EPSILON;
    let mut prev_pos = points[0];
    let mut i = 1;

    while i <= points.len() {
        let current_index = i % points.len();
        if current_index == 0 {
            break;
        }

        let current_pos = points[current_index];
        let dx = current_pos.x - prev_pos.x;
        let dy = current_pos.y - prev_pos.y;
        let dist_sq = dx * dx + dy * dy;

        let scaling_factor_sqrt = f64::max(
            f64::max(current_pos.x.abs(), current_pos.y.abs()),
            f64::max(prev_pos.x.abs(), prev_pos.y.abs()),
        );
        let threshold_sq_scaled = threshold_sq * scaling_factor_sqrt * scaling_factor_sqrt;

        if dist_sq <= threshold_sq_scaled {
            points.remove(current_index);
            continue;
        }

        prev_pos = current_pos;
        i += 1;
    }
}

/// Extrude a list of shapes into geometry. Each shape is an array of rings: first is contour, others are holes.
/// This version maintains JavaScript compatibility through JsValue parameters and is exported via wasm_bindgen.
/// Returns an object with `position` and `uv` Float32Array attributes plus indices and normals.
///
/// For internal Rust usage, prefer using `extrude_shape` instead.
#[wasm_bindgen]
pub fn extrude_geometry(shapes: &JsValue, options: &JsValue) -> Result<JsValue, JsValue> {
    // Deserialize input
    let raw_shapes: Vec<RawShape> = serde_wasm_bindgen::from_value(shapes.clone())
        .map_err(|e| JsValue::from_str(&format!("Invalid shapes: {}", e)))?;
    
    // Parse options from JSON
    let options_json: ExtrudeOptionsJson = serde_wasm_bindgen::from_value(options.clone())
        .map_err(|e| JsValue::from_str(&format!("Invalid options: {}", e)))?;
    
    // Convert to our native Rust struct
    let opts = ExtrudeOptions {
        curve_segments: options_json.curveSegments,
        steps: options_json.steps,
        depth: options_json.depth,
        extrude_path: options_json.extrudePath,
    };
    
    // Call the native implementation
    extrude_geometry_native(raw_shapes, opts)
}

/// Extrude a list of shapes into geometry using Rust native types.
/// This is the core implementation without the JS binding layer.
pub fn extrude_geometry_native(
    raw_shapes: Vec<RawShape>,
    opts: ExtrudeOptions,
) -> Result<JsValue, JsValue> {
    let mut vertices_array: Vec<f32> = Vec::new();
    let mut uv_array: Vec<f32> = Vec::new();
    let mut indices_array: Vec<u32> = Vec::new();
    let mut normals_array: Vec<f32> = Vec::new();

    // Determine if extrusion is along a path
    let mut extrude_by_path = false;
    let mut extrude_pts: Vec<Vector3> = Vec::new();
    let mut spline_tube = SplineTube {
        normals: Vec::new(),
        binormals: Vec::new(),
    };

    if let Some(_path) = &opts.extrude_path {
        // For simplicity, we're not implementing the full path extrusion here
        // In a complete implementation, we would extract points from the path
        // and compute the Frenet frames
        extrude_by_path = true;

        // Create placeholder points along the path
        for s in 0..=opts.steps {
            let t = s as f64 / opts.steps as f64;
            // In a real implementation, these would come from the path
            extrude_pts.push(Vector3::new(t, 0.0, 0.0));

            // Set up normals and binormals for the path
            spline_tube.normals.push(Vector3::new(0.0, 1.0, 0.0));
            spline_tube.binormals.push(Vector3::new(0.0, 0.0, 1.0));
        }
    }

    for RawShape(rings) in raw_shapes.into_iter() {
        if rings.is_empty() {
            continue;
        }

        // Convert raw points to Vector2 objects
        let mut contour: Vec<Vector2> = rings[0].iter().map(|p| Vector2::new(p[0], p[1])).collect();

        let mut holes: Vec<Vec<Vector2>> = rings[1..]
            .iter()
            .map(|ring| ring.iter().map(|p| Vector2::new(p[0], p[1])).collect())
            .collect();

        // Ensure proper winding of contours
        let reverse = !is_clockwise(&contour);
        if reverse {
            contour.reverse();

            // Check holes winding direction
            for hole in &mut holes {
                if is_clockwise(hole) {
                    hole.reverse();
                }
            }
        }

        // Merge overlapping points
        merge_overlapping_points(&mut contour);
        for hole in &mut holes {
            merge_overlapping_points(hole);
        }

        // Compute placeholder array where vertices will be stored temporarily
        let mut placeholder: Vec<f32> = Vec::new();

        // Prepare vertices (contour and holes)
        let mut vertices = contour.clone();
        for hole in &holes {
            vertices.extend(hole.clone());
        }

        // Triangulate the shape (with holes)
        let faces: Vec<Vec<usize>>;


        // Triangulate contour and holes directly (no bevel)
        let mut data: Vec<f64> = Vec::new();
        for pt in &contour {
            data.push(pt.x);
            data.push(pt.y);
        }
        let mut hole_indices: Vec<usize> = Vec::new();
        let mut idx_offset = contour.len();
        for hole in &holes {
            hole_indices.push(idx_offset);
            for pt in hole {
                data.push(pt.x);
                data.push(pt.y);
            }
            idx_offset += hole.len();
        }
        let indices = earcut(&data, &hole_indices, 2).unwrap();

        // Convert to the faces format (triplets of indices)
        faces = indices.chunks(3).map(|chunk| chunk.to_vec()).collect();

        // Function to add a vertex to the placeholder
        let mut v = |x: f64, y: f64, z: f64| {
            placeholder.push(x as f32);
            placeholder.push(y as f32);
            placeholder.push(z as f32);
        };

        let vlen = vertices.len();

        // Add back facing vertices
        for i in 0..vlen {
            let vert = vertices[i];

            if !extrude_by_path {
                v(vert.x, vert.y, 0.0);
            } else {
                // For path extrusion, we need to compute the position along the path
                let normal = spline_tube.normals[0].multiply_scalar(vert.x);
                let binormal = spline_tube.binormals[0].multiply_scalar(vert.y);
                let position = extrude_pts[0].add(&normal).add(&binormal);

                v(position.x, position.y, position.z);
            }
        }

        // Add stepped vertices (front facing for simple extrusion)
        for s in 1..=opts.steps {
            for i in 0..vlen {
                let vert = vertices[i];

                // console_log!("Extruding vertex: extrude_by_path {} ({}, {}, {}) {}", extrude_by_path, vert.x, vert.y, s, opts.depth);
                if !extrude_by_path {
                    v(vert.x, vert.y, opts.depth / opts.steps as f64 * s as f64);
                } else {
                    // For path extrusion
                    let normal = spline_tube.normals[s as usize].multiply_scalar(vert.x);
                    let binormal = spline_tube.binormals[s as usize].multiply_scalar(vert.y);
                    let position = extrude_pts[s as usize].add(&normal).add(&binormal);

                    v(position.x, position.y, position.z);
                }
            }
        }

        // Add faces
        let vertex_count = vertices_array.len() / 3;

        // Define a function to add triangular faces
        fn add_triangle(
            indices_array: &mut Vec<u32>,
            vertices_array: &mut Vec<f32>,
            normals_array: &mut Vec<f32>,
            uv_array: &mut Vec<f32>,
            vertex_count: usize,
            placeholder: &[f32],
            a: usize,
            b: usize,
            c: usize,
        ) {
            // Get the current vertex index before adding any vertices
            let current_vertex = vertices_array.len() / 3;

            // Add these indices (they'll point to the vertices we're about to add)
            indices_array.push(current_vertex as u32);
            indices_array.push(current_vertex as u32 + 1);
            indices_array.push(current_vertex as u32 + 2);

            // Safety check for array bounds
            let placeholder_len = placeholder.len();
            let has_out_of_bounds = (a * 3 + 2 >= placeholder_len)
                || (b * 3 + 2 >= placeholder_len)
                || (c * 3 + 2 >= placeholder_len);

            if has_out_of_bounds {
                // Use default values if any index is out of bounds
                // Add default normal vector (pointing upward)
                normals_array.push(0.0);
                normals_array.push(0.0);
                normals_array.push(1.0);
                normals_array.push(0.0);
                normals_array.push(0.0);
                normals_array.push(1.0);
                normals_array.push(0.0);
                normals_array.push(0.0);
                normals_array.push(1.0);

                // Add default vertex positions - a small triangle at z=0
                vertices_array.push(0.0);
                vertices_array.push(0.0);
                vertices_array.push(0.0);

                vertices_array.push(0.1);
                vertices_array.push(0.0);
                vertices_array.push(0.0);

                vertices_array.push(0.0);
                vertices_array.push(0.1);
                vertices_array.push(0.0);

                // Add default UVs
                uv_array.push(0.0);
                uv_array.push(0.0);
                uv_array.push(1.0);
                uv_array.push(0.0);
                uv_array.push(0.0);
                uv_array.push(1.0);

                return;
            }

            // Compute normal
            let ax = placeholder[a * 3] as f64;
            let ay = placeholder[a * 3 + 1] as f64;
            let az = placeholder[a * 3 + 2] as f64;

            let bx = placeholder[b * 3] as f64;
            let by = placeholder[b * 3 + 1] as f64;
            let bz = placeholder[b * 3 + 2] as f64;

            let cx = placeholder[c * 3] as f64;
            let cy = placeholder[c * 3 + 1] as f64;
            let cz = placeholder[c * 3 + 2] as f64;

            // Check for degenerate triangle - if any vertices are the same
            if (ax == bx && ay == by && az == bz)
                || (bx == cx && by == cy && bz == cz)
                || (cx == ax && cy == ay && cz == az)
            {
                // Degenerate triangle - use Z-up normal
                normals_array.push(0.0);
                normals_array.push(0.0);
                normals_array.push(1.0);
            } else {
                // Compute vectors for normal calculation
                let v1x = bx - ax;
                let v1y = by - ay;
                let v1z = bz - az;

                let v2x = cx - ax;
                let v2y = cy - ay;
                let v2z = cz - az;

                // Cross product
                let nx = v1y * v2z - v1z * v2y;
                let ny = v1z * v2x - v1x * v2z;
                let nz = v1x * v2y - v1y * v2x;

                // Normalize
                let len = (nx * nx + ny * ny + nz * nz).sqrt();

                // Set the normal (will be used for all three vertices)
                const EPSILON: f64 = 1e-10; // Small threshold to avoid division by zero
                if len > EPSILON {
                    let inv_len = 1.0 / len;
                    normals_array.push((nx * inv_len) as f32);
                    normals_array.push((ny * inv_len) as f32);
                    normals_array.push((nz * inv_len) as f32);
                } else {
                    // Try to determine a reasonable fallback normal
                    // First try to use edge directions
                    if v1x.abs() > EPSILON || v1y.abs() > EPSILON || v1z.abs() > EPSILON {
                        // Normalize v1 as fallback
                        let v1_len = (v1x * v1x + v1y * v1y + v1z * v1z).sqrt();
                        if v1_len > EPSILON {
                            normals_array.push((v1x / v1_len) as f32);
                            normals_array.push((v1y / v1_len) as f32);
                            normals_array.push((v1z / v1_len) as f32);
                        } else {
                            // Last resort - use Z-up normal
                            normals_array.push(0.0);
                            normals_array.push(0.0);
                            normals_array.push(1.0);
                        }
                    } else {
                        // If all else fails, use Z-up normal since that's often visually correct for extrusions
                        normals_array.push(0.0);
                        normals_array.push(0.0);
                        normals_array.push(1.0);
                    }
                }
            }

            // Duplicate the same normal for the other two vertices (b and c)
            // Get the normal components we just added for vertex a
            let nx_norm = normals_array[normals_array.len() - 3];
            let ny_norm = normals_array[normals_array.len() - 2];
            let nz_norm = normals_array[normals_array.len() - 1];

            // Apply the same normal to vertex b
            normals_array.push(nx_norm);
            normals_array.push(ny_norm);
            normals_array.push(nz_norm);

            // Apply the same normal to vertex c
            normals_array.push(nx_norm);
            normals_array.push(ny_norm);
            normals_array.push(nz_norm);

            // Add vertex positions
            for &idx in &[a, b, c] {
                vertices_array.push(placeholder[idx * 3]);
                vertices_array.push(placeholder[idx * 3 + 1]);
                vertices_array.push(placeholder[idx * 3 + 2]);
            }

            // Generate UVs - make sure to use proper UV mapping
            let uvs = UVGenerator::generate_top_uv(&placeholder, a, b, c);

            // Add UVs
            for uv in uvs {
                uv_array.push(uv.x as f32);
                uv_array.push(uv.y as f32);
            }
        }

        // Define a function for quadrilateral faces (two triangles)
        fn add_quad(
            indices_array: &mut Vec<u32>,
            vertices_array: &mut Vec<f32>,
            normals_array: &mut Vec<f32>,
            uv_array: &mut Vec<f32>,
            vertex_count: usize,
            placeholder: &[f32],
            a: usize,
            b: usize,
            c: usize,
            d: usize,
        ) {
            // Add first triangle
            add_triangle(
                indices_array,
                vertices_array,
                normals_array,
                uv_array,
                vertex_count,
                placeholder,
                a,
                b,
                d,
            );

            // Add second triangle
            add_triangle(
                indices_array,
                vertices_array,
                normals_array,
                uv_array,
                vertex_count,
                placeholder,
                b,
                c,
                d,
            );
        }

        // Bottom faces
        for face in &faces {
            add_triangle(
                &mut indices_array,
                &mut vertices_array,
                &mut normals_array,
                &mut uv_array,
                vertex_count,
                &placeholder,
                face[2],
                face[1],
                face[0],
            );
        }

        // Top faces
        let offset_top = vlen * opts.steps as usize;
        for face in &faces {
            add_triangle(
                &mut indices_array,
                &mut vertices_array,
                &mut normals_array,
                &mut uv_array,
                vertex_count,
                &placeholder,
                face[0] + offset_top,
                face[1] + offset_top,
                face[2] + offset_top,
            );
        }

        // Build side faces
        let mut layer_offset = 0;

        // Sidewalls for contour
        for i in (0..contour.len()).rev() {
            let j = i;
            let k = if i == 0 { contour.len() - 1 } else { i - 1 };

            for s in 0..opts.steps as usize * 2 {
                let slen1 = vlen * s;
                let slen2 = vlen * (s + 1);

                let a = layer_offset + j + slen1;
                let b = layer_offset + k + slen1;
                let c = layer_offset + k + slen2;
                let d = layer_offset + j + slen2;

                add_quad(
                    &mut indices_array,
                    &mut vertices_array,
                    &mut normals_array,
                    &mut uv_array,
                    vertex_count,
                    &placeholder,
                    a,
                    b,
                    c,
                    d,
                );
            }
        }

        layer_offset += contour.len();

        // Sidewalls for holes
        for h in 0..holes.len() {
            let ahole = &holes[h];

            for i in (0..ahole.len()).rev() {
                let j = i;
                let k = if i == 0 { ahole.len() - 1 } else { i - 1 };

                for s in 0..opts.steps as usize * 2 {
                    let slen1 = vlen * s;
                    let slen2 = vlen * (s + 1);

                    let a = layer_offset + j + slen1;
                    let b = layer_offset + k + slen1;
                    let c = layer_offset + k + slen2;
                    let d = layer_offset + j + slen2;

                    add_quad(
                        &mut indices_array,
                        &mut vertices_array,
                        &mut normals_array,
                        &mut uv_array,
                        vertex_count,
                        &placeholder,
                        a,
                        b,
                        c,
                        d,
                    );
                }
            }

            layer_offset += ahole.len();
        }
    }

    // Prepare return object
    let result = Object::new();
    let pos_arr = Float32Array::from(vertices_array.as_slice());
    let normal_arr = Float32Array::from(normals_array.as_slice());
    let uv_arr = Float32Array::from(uv_array.as_slice());

    // Create a JS array of indices
    let indices_js_array = Array::new_with_length(indices_array.len() as u32);
    for (i, &index) in indices_array.iter().enumerate() {
        indices_js_array.set(i as u32, JsValue::from_f64(index as f64));
    }

    // Set properties on result
    js_sys::Reflect::set(&result, &JsValue::from_str("position"), &pos_arr)?;
    js_sys::Reflect::set(&result, &JsValue::from_str("normal"), &normal_arr)?;
    js_sys::Reflect::set(&result, &JsValue::from_str("uv"), &uv_arr)?;
    js_sys::Reflect::set(&result, &JsValue::from_str("index"), &indices_js_array)?;

    Ok(result.into())
}

/// A convenience function to directly extrude a shape with Rust native types.
/// This is meant to be used from other Rust code in the crate, providing a more idiomatic
/// Rust interface compared to using JsValue parameters.
///
/// # Parameters
/// * `shapes` - A vector of shapes, where each shape is a vector of rings (first is contour, others are holes).
/// * `depth` - The depth of the extrusion.
/// * `steps` - The number of steps for the extrusion (default: 1).
///
/// # Returns
/// * `Result<JsValue, JsValue>` - The extruded geometry data or an error.
pub fn extrude_shape(
    shapes: Vec<Vec<Vec<[f64; 2]>>>,
    depth: f64,
    steps: u32,
) -> Result<JsValue, JsValue> {
    // Convert the shapes to RawShapes
    let raw_shapes: Vec<RawShape> = shapes.into_iter()
        .map(|shape| RawShape(shape))
        .collect();
    
    // Create the extrusion options
    let opts = ExtrudeOptions {
        depth,
        steps,
        curve_segments: 12, // Default
        extrude_path: None,
    };
    
    // Call the native implementation
    extrude_geometry_native(raw_shapes, opts)
}
