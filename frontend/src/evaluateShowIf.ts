export type ShowIfOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'

export type ShowIfCondition = {
  field: string
  op: ShowIfOp
  value: unknown
  and?: ShowIfCondition[]
  or?: ShowIfCondition[]
}

function resolve(field: string, values: Record<string, unknown>): unknown {
  return field.split('.').reduce<unknown>((obj, key) => {
    if (obj != null && typeof obj === 'object') {
      return (obj as Record<string, unknown>)[key]
    }
    return undefined
  }, values)
}

export function evaluateShowIf(
  condition: ShowIfCondition,
  values: Record<string, unknown>,
): boolean {
  const v = resolve(condition.field, values)
  if (v === undefined) return false

  let result: boolean
  switch (condition.op) {
    case 'eq':  result = v === condition.value; break
    case 'neq': result = v !== condition.value; break
    case 'gt':  result = (v as number) > (condition.value as number); break
    case 'gte': result = (v as number) >= (condition.value as number); break
    case 'lt':  result = (v as number) < (condition.value as number); break
    case 'lte': result = (v as number) <= (condition.value as number); break
  }

  if (condition.and) result = result && condition.and.every(c => evaluateShowIf(c, values))
  if (condition.or)  result = result || condition.or.some(c => evaluateShowIf(c, values))

  return result
}
