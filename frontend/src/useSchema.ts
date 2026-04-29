import { useState, useEffect } from 'react'
import type { ShowIfCondition } from './evaluateShowIf'

export type JSONSchema = {
  type?: string | string[]
  title?: string
  description?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  enum?: unknown[]
  oneOf?: JSONSchema[]
  items?: JSONSchema
  minimum?: number
  maximum?: number
  default?: unknown
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  'x-unit'?: string
  'x-ui-component'?: string
  'x-show-if'?: ShowIfCondition
  [key: string]: unknown
}

export function useSchema(endpoint: string): {
  schema: JSONSchema | null
  loading: boolean
  error: Error | null
} {
  const [schema, setSchema] = useState<JSONSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(endpoint)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<JSONSchema>
      })
      .then(data => {
        if (!cancelled) {
          setSchema(data)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [endpoint])

  return { schema, loading, error }
}
