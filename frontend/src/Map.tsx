import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useMapStore } from './mapStore'
import { circleGeoJSON } from './circleGeoJSON'
import { HeatmapCustomLayer } from './heatmap/HeatmapCustomLayer'
import { useSliceStore } from './heatmap/sliceStore'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol))

const MAP_STYLE = '/style.json'

const DEFAULT_CENTER: [number, number] = [0, 51.5]
const DEFAULT_ZOOM = 5
const EPSILON = 1e-8

export function MapComponent() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<(maplibregl.Marker | null)[]>([])
  const draggingRef = useRef<boolean[]>([])
  const circleCountRef = useRef(0)
  const heatmapLayerRef = useRef<HeatmapCustomLayer | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const { entityPositions, entityRadii, applyPositionToForm } = useMapStore()
  const { sliceResult } = useSliceStore()

  // Stable refs so event handlers never capture stale values
  const applyPositionRef = useRef(applyPositionToForm)
  useEffect(() => { applyPositionRef.current = applyPositionToForm }, [applyPositionToForm])

  const activeEntityIndexRef = useRef(useMapStore.getState().activeEntityIndex)
  useEffect(() =>
    useMapStore.subscribe(s => { activeEntityIndexRef.current = s.activeEntityIndex }),
  [])

  // Mount: create map and attach click handler
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const origin = window.location.origin
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      transformStyle: (_prev, style) => ({
        ...style,
        sprite: typeof style.sprite === 'string' && style.sprite.startsWith('/')
          ? origin + style.sprite
          : style.sprite,
        glyphs: typeof style.glyphs === 'string' && style.glyphs.startsWith('/')
          ? origin + style.glyphs
          : style.glyphs,
      }),
    })

    mapRef.current.addControl(new maplibregl.NavigationControl())

    mapRef.current.on('load', () => {
      const hl = new HeatmapCustomLayer()
      heatmapLayerRef.current = hl
      mapRef.current!.addLayer(hl)
      setMapReady(true)
    })

    mapRef.current.on('click', e => {
      const idx = activeEntityIndexRef.current
      if (idx === null || !applyPositionRef.current) return
      const { lat, lng } = e.lngLat
      applyPositionRef.current(idx, { lat, lon: lng })
    })

    return () => {
      markersRef.current.forEach(m => m?.remove())
      markersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Push heatmap data into the custom layer whenever a new slice arrives or the map loads.
  useEffect(() => {
    if (!sliceResult || !mapReady || !heatmapLayerRef.current) return
    heatmapLayerRef.current.setData(sliceResult)
    mapRef.current?.triggerRepaint()
  }, [sliceResult, mapReady])

  // Sync markers to entityPositions
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove markers beyond the current array length
    for (let i = entityPositions.length; i < markersRef.current.length; i++) {
      markersRef.current[i]?.remove()
      markersRef.current[i] = null
    }
    markersRef.current.length = entityPositions.length
    draggingRef.current.length = entityPositions.length

    entityPositions.forEach((pos, index) => {
      if (!pos) {
        markersRef.current[index]?.remove()
        markersRef.current[index] = null
        return
      }

      const existing = markersRef.current[index]
      if (existing) {
        if (!draggingRef.current[index]) {
          const cur = existing.getLngLat()
          if (Math.abs(cur.lat - pos.lat) > EPSILON || Math.abs(cur.lng - pos.lon) > EPSILON) {
            existing.setLngLat([pos.lon, pos.lat])
          }
        }
      } else {
        const marker = new maplibregl.Marker({ draggable: true, color: '#1a6ef5' })
          .setLngLat([pos.lon, pos.lat])
          .addTo(map)

        // Prevent marker clicks from propagating to map click handler
        marker.getElement().addEventListener('click', e => e.stopPropagation())

        marker.on('dragstart', () => { draggingRef.current[index] = true })
        marker.on('dragend', () => {
          draggingRef.current[index] = false
          const { lat, lng } = marker.getLngLat()
          applyPositionRef.current?.(index, { lat, lon: lng })
        })

        markersRef.current[index] = marker
      }
    })
  }, [entityPositions])

  // Sync GeoJSON circle fill layers to entityPositions + entityRadii
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const count = Math.max(entityPositions.length, circleCountRef.current)

    for (let i = 0; i < count; i++) {
      const sourceId = `circle-source-${i}`
      const layerId = `circle-fill-${i}`
      const pos = entityPositions[i]
      const radius = entityRadii[i]

      if (!pos || !radius) {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
        continue
      }

      const geo = circleGeoJSON(pos, radius)

      if (map.getSource(sourceId)) {
        ;(map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geo)
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geo })
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': '#1a6ef5',
            'fill-opacity': 0.25,
          },
        })
      }
    }

    circleCountRef.current = entityPositions.length
  }, [entityPositions, entityRadii, mapReady])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
