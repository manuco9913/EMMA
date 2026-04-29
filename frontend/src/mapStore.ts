import { create } from 'zustand'

export type MarkerPosition = { lat: number; lon: number }

type MapStore = {
  activeEntityIndex: number | null
  setActiveEntityIndex: (i: number | null) => void
  entityPositions: (MarkerPosition | null)[]
  setEntityPositions: (positions: (MarkerPosition | null)[]) => void
  entityRadii: (number | null)[]
  setEntityRadii: (radii: (number | null)[]) => void
  applyPositionToForm: ((index: number, pos: MarkerPosition) => void) | null
  registerApplyPosition: (fn: ((index: number, pos: MarkerPosition) => void) | null) => void
}

export const useMapStore = create<MapStore>(set => ({
  activeEntityIndex: null,
  setActiveEntityIndex: i => set({ activeEntityIndex: i }),
  entityPositions: [],
  setEntityPositions: positions => set({ entityPositions: positions }),
  entityRadii: [],
  setEntityRadii: radii => set({ entityRadii: radii }),
  applyPositionToForm: null,
  registerApplyPosition: fn => set({ applyPositionToForm: fn }),
}))
