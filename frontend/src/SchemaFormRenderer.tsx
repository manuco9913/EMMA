import { useState } from 'react'
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

function ErrorMsg({ message }: { message?: string }) {
  if (!message) return null
  return <span style={{ fontSize: 11, color: '#c00' }}>{message}</span>
}

function NumericOrFileField({
  fieldKey,
  title,
  unit,
  control,
}: {
  fieldKey: string
  title: string
  unit?: string
  control: AnyControl
}) {
  const [mode, setMode] = useState<'number' | 'file'>('number')
  return (
    <Field>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label text={title} unit={unit} />
        <button
          type="button"
          onClick={() => setMode(m => (m === 'number' ? 'file' : 'number'))}
          style={{
            fontSize: 10,
            padding: '2px 6px',
            border: '1px solid #bbb',
            borderRadius: 3,
            background: '#f0f0f0',
            cursor: 'pointer',
          }}
        >
          {mode === 'number' ? 'Use file' : 'Use value'}
        </button>
      </div>
      <Controller
        name={fieldKey}
        control={control}
        render={({ field }) =>
          mode === 'number' ? (
            <input
              type="number"
              style={input}
              step="any"
              value={typeof field.value === 'number' ? field.value : ''}
              onChange={e => field.onChange(e.target.valueAsNumber)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          ) : (
            <input
              type="text"
              placeholder="File path…"
              style={input}
              value={typeof field.value === 'string' ? field.value : ''}
              onChange={e => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )
        }
      />
    </Field>
  )
}

function CoordinateField({
  fieldKey,
  title,
  schema,
  control,
}: {
  fieldKey: string
  title: string
  schema: JSONSchema
  control: AnyControl
}) {
  const latSchema = schema.properties?.lat
  const lonSchema = schema.properties?.lon
  return (
    <Field>
      <Label text={title} />
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Label text="Lat" />
          <Controller
            name={`${fieldKey}.lat`}
            control={control}
            render={({ field }) => (
              <input
                type="number"
                placeholder="Latitude"
                style={input}
                min={latSchema?.minimum}
                max={latSchema?.maximum}
                step="any"
                value={field.value as number ?? ''}
                onChange={e => field.onChange(e.target.valueAsNumber)}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Label text="Lon" />
          <Controller
            name={`${fieldKey}.lon`}
            control={control}
            render={({ field }) => (
              <input
                type="number"
                placeholder="Longitude"
                style={input}
                min={lonSchema?.minimum}
                max={lonSchema?.maximum}
                step="any"
                value={field.value as number ?? ''}
                onChange={e => field.onChange(e.target.valueAsNumber)}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          />
        </div>
      </div>
    </Field>
  )
}

function numericRules(schema: JSONSchema) {
  return {
    validate: {
      isNumber: (v: unknown) => {
        if (typeof v !== 'number' || isNaN(v as number)) return 'Must be a number'
        return true
      },
      min: (v: unknown) => {
        if (schema.minimum !== undefined && typeof v === 'number' && v < schema.minimum)
          return `Minimum value is ${schema.minimum}`
        return true
      },
      max: (v: unknown) => {
        if (schema.maximum !== undefined && typeof v === 'number' && v > schema.maximum)
          return `Maximum value is ${schema.maximum}`
        return true
      },
    },
  }
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

  if (uiComponent === 'coordinate') {
    return (
      <CoordinateField key={fieldKey} fieldKey={fieldKey} title={title} schema={schema} control={control} />
    )
  }

  if (uiComponent === 'numeric-or-file') {
    return (
      <NumericOrFileField key={fieldKey} fieldKey={fieldKey} title={title} unit={unit} control={control} />
    )
  }

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
          rules={numericRules(schema)}
          render={({ field, fieldState }) => (
            <>
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
              <ErrorMsg message={fieldState.error?.message} />
            </>
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
