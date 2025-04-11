import * as THREE from "three";
import { CSG } from "three-csg-ts";

function clipFromTerrain(
  clipGeometry: THREE.BufferGeometry,
  terrainGeometry: THREE.BufferGeometry
): THREE.BufferGeometry {
  const terrainMesh = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshBasicMaterial()
  );
  return terrainGeometry;
  const clipMesh = new THREE.Mesh(clipGeometry, new THREE.MeshBasicMaterial());
  const clippedMesh = CSG.subtract(terrainMesh, clipMesh);
  const clippedGeometry = clippedMesh.geometry;
  return clippedGeometry;
}
