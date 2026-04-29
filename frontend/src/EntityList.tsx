import { useState, useEffect } from 'react'
import { useFieldArray, useWatch, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { Control } from 'react-hook-form'
import { useSchema } from './useSchema'
import { SchemaFormRenderer } from './SchemaFormRenderer'
import { useMapStore } from './mapStore'
import type { MarkerPosition } from './mapStore'

const ENTITY_SCHEMA_URL = '/api/schema/entity'
const MIN_ENTITIES = 2
const MAX_ENTITIES = 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyControl = Control<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySetValue = UseFormSetValue<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWatch = UseFormWatch<any>

export type EntityListProps = {
  control: AnyControl
  watch: AnyWatch
  setValue: AnySetValue
}

type EntityValue = {
  position?: { lat?: number; lon?: number }
  [key: string]: unknown
}

export function EntityList({ control, watch, setValue }: EntityListProps) {
  const { schema, loading, error } = useSchema(ENTITY_SCHEMA_URL)
  const { fields, append, remove } = useFieldArray({ control, name: 'entities' })
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const { setActiveEntityIndex, setEntityPositions, registerApplyPosition } = useMapStore()
  const activeEntityIndex = useMapStore(s => s.activeEntityIndex)

  // Register the callback that lets the map update form position fields
  useEffect(() => {
    const applyPosition = (index: number, pos: MarkerPosition) => {
      setValue(`entities.${index}.position`, { lat: pos.lat, lon: pos.lon })
    }
    registerApplyPosition(applyPosition)
    return () => registerApplyPosition(null)
  }, [setValue, registerApplyPosition])

  // Watch entity positions and sync to map store
  const entities = useWatch({ control, name: 'entities' }) as EntityValue[] | undefined
  useEffect(() => {
    const positions = (entities ?? []).map(e =>
      typeof e?.position?.lat === 'number' && typeof e?.position?.lon === 'number'
        ? { lat: e.position.lat, lon: e.position.lon }
        : null
    )
    setEntityPositions(positions)
  }, [entities, setEntityPositions])

  const toggleExpanded = (index: number) => {
    const isCurrentlyExpanded = expanded.has(index)
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
    if (isCurrentlyExpanded) {
      if (useMapStore.getState().activeEntityIndex === index) {
        setActiveEntityIndex(null)
      }
    } else {
      setActiveEntityIndex(index)
    }
  }

  const addEntity = () => {
    if (fields.length >= MAX_ENTITIES) return
    const newIndex = fields.length
    append({})
    setExpanded(prev => {
      const next = new Set(prev)
      next.add(newIndex)
      return next
    })
    setActiveEntityIndex(newIndex)
  }

  const removeEntity = (index: number) => {
    remove(index)
    setExpanded(prev => {
      const next = new Set<number>()
      prev.forEach(i => {
        if (i < index) next.add(i)
        else if (i > index) next.add(i - 1)
      })
      return next
    })
    const current = useMapStore.getState().activeEntityIndex
    if (current === index) setActiveEntityIndex(null)
    else if (current !== null && current > index) setActiveEntityIndex(current - 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Entities ({fields.length}/{MAX_ENTITIES})
        </span>
        <button
          type="button"
          onClick={addEntity}
          disabled={fields.length >= MAX_ENTITIES}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            background: fields.length >= MAX_ENTITIES ? '#ccc' : '#1a6ef5',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: fields.length >= MAX_ENTITIES ? 'not-allowed' : 'pointer',
          }}
        >
          + Add Entity
        </button>
      </div>

      {loading && (
        <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Loading entity schema…</p>
      )}
      {error && (
        <p style={{ fontSize: 12, color: '#c00', margin: 0 }}>Entity schema unavailable</p>
      )}

      {fields.map((field, index) => {
        const isActive = activeEntityIndex === index
        return (
          <div
            key={field.id}
            style={{
              border: `1px solid ${isActive ? '#1a6ef5' : '#d0d0d0'}`,
              borderRadius: 6,
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                cursor: 'pointer',
                background: isActive ? '#e8f0fe' : '#eaeaea',
                userSelect: 'none',
              }}
              onClick={() => toggleExpanded(index)}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Entity {index + 1}
                {isActive && (
                  <span style={{ fontSize: 10, color: '#1a6ef5', marginLeft: 6 }}>
                    ← click map to place
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    removeEntity(index)
                  }}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    background: '#e33',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
                <span style={{ fontSize: 11, color: '#666' }}>
                  {expanded.has(index) ? '▲' : '▼'}
                </span>
              </div>
            </div>
            {expanded.has(index) && schema && (
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SchemaFormRenderer
                  schema={schema}
                  control={control}
                  watch={watch}
                  prefix={`entities.${index}`}
                />
              </div>
            )}
          </div>
        )
      })}

      {fields.length > 0 && fields.length < MIN_ENTITIES && (
        <p style={{ fontSize: 12, color: '#c66', margin: 0 }}>
          At least {MIN_ENTITIES} entities required to run.
        </p>
      )}
    </div>
  )
}
