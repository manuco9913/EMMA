const MAGIC = [0x57, 0x50, 0x53, 0x31] // "WPS1"
const HEADER_BYTES = 56

export class SliceParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SliceParseError'
  }
}

export interface SliceBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface SliceResult {
  width: number
  height: number
  minVal: number
  maxVal: number
  bounds: SliceBounds
  data: Float32Array
}

export function parseSlice(buffer: ArrayBuffer): SliceResult {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new SliceParseError(
      `Buffer too small: ${buffer.byteLength} bytes, need at least ${HEADER_BYTES}`,
    )
  }

  const view = new DataView(buffer)

  for (let i = 0; i < 4; i++) {
    if (view.getUint8(i) !== MAGIC[i]) {
      throw new SliceParseError('Invalid magic bytes')
    }
  }

  const width = view.getUint32(6, true)
  const height = view.getUint32(10, true)

  if (width === 0 || height === 0) {
    throw new SliceParseError(`Zero-size grid: ${width}×${height}`)
  }

  const expectedTotal = HEADER_BYTES + width * height * 4
  if (buffer.byteLength < expectedTotal) {
    throw new SliceParseError(
      `Buffer truncated: expected ${expectedTotal} bytes, got ${buffer.byteLength}`,
    )
  }

  const minVal = view.getFloat32(14, true)
  const maxVal = view.getFloat32(18, true)
  const west = view.getFloat64(22, true)
  const south = view.getFloat64(30, true)
  const east = view.getFloat64(38, true)
  const north = view.getFloat64(46, true)

  const data = new Float32Array(buffer, HEADER_BYTES, width * height)

  return { width, height, minVal, maxVal, bounds: { west, south, east, north }, data }
}
