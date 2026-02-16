import { Feature } from 'geojson';
import { VtDataSet, TerrainSettings } from '../stores/useAppStore';

/**
 * Serializable state for URL sharing
 */
interface ShareableState {
  bbox?: {
    type: string;
    geometry: {
      type: string;
      coordinates: number[][][];
    };
  };
  terrain?: {
    enabled: boolean;
    verticalExaggeration: number;
    baseHeight: number;
    color: string;
  };
  layers?: {
    sourceLayer: string;
    label?: string;
    enabled: boolean;
    color: string;
    filter?: unknown;
    extrusionDepth?: number;
    zOffset?: number;
    bufferSize?: number;
    fixedBufferSize?: boolean;
  }[];
}

/**
 * Base64 encode a string with UTF-8 support
 */
function toBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (e) {
    console.error('Base64 encoding failed:', e);
    return '';
  }
}

/**
 * Base64 decode a string with UTF-8 support
 */
function fromBase64(base64: string): string {
  try {
    // Add back padding
    let s = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) {
      s += '=';
    }

    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.error('Base64 decoding failed:', e);
    return '';
  }
}

/**
 * Serialize app state to a URL-safe base64 string
 */
export function serializeStateToUrl(
  bbox: Feature | null,
  terrainSettings: TerrainSettings,
  vtLayers: VtDataSet[]
): string {
  const state: ShareableState = {};

  // Serialize bbox (only geometry coordinates to keep URL shorter)
  if (bbox && bbox.geometry) {
    state.bbox = {
      type: bbox.type,
      geometry: {
        type: bbox.geometry.type,
        coordinates: (bbox.geometry as any).coordinates
      }
    };
  }

  // Serialize terrain settings
  state.terrain = {
    enabled: terrainSettings.enabled,
    verticalExaggeration: terrainSettings.verticalExaggeration,
    baseHeight: terrainSettings.baseHeight,
    color: terrainSettings.color,
  };

  // Serialize layer configs (only essential properties)
  state.layers = vtLayers.map(layer => ({
    sourceLayer: layer.sourceLayer,
    label: layer.label,
    enabled: layer.enabled,
    color: layer.color,
    filter: layer.filter,
    extrusionDepth: layer.extrusionDepth,
    zOffset: layer.zOffset,
    bufferSize: layer.bufferSize,
    fixedBufferSize: layer.fixedBufferSize,
  }));

  const jsonStr = JSON.stringify(state);
  return toBase64(jsonStr);
}

/**
 * Deserialize state from URL base64 string
 */
export function deserializeStateFromUrl(base64: string): ShareableState | null {
  const jsonStr = fromBase64(base64);
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr) as ShareableState;
  } catch (error) {
    console.error('Failed to parse decoded JSON state:', error);
    console.debug('Faulty JSON string:', jsonStr);
    return null;
  }
}

/**
 * Get the current shareable URL
 */
export function getShareableUrl(
  bbox: Feature | null,
  terrainSettings: TerrainSettings,
  vtLayers: VtDataSet[]
): string {
  const stateStr = serializeStateToUrl(bbox, terrainSettings, vtLayers);
  if (!stateStr) return window.location.origin + window.location.pathname;

  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('config', stateStr);
  return url.toString();
}

/**
 * Read state from current URL
 */
export function getStateFromCurrentUrl(): ShareableState | null {
  const url = new URL(window.location.href);
  const configParam = url.searchParams.get('config');

  if (!configParam) {
    return null;
  }

  return deserializeStateFromUrl(configParam);
}

/**
 * Update the browser URL without triggering navigation
 */
export function updateBrowserUrl(
  bbox: Feature | null,
  terrainSettings: TerrainSettings,
  vtLayers: VtDataSet[]
): void {
  const stateStr = serializeStateToUrl(bbox, terrainSettings, vtLayers);
  if (!stateStr) {
    console.debug('urlState: Serialization produced empty string, not updating URL');
    return;
  }

  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('config', stateStr);

  // Use replaceState to avoid creating history entries for every change
  window.history.replaceState({}, '', url.toString());
}

export type { ShareableState };
