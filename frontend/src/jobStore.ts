import { create } from 'zustand'

export type JobStatus = 'idle' | 'submitting' | 'running' | 'done' | 'error'

type JobStore = {
  scenarioId: string | null
  jobId: string | null
  runId: string | null
  status: JobStatus
  progress: number
  message: string
  setSubmitting: () => void
  setJobIds: (scenarioId: string, jobId: string) => void
  setProgress: (progress: number, message: string) => void
  setDone: (runId: string) => void
  setError: (message: string) => void
  reset: () => void
}

export const useJobStore = create<JobStore>(set => ({
  scenarioId: null,
  jobId: null,
  runId: null,
  status: 'idle',
  progress: 0,
  message: '',
  setSubmitting: () => set({ status: 'submitting', progress: 0, message: '' }),
  setJobIds: (scenarioId, jobId) => set({ scenarioId, jobId, status: 'running' }),
  setProgress: (progress, message) => set({ progress, message }),
  setDone: (runId) => set({ status: 'done', runId }),
  setError: (message) => set({ status: 'error', message }),
  reset: () => set({ scenarioId: null, jobId: null, runId: null, status: 'idle', progress: 0, message: '' }),
}))
