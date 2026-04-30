// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ScenarioPanel } from './ScenarioPanel'
import { useJobStore } from './jobStore'
import { useSliceStore } from './heatmap/sliceStore'

vi.mock('./useSchema', () => ({
  useSchema: () => ({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', title: 'Scenario Name' } },
    },
    loading: false,
    error: null,
  }),
}))

vi.mock('./EntityList', () => ({
  EntityList: () => null,
}))

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  addEventListener() {}
  close() {}
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
})

afterEach(() => {
  cleanup()
  useJobStore.getState().reset()
  useSliceStore.getState().clearSlice()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ScenarioPanel job submission', () => {
  it('shows progress indicator immediately after clicking Run Scenario', async () => {
    // fetch never resolves — indicator must appear before API responds
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))

    render(<ScenarioPanel />)
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    await waitFor(() => {
      expect(screen.getByText(/submitting/i)).toBeTruthy()
    })
  })

  it('calls POST /api/scenarios on submit', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario_id: 'sid-1', job_id: 'jid-1' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScenarioPanel />)
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scenarios',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('stores scenario_id and job_id after successful POST', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario_id: 'sid-42', job_id: 'jid-99' }),
    }))

    render(<ScenarioPanel />)
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    await waitFor(() => {
      const s = useJobStore.getState()
      expect(s.scenarioId).toBe('sid-42')
      expect(s.jobId).toBe('jid-99')
    })
  })

  it('indicator remains visible while job is running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario_id: 'sid-1', job_id: 'jid-1' }),
    }))

    render(<ScenarioPanel />)
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    await waitFor(() => expect(useJobStore.getState().status).toBe('running'))
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('connects SSE using scenario_id and job_id from POST response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario_id: 'sid-42', job_id: 'jid-99' }),
    }))

    render(<ScenarioPanel />)
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0)
      expect(MockEventSource.instances[0].url).toBe(
        '/api/scenarios/sid-42/jobs/jid-99/events'
      )
    })
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildWPS1Buffer(opts: {
  width: number
  height: number
  data: number[]
  minVal?: number
  maxVal?: number
}): ArrayBuffer {
  const { width, height, data, minVal = 0, maxVal = 1 } = opts
  const buf = new ArrayBuffer(56 + width * height * 4)
  const v = new DataView(buf)
  v.setUint8(0, 0x57); v.setUint8(1, 0x50); v.setUint8(2, 0x53); v.setUint8(3, 0x31)
  v.setUint16(4, 1, true)
  v.setUint32(6, width, true)
  v.setUint32(10, height, true)
  v.setFloat32(14, minVal, true)
  v.setFloat32(18, maxVal, true)
  v.setFloat64(22, -1, true)  // west
  v.setFloat64(30, -1, true)  // south
  v.setFloat64(38,  1, true)  // east
  v.setFloat64(46,  1, true)  // north
  data.forEach((val, i) => v.setFloat32(56 + i * 4, val, true))
  return buf
}

// Controllable EventSource that can fire events after construction.
type EventCallback = (e: Event) => void
class ControllableMockEventSource {
  static instances: ControllableMockEventSource[] = []
  url: string
  private listeners: Map<string, EventCallback[]> = new Map()

  constructor(url: string) {
    this.url = url
    ControllableMockEventSource.instances.push(this)
  }

  addEventListener(name: string, cb: EventCallback) {
    const list = this.listeners.get(name) ?? []
    list.push(cb)
    this.listeners.set(name, list)
  }

  dispatchNamed(name: string, data: unknown) {
    const evt = Object.assign(new Event(name), { data: JSON.stringify(data) })
    this.listeners.get(name)?.forEach(cb => cb(evt))
  }

  close() {}
}

describe('ScenarioPanel heatmap slice fetch', () => {
  beforeEach(() => {
    ControllableMockEventSource.instances = []
    vi.stubGlobal('EventSource', ControllableMockEventSource)
  })

  it('fetches default height slice after SSE done and updates sliceStore', async () => {
    const wps1 = buildWPS1Buffer({ width: 2, height: 2, data: [1, 2, 3, 4] })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ scenario_id: 'sid', job_id: 'jid' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(wps1),
      })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScenarioPanel />)
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    // Wait for POST to complete and EventSource to be created.
    await waitFor(() => expect(ControllableMockEventSource.instances.length).toBe(1))
    await waitFor(() => expect(useJobStore.getState().status).toBe('running'))

    // Fire the SSE 'done' event with a run_id.
    ControllableMockEventSource.instances[0].dispatchNamed('done', { run_id: 'run-abc' })

    // sliceStore should be populated with parsed slice data.
    await waitFor(() => expect(useSliceStore.getState().sliceResult).not.toBeNull())

    const slice = useSliceStore.getState().sliceResult!
    expect(slice.width).toBe(2)
    expect(slice.height).toBe(2)
    expect(slice.data[0]).toBeCloseTo(1)
    expect(slice.data[3]).toBeCloseTo(4)

    // jobStore should record the run_id.
    expect(useJobStore.getState().runId).toBe('run-abc')
    expect(useJobStore.getState().status).toBe('done')

    // Slice was fetched for height=0 (no height_range in mock schema).
    expect(mockFetch).toHaveBeenCalledWith('/api/scenarios/sid/runs/run-abc/slices/0')
  })
})
