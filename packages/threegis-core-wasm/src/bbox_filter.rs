// filepath: /home/tobi/project/stlmaps/packages/threegis-core-wasm/src/bbox_filter.rs

// Function to check if a point is inside a bounding box
pub fn point_in_bbox(point: &[f64], bbox: &[f64]) -> bool {
    let lng = point[0];
    let lat = point[1];
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];
    
    lng >= min_lng && lng <= max_lng && lat >= min_lat && lat <= max_lat
}

// Function to check if a polygon intersects with a bounding box
pub fn polygon_intersects_bbox(polygon: &Vec<Vec<f64>>, bbox: &[f64]) -> bool {
    // 1. Quick rejection tests first - if the polygon's bounding box doesn't overlap the target bbox, reject it
    let min_lng = bbox[0];
    let min_lat = bbox[1];
    let max_lng = bbox[2];
    let max_lat = bbox[3];
    
    // Calculate the bounding box of the polygon
    let mut poly_min_lng = f64::INFINITY;
    let mut poly_min_lat = f64::INFINITY;
    let mut poly_max_lng = f64::NEG_INFINITY;
    let mut poly_max_lat = f64::NEG_INFINITY;
    
    for point in polygon {
        poly_min_lng = poly_min_lng.min(point[0]);
        poly_min_lat = poly_min_lat.min(point[1]);
        poly_max_lng = poly_max_lng.max(point[0]);
        poly_max_lat = poly_max_lat.max(point[1]);
    }
    
    // Check if bounding boxes don't overlap
    if poly_max_lng < min_lng || poly_min_lng > max_lng || poly_max_lat < min_lat || poly_min_lat > max_lat {
        return false;
    }
    
    // 2. Check if any point of the polygon is inside the bbox
    let polygon_points_in_bbox = polygon.iter().any(|point| point_in_bbox(point, bbox));
    if polygon_points_in_bbox {
        return true;
    }
    
    // 3. Check if any edge of the polygon intersects with any edge of the bbox
    // Define the four edges of the bbox
    let bbox_edges = [
        [[min_lng, min_lat], [max_lng, min_lat]], // bottom
        [[max_lng, min_lat], [max_lng, max_lat]], // right
        [[max_lng, max_lat], [min_lng, max_lat]], // top
        [[min_lng, max_lat], [min_lng, min_lat]]  // left
    ];
    
    // Check if any edge of the polygon intersects with any edge of the bbox
    let n = polygon.len();
    for i in 0..n {
        let p1 = &polygon[i];
        let p2 = &polygon[(i + 1) % n];
        
        for bbox_edge in &bbox_edges {
            if line_segments_intersect(p1, p2, &bbox_edge[0], &bbox_edge[1]) {
                return true;
            }
        }
    }
    
    // 4. Check if the bbox is completely inside the polygon
    // Test if any corner of the bbox is inside the polygon
    let bbox_corners = [
        [min_lng, min_lat], // bottom-left
        [max_lng, min_lat], // bottom-right
        [max_lng, max_lat], // top-right
        [min_lng, max_lat]  // top-left
    ];
    
    for corner in &bbox_corners {
        if is_point_in_polygon(corner, polygon) {
            return true;
        }
    }
    
    // 5. Check if the polygon is completely inside the bbox
    // If all polygon points are inside the bbox, then the polygon is inside the bbox
    if polygon.iter().all(|point| point_in_bbox(point, bbox)) {
        return true;
    }
    
    // No intersections found
    false
}

// Helper function to check if two line segments intersect
fn line_segments_intersect(p1: &[f64], p2: &[f64], p3: &[f64], p4: &[f64]) -> bool {
    let d1 = direction(p3, p4, p1);
    let d2 = direction(p3, p4, p2);
    let d3 = direction(p1, p2, p3);
    let d4 = direction(p1, p2, p4);
    
    // Check if the line segments intersect
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && 
       ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0)) {
        return true;
    }
    
    // Check for colinearity
    if d1 == 0.0 && is_point_on_segment(p3, p4, p1) { return true; }
    if d2 == 0.0 && is_point_on_segment(p3, p4, p2) { return true; }
    if d3 == 0.0 && is_point_on_segment(p1, p2, p3) { return true; }
    if d4 == 0.0 && is_point_on_segment(p1, p2, p4) { return true; }
    
    false
}

// Helper function to calculate the direction of three points
fn direction(p1: &[f64], p2: &[f64], p3: &[f64]) -> f64 {
    (p3[0] - p1[0]) * (p2[1] - p1[1]) - (p2[0] - p1[0]) * (p3[1] - p1[1])
}

// Helper function to check if a point lies on a line segment
fn is_point_on_segment(p1: &[f64], p2: &[f64], p: &[f64]) -> bool {
    p[0] >= p1[0].min(p2[0]) && p[0] <= p1[0].max(p2[0]) &&
    p[1] >= p1[1].min(p2[1]) && p[1] <= p1[1].max(p2[1])
}

// Helper function to check if a point is inside a polygon using the ray casting algorithm
fn is_point_in_polygon(point: &[f64], polygon: &Vec<Vec<f64>>) -> bool {
    let mut inside = false;
    let x = point[0];
    let y = point[1];
    let n = polygon.len();
    
    for i in 0..n {
        let j = (i + 1) % n;
        let xi = polygon[i][0];
        let yi = polygon[i][1];
        let xj = polygon[j][0];
        let yj = polygon[j][1];
        
        let intersect = ((yi > y) != (yj > y)) && 
                        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        
        if intersect {
            inside = !inside;
        }
    }
    
    inside
}
