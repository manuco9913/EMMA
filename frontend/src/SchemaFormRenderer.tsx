import { Control, Controller, UseFormWatch } from 'react-hook-form'
import { evaluateShowIf } from './evaluateShowIf'
import type { JSONSchema } from './useSchema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyControl = Control<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWatch = UseFormWatch<any>

export type SchemaFormRendererProps = {
  schema: JSONSchema
  control: AnyControl
  watch: AnyWatch
  prefix?: string
}

const input: React.CSSProperties = {
  padding: '5px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 13,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
}

function Label({ text, unit }: { text: string; unit?: string }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 500, color: '#555' }}>
      {text}
      {unit && <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>{unit}</span>}
    </label>
  )
}

function Field({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</div>
}

function renderField(
  key: string,
  fieldKey: string,
  schema: JSONSchema,
  control: AnyControl,
): React.ReactNode {
  const unit = schema['x-unit']
  const uiComponent = schema['x-ui-component']
  const title = schema.title ?? key

  if (uiComponent === 'range') {
    return (
      <Field key={fieldKey}>
        <Label text={title} unit={unit} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Controller
            name={`${fieldKey}.min`}
            control={control}
            render={({ field }) => (
              <input
                type="number"
                placeholder="Min"
                style={{ ...input, flex: 1 }}
                value={field.value as number ?? ''}
                onChange={e => field.onChange(e.target.valueAsNumber)}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          />
          <Controller
            name={`${fieldKey}.max`}
            control={control}
            render={({ field }) => (
              <input
                type="number"
                placeholder="Max"
                style={{ ...input, flex: 1 }}
                value={field.value as number ?? ''}
                onChange={e => field.onChange(e.target.valueAsNumber)}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          />
        </div>
      </Field>
    )
  }

  if (schema.type === 'boolean') {
    return (
      <Field key={fieldKey}>
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={e => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
              {title}
            </label>
          )}
        />
      </Field>
    )
  }

  if (schema.type === 'string' && schema.enum) {
    return (
      <Field key={fieldKey}>
        <Label text={title} />
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <select
              style={input}
              value={String(field.value ?? '')}
              onChange={e => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            >
              {schema.enum!.map(opt => (
                <option key={String(opt)} value={String(opt)}>
                  {String(opt)}
                </option>
              ))}
            </select>
          )}
        />
      </Field>
    )
  }

  if (schema.type === 'number') {
    return (
      <Field key={fieldKey}>
        <Label text={title} unit={unit} />
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <input
              type="number"
              style={input}
              min={schema.minimum}
              max={schema.maximum}
              step="any"
              value={field.value as number ?? ''}
              onChange={e => field.onChange(e.target.valueAsNumber)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        />
      </Field>
    )
  }

  if (schema.type === 'string') {
    return (
      <Field key={fieldKey}>
        <Label text={title} />
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <input
              type="text"
              style={input}
              value={String(field.value ?? '')}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        />
      </Field>
    )
  }

  return null
}

export function SchemaFormRenderer({
  schema,
  control,
  watch,
  prefix = '',
}: SchemaFormRendererProps) {
  const allValues = watch() as Record<string, unknown>

  if (!schema.properties) return null

  return (
    <>
      {Object.entries(schema.properties)
        .filter(([, fieldSchema]) => fieldSchema.type !== 'array')
        .map(([key, fieldSchema]) => {
          const fieldKey = prefix ? `${prefix}.${key}` : key
          const showIf = fieldSchema['x-show-if']

          if (showIf && !evaluateShowIf(showIf, allValues)) return null

          return renderField(key, fieldKey, fieldSchema, control)
        })}
    </>
  )
}
