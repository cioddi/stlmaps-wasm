import * as THREE from "three";
import { VtDataSet } from "../types/VtDataSet";

export const vtGeometries: VtDataSet[] = [
  {
    sourceLayer: "water",
    color: new THREE.Color(0x76bcff), // Lighter blue color for water
    extrusionDepth: 1, // Thin extrusion for water
    zOffset: -0.5,
    enabled: false,
    csgClipping: false,
  },
  {
    sourceLayer: "landcover",
    color: new THREE.Color(0x74e010), // Green color for landuse
    extrusionDepth: 1.2, // Thin extrusion for landuse
    zOffset: -0.3,
    bufferSize: 2,
    enabled: false,
    alignVerticesToTerrain: false,
    csgClipping: false,
  },
  {
    sourceLayer: "park",
    color: new THREE.Color(0x4cdf54), // Green color for landuse
    extrusionDepth: 0.8, // Thin extrusion for landuse
    zOffset: -0.3,
    bufferSize: 2,
    enabled: false,
    alignVerticesToTerrain: false,
    csgClipping: false,
  },
  {
    sourceLayer: "landuse",
    color: new THREE.Color(0x4caf50), // Green color for landuse
    extrusionDepth: 0.8, // Thin extrusion for landuse
    zOffset: -0.4,
    bufferSize: 2,
    enabled: false,
    alignVerticesToTerrain: false,
    // Filter to include green areas
    filter: ["in", "class", "commercial", "residential"],
    csgClipping: false,
  },
  {
    sourceLayer: "transportation",
    color: new THREE.Color(0x989898), // Gray color for streets
    extrusionDepth: 2.8, // Thin extrusion for landuse
    zOffset: -0.2,
    bufferSize: 2.4,
    enabled: true,
    alignVerticesToTerrain: false,
    // Filter for main road types
    filter: [
      "in",
      "class",
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "service",
      "minor",
      "track",
      "raceway",
      "path",
    ],
    csgClipping: false,
  },
  {
    sourceLayer: "building",
    color: new THREE.Color(0xafafaf), // Gray color for buildings
    zOffset: -0.1,
    useAdaptiveScaleFactor: true,
    heightScaleFactor: 0.8,
    enabled: true,
    csgClipping: false,
  },
];
