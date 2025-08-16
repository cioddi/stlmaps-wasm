// Utility functions to generate consistent cache keys across the application.

/// Generate a consistent key for a bounding box: "minLng_minLat_maxLng_maxLat".
pub fn make_bbox_key(min_lng: f64, min_lat: f64, max_lng: f64, max_lat: f64) -> String {
    format!("{}_{}_{}_{}", min_lng, min_lat, max_lng, max_lat)
}

/// Generate an inner cache key from a source layer and optional filter string.
/// If `filter_str` is empty, returns the source layer; otherwise returns "sourceLayer_filterStr".
pub fn make_inner_key(source_layer: &str, filter_str: &str) -> String {
    if filter_str.is_empty() {
        source_layer.to_string()
    } else {
        format!("{}_{}", source_layer, filter_str)
    }
}

/// Generate an inner cache key from a source layer and optional filter JSON value.
/// Handles null values and empty filters consistently by treating them as empty strings.
pub fn make_inner_key_from_filter(source_layer: &str, filter: Option<&serde_json::Value>) -> String {
    let filter_str = filter
        .filter(|f| !f.is_null())
        .map(|f| f.to_string())
        .unwrap_or_else(|| "".to_string());
    make_inner_key(source_layer, &filter_str)
}
