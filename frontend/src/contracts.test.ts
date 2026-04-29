import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const contractsDir = resolve(__dirname, '../../contracts')

function loadSchema(name: string) {
  return JSON.parse(readFileSync(resolve(contractsDir, name), 'utf-8'))
}

describe('JSON Schema contracts — ajv 8 resolution', () => {
  it('entity.schema.json uses JSON Schema draft-07', () => {
    const schema = loadSchema('entity.schema.json')
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
  })

  it('scenario.schema.json uses JSON Schema draft-07', () => {
    const schema = loadSchema('scenario.schema.json')
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
  })

  it('both schemas declare x- extension properties', () => {
    const entity = loadSchema('entity.schema.json')
    const scenario = loadSchema('scenario.schema.json')
    const entityXProps = Object.values(entity.properties as Record<string, Record<string, unknown>>).some(
      (p) => Object.keys(p).some((k) => k.startsWith('x-')),
    )
    const scenarioXProps = Object.values(scenario.properties as Record<string, Record<string, unknown>>).some(
      (p) => Object.keys(p).some((k) => k.startsWith('x-')),
    )
    expect(entityXProps).toBe(true)
    expect(scenarioXProps).toBe(true)
  })

  it('ajv 8 compiles entity schema without errors', () => {
    const ajv = new Ajv({ strict: false })
    const schema = loadSchema('entity.schema.json')
    expect(() => ajv.compile(schema)).not.toThrow()
  })

  it('ajv 8 compiles scenario schema without errors', () => {
    const ajv = new Ajv({ strict: false })
    const entitySchema = loadSchema('entity.schema.json')
    const scenarioSchema = loadSchema('scenario.schema.json')
    ajv.addSchema(entitySchema)
    expect(() => ajv.compile(scenarioSchema)).not.toThrow()
  })

  it('ajv 8 resolves $ref from scenario schema to entity schema', () => {
    const ajv = new Ajv({ strict: false })
    const entitySchema = loadSchema('entity.schema.json')
    const scenarioSchema = loadSchema('scenario.schema.json')
    ajv.addSchema(entitySchema)
    const validate = ajv.compile(scenarioSchema)
    expect(validate).toBeDefined()
  })

  it('valid entity passes entity schema validation', () => {
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(loadSchema('entity.schema.json'))
    const valid = {
      label: 'Alpha',
      position: { lat: 48.8566, lon: 2.3522 },
      frequency: 100,
      power: 20,
      azimuth: 90,
      antenna_height: 10,
      radius: 5,
    }
    expect(validate(valid)).toBe(true)
  })

  it('entity missing required field fails validation', () => {
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(loadSchema('entity.schema.json'))
    const invalid = {
      label: 'Alpha',
      position: { lat: 48.8566, lon: 2.3522 },
      frequency: 100,
      // power missing
      azimuth: 90,
      antenna_height: 10,
      radius: 5,
    }
    expect(validate(invalid)).toBe(false)
  })

  it('valid scenario with two entities passes validation', () => {
    const ajv = new Ajv({ strict: false })
    ajv.addSchema(loadSchema('entity.schema.json'))
    const validate = ajv.compile(loadSchema('scenario.schema.json'))
    const entity = {
      label: 'Alpha',
      position: { lat: 48.8566, lon: 2.3522 },
      frequency: 100,
      power: 20,
      azimuth: 90,
      antenna_height: 10,
      radius: 5,
    }
    const valid = {
      name: 'Test scenario',
      height_range: { min: 0, max: 100 },
      height_step: 10,
      angular_resolution: 0.1,
      grid_cell_size: 100,
      terrain_enabled: true,
      combination_method: 'max',
      entities: [entity, { ...entity, label: 'Beta' }],
    }
    expect(validate(valid)).toBe(true)
  })

  it('scenario with fewer than 2 entities fails validation', () => {
    const ajv = new Ajv({ strict: false })
    ajv.addSchema(loadSchema('entity.schema.json'))
    const validate = ajv.compile(loadSchema('scenario.schema.json'))
    const entity = {
      label: 'Alpha',
      position: { lat: 48.8566, lon: 2.3522 },
      frequency: 100,
      power: 20,
      azimuth: 90,
      antenna_height: 10,
      radius: 5,
    }
    const invalid = {
      name: 'Test scenario',
      height_range: { min: 0, max: 100 },
      height_step: 10,
      angular_resolution: 0.1,
      grid_cell_size: 100,
      terrain_enabled: true,
      combination_method: 'max',
      entities: [entity], // only 1, minItems: 2
    }
    expect(validate(invalid)).toBe(false)
  })
})
