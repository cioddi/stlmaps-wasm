/**
 * Type definitions for MapLibre GL JS filter expressions
 * Based on the MapLibre GL JS specification
 */

// Basic filter operators
export type ComparisonOperator = 
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'in' | '!in';

export type SetMembershipOperator = 'in' | '!in';

export type ExistentialOperator = 'has' | '!has';

// Filter expression values
export type FilterValue = string | number | boolean;

// Comparison filter: ["==", key, value]
export type ComparisonFilter = [ComparisonOperator, string, FilterValue];

// Set membership filter: ["in", key, ...values] or ["in", value, ...keyValues]
export type SetMembershipFilter = [SetMembershipOperator, string, ...FilterValue[]];

// Existential filter: ["has", key]
export type ExistentialFilter = [ExistentialOperator, string];

// Combining filters
export type CombiningOperator = 'all' | 'any' | 'none';
export type CombiningFilter = [CombiningOperator, ...FilterExpression[]];

// Complete filter expression
export type FilterExpression = 
  | ComparisonFilter
  | SetMembershipFilter
  | ExistentialFilter
  | CombiningFilter;

/**
 * MapLibre style specification types
 */
export interface SourceSpecification {
  type: 'vector' | 'raster' | 'raster-dem' | 'geojson' | 'image' | 'video';
  url?: string;
  tiles?: string[];
  bounds?: [number, number, number, number];
  scheme?: 'xyz' | 'tms';
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
  promoteId?: string | { [sourceLayer: string]: string };
  volatile?: boolean;
}

export interface VectorSourceSpecification extends SourceSpecification {
  type: 'vector';
  url?: string;
  tiles?: string[];
}

/**
 * Layer specifications
 */
export interface LayerSpecification {
  id: string;
  type: 'background' | 'fill' | 'line' | 'symbol' | 'raster' | 'circle' | 'fill-extrusion' | 'heatmap' | 'hillshade';
  source?: string;
  'source-layer'?: string;
  layout?: Record<string, any>;
  paint?: Record<string, any>;
  filter?: FilterExpression;
  minzoom?: number;
  maxzoom?: number;
  interactive?: boolean;
}

/**
 * Feature and geometry types
 */
export interface Feature<T = any> {
  type: 'Feature';
  geometry: Geometry;
  properties: T;
  id?: string | number;
}

export interface Geometry {
  type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon' | 'GeometryCollection';
  coordinates?: any; // Varies by geometry type
  geometries?: Geometry[]; // For GeometryCollection
}

export interface BoundingBox {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: [[[number, number], [number, number], [number, number], [number, number], [number, number]]];
  };
  properties: Record<string, any>;
}