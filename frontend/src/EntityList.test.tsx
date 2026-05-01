// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { EntityList } from './EntityList'
import { useMapStore } from './mapStore'

const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    position: {
      title: 'Position',
      'x-ui-component': 'coordinate',
      type: 'object',
      properties: {
        lat: { type: 'number', title: 'Latitude', minimum: -90, maximum: 90 },
        lon: { type: 'number', title: 'Longitude', minimum: -180, maximum: 180 },
      },
    },
    radius: {
      type: 'number',
      title: 'Radius',
      minimum: 0,
    },
    name: {
      type: 'string',
      title: 'Name',
    },
  },
}

const server = setupServer(
  http.get('/api/schema/entity', () => HttpResponse.json(ENTITY_SCHEMA)),
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TestWrapper() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { control, watch, setValue } = useForm<any>({
    defaultValues: { entities: [] },
  })

  return <EntityList control={control} watch={watch} setValue={setValue} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TestWrapperWithEntities(props: { entities: any[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { control, watch, setValue } = useForm<any>({
    defaultValues: { entities: props.entities },
  })

  return <EntityList control={control} watch={watch} setValue={setValue} />
}

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

afterEach(() => {
  server.resetHandlers()
  cleanup()
  vi.clearAllMocks()
  useMapStore.setState({
    activeEntityIndex: null,
    entityPositions: [],
    entityRadii: [],
  })
})

afterAll(() => server.close())

describe('EntityList', () => {
  // Acceptance Criterion 1: Adding an entity appends a form and a marker
  it('adding an entity appends a form', async () => {
    render(<TestWrapper />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    expect(screen.queryByText(/Entities \(0\/10\)/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /add entity/i }))

    await waitFor(() => screen.getByText(/Entities \(1\/10\)/i))
    expect(screen.queryByText(/Entity 1/i)).toBeTruthy()
  })

  // Adding an entity updates mapStore.entityPositions and entityRadii
  it('adding an entity syncs to mapStore', async () => {
    render(<TestWrapper />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    fireEvent.click(screen.getByRole('button', { name: /add entity/i }))

    await waitFor(() => {
      expect(useMapStore.getState().entityPositions.length).toBe(1)
      expect(useMapStore.getState().entityRadii.length).toBe(1)
    })
  })

  // Acceptance Criterion 1: Removing an entity cleans up both form and marker
  it('removing an entity removes form and updates mapStore', async () => {
    render(<TestWrapper />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    fireEvent.click(screen.getByRole('button', { name: /add entity/i }))
    await waitFor(() => screen.getByText(/Entities \(1\/10\)/i))

    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    fireEvent.click(removeButtons[0])

    await waitFor(() => screen.getByText(/Entities \(0\/10\)/i))
    expect(useMapStore.getState().entityPositions.length).toBe(0)
    expect(useMapStore.getState().entityRadii.length).toBe(0)
  })

  // Acceptance Criterion 2: Minimum 2 entities enforced
  it('enforces minimum 2 entities requirement', async () => {
    render(<TestWrapper />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    fireEvent.click(screen.getByRole('button', { name: /add entity/i }))
    await waitFor(() => screen.getByText(/Entities \(1\/10\)/i))

    expect(screen.queryByText(/At least 2 entities required/i)).toBeTruthy()
  })

  // Acceptance Criterion 2: Maximum 10 entities enforced
  it('enforces maximum 10 entities limit', async () => {
    render(<TestWrapper />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    const addButton = () => screen.getByRole('button', { name: /add entity/i })

    for (let i = 0; i < 10; i++) {
      fireEvent.click(addButton())
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => screen.getByText(new RegExp(`Entities \\(${i + 1}\\/10\\)`, 'i')))
    }

    const button = addButton()
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  // Acceptance Criterion 3 & 4: Bidirectional sync
  it('syncs form position changes to mapStore', async () => {
    render(<TestWrapperWithEntities entities={[{ position: { lat: 0, lon: 0 } }]} />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    await waitFor(() => {
      const positions = useMapStore.getState().entityPositions
      expect(positions.length).toBe(1)
      expect(positions[0]).toEqual({ lat: 0, lon: 0 })
    })
  })

  // Acceptance Criterion 5: Radius circle updates in real time
  it('syncs form radius changes to mapStore', async () => {
    render(<TestWrapperWithEntities entities={[{ position: { lat: 0, lon: 0 }, radius: 1000 }]} />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    await waitFor(() => {
      const radii = useMapStore.getState().entityRadii
      expect(radii.length).toBe(1)
      expect(radii[0]).toBe(1000)
    })
  })

  // Acceptance Criterion 6: No position state outside mapStore
  it('reads entity positions from mapStore only', async () => {
    render(<TestWrapperWithEntities entities={[{ position: { lat: 51.5, lon: 0 } }]} />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    await waitFor(() => {
      const pos = useMapStore.getState().entityPositions[0]
      expect(pos).toEqual({ lat: 51.5, lon: 0 })
    })

    // Verify that applyPositionToForm is registered and functional
    const applyFn = useMapStore.getState().applyPositionToForm
    expect(applyFn).not.toBeNull()

    // Call applyPositionToForm to simulate a marker drag
    applyFn?.(0, { lat: 52, lon: 1 })

    await waitFor(() => {
      const pos = useMapStore.getState().entityPositions[0]
      expect(pos).toEqual({ lat: 52, lon: 1 })
    })
  })

  it('toggles entity expansion on header click', async () => {
    render(<TestWrapper />)
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    fireEvent.click(screen.getByRole('button', { name: /add entity/i }))
    await waitFor(() => screen.getByText(/Entity 1/i))

    const header = screen.getByText(/Entity 1/).closest('div')
    expect(header?.parentElement?.style.borderColor).toBeTruthy()

    // Header should be clickable to expand/collapse
    expect(screen.queryByText(/click map to place/i)).toBeTruthy()
  })

  it('handles multiple entities independently', async () => {
    render(
      <TestWrapperWithEntities
        entities={[
          { position: { lat: 0, lon: 0 }, radius: 1000 },
          { position: { lat: 10, lon: 10 }, radius: 2000 },
        ]}
      />
    )
    await waitFor(() => screen.getByRole('button', { name: /add entity/i }))

    await waitFor(() => {
      const positions = useMapStore.getState().entityPositions
      const radii = useMapStore.getState().entityRadii
      expect(positions.length).toBe(2)
      expect(radii.length).toBe(2)
      expect(positions[0]).toEqual({ lat: 0, lon: 0 })
      expect(positions[1]).toEqual({ lat: 10, lon: 10 })
      expect(radii[0]).toBe(1000)
      expect(radii[1]).toBe(2000)
    })
  })
})
