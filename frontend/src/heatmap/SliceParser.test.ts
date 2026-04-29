import { describe, it, expect } from 'vitest'
import { parseSlice, SliceParseError } from './SliceParser'

interface BuildOpts {
  magic?: number[]
  version?: number
  minVal?: number
  maxVal?: number
  west?: number
  south?: number
  east?: number
  north?: number
}

function buildBuffer(
  width: number,
  height: number,
  dataValues: number[],
  opts: BuildOpts = {},
): ArrayBuffer {
  const magic = opts.magic ?? [0x57, 0x50, 0x53, 0x31]
  const version = opts.version ?? 1
  const headerBytes = 56
  const dataBytes = width * height * 4
  const buf = new ArrayBuffer(headerBytes + dataBytes)
  const view = new DataView(buf)

  for (let i = 0; i < 4; i++) view.setUint8(i, magic[i] ?? 0)
  view.setUint16(4, version, true)
  view.setUint32(6, width, true)
  view.setUint32(10, height, true)
  view.setFloat32(14, opts.minVal ?? 0, true)
  view.setFloat32(18, opts.maxVal ?? 100, true)
  view.setFloat64(22, opts.west ?? -10, true)
  view.setFloat64(30, opts.south ?? 50, true)
  view.setFloat64(38, opts.east ?? 10, true)
  view.setFloat64(46, opts.north ?? 60, true)

  const floats = new Float32Array(buf, headerBytes, width * height)
  dataValues.forEach((v, i) => { floats[i] = v })

  return buf
}

describe('parseSlice', () => {
  it('parses a valid fixture correctly', () => {
    const buf = buildBuffer(2, 3, [1, 2, 3, 4, 5, 6], {
      minVal: -90,
      maxVal: 10,
      west: -10.5,
      south: 48.2,
      east: 10.5,
      north: 58.8,
    })
    const result = parseSlice(buf)
    expect(result.width).toBe(2)
    expect(result.height).toBe(3)
    expect(result.data[0]).toBeCloseTo(1)
    expect(result.data[5]).toBeCloseTo(6)
    expect(result.minVal).toBeCloseTo(-90, 1)
    expect(result.maxVal).toBeCloseTo(10, 1)
    expect(result.bounds.west).toBeCloseTo(-10.5)
    expect(result.bounds.south).toBeCloseTo(48.2)
    expect(result.bounds.east).toBeCloseTo(10.5)
    expect(result.bounds.north).toBeCloseTo(58.8)
  })

  it('throws SliceParseError for wrong magic bytes', () => {
    const buf = buildBuffer(1, 1, [0], { magic: [0x00, 0x00, 0x00, 0x00] })
    expect(() => parseSlice(buf)).toThrow(SliceParseError)
    expect(() => parseSlice(buf)).toThrow(/magic/i)
  })

  it('throws SliceParseError for a truncated buffer', () => {
    // Declare 2×2 grid (needs 56 + 16 = 72 bytes) but only supply 60 bytes
    const full = buildBuffer(2, 2, [1, 2, 3, 4])
    const truncated = full.slice(0, 60)
    expect(() => parseSlice(truncated)).toThrow(SliceParseError)
    expect(() => parseSlice(truncated)).toThrow(/truncated/i)
  })

  it('throws SliceParseError for a zero-size grid', () => {
    const buf = buildBuffer(0, 1, [])
    expect(() => parseSlice(buf)).toThrow(SliceParseError)
    expect(() => parseSlice(buf)).toThrow(/zero.size/i)
  })

  it('preserves NaN cells in the data array', () => {
    const buf = buildBuffer(2, 1, [1, NaN])
    const result = parseSlice(buf)
    expect(result.data[0]).toBeCloseTo(1)
    expect(Number.isNaN(result.data[1])).toBe(true)
  })

  it('throws SliceParseError when the buffer is too small for the header', () => {
    const tiny = new ArrayBuffer(20)
    expect(() => parseSlice(tiny)).toThrow(SliceParseError)
    expect(() => parseSlice(tiny)).toThrow(/small|too small/i)
  })
})
