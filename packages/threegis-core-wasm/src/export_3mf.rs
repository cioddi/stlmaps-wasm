use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct Mesh3MFData {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub colors: Option<Vec<f32>>,
    pub name: Option<String>,
    pub transform: Option<Vec<f64>>, // 4x4 transform matrix (16 elements)
}

#[derive(Serialize, Deserialize)]
pub struct Model3MFData {
    pub meshes: Vec<Mesh3MFData>,
    pub title: Option<String>,
    pub description: Option<String>,
}

/// Generate 3MF XML content from geometry data
#[wasm_bindgen]
pub fn generate_3mf_model_xml(input_json: &str) -> Result<String, JsValue> {
    // Parse input data
    let model_data: Model3MFData = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    create_model_xml(&model_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to create model XML: {}", e)))
}

/// Generate content types XML for 3MF
#[wasm_bindgen]
pub fn generate_3mf_content_types_xml() -> String {
    create_content_types_xml()
}

/// Generate relationships XML for 3MF
#[wasm_bindgen]
pub fn generate_3mf_rels_xml() -> String {
    create_rels_xml()
}

fn create_content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>"#.to_string()
}

fn create_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" Id="rel0"/>
</Relationships>"#.to_string()
}

fn create_model_xml(model_data: &Model3MFData) -> Result<String, String> {
    let mut xml = String::new();

    // XML declaration and root element
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
"#);

    // Metadata
    let title = model_data.title.as_deref().unwrap_or("STLMaps 3D Model");
    xml.push_str(&format!(
        r#"  <metadata name="Title">{}</metadata>
"#,
        escape_xml(title)
    ));

    if let Some(ref description) = model_data.description {
        xml.push_str(&format!(
            r#"  <metadata name="Description">{}</metadata>
"#,
            escape_xml(description)
        ));
    }

    // Resources
    xml.push_str("  <resources>\n");

    // Process each mesh
    for (mesh_id, mesh) in model_data.meshes.iter().enumerate() {
        let object_id = mesh_id + 1;

        xml.push_str(&format!(
            r#"    <object id="{}" type="model">
      <mesh>
        <vertices>
"#,
            object_id
        ));

        // Vertices
        for i in (0..mesh.vertices.len()).step_by(3) {
            if i + 2 < mesh.vertices.len() {
                xml.push_str(&format!(
                    r#"          <vertex x="{}" y="{}" z="{}"/>
"#,
                    mesh.vertices[i],
                    mesh.vertices[i + 1],
                    mesh.vertices[i + 2]
                ));
            }
        }

        xml.push_str("        </vertices>\n        <triangles>\n");

        // Triangles
        for i in (0..mesh.indices.len()).step_by(3) {
            if i + 2 < mesh.indices.len() {
                xml.push_str(&format!(
                    r#"          <triangle v1="{}" v2="{}" v3="{}"/>
"#,
                    mesh.indices[i],
                    mesh.indices[i + 1],
                    mesh.indices[i + 2]
                ));
            }
        }

        xml.push_str("        </triangles>\n      </mesh>\n    </object>\n");
    }

    xml.push_str("  </resources>\n");

    // Build section - use a simple build approach
    xml.push_str("  <build>\n");

    // Add all objects to the build directly (3MF viewers should handle positioning correctly)
    for mesh_id in 0..model_data.meshes.len() {
        let object_id = mesh_id + 1;
        xml.push_str(&format!(
            r#"    <item objectid="{}"/>
"#,
            object_id
        ));
    }

    xml.push_str("  </build>\n</model>");

    Ok(xml)
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// Removed unused helper functions for now
