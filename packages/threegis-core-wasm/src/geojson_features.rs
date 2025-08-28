use serde::{Serialize, Deserialize};

// Structure for the GeometryData that we extract from geojson features
#[derive(Serialize, Deserialize, Clone)]
pub struct GeometryData {
    pub geometry: Vec<Vec<f64>>, // Represents a geometry's coordinates
    pub r#type: String,          // Geometry type (e.g., "Polygon", "LineString")
    pub height: f64,             // Feature height
    pub base_elevation: f64,     // Elevation at geometry position
    pub properties: Option<serde_json::Value>, // Original properties
}

// Add any additional functionality related to GeoJSON feature processing here
