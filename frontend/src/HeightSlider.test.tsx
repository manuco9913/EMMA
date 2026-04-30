// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { HeightSlider, PREFETCH_RADIUS } from './HeightSlider'
import { useJobStore } from './jobStore'
import { useSliceStore } from './heatmap/sliceStore'

// ── WPS1 helper ──────────────────────────────────────────────────────────────

function buildWPS1(data: number[] = [1]): ArrayBuffer {
  const w = data.length
  const h = 1
  const buf = new ArrayBuffer(56 + w * h * 4)
  const v = new DataView(buf)
  v.setUint8(0, 0x57); v.setUint8(1, 0x50); v.setUint8(2, 0x53); v.setUint8(3, 0x31)
  v.setUint16(4, 1, true)
  v.setUint32(6, w, true)
  v.setUint32(10, h, true)
  v.setFloat32(14, 0, true)
  v.setFloat32(18, 1, true)
  v.setFloat64(22, -1, true)
  v.setFloat64(30, -1, true)
  v.setFloat64(38,  1, true)
  v.setFloat64(46,  1, true)
  data.forEach((val, i) => v.setFloat32(56 + i * 4, val, true))
  return buf
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

function setDoneState(overrides: Partial<{ heightMin: number; heightMax: number; heightStep: number }> = {}) {
  useJobStore.setState({
    status: 'done',
    scenarioId: 'sid',
    runId: 'rid',
    heightMin: 0,
    heightMax: 100,
    heightStep: 50,
    ...overrides,
  })
}

afterEach(() => {
  cleanup()
  useJobStore.getState().reset()
  useSliceStore.getState().clearSlice()
  vi.restoreAllMocks()
})

// ── Visibility ────────────────────────────────────────────────────────────────

describe('HeightSlider visibility', () => {
  it('is not rendered when status is idle', () => {
    useJobStore.setState({ status: 'idle' })
    render(<HeightSlider />)
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('is not rendered when status is running', () => {
    useJobStore.setState({ status: 'running' })
    render(<HeightSlider />)
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('renders when status is done', () => {
    setDoneState()
    render(<HeightSlider />)
    expect(screen.getByRole('slider')).toBeTruthy()
  })
})

// ── Input sync ────────────────────────────────────────────────────────────────

describe('HeightSlider input sync', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buildWPS1()),
    }))
  })

  it('changing the slider updates the numeric input', async () => {
    setDoneState({ heightMin: 0, heightMax: 100, heightStep: 50 })
    render(<HeightSlider />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } })

    await waitFor(() => {
      expect(Number((screen.getByRole('spinbutton') as HTMLInputElement).value)).toBe(50)
    })
  })

  it('changing the numeric input updates the slider', async () => {
    setDoneState({ heightMin: 0, heightMax: 100, heightStep: 50 })
    render(<HeightSlider />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })

    await waitFor(() => {
      expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBe(50)
    })
  })

  it('slider initialises at heightMin', () => {
    setDoneState({ heightMin: 20, heightMax: 100, heightStep: 20 })
    render(<HeightSlider />)
    expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBe(20)
  })
})

// ── Fetch + sliceStore ────────────────────────────────────────────────────────

describe('HeightSlider fetch behaviour', () => {
  it('fetches the slice URL on height change', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buildWPS1([5, 6])),
    })
    vi.stubGlobal('fetch', mockFetch)

    setDoneState({ heightMin: 0, heightMax: 100, heightStep: 50 })
    render(<HeightSlider />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/scenarios/sid/runs/rid/slices/50')
    })
  })

  it('updates sliceStore with parsed data after fetch', async () => {
    const wps1 = buildWPS1([42])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(wps1),
    }))

    setDoneState({ heightMin: 0, heightMax: 50, heightStep: 50 })
    render(<HeightSlider />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } })

    await waitFor(() => {
      const slice = useSliceStore.getState().sliceResult
      expect(slice).not.toBeNull()
      expect(slice!.data[0]).toBeCloseTo(42)
    })
  })

  it('does not re-fetch a height already in the ring buffer', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buildWPS1()),
    })
    vi.stubGlobal('fetch', mockFetch)

    setDoneState({ heightMin: 0, heightMax: 100, heightStep: 50 })
    render(<HeightSlider />)

    // First change to height 50 → triggers a fetch for 50
    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } })
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/scenarios/sid/runs/rid/slices/50')
    })

    const callCount = mockFetch.mock.calls.length

    // Second change to height 50 → must hit the buffer, no new fetch
    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } })

    // Give any async ops a chance to settle
    await new Promise(r => setTimeout(r, 50))

    const fetchesFor50 = mockFetch.mock.calls.filter(
      (c: unknown[]) => (c[0] as string) === '/api/scenarios/sid/runs/rid/slices/50'
    ).length
    expect(fetchesFor50).toBe(callCount - mockFetch.mock.calls.filter(
      (c: unknown[]) => (c[0] as string) !== '/api/scenarios/sid/runs/rid/slices/50'
    ).length === callCount ? 1 : fetchesFor50)

    // Simpler assertion: total fetches for /slices/50 must still be 1
    expect(
      mockFetch.mock.calls.filter((c: unknown[]) => (c[0] as string) === '/api/scenarios/sid/runs/rid/slices/50').length
    ).toBe(1)
  })
})

// ── Prefetch ──────────────────────────────────────────────────────────────────

describe('HeightSlider prefetch', () => {
  it('PREFETCH_RADIUS is exported as a number', () => {
    expect(typeof PREFETCH_RADIUS).toBe('number')
    expect(PREFETCH_RADIUS).toBeGreaterThan(0)
  })

  it('prefetches adjacent heights after a height change', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buildWPS1()),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Heights: 0, 10, 20, 30, 40 — change to 20 (index 2)
    // Should prefetch indices 1 (10), 3 (30), 0 (0), 4 (40) with PREFETCH_RADIUS=2
    setDoneState({ heightMin: 0, heightMax: 40, heightStep: 10 })
    render(<HeightSlider />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } })

    // Wait for the primary fetch + prefetch fetches to fire
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string)
      // At minimum, the primary height and ±1 neighbours should be fetched
      expect(urls).toContain('/api/scenarios/sid/runs/rid/slices/20')
      expect(urls).toContain('/api/scenarios/sid/runs/rid/slices/10')
      expect(urls).toContain('/api/scenarios/sid/runs/rid/slices/30')
    })
  })
})
