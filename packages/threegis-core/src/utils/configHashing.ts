/**
 * Creates a hash representation of bbox
 * 
 * @param feature A GeoJSON Feature or a Feature-like object with geometry property
 * @returns A string hash representation of the geometry
 */
export function hashBbox(feature: {type: string; geometry: any } | undefined): string {
  if (!feature) return "undefined";
  return JSON.stringify(feature.geometry);
}
