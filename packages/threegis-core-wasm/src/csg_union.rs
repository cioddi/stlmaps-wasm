use crate::polygon_geometry::BufferGeometry;
use csgrs::float_types::Real;
use csgrs::mesh::polygon::Polygon as CsgPolygon;
use csgrs::mesh::vertex::Vertex as CsgVertex;
use csgrs::mesh::Mesh as CSG;
use csgrs::traits::CSG as _;
#[cfg(target_arch = "wasm32")]
use geo::{BooleanOps, LineString, MultiPolygon, Polygon};
#[cfg(target_arch = "wasm32")]
use js_sys::{Array, Float32Array, Reflect};
use nalgebra::{Point3, Vector3};
use rayon::prelude::*;
use std::collections::{HashMap, VecDeque};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;

#[cfg(target_arch = "wasm32")]
use crate::extrude;

const NORMAL_EPS: Real = 1e-6;

#[cfg(target_arch = "wasm32")]
struct FootprintGroup {
    footprint: MultiPolygon<f64>,
    min_z: f64,
    max_z: f64,
}

pub fn merge_geometries_by_layer(
    geometries: Vec<BufferGeometry>,
) -> HashMap<String, BufferGeometry> {
    if geometries.is_empty() {
        return HashMap::new();
    }

    let mut grouped: HashMap<String, Vec<BufferGeometry>> = HashMap::new();
    for geometry in geometries.into_iter() {
        let key = geometry_layer_key(&geometry);
        grouped.entry(key).or_default().push(geometry);
    }

    let mut results = HashMap::new();
    for (layer_key, group) in grouped.into_iter() {
        let merged = merge_geometry_group(group);
        if merged.has_data {
            results.insert(layer_key, merged);
        }
    }

    results
}

#[cfg(target_arch = "wasm32")]
fn union_via_footprints(geometries: &[BufferGeometry]) -> Option<BufferGeometry> {
    let mut groups: HashMap<(i64, i64), FootprintGroup> = HashMap::new();

    for geometry in geometries {
        if let Some((footprint, min_z, max_z)) = geometry_footprint(geometry) {
            let depth = max_z - min_z;
            if depth <= NORMAL_EPS as f64 {
                continue;
            }

            let key = (quantize_value(min_z, 1e-3), quantize_value(depth, 1e-3));

            groups
                .entry(key)
                .and_modify(|group| {
                    group.footprint = union_multipolygon(&group.footprint, &footprint);
                    group.min_z = group.min_z.min(min_z);
                    group.max_z = group.max_z.max(max_z);
                })
                .or_insert(FootprintGroup {
                    footprint,
                    min_z,
                    max_z,
                });
        }
    }

    let mut extruded_geometries = Vec::new();
    for group in groups.values() {
        let depth = group.max_z - group.min_z;
        if depth <= NORMAL_EPS as f64 {
            continue;
        }

        if let Some(extruded) = extrude_multipolygon(&group.footprint, group.min_z, depth) {
            extruded_geometries.push(extruded);
        }
    }

    if extruded_geometries.is_empty() {
        return None;
    }

    Some(fallback_layer_union(extruded_geometries))
}

#[cfg(not(target_arch = "wasm32"))]
fn union_via_footprints(_: &[BufferGeometry]) -> Option<BufferGeometry> {
    None
}

#[allow(dead_code)]
pub fn merge_geometries_with_spatial_grouping(
    geometries: Vec<BufferGeometry>,
    max_distance: f32,
) -> HashMap<String, BufferGeometry> {
    if geometries.is_empty() {
        return HashMap::new();
    }

    let geometry_centers: Vec<(BufferGeometry, (f32, f32))> = geometries
        .into_par_iter()
        .filter(|geometry| geometry.has_data && geometry.vertices.len() >= 9)
        .map(|geometry| {
            let vertex_count = geometry.vertices.len() / 3;
            let (center_x, center_y) = geometry
                .vertices
                .par_chunks_exact(3)
                .map(|chunk| (chunk[0], chunk[1]))
                .reduce(
                    || (0.0, 0.0),
                    |acc, point| (acc.0 + point.0, acc.1 + point.1),
                );

            let center = (
                center_x / vertex_count as f32,
                center_y / vertex_count as f32,
            );
            (geometry, center)
        })
        .collect();

    let mut groups: Vec<Vec<BufferGeometry>> = Vec::new();

    for (geometry, center) in geometry_centers {
        let mut added_to_group = false;
        for group in &mut groups {
            if let Some(first_geom) = group.first() {
                let group_vertex_count = first_geom.vertices.len() / 3;
                let (group_center_x, group_center_y) = first_geom
                    .vertices
                    .par_chunks_exact(3)
                    .map(|chunk| (chunk[0], chunk[1]))
                    .reduce(
                        || (0.0, 0.0),
                        |acc, point| (acc.0 + point.0, acc.1 + point.1),
                    );
                let group_center = (
                    group_center_x / group_vertex_count as f32,
                    group_center_y / group_vertex_count as f32,
                );

                let distance = ((center.0 - group_center.0).powi(2)
                    + (center.1 - group_center.1).powi(2))
                .sqrt();
                if distance <= max_distance {
                    group.push(geometry.clone());
                    added_to_group = true;
                    break;
                }
            }
        }

        if !added_to_group {
            groups.push(vec![geometry]);
        }
    }

    groups
        .into_par_iter()
        .enumerate()
        .filter_map(|(group_idx, group)| {
            if group.is_empty() {
                return None;
            }

            let merged = fallback_layer_union(group);
            if merged.has_data {
                Some((format!("group_{}", group_idx), merged))
            } else {
                None
            }
        })
        .collect()
}

pub fn rebuild_single_geometry(geometry: BufferGeometry) -> BufferGeometry {
    let mut geometries = vec![geometry];
    if let Some(result) = csgrs_union(&geometries) {
        return result;
    }
    fallback_layer_union(std::mem::take(&mut geometries))
}

pub fn optimize_geometry(geometry: BufferGeometry, tolerance: f32) -> BufferGeometry {
    if !geometry.has_data || geometry.vertices.len() < 9 {
        return geometry;
    }

    let vertex_count = geometry.vertices.len() / 3;
    let mut merged_vertices = Vec::new();
    let mut merged_normals = Vec::new();
    let mut merged_colors = Vec::new();
    let mut vertex_map: HashMap<usize, usize> = HashMap::new();

    for i in 0..vertex_count {
        let v1_idx = i * 3;
        let v1 = [
            geometry.vertices[v1_idx],
            geometry.vertices[v1_idx + 1],
            geometry.vertices[v1_idx + 2],
        ];

        let mut found_match = false;
        for (existing_idx, &merged_idx) in &vertex_map {
            if *existing_idx >= i {
                continue;
            }

            let existing_v_idx = existing_idx * 3;
            let existing_v = [
                geometry.vertices[existing_v_idx],
                geometry.vertices[existing_v_idx + 1],
                geometry.vertices[existing_v_idx + 2],
            ];

            let distance_sq = (v1[0] - existing_v[0]).powi(2)
                + (v1[1] - existing_v[1]).powi(2)
                + (v1[2] - existing_v[2]).powi(2);

            if distance_sq <= tolerance * tolerance {
                vertex_map.insert(i, merged_idx);
                found_match = true;
                break;
            }
        }

        if !found_match {
            let new_merged_idx = merged_vertices.len() / 3;
            vertex_map.insert(i, new_merged_idx);

            merged_vertices.extend_from_slice(&v1);

            if let Some(ref normals) = geometry.normals {
                if normals.len() > v1_idx + 2 {
                    merged_normals.extend_from_slice(&normals[v1_idx..v1_idx + 3]);
                }
            }

            if let Some(ref colors) = geometry.colors {
                if colors.len() > v1_idx + 2 {
                    merged_colors.extend_from_slice(&colors[v1_idx..v1_idx + 3]);
                }
            }
        }
    }

    let new_indices: Vec<u32> = if let Some(ref indices) = geometry.indices {
        indices
            .iter()
            .map(|&idx| vertex_map.get(&(idx as usize)).copied().unwrap_or(0) as u32)
            .collect()
    } else {
        (0..merged_vertices.len() as u32 / 3).collect()
    };

    let has_data = !merged_vertices.is_empty();
    BufferGeometry {
        vertices: merged_vertices,
        normals: if merged_normals.is_empty() {
            None
        } else {
            Some(merged_normals)
        },
        colors: if merged_colors.is_empty() {
            None
        } else {
            Some(merged_colors)
        },
        indices: if new_indices.is_empty() {
            None
        } else {
            Some(new_indices)
        },
        uvs: None,
        has_data,
        properties: geometry.properties,
    }
}

fn csgrs_union(geometries: &[BufferGeometry]) -> Option<BufferGeometry> {
    let solids: Vec<CSG<()>> = geometries
        .iter()
        .filter_map(buffer_geometry_to_csg)
        .collect();

    if solids.is_empty() {
        return None;
    }

    let reduced = pairwise_union(solids)?;
    csg_to_buffer_geometry(&reduced)
}

fn merge_geometry_group(group: Vec<BufferGeometry>) -> BufferGeometry {
    if group.is_empty() {
        return fallback_layer_union(group);
    }

    if let Some(footprint) = union_via_footprints(&group) {
        if footprint.has_data {
            return footprint;
        }
    }

    if let Some(csg) = csgrs_union(&group) {
        if csg.has_data {
            return csg;
        }
    }

    fallback_layer_union(group)
}

fn pairwise_union(mut solids: Vec<CSG<()>>) -> Option<CSG<()>> {
    if solids.is_empty() {
        return None;
    }

    let mut queue: VecDeque<CSG<()>> = solids.drain(..).collect();

    while queue.len() > 1 {
        let mut next_queue: VecDeque<CSG<()>> = VecDeque::with_capacity((queue.len() + 1) / 2);
        while let Some(a) = queue.pop_front() {
            if let Some(b) = queue.pop_front() {
                let merged = a.union(&b);
                next_queue.push_back(merged);
            } else {
                next_queue.push_back(a);
            }
        }
        queue = next_queue;
    }

    queue.pop_front()
}

fn geometry_layer_key(geometry: &BufferGeometry) -> String {
    if let Some(props) = &geometry.properties {
        for key in [
            "layer",
            "Layer",
            "sourceLayer",
            "source_layer",
            "__sourceLayer",
        ] {
            if let Some(value) = props.get(key) {
                if let Some(s) = value.as_str() {
                    if !s.is_empty() {
                        return s.to_string();
                    }
                } else if let Some(n) = value.as_i64() {
                    return n.to_string();
                }
            }
        }
    }

    "merged_layer".to_string()
}

#[cfg(target_arch = "wasm32")]
fn union_multipolygon(a: &MultiPolygon<f64>, b: &MultiPolygon<f64>) -> MultiPolygon<f64> {
    a.union(b)
}

#[cfg(target_arch = "wasm32")]
fn extrude_multipolygon(
    footprint: &MultiPolygon<f64>,
    base_z: f64,
    depth: f64,
) -> Option<BufferGeometry> {
    let mut geometries = Vec::new();
    for polygon in &footprint.0 {
        if polygon.exterior().0.len() < 3 {
            continue;
        }
        if let Some(geometry) = extrude_polygon_to_geometry(polygon, base_z, depth) {
            geometries.push(geometry);
        }
    }
    if geometries.is_empty() {
        return None;
    }
    Some(fallback_layer_union(geometries))
}

#[cfg(target_arch = "wasm32")]
fn extrude_polygon_to_geometry(
    polygon: &Polygon<f64>,
    base_z: f64,
    depth: f64,
) -> Option<BufferGeometry> {
    if depth <= NORMAL_EPS as f64 {
        return None;
    }

    let shape = polygon_to_shape(polygon)?;
    let extruded_js = extrude::extrude_shape_with_options(vec![shape], depth, 1, false).ok()?;

    let position_js = Reflect::get(&extruded_js, &JsValue::from_str("position")).ok()?;
    if position_js.is_null() {
        return None;
    }

    let mut vertices = {
        let array = Float32Array::from(position_js.clone());
        let mut data = vec![0.0; array.length() as usize];
        array.copy_to(&mut data);
        data
    };

    if base_z.abs() > 0.0 {
        for i in (2..vertices.len()).step_by(3) {
            vertices[i] += base_z as f32;
        }
    }

    let normals = {
        let normal_js =
            Reflect::get(&extruded_js, &JsValue::from_str("normal")).unwrap_or(JsValue::NULL);
        if normal_js.is_null() {
            None
        } else {
            let array = Float32Array::from(normal_js);
            let mut data = vec![0.0; array.length() as usize];
            array.copy_to(&mut data);
            Some(data)
        }
    };

    let indices = {
        let index_js =
            Reflect::get(&extruded_js, &JsValue::from_str("index")).unwrap_or(JsValue::NULL);
        if index_js.is_null() {
            None
        } else {
            let array = Array::from(&index_js);
            let mut data = Vec::with_capacity(array.length() as usize);
            for i in 0..array.length() {
                data.push(array.get(i).as_f64().unwrap_or(0.0) as u32);
            }
            Some(data)
        }
    };

    let uvs = {
        let uv_js = Reflect::get(&extruded_js, &JsValue::from_str("uv")).unwrap_or(JsValue::NULL);
        if uv_js.is_null() {
            None
        } else {
            let array = Float32Array::from(uv_js);
            let mut data = vec![0.0; array.length() as usize];
            array.copy_to(&mut data);
            Some(data)
        }
    };

    Some(BufferGeometry {
        vertices,
        normals,
        colors: None,
        indices,
        uvs,
        has_data: true,
        properties: None,
    })
}

#[cfg(target_arch = "wasm32")]
fn polygon_to_shape(polygon: &Polygon<f64>) -> Option<Vec<Vec<[f64; 2]>>> {
    let mut shape = Vec::new();
    let exterior = linestring_to_ring(polygon.exterior(), false)?;
    shape.push(exterior);

    for hole in polygon.interiors() {
        if let Some(ring) = linestring_to_ring(hole, true) {
            shape.push(ring);
        }
    }

    if shape.is_empty() {
        None
    } else {
        Some(shape)
    }
}

#[cfg(target_arch = "wasm32")]
fn linestring_to_ring(ls: &LineString<f64>, hole: bool) -> Option<Vec<[f64; 2]>> {
    if ls.0.len() < 3 {
        return None;
    }

    let mut points: Vec<[f64; 2]> = ls.0.iter().map(|coord| [coord.x, coord.y]).collect();

    if points.first() == points.last() {
        points.pop();
    }

    if points.len() < 3 {
        return None;
    }

    let clockwise = ring_area(&points) < 0.0;
    if hole {
        if !clockwise {
            points.reverse();
        }
    } else if clockwise {
        points.reverse();
    }

    points.push(points[0]);
    Some(points)
}

#[cfg(target_arch = "wasm32")]
fn ring_area(points: &[[f64; 2]]) -> f64 {
    let mut area = 0.0;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        area += points[i][0] * points[j][1] - points[j][0] * points[i][1];
    }
    area * 0.5
}

#[cfg(target_arch = "wasm32")]
fn quantize_value(value: f64, precision: f64) -> i64 {
    (value / precision).round() as i64
}

fn buffer_geometry_to_csg(geometry: &BufferGeometry) -> Option<CSG<()>> {
    if !geometry.has_data || geometry.vertices.len() < 9 {
        return None;
    }

    let vertices = &geometry.vertices;
    let normals = geometry.normals.as_ref();
    let indices: Vec<u32> = if let Some(ref idx) = geometry.indices {
        if idx.len() < 3 || idx.len() % 3 != 0 {
            return None;
        }
        idx.clone()
    } else {
        let count = vertices.len() / 3;
        if count < 3 {
            return None;
        }
        (0..count as u32).collect()
    };

    let center = geometry_centroid(vertices);
    let mut polygons = Vec::with_capacity(indices.len() / 3);

    for face in indices.chunks_exact(3) {
        let mut tri_vertices = Vec::with_capacity(3);

        for &index in face {
            let base = index as usize * 3;
            if base + 2 >= vertices.len() {
                return None;
            }

            let x = vertices[base] as Real;
            let y = vertices[base + 1] as Real;
            let z = vertices[base + 2] as Real;

            let normal_vec = if let Some(normals_vec) = normals {
                if base + 2 < normals_vec.len() {
                    Vector3::new(
                        normals_vec[base] as Real,
                        normals_vec[base + 1] as Real,
                        normals_vec[base + 2] as Real,
                    )
                } else {
                    Vector3::zeros()
                }
            } else {
                Vector3::zeros()
            };

            tri_vertices.push((Point3::new(x, y, z), normal_vec));
        }

        let mut p0 = tri_vertices[0].0;
        let mut p1 = tri_vertices[1].0;
        let mut p2 = tri_vertices[2].0;
        let mut v1 = p1 - p0;
        let mut v2 = p2 - p0;
        let mut face_normal = v1.cross(&v2);
        if face_normal.norm() <= NORMAL_EPS {
            face_normal = Vector3::new(0.0, 0.0, 1.0);
        } else {
            face_normal = face_normal.normalize();
        }

        let tri_centroid = Point3::from((p0.coords + p1.coords + p2.coords) / 3.0);
        let to_outside = tri_centroid - center;
        if face_normal.dot(&to_outside) < 0.0 {
            tri_vertices.swap(1, 2);
            p0 = tri_vertices[0].0;
            p1 = tri_vertices[1].0;
            p2 = tri_vertices[2].0;
            v1 = p1 - p0;
            v2 = p2 - p0;
            face_normal = v1.cross(&v2);
            if face_normal.norm() <= NORMAL_EPS {
                face_normal = Vector3::new(0.0, 0.0, 1.0);
            } else {
                face_normal = face_normal.normalize();
            }
        }

        let polygon_vertices: Vec<CsgVertex> = tri_vertices
            .into_iter()
            .map(|(pos, normal)| {
                let final_normal = if normal.norm() > NORMAL_EPS {
                    normal.normalize()
                } else {
                    face_normal
                };
                CsgVertex::new(pos, final_normal)
            })
            .collect();

        polygons.push(CsgPolygon::new(polygon_vertices, None));
    }

    if polygons.is_empty() {
        return None;
    }

    Some(CSG::from_polygons(&polygons, None))
}

#[cfg(target_arch = "wasm32")]
fn geometry_footprint(geometry: &BufferGeometry) -> Option<(MultiPolygon<f64>, f64, f64)> {
    if !geometry.has_data || geometry.vertices.len() < 9 {
        return None;
    }

    let vertices = &geometry.vertices;
    let mut min_z = f64::INFINITY;
    let mut max_z = f64::NEG_INFINITY;
    for chunk in vertices.chunks(3) {
        min_z = min_z.min(chunk[2] as f64);
        max_z = max_z.max(chunk[2] as f64);
    }

    if max_z <= min_z {
        return None;
    }

    let indices: Vec<u32> = geometry
        .indices
        .clone()
        .unwrap_or_else(|| (0..(vertices.len() / 3) as u32).collect());

    if indices.len() < 3 {
        return None;
    }

    let mut polygons = Vec::new();

    for face in indices.chunks(3) {
        let idx0 = face[0] as usize * 3;
        let idx1 = face[1] as usize * 3;
        let idx2 = face[2] as usize * 3;
        if idx2 + 2 >= vertices.len() {
            continue;
        }

        let ax = vertices[idx0] as f64;
        let ay = vertices[idx0 + 1] as f64;
        let az = vertices[idx0 + 2] as f64;
        let bx = vertices[idx1] as f64;
        let by = vertices[idx1 + 1] as f64;
        let bz = vertices[idx1 + 2] as f64;
        let cx = vertices[idx2] as f64;
        let cy = vertices[idx2 + 1] as f64;
        let cz = vertices[idx2 + 2] as f64;

        let v1 = [bx - ax, by - ay, bz - az];
        let v2 = [cx - ax, cy - ay, cz - az];
        let normal = [
            v1[1] * v2[2] - v1[2] * v2[1],
            v1[2] * v2[0] - v1[0] * v2[2],
            v1[0] * v2[1] - v1[1] * v2[0],
        ];

        let normal_len =
            (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if normal_len <= 1e-9 {
            continue;
        }

        let nz = normal[2] / normal_len;
        if nz <= 0.5 {
            continue;
        }

        let mut ring = vec![[ax, ay], [bx, by], [cx, cy]];
        if ring_area(&ring) < 0.0 {
            ring.swap(1, 2);
        }
        ring.push(ring[0]);

        let linestring = LineString::from(ring);
        polygons.push(Polygon::new(linestring, vec![]));
    }

    if polygons.is_empty() {
        return None;
    }

    let mut iter = polygons.into_iter();
    let first = iter.next().unwrap();
    let mut footprint = MultiPolygon(vec![first]);
    for poly in iter {
        let mp = MultiPolygon(vec![poly]);
        footprint = union_multipolygon(&footprint, &mp);
    }

    Some((footprint, min_z, max_z))
}

fn geometry_centroid(vertices: &[f32]) -> Point3<Real> {
    let mut sum = Vector3::zeros();
    let mut count = 0.0;
    for chunk in vertices.chunks_exact(3) {
        sum.x += chunk[0] as Real;
        sum.y += chunk[1] as Real;
        sum.z += chunk[2] as Real;
        count += 1.0;
    }
    if count == 0.0 {
        return Point3::origin();
    }
    sum /= count;
    Point3::new(sum.x, sum.y, sum.z)
}

fn csg_to_buffer_geometry(csg: &CSG<()>) -> Option<BufferGeometry> {
    if csg.polygons.is_empty() {
        return None;
    }

    let mut vertices = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();

    for polygon in &csg.polygons {
        for tri in polygon.triangulate() {
            for vertex in tri.iter() {
                vertices.push(vertex.pos.x as f32);
                vertices.push(vertex.pos.y as f32);
                vertices.push(vertex.pos.z as f32);

                let mut normal = vertex.normal;
                if normal.norm() <= NORMAL_EPS {
                    normal = Vector3::new(0.0, 0.0, 1.0);
                } else {
                    normal = normal.normalize();
                }
                normals.push(normal.x as f32);
                normals.push(normal.y as f32);
                normals.push(normal.z as f32);

                let current_index = (vertices.len() / 3 - 1) as u32;
                indices.push(current_index);
            }
        }
    }

    if vertices.is_empty() {
        return None;
    }

    Some(BufferGeometry {
        vertices,
        normals: if normals.is_empty() {
            None
        } else {
            Some(normals)
        },
        colors: None,
        indices: if indices.is_empty() {
            None
        } else {
            Some(indices)
        },
        uvs: None,
        has_data: true,
        properties: None,
    })
}

fn fallback_layer_union(geometries: Vec<BufferGeometry>) -> BufferGeometry {
    let mut vertex_map: HashMap<QuantizedPosition, u32> = HashMap::new();
    let mut vertices: Vec<f32> = Vec::new();
    let mut colors: Vec<f32> = Vec::new();
    let mut has_global_colors = false;
    let mut indices: Vec<[u32; 3]> = Vec::new();
    let mut face_lookup: HashMap<(u32, u32, u32), usize> = HashMap::new();

    for geometry in geometries {
        if !geometry.has_data || geometry.vertices.len() < 9 {
            continue;
        }

        let local_vertices = geometry.vertices;
        let local_indices = if let Some(idx) = geometry.indices {
            idx
        } else {
            (0..(local_vertices.len() / 3) as u32).collect()
        };

        let local_colors = geometry.colors.as_ref().map(|c| c.as_slice());
        let mut remap_cache: HashMap<u32, u32> = HashMap::new();

        for face in local_indices.chunks(3) {
            if face.len() < 3 {
                continue;
            }

            let i0 = match get_or_insert_vertex(
                face[0],
                &local_vertices,
                local_colors,
                &mut vertex_map,
                &mut vertices,
                &mut colors,
                &mut has_global_colors,
                &mut remap_cache,
            ) {
                Some(idx) => idx,
                None => continue,
            };
            let i1 = match get_or_insert_vertex(
                face[1],
                &local_vertices,
                local_colors,
                &mut vertex_map,
                &mut vertices,
                &mut colors,
                &mut has_global_colors,
                &mut remap_cache,
            ) {
                Some(idx) => idx,
                None => continue,
            };
            let i2 = match get_or_insert_vertex(
                face[2],
                &local_vertices,
                local_colors,
                &mut vertex_map,
                &mut vertices,
                &mut colors,
                &mut has_global_colors,
                &mut remap_cache,
            ) {
                Some(idx) => idx,
                None => continue,
            };

            if i0 == i1 || i1 == i2 || i2 == i0 {
                continue;
            }

            let mut sorted = [i0, i1, i2];
            sorted.sort();
            let key = (sorted[0], sorted[1], sorted[2]);

            if face_lookup.contains_key(&key) {
                continue;
            }

            face_lookup.insert(key, indices.len());
            indices.push([i0, i1, i2]);
        }
    }

    if vertices.is_empty() || indices.is_empty() {
        return BufferGeometry {
            vertices: Vec::new(),
            normals: None,
            colors: None,
            indices: None,
            uvs: None,
            has_data: false,
            properties: None,
        };
    }

    let mut normals = vec![0.0f32; vertices.len()];
    for tri in &indices {
        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        let ax = vertices[i0 * 3];
        let ay = vertices[i0 * 3 + 1];
        let az = vertices[i0 * 3 + 2];
        let bx = vertices[i1 * 3];
        let by = vertices[i1 * 3 + 1];
        let bz = vertices[i1 * 3 + 2];
        let cx = vertices[i2 * 3];
        let cy = vertices[i2 * 3 + 1];
        let cz = vertices[i2 * 3 + 2];

        let v1x = bx - ax;
        let v1y = by - ay;
        let v1z = bz - az;
        let v2x = cx - ax;
        let v2y = cy - ay;
        let v2z = cz - az;

        let nx = v1y * v2z - v1z * v2y;
        let ny = v1z * v2x - v1x * v2z;
        let nz = v1x * v2y - v1y * v2x;

        for &idx in &[i0, i1, i2] {
            normals[idx * 3] += nx;
            normals[idx * 3 + 1] += ny;
            normals[idx * 3 + 2] += nz;
        }
    }

    for normal in normals.chunks_mut(3) {
        let len = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if len > 1e-6 {
            normal[0] /= len;
            normal[1] /= len;
            normal[2] /= len;
        } else {
            normal[0] = 0.0;
            normal[1] = 0.0;
            normal[2] = 1.0;
        }
    }

    let mut final_indices = Vec::with_capacity(indices.len() * 3);
    for tri in indices {
        final_indices.push(tri[0]);
        final_indices.push(tri[1]);
        final_indices.push(tri[2]);
    }

    BufferGeometry {
        vertices,
        normals: Some(normals),
        colors: if has_global_colors {
            Some(colors)
        } else {
            None
        },
        indices: Some(final_indices),
        uvs: None,
        has_data: true,
        properties: None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct QuantizedPosition(i32, i32, i32);

const POSITION_EPSILON: f32 = 1e-5;

fn quantize_position(x: f32, y: f32, z: f32) -> QuantizedPosition {
    let scale = 1.0 / POSITION_EPSILON;
    QuantizedPosition(
        (x * scale).round() as i32,
        (y * scale).round() as i32,
        (z * scale).round() as i32,
    )
}

fn get_or_insert_vertex(
    original_index: u32,
    local_vertices: &[f32],
    local_colors: Option<&[f32]>,
    vertex_map: &mut HashMap<QuantizedPosition, u32>,
    global_vertices: &mut Vec<f32>,
    global_colors: &mut Vec<f32>,
    has_global_colors: &mut bool,
    remap_cache: &mut HashMap<u32, u32>,
) -> Option<u32> {
    if let Some(mapped) = remap_cache.get(&original_index) {
        return Some(*mapped);
    }

    let base = original_index as usize * 3;
    if base + 2 >= local_vertices.len() {
        return None;
    }

    let x = local_vertices[base];
    let y = local_vertices[base + 1];
    let z = local_vertices[base + 2];
    let key = quantize_position(x, y, z);

    let mapped_index = match vertex_map.get(&key) {
        Some(existing) => *existing,
        None => {
            let new_index = (global_vertices.len() / 3) as u32;
            global_vertices.push(x);
            global_vertices.push(y);
            global_vertices.push(z);
            vertex_map.insert(key, new_index);

            if let Some(colors) = local_colors {
                let base = original_index as usize * 3;
                if base + 2 < colors.len() {
                    global_colors.push(colors[base]);
                    global_colors.push(colors[base + 1]);
                    global_colors.push(colors[base + 2]);
                    *has_global_colors = true;
                } else if *has_global_colors {
                    global_colors.extend_from_slice(&[0.0, 0.0, 0.0]);
                }
            } else if *has_global_colors {
                global_colors.extend_from_slice(&[0.0, 0.0, 0.0]);
            }

            new_index
        }
    };

    remap_cache.insert(original_index, mapped_index);
    Some(mapped_index)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;

    fn tetra_buffer(scale: f32) -> BufferGeometry {
        let s = scale;
        BufferGeometry {
            vertices: vec![s, s, s, -s, -s, s, -s, s, -s, s, -s, -s],
            normals: None,
            colors: None,
            indices: Some(vec![0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]),
            uvs: None,
            has_data: true,
            properties: None,
        }
    }

    fn cube_buffer(center: (f32, f32, f32), half: f32) -> BufferGeometry {
        let (cx, cy, cz) = center;
        let h = half;
        let vertices = vec![
            cx - h,
            cy - h,
            cz - h,
            cx + h,
            cy - h,
            cz - h,
            cx + h,
            cy + h,
            cz - h,
            cx - h,
            cy + h,
            cz - h,
            cx - h,
            cy - h,
            cz + h,
            cx + h,
            cy - h,
            cz + h,
            cx + h,
            cy + h,
            cz + h,
            cx - h,
            cy + h,
            cz + h,
        ];

        let indices = vec![
            0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 7, 6, 2, 3, 7, 1, 2, 6, 1, 6,
            5, 0, 4, 7, 0, 7, 3,
        ];

        BufferGeometry {
            vertices,
            normals: None,
            colors: None,
            indices: Some(indices),
            uvs: None,
            has_data: true,
            properties: None,
        }
    }

    fn vertex_bounds(vertices: &[f32]) -> Option<((f32, f32, f32), (f32, f32, f32))> {
        if vertices.len() < 3 {
            return None;
        }
        let mut min = (f32::MAX, f32::MAX, f32::MAX);
        let mut max = (f32::MIN, f32::MIN, f32::MIN);
        for chunk in vertices.chunks_exact(3) {
            min.0 = min.0.min(chunk[0]);
            min.1 = min.1.min(chunk[1]);
            min.2 = min.2.min(chunk[2]);
            max.0 = max.0.max(chunk[0]);
            max.1 = max.1.max(chunk[1]);
            max.2 = max.2.max(chunk[2]);
        }
        Some((min, max))
    }

    fn approx_tuple_eq(a: (f32, f32, f32), b: (f32, f32, f32), eps: f32) {
        assert!((a.0 - b.0).abs() <= eps, "x mismatch: {a:?} vs {b:?}");
        assert!((a.1 - b.1).abs() <= eps, "y mismatch: {a:?} vs {b:?}");
        assert!((a.2 - b.2).abs() <= eps, "z mismatch: {a:?} vs {b:?}");
    }

    #[test]
    fn csgrs_union_drops_nested_inner_volume() {
        let outer = tetra_buffer(2.0);
        let inner = tetra_buffer(0.5);
        let merged = merge_geometries_by_layer(vec![outer.clone(), inner])
            .remove("merged_layer")
            .expect("merged geometry");

        assert!(merged.has_data);

        let merged_bounds = vertex_bounds(&merged.vertices).expect("merged bounds");
        let outer_bounds = vertex_bounds(&outer.vertices).expect("outer bounds");

        if let Some(csgrs_only) = csgrs_union(&[outer.clone()]) {
            let csgrs_bounds = vertex_bounds(&csgrs_only.vertices).expect("csgrs bounds");
            approx_tuple_eq(csgrs_bounds.0, outer_bounds.0, 1e-4);
            approx_tuple_eq(csgrs_bounds.1, outer_bounds.1, 1e-4);
        }

        approx_tuple_eq(merged_bounds.0, outer_bounds.0, 1e-4);
        approx_tuple_eq(merged_bounds.1, outer_bounds.1, 1e-4);

        assert!(merged.vertices.len() >= outer.vertices.len());
    }

    #[test]
    fn csgrs_union_expands_overlapping_solids() {
        let cube_a = cube_buffer((0.0, 0.0, 0.0), 1.0);
        let cube_b = cube_buffer((1.0, 0.0, 0.0), 1.0);

        let union = merge_geometries_by_layer(vec![cube_a, cube_b])
            .remove("merged_layer")
            .expect("merged geometry");

        assert!(union.has_data);

        let bounds = vertex_bounds(&union.vertices).expect("bounds");
        approx_tuple_eq(bounds.0, (-1.0, -1.0, -1.0), 1e-4);
        approx_tuple_eq(bounds.1, (2.0, 1.0, 1.0), 1e-4);
    }
}
