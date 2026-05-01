// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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

  it('hides a conditional field when controlling value changes back to non-triggering value', () => {
    render(<Wrapper schema={fixtureSchema} defaultValues={{ mode: 'advanced' }} />)
    expect(screen.getByText('Advanced Only')).toBeTruthy()

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'simple' } })

    expect(screen.queryByText('Advanced Only')).toBeNull()
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

describe('FileField', () => {
  it('renders a text input for x-ui-component: file', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        dataFile: { type: 'string', title: 'Data File', 'x-ui-component': 'file' },
      },
    }
    render(<Wrapper schema={schema} defaultValues={{}} />)
    expect(screen.getByText('Data File')).toBeTruthy()
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBeGreaterThan(0)
  })

  it('accepts a file path string value', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        dataFile: { type: 'string', title: 'Data File', 'x-ui-component': 'file' },
      },
    }
    render(<Wrapper schema={schema} defaultValues={{ dataFile: '/data/terrain.tif' }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('/data/terrain.tif')
  })
})

describe('MatrixField', () => {
  it('renders a grid of number inputs for x-ui-component: matrix', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        gain: {
          type: 'array',
          title: 'Gain Pattern',
          'x-ui-component': 'matrix',
          'x-rows': 2,
          'x-cols': 3,
        } as JSONSchema,
      },
    }
    render(<Wrapper schema={schema} defaultValues={{}} />)
    expect(screen.getByText('Gain Pattern')).toBeTruthy()
    const inputs = document.querySelectorAll('input[type="number"]')
    expect(inputs.length).toBe(6)
  })

  it('defaults to 2×2 when x-rows and x-cols are omitted', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        mat: {
          type: 'array',
          title: 'Matrix',
          'x-ui-component': 'matrix',
        } as JSONSchema,
      },
    }
    render(<Wrapper schema={schema} defaultValues={{}} />)
    const inputs = document.querySelectorAll('input[type="number"]')
    expect(inputs.length).toBe(4)
  })
})

const numericSchema: JSONSchema = {
  type: 'object',
  properties: {
    count: { type: 'number', title: 'Count', minimum: 0, maximum: 100 },
  },
}

function ValidationWrapper({
  schema,
  defaultValues = {},
  onSubmit: externalSubmit,
}: {
  schema: JSONSchema
  defaultValues?: Record<string, unknown>
  onSubmit?: () => void
}) {
  const { control, watch, handleSubmit } = useForm({
    defaultValues,
    mode: 'onBlur',
  })
  return (
    <form onSubmit={handleSubmit(externalSubmit ?? (() => {}))}>
      <SchemaFormRenderer schema={schema} control={control} watch={watch} />
      <button type="submit">Submit</button>
    </form>
  )
}

describe('validation', () => {
  it('shows "Must be a number" on blur when number field is empty', async () => {
    render(<ValidationWrapper schema={numericSchema} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.getByText('Must be a number')).toBeTruthy()
    })
  })

  it('clears error when valid value is entered after invalid blur', async () => {
    render(<ValidationWrapper schema={numericSchema} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText('Must be a number')).toBeTruthy())

    fireEvent.change(input, { target: { valueAsNumber: 50 } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.queryByText('Must be a number')).toBeNull())
  })

  it('shows minimum constraint error when value is below minimum', async () => {
    render(<ValidationWrapper schema={numericSchema} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { valueAsNumber: -5 } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.getByText('Minimum value is 0')).toBeTruthy()
    })
  })

  it('shows maximum constraint error when value is above maximum', async () => {
    render(<ValidationWrapper schema={numericSchema} />)
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { valueAsNumber: 150 } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.getByText('Maximum value is 100')).toBeTruthy()
    })
  })

  it('blocks submission and shows errors when number field is invalid', async () => {
    const mockSubmit = vi.fn()
    render(<ValidationWrapper schema={numericSchema} onSubmit={mockSubmit} />)
    const submitBtn = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(screen.getByText('Must be a number')).toBeTruthy()
    })
    expect(mockSubmit).not.toHaveBeenCalled()
  })
})
