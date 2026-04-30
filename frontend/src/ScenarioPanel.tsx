import { useForm } from 'react-hook-form'
import { useSchema } from './useSchema'
import { SchemaFormRenderer } from './SchemaFormRenderer'
import { EntityList } from './EntityList'
import { useJobStore } from './jobStore'
import { useSliceStore } from './heatmap/sliceStore'
import { parseSlice } from './heatmap/SliceParser'

const SCHEMA_URL = '/api/schema/scenario'

export function ScenarioPanel() {
  const { schema, loading, error } = useSchema(SCHEMA_URL)
  const { control, watch, setValue, handleSubmit } = useForm<Record<string, unknown>>({
    defaultValues: {},
    mode: 'onBlur',
  })
  const { status, message, setSubmitting, setJobIds, setProgress, setDone, setError, setHeightRange } = useJobStore()

  const onSubmit = async (data: Record<string, unknown>) => {
    const heightRange = data.height_range as { min?: number; max?: number } | undefined
    const defaultHeight = heightRange?.min ?? 0
    setHeightRange(heightRange?.min ?? 0, heightRange?.max ?? 0, (data.height_step as number | undefined) ?? 10)
    setSubmitting()
    try {
      const res = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const { scenario_id, job_id } = await res.json()
      setJobIds(scenario_id, job_id)
      const es = new EventSource(`/api/scenarios/${scenario_id}/jobs/${job_id}/events`)
      es.addEventListener('progress', (e) => {
        const payload = JSON.parse((e as MessageEvent).data) as { message?: string; percent?: number }
        setProgress(payload.percent ?? 0, payload.message ?? '')
      })
      es.addEventListener('done', async (e) => {
        const { run_id } = JSON.parse((e as MessageEvent).data) as { run_id: string }
        setDone(run_id)
        es.close()
        try {
          const sliceRes = await fetch(
            `/api/scenarios/${scenario_id}/runs/${run_id}/slices/${defaultHeight}`,
          )
          if (sliceRes.ok) {
            const buffer = await sliceRes.arrayBuffer()
            useSliceStore.getState().setSlice(parseSlice(buffer))
          }
        } catch {
          // Slice fetch failure is non-fatal; heatmap simply won't appear.
        }
      })
      es.addEventListener('error', () => { setError('Job failed'); es.close() })
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        background: '#f5f5f5',
        borderRight: '1px solid #d0d0d0',
        boxSizing: 'border-box',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Scenario</h2>

      {status !== 'idle' && (
        <div role="status" aria-live="polite" style={{ fontSize: 13, color: '#555' }}>
          {status === 'submitting'
            ? 'Submitting…'
            : status === 'running'
              ? `Running… ${message}`
              : status === 'done'
                ? 'Done'
                : `Error: ${message}`}
        </div>
      )}

      {loading && (
        <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>Loading schema…</p>
      )}

      {error && (
        <p style={{ margin: 0, color: '#c00', fontSize: '13px' }}>
          Schema unavailable: {error.message}
        </p>
      )}

      {schema && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <SchemaFormRenderer schema={schema} control={control} watch={watch} />
          <EntityList control={control} watch={watch} setValue={setValue} />
          <button
            type="submit"
            disabled={status === 'submitting' || status === 'running'}
            style={{
              marginTop: 4,
              padding: '8px 0',
              background: '#1a6ef5',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              cursor: status === 'submitting' || status === 'running' ? 'not-allowed' : 'pointer',
            }}
          >
            Run Scenario
          </button>
        </form>
      )}
    </aside>
  )
}
