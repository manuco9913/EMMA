import { describe, it, expect } from 'vitest'
import { evaluateShowIf } from './evaluateShowIf'

describe('evaluateShowIf', () => {
  it('eq: true when field equals value', () => {
    expect(evaluateShowIf({ field: 'type', op: 'eq', value: 'a' }, { type: 'a' })).toBe(true)
  })

  it('eq: false when field differs', () => {
    expect(evaluateShowIf({ field: 'type', op: 'eq', value: 'a' }, { type: 'b' })).toBe(false)
  })

  it('neq: true when field differs', () => {
    expect(evaluateShowIf({ field: 'x', op: 'neq', value: 1 }, { x: 2 })).toBe(true)
  })

  it('neq: false when field equals value', () => {
    expect(evaluateShowIf({ field: 'x', op: 'neq', value: 1 }, { x: 1 })).toBe(false)
  })

  it('gt: true when field > value', () => {
    expect(evaluateShowIf({ field: 'n', op: 'gt', value: 5 }, { n: 10 })).toBe(true)
  })

  it('gt: false when field <= value', () => {
    expect(evaluateShowIf({ field: 'n', op: 'gt', value: 5 }, { n: 5 })).toBe(false)
  })

  it('gte: true when field equals value', () => {
    expect(evaluateShowIf({ field: 'n', op: 'gte', value: 5 }, { n: 5 })).toBe(true)
  })

  it('lt: true when field < value', () => {
    expect(evaluateShowIf({ field: 'n', op: 'lt', value: 5 }, { n: 3 })).toBe(true)
  })

  it('lte: true when field equals value', () => {
    expect(evaluateShowIf({ field: 'n', op: 'lte', value: 5 }, { n: 5 })).toBe(true)
  })

  it('missing field returns false', () => {
    expect(evaluateShowIf({ field: 'missing', op: 'eq', value: 'x' }, {})).toBe(false)
  })

  it('missing field returns false even for neq', () => {
    expect(evaluateShowIf({ field: 'missing', op: 'neq', value: 'x' }, {})).toBe(false)
  })

  it('nested field path resolved via dot notation', () => {
    expect(evaluateShowIf({ field: 'a.b', op: 'eq', value: 5 }, { a: { b: 5 } })).toBe(true)
  })

  it('nested path returns false when intermediate is missing', () => {
    expect(evaluateShowIf({ field: 'a.b.c', op: 'eq', value: 1 }, { a: {} })).toBe(false)
  })

  it('and: true when root and all conditions pass', () => {
    expect(
      evaluateShowIf(
        { field: 'a', op: 'eq', value: 1, and: [{ field: 'b', op: 'eq', value: 2 }] },
        { a: 1, b: 2 },
      ),
    ).toBe(true)
  })

  it('and: false when one and-condition fails', () => {
    expect(
      evaluateShowIf(
        { field: 'a', op: 'eq', value: 1, and: [{ field: 'b', op: 'eq', value: 2 }] },
        { a: 1, b: 3 },
      ),
    ).toBe(false)
  })

  it('or: true when root fails but or-condition passes', () => {
    expect(
      evaluateShowIf(
        { field: 'a', op: 'eq', value: 1, or: [{ field: 'b', op: 'eq', value: 2 }] },
        { a: 0, b: 2 },
      ),
    ).toBe(true)
  })

  it('or: false when root and all or-conditions fail', () => {
    expect(
      evaluateShowIf(
        { field: 'a', op: 'eq', value: 1, or: [{ field: 'b', op: 'eq', value: 2 }] },
        { a: 0, b: 99 },
      ),
    ).toBe(false)
  })
})
