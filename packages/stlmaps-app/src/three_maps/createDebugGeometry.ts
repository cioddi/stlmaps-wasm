import * as THREE from "three";
import { GeometryData } from "../components/VectorTileFunctions";
import { VtDataSet } from "../types/VtDataSet";

/**
 * Creates simple debug geometry without any processing (no extrusion, no buffering)
 * This allows you to see the raw features as they come from the vector tiles
 */
export function createDebugGeometry({
  polygons,
  bbox,
  vtDataSet,
}: {
  polygons: GeometryData[];
  bbox: number[];
  vtDataSet: VtDataSet;
}): THREE.BufferGeometry {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  
  // Function to transform coordinates to mesh space
  function transformToMeshCoordinates({ lng, lat }: { lng: number; lat: number }): [number, number] {
    const TERRAIN_SIZE = 200;
    const x = ((lng - minLng) / (maxLng - minLng)) * TERRAIN_SIZE - TERRAIN_SIZE / 2;
    const y = ((lat - minLat) / (maxLat - minLat)) * TERRAIN_SIZE - TERRAIN_SIZE / 2;
    return [x, y];
  }

  const vertices: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  
  const colorObj = new THREE.Color(vtDataSet.color);
  let vertexIndex = 0;

  console.log(`Creating debug geometry for ${vtDataSet.sourceLayer} with ${polygons.length} features`);

  polygons.forEach((poly) => {
    const footprint = poly.geometry;
    
    if (!footprint || footprint.length < 2) {
      return;
    }

    if (poly.type === "LineString") {
      // For LineStrings, create a simple line geometry
      for (let i = 0; i < footprint.length; i++) {
        const [lng, lat] = footprint[i];
        const [x, y] = transformToMeshCoordinates({ lng, lat });
        
        // Add vertex position (slightly elevated for visibility)
        vertices.push(x, y, 0.5);
        
        // Add color (make lines slightly brighter for visibility)
        colors.push(
          Math.min(1, colorObj.r + 0.3), 
          Math.min(1, colorObj.g + 0.3), 
          Math.min(1, colorObj.b + 0.3)
        );
        
        // Create line segments (except for the last vertex)
        if (i < footprint.length - 1) {
          indices.push(vertexIndex, vertexIndex + 1);
        }
        
        vertexIndex++;
      }
    } else if (poly.type === "Polygon") {
      // For Polygons, create a wireframe outline
      for (let i = 0; i < footprint.length; i++) {
        const [lng, lat] = footprint[i];
        const [x, y] = transformToMeshCoordinates({ lng, lat });
        
        // Add vertex position at ground level
        vertices.push(x, y, 0.1);
        
        // Add color
        colors.push(colorObj.r, colorObj.g, colorObj.b);
        
        // Create line segments to form the polygon outline
        const nextIndex = (i + 1) % footprint.length;
        if (nextIndex !== 0) {
          indices.push(vertexIndex, vertexIndex + 1);
        } else {
          // Close the polygon
          indices.push(vertexIndex, vertexIndex - footprint.length + 1);
        }
        
        vertexIndex++;
      }
    } else if (poly.type === "Point") {
      // For Points, create a small cross marker
      const [lng, lat] = footprint[0];
      const [x, y] = transformToMeshCoordinates({ lng, lat });
      const size = 1.0; // Marker size
      
      // Create a cross pattern
      const crossPoints = [
        [x - size, y, 1.0],      // left
        [x + size, y, 1.0],      // right
        [x, y - size, 1.0],      // bottom
        [x, y + size, 1.0],      // top
      ];
      
      crossPoints.forEach(([px, py, pz]) => {
        vertices.push(px, py, pz);
        // Make points bright for visibility
        colors.push(
          Math.min(1, colorObj.r + 0.5), 
          Math.min(1, colorObj.g + 0.5), 
          Math.min(1, colorObj.b + 0.5)
        );
      });
      
      // Create line indices for the cross
      indices.push(vertexIndex, vertexIndex + 1); // horizontal line
      indices.push(vertexIndex + 2, vertexIndex + 3); // vertical line
      
      vertexIndex += 4;
    }
  });

  const geometry = new THREE.BufferGeometry();
  
  if (vertices.length > 0) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    if (indices.length > 0) {
      geometry.setIndex(indices);
    }
    
    console.log(`Debug geometry created: ${vertices.length / 3} vertices, ${indices.length / 2} lines`);
  } else {
    console.warn("No debug geometry data created");
  }

  return geometry;
}
