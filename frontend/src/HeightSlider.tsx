import { useCallback, useMemo, useRef, useState } from 'react'
import { useJobStore } from './jobStore'
import { useSliceStore } from './heatmap/sliceStore'
import { parseSlice, type SliceResult } from './heatmap/SliceParser'

export const PREFETCH_RADIUS = 2

const CAPACITY = 2 * PREFETCH_RADIUS + 1

export function HeightSlider() {
  const { status, scenarioId, runId, heightMin, heightMax, heightStep } = useJobStore()
  const setSlice = useSliceStore(s => s.setSlice)

  const [currentHeight, setCurrentHeight] = useState(heightMin)

  // Ring buffer: bounded Map keyed by height value, insertion order tracked separately.
  const bufferRef = useRef<Map<number, SliceResult>>(new Map())
  const insertionOrderRef = useRef<number[]>([])

  const heights = useMemo(() => {
    if (heightStep <= 0 || heightMin > heightMax) return [heightMin]
    const result: number[] = []
    for (let h = heightMin; h <= heightMax + 1e-9; h += heightStep) {
      result.push(Math.round(h * 1e9) / 1e9)
    }
    return result
  }, [heightMin, heightMax, heightStep])

  const addToBuffer = useCallback((height: number, result: SliceResult) => {
    if (bufferRef.current.has(height)) {
      bufferRef.current.set(height, result)
      return
    }
    if (insertionOrderRef.current.length >= CAPACITY) {
      const oldest = insertionOrderRef.current.shift()!
      bufferRef.current.delete(oldest)
    }
    insertionOrderRef.current.push(height)
    bufferRef.current.set(height, result)
  }, [])

  const fetchSlice = useCallback(async (height: number): Promise<SliceResult | null> => {
    if (bufferRef.current.has(height)) {
      return bufferRef.current.get(height)!
    }
    try {
      const res = await fetch(`/api/scenarios/${scenarioId}/runs/${runId}/slices/${height}`)
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      const result = parseSlice(buf)
      addToBuffer(height, result)
      return result
    } catch {
      return null
    }
  }, [scenarioId, runId, addToBuffer])

  const handleHeightChange = useCallback(async (height: number) => {
    setCurrentHeight(height)

    const result = await fetchSlice(height)
    if (result) setSlice(result)

    // Fire-and-forget prefetch of ±PREFETCH_RADIUS adjacent levels.
    const idx = heights.findIndex(h => Math.abs(h - height) < 1e-9)
    for (let r = 1; r <= PREFETCH_RADIUS; r++) {
      const prev = idx - r
      const next = idx + r
      if (prev >= 0) fetchSlice(heights[prev])
      if (next < heights.length) fetchSlice(heights[next])
    }
  }, [fetchSlice, heights, setSlice])

  if (status !== 'done') return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 32,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(4px)',
        borderRadius: 8,
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        fontSize: 13,
      }}
    >
      <label htmlFor="height-range" style={{ whiteSpace: 'nowrap' }}>Height (m)</label>
      <input
        id="height-range"
        type="range"
        min={heightMin}
        max={heightMax}
        step={heightStep}
        value={currentHeight}
        onChange={e => handleHeightChange(Number(e.target.value))}
        style={{ width: 160 }}
      />
      <input
        type="number"
        aria-label="Height in metres"
        min={heightMin}
        max={heightMax}
        step={heightStep}
        value={currentHeight}
        onChange={e => {
          const v = Number(e.target.value)
          if (v >= heightMin && v <= heightMax) handleHeightChange(v)
        }}
        style={{ width: 70, textAlign: 'right' }}
      />
    </div>
  )
}
