import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl'
import type { SliceResult } from './SliceParser'

// GLSL ES 3.0 vertex shader.
// a_pos: mercator [0,1] coordinates for the quad corners.
// u_matrix: maplibre projection matrix (mercator → clip space).
const VS = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_uv;
uniform mat4 u_matrix;
out vec2 v_uv;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`

// Fragment shader: samples R32F texture, applies NaN-transparent + black→yellow ramp.
// isnan() is available in GLSL ES 3.00 (WebGL2).
const FS = `#version 300 es
precision highp float;
uniform sampler2D u_heatmap;
uniform float u_min;
uniform float u_max;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  float v = texture(u_heatmap, v_uv).r;
  if (isnan(v)) {
    fragColor = vec4(0.0);
    return;
  }
  float t = clamp((v - u_min) / (u_max - u_min), 0.0, 1.0);
  fragColor = vec4(t, t, 0.0, 0.8);
}`

// Standard Web Mercator formulas matching maplibre-gl MercatorCoordinate.
// Output is in [0,1] range; the maplibre matrix encodes the rest of the transform.
function lngToMercX(lng: number): number {
  return (lng + 180) / 360
}

function latToMercY(lat: number): number {
  return (
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  )
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(sh)}`)
  }
  return sh
}

export class HeatmapCustomLayer implements CustomLayerInterface {
  readonly id = 'propagation-heatmap'
  readonly type = 'custom' as const
  readonly renderingMode = '2d' as const

  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vbo: WebGLBuffer | null = null
  private texture: WebGLTexture | null = null
  private sliceResult: SliceResult | null = null
  private dirty = false

  private uMatrix: WebGLUniformLocation | null = null
  private uHeatmap: WebGLUniformLocation | null = null
  private uMin: WebGLUniformLocation | null = null
  private uMax: WebGLUniformLocation | null = null

  onAdd(_map: Map, rawGl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const gl = rawGl as WebGL2RenderingContext
    this.gl = gl
    // Enable linear filtering on float textures if the extension is available.
    gl.getExtension('OES_texture_float_linear')

    const vs = compileShader(gl, gl.VERTEX_SHADER, VS)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS)

    this.program = gl.createProgram()!
    gl.attachShader(this.program, vs)
    gl.attachShader(this.program, fs)
    gl.linkProgram(this.program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(this.program)}`)
    }

    this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix')
    this.uHeatmap = gl.getUniformLocation(this.program, 'u_heatmap')
    this.uMin = gl.getUniformLocation(this.program, 'u_min')
    this.uMax = gl.getUniformLocation(this.program, 'u_max')

    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    this.texture = gl.createTexture()!

    // Upload pending data if setData was called before the map loaded.
    if (this.sliceResult) {
      this._upload(gl)
    }
  }

  onRemove(_map: Map, rawGl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const gl = rawGl as WebGL2RenderingContext
    if (this.program) gl.deleteProgram(this.program)
    if (this.vao) gl.deleteVertexArray(this.vao)
    if (this.vbo) gl.deleteBuffer(this.vbo)
    if (this.texture) gl.deleteTexture(this.texture)
    this.gl = null
    this.program = null
    this.vao = null
    this.vbo = null
    this.texture = null
  }

  // Replace the current heatmap data without re-mounting the layer.
  setData(result: SliceResult): void {
    this.sliceResult = result
    this.dirty = true
    if (this.gl) this._upload(this.gl)
  }

  private _upload(gl: WebGL2RenderingContext): void {
    const result = this.sliceResult!
    const { west, south, east, north } = result.bounds
    const BYTES = Float32Array.BYTES_PER_ELEMENT

    // Upload Float32Array directly as an R32F texture (GPU-only colour ramp, no CPU conversion).
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F,
      result.width, result.height, 0,
      gl.RED, gl.FLOAT, result.data,
    )
    gl.bindTexture(gl.TEXTURE_2D, null)

    // Build a fullscreen quad at the slice bounds.
    // Mercator Y: north → smaller value (top), south → larger value (bottom).
    // Texture UV (0,0) = northwest corner (row 0 of the data = northernmost row).
    const x0 = lngToMercX(west)
    const x1 = lngToMercX(east)
    const y0 = latToMercY(north)
    const y1 = latToMercY(south)

    // Triangle strip: NW, NE, SW, SE — each vertex: [mercX, mercY, u, v]
    const verts = new Float32Array([
      x0, y0, 0, 0,
      x1, y0, 1, 0,
      x0, y1, 0, 1,
      x1, y1, 1, 1,
    ])

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)

    const stride = 4 * BYTES // 4 floats per vertex
    const aPosLoc = gl.getAttribLocation(this.program!, 'a_pos')
    const aUvLoc = gl.getAttribLocation(this.program!, 'a_uv')
    gl.enableVertexAttribArray(aPosLoc)
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(aUvLoc)
    gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, stride, 2 * BYTES)
    gl.bindVertexArray(null)

    this.dirty = false
  }

  render(rawGl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const gl = rawGl as WebGL2RenderingContext
    const matrix = options.modelViewProjectionMatrix as unknown as number[]
    if (!this.sliceResult || !this.program || !this.vao) return
    if (this.dirty) this._upload(gl)

    const result = this.sliceResult

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uMatrix, false, matrix)
    gl.uniform1i(this.uHeatmap, 0)
    gl.uniform1f(this.uMin, result.minVal)
    gl.uniform1f(this.uMax, result.maxVal)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)

    gl.disable(gl.BLEND)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }
}
