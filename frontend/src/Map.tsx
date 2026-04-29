import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useMapStore } from './mapStore'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol))

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: 'vector',
      url: 'pmtiles:///tiles/tiles.pmtiles',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#d4d0c8',
      },
    },
  ],
}

const DEFAULT_CENTER: [number, number] = [0, 51.5]
const DEFAULT_ZOOM = 5
const EPSILON = 1e-8

export function MapComponent() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<(maplibregl.Marker | null)[]>([])
  const draggingRef = useRef<boolean[]>([])

  const { entityPositions, applyPositionToForm } = useMapStore()

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

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })

    mapRef.current.addControl(new maplibregl.NavigationControl())

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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
