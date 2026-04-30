import { create } from 'zustand'

export type JobStatus = 'idle' | 'submitting' | 'running' | 'done' | 'error'

type JobStore = {
  scenarioId: string | null
  jobId: string | null
  status: JobStatus
  progress: number
  message: string
  setSubmitting: () => void
  setJobIds: (scenarioId: string, jobId: string) => void
  setProgress: (progress: number, message: string) => void
  setDone: () => void
  setError: (message: string) => void
  reset: () => void
}

export const useJobStore = create<JobStore>(set => ({
  scenarioId: null,
  jobId: null,
  status: 'idle',
  progress: 0,
  message: '',
  setSubmitting: () => set({ status: 'submitting', progress: 0, message: '' }),
  setJobIds: (scenarioId, jobId) => set({ scenarioId, jobId, status: 'running' }),
  setProgress: (progress, message) => set({ progress, message }),
  setDone: () => set({ status: 'done' }),
  setError: (message) => set({ status: 'error', message }),
  reset: () => set({ scenarioId: null, jobId: null, status: 'idle', progress: 0, message: '' }),
}))
