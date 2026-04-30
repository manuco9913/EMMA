import { create } from 'zustand'
import type { SliceResult } from './SliceParser'

type SliceStore = {
  sliceResult: SliceResult | null
  setSlice: (result: SliceResult) => void
  clearSlice: () => void
}

export const useSliceStore = create<SliceStore>(set => ({
  sliceResult: null,
  setSlice: (sliceResult) => set({ sliceResult }),
  clearSlice: () => set({ sliceResult: null }),
}))
