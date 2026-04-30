// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ScenarioPanel } from './ScenarioPanel'
import { useJobStore } from './jobStore'

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
