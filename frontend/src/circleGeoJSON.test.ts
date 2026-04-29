import { describe, it, expect } from 'vitest'
import { circleGeoJSON } from './circleGeoJSON'

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

describe('circleGeoJSON', () => {
  it('returns a GeoJSON Feature with Polygon geometry', () => {
    const result = circleGeoJSON({ lat: 51.5, lon: 0 }, 10)
    expect(result.type).toBe('Feature')
    expect(result.geometry.type).toBe('Polygon')
  })

  it('closes the ring (first coordinate equals last)', () => {
    const result = circleGeoJSON({ lat: 51.5, lon: 0 }, 10)
    const ring = result.geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('has segments+1 coordinates in the outer ring for the given segment count', () => {
    const segments = 32
    const result = circleGeoJSON({ lat: 51.5, lon: 0 }, 10, segments)
    expect(result.geometry.coordinates[0]).toHaveLength(segments + 1)
  })

  it('all ring vertices are approximately radius km from the center', () => {
    const center: [number, number] = [0, 51.5]
    const radiusKm = 50
    const result = circleGeoJSON({ lat: 51.5, lon: 0 }, radiusKm)
    const ring = result.geometry.coordinates[0] as [number, number][]
    ring.slice(0, -1).forEach(point => {
      const dist = haversineKm(point, center)
      expect(dist).toBeCloseTo(radiusKm, 0)
    })
  })

  it('works correctly at the equator', () => {
    const result = circleGeoJSON({ lat: 0, lon: 0 }, 100)
    const ring = result.geometry.coordinates[0] as [number, number][]
    ring.slice(0, -1).forEach(point => {
      const dist = haversineKm(point, [0, 0])
      expect(dist).toBeCloseTo(100, 0)
    })
  })

  it('uses 64 segments by default', () => {
    const result = circleGeoJSON({ lat: 0, lon: 0 }, 10)
    expect(result.geometry.coordinates[0]).toHaveLength(65)
  })
})
