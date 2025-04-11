import * as turf from "@turf/turf";

export function bufferLineString(geometry: { coordinates: number[][]; }, bufferSize: number) {


    // Convert the LineString to a Turf.js feature
    const lineString = turf.lineString(geometry);

    // Buffer the LineString using the provided buffer size
    const buffered = turf.buffer(lineString, bufferSize, { units: "meters" });

    if (!buffered || buffered.geometry.type !== "Polygon") {
        throw new Error("Failed to buffer LineString into a Polygon");
    }

    return buffered.geometry.coordinates[0];
}
