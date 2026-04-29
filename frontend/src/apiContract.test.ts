import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const apiMdPath = resolve(__dirname, '../../contracts/api.md')
const content = readFileSync(apiMdPath, 'utf-8')

describe('contracts/api.md', () => {
  it('exists and is non-empty', () => {
    expect(content.length).toBeGreaterThan(0)
  })

  describe('REST endpoints', () => {
    const endpoints = [
      'GET /api/schema/entity',
      'GET /api/schema/scenario',
      'POST /api/scenarios',
      'GET /api/scenarios/{scenario_id}/jobs/{job_id}/events',
      'GET /api/scenarios/{scenario_id}/runs/{run_id}/slices/{height_m}',
      'POST /api/scenarios/{scenario_id}/runs/{run_id}/save',
      'DELETE /api/scenarios/{scenario_id}/runs/{run_id}',
    ]

    for (const endpoint of endpoints) {
      it(`documents ${endpoint}`, () => {
        expect(content).toContain(endpoint)
      })
    }
  })

  describe('HTTP status codes', () => {
    const codes = ['200', '201', '204', '404', '409', '422']

    for (const code of codes) {
      it(`documents status code ${code}`, () => {
        expect(content).toContain(code)
      })
    }
  })

  describe('binary slice wire format', () => {
    it('specifies 56-byte header size', () => {
      expect(content).toContain('56')
    })

    it('specifies Float32Array data section', () => {
      expect(content).toMatch(/float32|Float32Array/i)
    })

    const fields = ['magic', 'version', 'width', 'height', 'min_val', 'max_val', 'west', 'south', 'east', 'north', 'reserved']

    for (const field of fields) {
      it(`specifies wire field '${field}'`, () => {
        expect(content).toContain(field)
      })
    }
  })
})
