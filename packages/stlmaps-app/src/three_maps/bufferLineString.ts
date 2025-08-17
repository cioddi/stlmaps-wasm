import { getWasmModule } from "@threegis/core";

export function bufferLineString(geometry: number[][], bufferSize: number) {
    console.log("🛣️ bufferLineString called with geometry:", geometry.length, "points, buffer size:", bufferSize);
    
    // Convert buffer size from meters to approximate degrees
    // Rough conversion: 1 degree ≈ 111,000 meters at equator
    const bufferSizeDegrees = bufferSize / 111000;
    
    console.log("🛣️ Buffer size in degrees:", bufferSizeDegrees);

    // Create a GeoJSON LineString
    const lineStringGeoJSON = {
        type: "Feature",
        geometry: {
            type: "LineString",
            coordinates: geometry
        },
        properties: {}
    };

    try {
        // Use the Rust WASM buffer_line_string function
        const wasmModule = getWasmModule();
        if (!wasmModule) {
            throw new Error("WASM module not available");
        }
        
        const resultGeoJSON = wasmModule.buffer_line_string(JSON.stringify(lineStringGeoJSON), bufferSizeDegrees);
        console.log("🛣️ WASM buffer result:", resultGeoJSON);
        
        const result = JSON.parse(resultGeoJSON);
        
        if (!result.geometry || result.geometry.type !== "MultiPolygon" || !result.geometry.coordinates || result.geometry.coordinates.length === 0) {
            console.warn("🛣️ WASM buffering failed, no valid MultiPolygon returned");
            return [];
        }
        
        // Return the first polygon's exterior ring
        const firstPolygon = result.geometry.coordinates[0];
        if (firstPolygon && firstPolygon.length > 0) {
            console.log("🛣️ Returning buffered polygon with", firstPolygon[0].length, "points");
            return firstPolygon[0];
        }
        
        console.warn("🛣️ No valid polygon found in WASM buffer result");
        return [];
        
    } catch (error) {
        console.error("🛣️ Error in WASM bufferLineString:", error);
        return [];
    }
}
