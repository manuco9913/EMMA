import type { GeoJSON } from "geojson";

const ENTITY_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

/** Generate a GeoJSON polygon approximating a circle on the map. */
export function circleGeoJSON(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 64
): GeoJSON.FeatureCollection {
  const coords: [number, number][] = [];
  const earthRadiusKm = 6371;

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.cos(angle);
    const dLon =
      (radiusKm / earthRadiusKm) *
      (180 / Math.PI) *
      Math.sin(angle) /
      Math.cos((lat * Math.PI) / 180);
    coords.push([lon + dLon, lat + dLat]);
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: {},
      },
    ],
  };
}

export function entityColor(idx: number): string {
  return ENTITY_COLORS[idx % ENTITY_COLORS.length];
}
