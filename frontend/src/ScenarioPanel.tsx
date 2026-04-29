import { useForm } from 'react-hook-form'
import { useSchema } from './useSchema'
import { SchemaFormRenderer } from './SchemaFormRenderer'
import { EntityList } from './EntityList'

const SCHEMA_URL = '/api/schema/scenario'

export function ScenarioPanel() {
  const { schema, loading, error } = useSchema(SCHEMA_URL)
  const { control, watch, handleSubmit } = useForm<Record<string, unknown>>({
    defaultValues: {},
  })

  const onSubmit = (data: Record<string, unknown>) => {
    console.log('scenario submit', data)
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
          <EntityList control={control} watch={watch} />
          <button
            type="submit"
            style={{
              marginTop: 4,
              padding: '8px 0',
              background: '#1a6ef5',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Run Scenario
          </button>
        </form>
      )}
    </aside>
  )
}
