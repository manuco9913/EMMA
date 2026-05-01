// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { ScenarioPanel } from './ScenarioPanel'
import { useJobStore } from './jobStore'
import { useSliceStore } from './heatmap/sliceStore'

vi.mock('./EntityList', () => ({ EntityList: () => null }))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SIMPLE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
  },
}

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    frequency: { type: 'number', title: 'Frequency', minimum: 0.1 },
  },
}

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

// ── Controllable EventSource ──────────────────────────────────────────────────

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

// ── MSW server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/schema/scenario', () => HttpResponse.json(SIMPLE_SCHEMA)),
  http.get('/api/schema/entity', () => HttpResponse.json({ type: 'object', properties: {} })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
  useJobStore.getState().reset()
  useSliceStore.getState().clearSlice()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  ControllableMockEventSource.instances = []
})
afterAll(() => server.close())

function setupEventSource() {
  ControllableMockEventSource.instances = []
  vi.stubGlobal('EventSource', ControllableMockEventSource)
  return ControllableMockEventSource
}

// ── Test 1: Full submit flow ──────────────────────────────────────────────────

describe('Integration: full submit flow', () => {
  it('submit → SSE progress → SSE done → heatmap receives exact Float32Array from fixture', async () => {
    const wps1 = buildWPS1Buffer({ width: 3, height: 2, data: [10, 20, 30, 40, 50, 60] })
    const ESClass = setupEventSource()

    server.use(
      http.post('/api/scenarios', () =>
        HttpResponse.json({ scenario_id: 'sid-it1', job_id: 'jid-it1' }, { status: 201 })
      ),
      http.get('/api/scenarios/sid-it1/runs/run-it1/slices/0', () =>
        new HttpResponse(wps1, { headers: { 'Content-Type': 'application/octet-stream' } })
      ),
    )

    render(<ScenarioPanel />)
    // Wait for schema to load and form to appear.
    await waitFor(() => screen.getByRole('button', { name: /run scenario/i }))

    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    // EventSource should connect.
    await waitFor(() => expect(ESClass.instances.length).toBe(1))

    // Fire SSE progress event → UI updates.
    ESClass.instances[0].dispatchNamed('progress', { message: 'Computing paths', percent: 30 })
    await waitFor(() => screen.getByText(/computing paths/i))

    // Fire SSE done event → slice fetched → sliceStore populated.
    ESClass.instances[0].dispatchNamed('done', { run_id: 'run-it1' })

    await waitFor(() => expect(useSliceStore.getState().sliceResult).not.toBeNull())

    const result = useSliceStore.getState().sliceResult!
    expect(result.width).toBe(3)
    expect(result.height).toBe(2)
    expect(result.data[0]).toBeCloseTo(10)
    expect(result.data[5]).toBeCloseTo(60)
    expect(useJobStore.getState().runId).toBe('run-it1')
    expect(useJobStore.getState().status).toBe('done')
  })
})

// ── Test 2: Validation blocks submit ─────────────────────────────────────────

describe('Integration: invalid submit blocked by validation', () => {
  it('validation error shown and no POST fired when required number field is empty', async () => {
    // Override schema to include a number field with minimum validation.
    server.use(
      http.get('/api/schema/scenario', () => HttpResponse.json(VALIDATION_SCHEMA)),
    )

    render(<ScenarioPanel />)
    await waitFor(() => screen.getByRole('button', { name: /run scenario/i }))

    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))

    // Validation error should appear without any POST being made.
    await waitFor(() => screen.getByText(/must be a number/i))
    expect(useJobStore.getState().status).toBe('idle')
  })
})

// ── Test 3: Save & Re-run ─────────────────────────────────────────────────────

describe('Integration: Save & Re-run modal flow', () => {
  it('modal appears on second submit → Save & Re-run saves then starts new job', async () => {
    const ESClass = setupEventSource()
    let postCallCount = 0
    const wps1 = buildWPS1Buffer({ width: 1, height: 1, data: [99] })

    server.use(
      http.post('/api/scenarios', () => {
        postCallCount++
        return HttpResponse.json(
          { scenario_id: 'sid-sr', job_id: `jid-sr-${postCallCount}` },
          { status: 201 }
        )
      }),
      http.get('/api/scenarios/sid-sr/runs/:runId/slices/0', () =>
        new HttpResponse(wps1, { headers: { 'Content-Type': 'application/octet-stream' } })
      ),
      http.post('/api/scenarios/sid-sr/runs/run-first/save', async ({ request }) => {
        const body = await request.json() as { name: string }
        return HttpResponse.json({ run_id: 'run-first', name: body.name })
      }),
    )

    render(<ScenarioPanel />)
    await waitFor(() => screen.getByRole('button', { name: /run scenario/i }))

    // First submit.
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => expect(ESClass.instances.length).toBe(1))
    ESClass.instances[0].dispatchNamed('done', { run_id: 'run-first' })
    await waitFor(() => expect(useJobStore.getState().status).toBe('done'))

    // Second submit → modal should appear.
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => screen.getByRole('dialog'))

    // Fill name and click Save & Re-run.
    fireEvent.change(screen.getByLabelText(/run name/i), { target: { value: 'My Saved Run' } })
    fireEvent.click(screen.getByRole('button', { name: /save & re-run/i }))

    // Modal closes and second job starts.
    await waitFor(() => expect(ESClass.instances.length).toBe(2))
    expect(postCallCount).toBe(2)

    // Second job completes.
    ESClass.instances[1].dispatchNamed('done', { run_id: 'run-second' })
    await waitFor(() => expect(useJobStore.getState().status).toBe('done'))
    expect(useJobStore.getState().runId).toBe('run-second')
  })
})

// ── Test 4: Discard & Re-run ──────────────────────────────────────────────────

describe('Integration: Discard & Re-run modal flow', () => {
  it('modal appears on second submit → Discard & Re-run deletes then starts new job', async () => {
    const ESClass = setupEventSource()
    let postCallCount = 0
    let deleteCalled = false
    const wps1 = buildWPS1Buffer({ width: 1, height: 1, data: [7] })

    server.use(
      http.post('/api/scenarios', () => {
        postCallCount++
        return HttpResponse.json(
          { scenario_id: 'sid-dr', job_id: `jid-dr-${postCallCount}` },
          { status: 201 }
        )
      }),
      http.get('/api/scenarios/sid-dr/runs/:runId/slices/0', () =>
        new HttpResponse(wps1, { headers: { 'Content-Type': 'application/octet-stream' } })
      ),
      http.delete('/api/scenarios/sid-dr/runs/run-first', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    render(<ScenarioPanel />)
    await waitFor(() => screen.getByRole('button', { name: /run scenario/i }))

    // First submit.
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => expect(ESClass.instances.length).toBe(1))
    ESClass.instances[0].dispatchNamed('done', { run_id: 'run-first' })
    await waitFor(() => expect(useJobStore.getState().status).toBe('done'))

    // Second submit → modal appears.
    fireEvent.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => screen.getByRole('dialog'))

    // Click Discard & Re-run.
    fireEvent.click(screen.getByRole('button', { name: /discard & re-run/i }))

    // Modal closes, DELETE fired, second job starts.
    await waitFor(() => expect(ESClass.instances.length).toBe(2))
    expect(deleteCalled).toBe(true)
    expect(postCallCount).toBe(2)

    // Second job completes.
    ESClass.instances[1].dispatchNamed('done', { run_id: 'run-second' })
    await waitFor(() => expect(useJobStore.getState().status).toBe('done'))
    expect(useJobStore.getState().runId).toBe('run-second')
  })
})
