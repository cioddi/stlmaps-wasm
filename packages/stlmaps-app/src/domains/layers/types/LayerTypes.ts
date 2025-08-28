import { VtDataSet } from '../../../types/VtDataSet';

export interface LayerState {
  vtLayers: VtDataSet[];
}

export interface LayerActions {
  setVtLayers: (layers: VtDataSet[]) => void;
  updateVtLayer: (index: number, updates: Partial<VtDataSet>) => void;
  toggleLayerEnabled: (index: number) => void;
  setLayerColor: (index: number, hexColor: string) => void;
  setLayerExtrusionDepth: (index: number, value: number | undefined) => void;
  setLayerMinExtrusionDepth: (index: number, value: number | undefined) => void;
  setLayerZOffset: (index: number, value: number) => void;
  setLayerBufferSize: (index: number, value: number) => void;
  toggleLayerUseAdaptiveScaleFactor: (index: number) => void;
  toggleLayerAlignVerticesToTerrain: (index: number) => void;
  setLayerHeightScaleFactor: (index: number, value: number) => void;
  setLayerCsgClipping: (index: number, value: boolean) => void;
}

export interface LayerStore extends LayerState, LayerActions {}