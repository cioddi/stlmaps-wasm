import * as THREE from 'three';
import { VtDataSet } from '../../../types/VtDataSet';

export interface ConfigHashes {
  fullConfigHash: string;
  terrainHash: string;
  layerHashes: { index: number; hash: string }[];
}

export interface GeometryState {
  bbox: GeoJSON.Feature | undefined;
  configHashes: ConfigHashes;
  geometryDataSets: {
    polygonGeometries: VtDataSet[] | null;
    terrainGeometry: THREE.BufferGeometry | undefined;
  };
}

export interface GeometryActions {
  setBbox: (bbox: GeoJSON.Feature | undefined) => void;
  setConfigHashes: (hashes: ConfigHashes) => void;
  setGeometryDataSets: (dataSets: GeometryState['geometryDataSets']) => void;
}

export interface GeometryStore extends GeometryState, GeometryActions {}