const EARTH_RADIUS_KM = 6371

export type GeoJSONPolygonFeature = {
  type: 'Feature'
  geometry: {
    type: 'Polygon'
    coordinates: [number, number][][]
  }
  properties: Record<string, unknown>
}

export function circleGeoJSON(
  center: { lat: number; lon: number },
  radiusKm: number,
  segments = 64
): GeoJSONPolygonFeature {
  const d = radiusKm / EARTH_RADIUS_KM
  const lat1 = (center.lat * Math.PI) / 180
  const lon1 = (center.lon * Math.PI) / 180

  const ring: [number, number][] = []
  for (let i = 0; i < segments; i++) {
    const bearing = (2 * Math.PI * i) / segments
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
    )
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
      )
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  ring.push(ring[0])

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  }
}
