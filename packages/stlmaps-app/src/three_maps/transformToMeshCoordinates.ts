export function transformToMeshCoordinates({
    lng,
    lat,
    bbox: [minLng, minLat, maxLng, maxLat],
}:{
    lng: number;
    lat: number;
    bbox: [number, number, number, number];
}): [number, number] {
    const xFrac = (lng - minLng) / (maxLng - minLng) - 0.5;
    const yFrac = (lat - minLat) / (maxLat - minLat) - 0.5;
    return [xFrac * 200, yFrac * 200];
}