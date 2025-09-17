// Utility functions to generate consistent cache keys across the application.

/// Generate a cache key for process-specific data storage.
pub fn make_process_cache_key(process_id: &str, data_type: &str) -> String {
    format!("{}_{}", process_id, data_type)
}

/// Generate a legacy bbox key for backward compatibility (deprecated).
#[deprecated(note = "Use process-based keys instead")]
#[allow(dead_code)]
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

/// Generate an inner cache key using a label instead of source layer.
/// If `filter_str` is empty, returns the label; otherwise returns "label_filterStr".
pub fn make_inner_key_with_label(label: &str, filter_str: &str) -> String {
    if filter_str.is_empty() {
        label.to_string()
    } else {
        format!("{}_{}", label, filter_str)
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

/// Generate an inner cache key from a VtDataSet using its label.
#[allow(dead_code)]
pub fn make_inner_key_from_vtdataset(vt_dataset: &crate::polygon_geometry::VtDataSet) -> String {
    let filter_str = vt_dataset.filter
        .as_ref()
        .filter(|f| !f.is_null())
        .map(|f| f.to_string())
        .unwrap_or_else(|| "".to_string());
    make_inner_key_with_label(vt_dataset.get_label(), &filter_str)
}

/// Generate a process-specific data key for a VtDataSet.
pub fn make_process_vtdataset_key(process_id: &str, vt_dataset: &crate::polygon_geometry::VtDataSet) -> String {
    let filter_str = vt_dataset.filter
        .as_ref()
        .filter(|f| !f.is_null())
        .map(|f| f.to_string())
        .unwrap_or_else(|| "".to_string());
    let inner_key = make_inner_key_with_label(vt_dataset.get_label(), &filter_str);
    make_process_cache_key(process_id, &inner_key)
}
