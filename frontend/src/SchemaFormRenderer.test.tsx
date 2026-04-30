// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { SchemaFormRenderer } from './SchemaFormRenderer'
import type { JSONSchema } from './useSchema'

const fixtureSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    count: { type: 'number', title: 'Count' },
    active: { type: 'boolean', title: 'Active' },
    mode: { type: 'string', title: 'Mode', enum: ['simple', 'advanced'] },
    advancedOnly: {
      type: 'string',
      title: 'Advanced Only',
      'x-show-if': { field: 'mode', op: 'eq', value: 'advanced' },
    },
  },
}

function Wrapper({
  schema,
  defaultValues = { mode: 'simple', count: 0, active: false },
}: {
  schema: JSONSchema
  defaultValues?: Record<string, unknown>
}) {
  const { control, watch } = useForm({ defaultValues })
  return <SchemaFormRenderer schema={schema} control={control} watch={watch} />
}

afterEach(cleanup)

describe('SchemaFormRenderer', () => {
  it('renders a text input for a string field', () => {
    render(<Wrapper schema={fixtureSchema} />)
    expect(screen.getByText('Name')).toBeTruthy()
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBeGreaterThan(0)
  })

  it('renders a number input for a number field', () => {
    render(<Wrapper schema={fixtureSchema} />)
    expect(screen.getByText('Count')).toBeTruthy()
    const numberInputs = document.querySelectorAll('input[type="number"]')
    expect(numberInputs.length).toBeGreaterThan(0)
  })

  it('renders a checkbox for a boolean field', () => {
    render(<Wrapper schema={fixtureSchema} />)
    expect(screen.getByText('Active')).toBeTruthy()
    const checkbox = document.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
  })

  it('renders a select for an enum field', () => {
    render(<Wrapper schema={fixtureSchema} />)
    expect(screen.getByText('Mode')).toBeTruthy()
    const select = screen.getByRole('combobox')
    expect(select).toBeTruthy()
  })

  it('hides a field when x-show-if condition is false', () => {
    render(<Wrapper schema={fixtureSchema} defaultValues={{ mode: 'simple' }} />)
    expect(screen.queryByText('Advanced Only')).toBeNull()
  })

  it('shows a field when x-show-if condition is true', () => {
    render(<Wrapper schema={fixtureSchema} defaultValues={{ mode: 'advanced' }} />)
    expect(screen.getByText('Advanced Only')).toBeTruthy()
  })

  it('shows a conditional field after its controlling field value changes', () => {
    render(<Wrapper schema={fixtureSchema} defaultValues={{ mode: 'simple' }} />)
    expect(screen.queryByText('Advanced Only')).toBeNull()

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'advanced' } })

    expect(screen.getByText('Advanced Only')).toBeTruthy()
  })

  it('accepts schema and control as props without hardcoded field names', () => {
    const minimalSchema: JSONSchema = {
      type: 'object',
      properties: {
        customField: { type: 'string', title: 'Custom Field' },
      },
    }
    render(<Wrapper schema={minimalSchema} defaultValues={{}} />)
    expect(screen.getByText('Custom Field')).toBeTruthy()
  })
})
