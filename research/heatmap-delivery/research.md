# Research: Heatmap Slice Delivery to Frontend

## Overview

The system must deliver a single height-level slice (~4000×4000 Float32 cells,
~64 MB raw) from a Python/FastAPI or C#/ASP.NET Core backend to a React
frontend running MapLibre GL JS + Deck.gl, then render it as a geographic
heatmap overlay. The user expects a new slice within 1–3 seconds when scrubbing
the height slider. The system must work fully offline.

Three independent axes to solve:
1. **Transfer format** — how the slice leaves the backend
2. **Rendering approach** — how the frontend turns it into pixels
3. **Georeferencing** — how the Cartesian grid maps to geographic coordinates

---

## Option 1: Raw Binary HTTP Response

The backend serializes the 2D slice as a flat array of IEEE 754 32-bit floats
(row-major) and returns it as `application/octet-stream`. The frontend reads it
as an `ArrayBuffer` and wraps it in `Float32Array` — zero copy, no parsing overhead.

```typescript
const response = await fetch('/api/slice?height=500');
const buffer = await response.arrayBuffer();
const floats = new Float32Array(buffer); // 16M elements, zero copy
```

Metadata (bounding box, grid dimensions, value range) delivered as custom HTTP
response headers (`X-Grid-Width`, `X-Bbox-West`, etc.) to avoid JSON parsing overhead.

**Endianness**: `Float32Array` uses native host byte order. All x86/ARM is
little-endian. `numpy.ndarray.tobytes()` and .NET's `BinaryWriter` both write
little-endian — no conversion needed.

**Estimated transfer time:**

| Link | 64 MB raw | ~20 MB compressed |
|------|-----------|-------------------|
| Gigabit LAN | ~0.5 s | ~0.2 s |
| 100 Mbit LAN | ~5 s | ~1.6 s |
| localhost | <0.1 s | <0.1 s |

**Advantages:** Minimal backend complexity, zero parsing overhead, no
dependencies, fully offline, works with any HTTP stack.

**Disadvantages:** Full 64 MB must be fetched per step. Peak RAM on frontend:
Float32Array (64 MB) + RGBA canvas image (64 MB) + WebGL texture (64 MB)
≈ 192 MB. No progressive display — map updates only after full download.

---

## Option 2: Server-Side XYZ Tile Generation

The backend pre-renders the slice into a standard XYZ tile pyramid of 256×256
PNG images at one or more zoom levels. MapLibre consumes these natively.

```
GET /tiles/{z}/{x}/{y}.png?height=500  →  256×256 RGBA PNG (colorized heatmap)
```

**Tile count for ~40 km × 40 km at 100 m resolution:**

| Zoom | m/px | Tiles | Est. PNG size |
|------|------|-------|---------------|
| 10 | ~150 | ~9 | ~500 KB |
| 11 | ~75 | ~36 | ~2 MB |
| 12 | ~38 | ~144 | ~8 MB |
| 13 | ~19 | ~576 | ~32 MB |

**Backend implementation:** Python with `rio-tiler` can serve on-demand XYZ
tiles from a numpy array in ~10–50 ms per tile. C#/.NET has no equivalent —
requires GDAL bindings or manual clipping with `ImageSharp`.

**MapLibre integration:**
```typescript
map.addSource('heatmap', {
  type: 'raster',
  tiles: [`http://localhost:8000/tiles/{z}/{x}/{y}.png?height=${height}`],
  tileSize: 256,
});
// On slider change:
(map.getSource('heatmap') as RasterTileSource).setTiles([`...?height=${newHeight}`]);
```

**Advantages:** Native MapLibre integration, browser tile cache, only visible
tiles fetched, PNG naturally compressed, color mapping server-side.

**Disadvantages:** Color ramp baked into PNGs — changing thresholds requires
re-fetching all tiles. Significant backend complexity, especially in C#.

---

## Option 3: Progressive Streaming

The backend uses HTTP chunked transfer encoding to stream the Float32 slice
in sequential chunks. The frontend begins accumulating before the full response
completes.

```python
# FastAPI
def slice_generator(height_level: int):
    data = load_slice_from_hdf5(height_level)  # (4000, 4000) float32
    for i in range(0, 4000, 500):  # 500-row chunks = ~8 MB each
        yield data[i:i+500].tobytes()

@app.get("/api/slice/stream")
async def stream_slice(height: int):
    return StreamingResponse(slice_generator(height), media_type="application/octet-stream")
```

**Advantages:** Memory-efficient backend (reads HDF5 in chunks), enables
download progress indicator.

**Disadvantages:** Does not reduce total transfer size. Reassembly still holds
full payload in memory client-side. Progressive partial rendering adds
complexity not justified by the 1–3 s latency budget.

**Verdict:** Worth implementing for backend memory efficiency and progress
indicator, but true progressive rendering is not recommended for Phase 1.

---

## Option 4: Cloud-Optimized GeoTIFF (COG)

A COG is a GeoTIFF structured so that tiles appear at predictable byte offsets.
Clients use HTTP Range requests to read only the tiles needed at the current
zoom level without downloading the full file.

**geotiff.js** is a pure-JavaScript library that reads COGs in the browser.

```typescript
import { fromBlob } from 'geotiff';

// Offline (no range requests needed — full file):
const blob = await fetch('/api/slice?height=500&format=cog').then(r => r.blob());
const tiff = await fromBlob(blob);
const image = await tiff.getImage();
const data = await image.readRasters({ window: [x0, y0, x1, y1] });
// data[0] is a Float32Array of the requested window
```

COG's primary advantage — partial reads at multiple zoom levels — only pays
off if the frontend needs multi-scale display without re-fetching. For "fetch
whole slice, render at one zoom level," raw binary is simpler.

| Aspect | Raw Binary | COG |
|--------|-----------|-----|
| Backend complexity | Very low | Medium |
| Frontend complexity | Low–Medium | Medium (geotiff.js ~180 KB gz) |
| Partial reads | No | Yes |
| Float32 support | Native | Yes |
| Color ramp control | Client-side | Client-side |

---

## WebGL Rendering Approach

### Core Pipeline

1. Receive `Float32Array` of 4000×4000 values
2. Upload to GPU as a WebGL float texture
3. In GLSL fragment shader, map float value to RGBA using a color ramp
4. Draw a textured quad stretched over the geographic bounding box

**WebGL texture size limit:** The WebGL spec guarantees at least 2048. Modern
desktop GPUs universally support 8192 or 16384. A 4000×4000 texture is safe
on all plausible deployment hardware. Verify at runtime:
```javascript
gl.getParameter(gl.MAX_TEXTURE_SIZE)
```

**Uploading Float32 to WebGL texture (WebGL 2):**
```javascript
gl.texImage2D(
  gl.TEXTURE_2D, 0,
  gl.R32F,          // single-channel 32-bit float
  4000, 4000, 0,
  gl.RED, gl.FLOAT,
  floatArray        // Float32Array
);
// GPU VRAM cost: 4000 × 4000 × 4 bytes = 64 MB
```

**GLSL color ramp shader:**
```glsl
uniform sampler2D u_data;     // R32F float texture
uniform float u_minVal;
uniform float u_maxVal;
uniform sampler2D u_colorRamp; // 256×1 RGBA color ramp

void main() {
  float val = texture(u_data, v_texCoord).r;
  float t = clamp((val - u_minVal) / (u_maxVal - u_minVal), 0.0, 1.0);
  fragColor = texture(u_colorRamp, vec2(t, 0.5));
}
```

Adjusting thresholds at runtime = updating two uniform floats → instant GPU
re-render, no re-fetch, no CPU loop.

### Deck.gl BitmapLayer (Phase 1)

Accepts `HTMLCanvasElement`, `ImageBitmap`, or a URL. For Float32 data:
color-map CPU-side → `ImageData` → `createImageBitmap()` → `BitmapLayer`.
CPU loop over 16M values takes ~100–300 ms; run in a Web Worker to avoid
UI freeze.

```typescript
new BitmapLayer({
  id: 'heatmap',
  bounds: [westLon, southLat, eastLon, northLat],
  image: bitmap,
  opacity: 0.7,
});
```

### Deck.gl Custom Layer (Phase 2)

Subclass `Layer`, upload the Float32 texture directly to the GPU, apply GLSL
color ramp in the fragment shader. Live threshold/color adjustments require
only a uniform update — no re-fetch, no CPU work.

### MapLibre ImageSource (Phase 1 alternative)

```typescript
map.addSource('heatmap', {
  type: 'image',
  url: dataURL,
  coordinates: [[westLon, northLat], [eastLon, northLat], [eastLon, southLat], [westLon, southLat]],
});
// Update:
(map.getSource('heatmap') as ImageSource).updateImage({ url: newDataURL });
```

---

## Compression

Standard byte-level compressors compress float32 data poorly due to high entropy.

| Compressor | Typical ratio for float32 | Notes |
|------------|--------------------------|-------|
| gzip (level 6) | 1.1×–2.0× | Transparent browser decompression |
| Brotli | 1.5×–3.0× | Native browser support, good ratio |
| zstd (level 3) | 1.5×–3.0× | Not natively in browsers |
| ZFP (lossy) | 10×–20× | Needs WASM decompressor |

Propagation matrices often have large blocked/shadowed regions with constant
minimum values — compression ratios can reach 4×–8× in practice for those areas.

**Phase 1 recommendation:** Enable `Content-Encoding: gzip` via middleware:
- FastAPI: `app.add_middleware(GZipMiddleware, minimum_size=1000)`
- ASP.NET Core: `app.UseResponseCompression()` with gzip provider

Browsers decompress transparently. May reduce 64 MB to ~30–50 MB.

**Phase 2 recommendation:** Use Brotli (`Content-Encoding: br`) — natively
supported by all modern browsers, typically 3×–5× on float data.

---

## Georeferencing the Overlay

### Bounding Box Computation

```
west  = lon₀ − D / (111320 × cos(lat₀)) × (180/π)
east  = lon₀ + D / (111320 × cos(lat₀)) × (180/π)
south = lat₀ − D / 111320 × (180/π)
north = lat₀ + D / 111320 × (180/π)
```

Valid to <1% error for D ≤ 100 km at mid-latitudes. The backend must persist
this bounding box in PostgreSQL scenario metadata and return it with every
slice response (e.g., as response headers).

### Grid → Image Coordinate Mapping

```
col 0    → west longitude
col 4000 → east longitude
row 0    → north latitude  (image top = map north)
row 4000 → south latitude
```

### MapLibre ImageSource Coordinates

```typescript
coordinates: [
  [westLon, northLat],  // top-left
  [eastLon, northLat],  // top-right
  [eastLon, southLat],  // bottom-right
  [westLon, southLat],  // bottom-left
]
```

### Deck.gl BitmapLayer Bounds

`BitmapLayer.bounds` accepts either `[west, south, east, north]` (simple
rectangle) or `[[lon,lat] × 4]` for non-rectangular overlays. WGS84
coordinates are passed directly; Deck.gl handles Web Mercator internally.

---

## Phase 1 Recommendation (Simplest)

**Stack: Raw Binary HTTP + Web Worker CPU Color Mapping + MapLibre ImageSource**

No new library dependencies. Implementable in 1–2 days.

**Backend:**
1. `GET /api/scenarios/{id}/slice?height={h}` returns `application/octet-stream`
2. Read float32 slice from HDF5 (PureHDF or h5py)
3. Write bytes directly to response stream
4. Include bounding box as custom response headers
5. Enable gzip response compression

**Frontend:**
1. `fetch()` → `response.arrayBuffer()` → `Float32Array`
2. CPU color-map to `Uint8ClampedArray` RGBA in a **Web Worker** (prevents UI freeze)
3. `createImageBitmap(new ImageData(rgba, 4000, 4000))` in worker, transfer back
4. Convert to Object URL
5. `map.getSource('heatmap').updateImage({ url })` with WGS84 bounding box corners

**Expected latency (Gigabit LAN / localhost):**

| Step | Time |
|------|------|
| HDF5 slice read | 50–200 ms |
| Transfer (gzip ~30 MB) | 100–500 ms |
| Web Worker CPU color map | 100–300 ms |
| `createImageBitmap` | 50–100 ms |
| MapLibre texture upload + render | 50–100 ms |
| **Total** | **~0.4–1.2 s** |

Fits within the 1–3 s target on LAN/localhost.

---

## Phase 2+ Recommendation (Optimized)

### Phase 2 — GPU Color Mapping

Replace Web Worker CPU loop with a **custom Deck.gl layer** that uploads the
raw Float32 texture directly to the GPU and applies a GLSL color ramp in the
fragment shader. Threshold adjustments become a single uniform update →
sub-millisecond re-render with no re-fetch. Eliminates the 100–300 ms CPU loop.

Add Brotli compression to target ~15–20 MB transfer size.

Pre-fetch adjacent height levels (H±1, H±2) in the background — slider steps
feel instantaneous within a ±2 window.

### Phase 2.5 — Tile-Based Delivery

Switch to serving **float32 tiles** (256×256 × float32 = 256 KB each):
- Fetch only tiles visible in current viewport and zoom level
- Apply GPU color ramp client-side per tile
- At zoom 12: ~144 tiles × 256 KB ≈ 37 MB total, fetched progressively

Or switch to **colorized PNG tiles** (server-side color mapping):
- Each tile is 5–30 KB → total viewport transfer ~1–5 MB vs 64 MB
- Trade-off: live threshold adjustment requires server round-trip per tile change

### Phase 3 — COG + geotiff.js

Generate a COG per height level post-simulation. Client uses HTTP range
requests to fetch only the tiles needed at the current zoom:
- Zoom 10: ~9 tiles, ~2 MB total → fast zoomed-out overview
- Zoom 13: ~576 tiles, ~37 MB total → detail view fetched on demand
- Best for large-area deployments or future cloud/S3 hosting

---

## Final Decisions

### 9. HDF5 storage format — polar confirmed

**Decision: HDF5 stores polar `[D × A]` per height slice per entity.** The
backend rasterizes polar → Cartesian on-the-fly before serving.

MATLAB writes per-entity output in polar format `[Height × Distance × Angle]`,
which is the natural output of the ray-tracing model. No pre-rasterized
Cartesian grid is stored — this allows changing combination method and color
breakpoints without re-running MATLAB.

### 10. Polar → Cartesian rasterization method

**Decision: bilinear interpolation via `scipy.ndimage.map_coordinates(order=1)`
with pre-computed per-entity coordinate arrays.**

For each Cartesian output cell `(x, y)`:
1. Convert to polar `(r, θ)` relative to entity origin
2. `r_coord = r / distance_step_m` (float, not snapped)
3. `θ_coord = θ_normalized / angle_step_deg` (float, not snapped)
4. `map_coordinates(polar_slice_2d, [[r_coords], [θ_coords]], order=1)` —
   bilinear interpolation at the four surrounding polar samples

Rationale for `order=1` over alternatives:
- **Nearest-neighbor (`order=0`)**: rejected — blocky artifacts, especially
  where arc gap (349 m at 200 km) exceeds the 100 m output cell size
- **Bicubic (`order=3`)**: rejected — Gibbs-like overshoot at sharp shadow
  boundaries common in propagation data
- **scipy `griddata` (scattered)**: rejected — O(N log N) setup, too slow for
  16M output points
- **`order=1` (bilinear)**: smooth, no overshoot, O(N_output) per call,
  standard for propagation rasterization

### 11. Coordinate array pre-computation

**Decision: pre-compute `r_coords` and `theta_coords` arrays per entity once
after preprocessing; cache in memory for active scenario.**

The coordinate arrays (shape `[W_grid × H_grid]`, float32, ~64 MB each × 2
per entity) depend only on entity position, entity radius, and output grid
geometry — all known after preprocessing, before MATLAB runs. They are
invariant across height levels.

Pipeline:
1. After preprocessing completes, compute and save `entity_{id}_coords.npy`
   to the job directory alongside the HDF5 file
2. On first slice request for the scenario, load coordinate arrays into
   an in-memory LRU cache
3. Per request: `ProcessPoolExecutor` over entities → `map_coordinates` on
   each entity's polar slice using cached coordinate arrays → element-wise
   combination (max by default) → return binary

**Performance (4000×4000 grid, 10 entities, 8 cores):**
- `map_coordinates` per entity: ~300–1000 ms
- With parallelism: ~0.5–1.5 s total — within the 1–3 s target

If coordinate arrays exceed available memory, recompute per request:
`r = np.sqrt(dx² + dy²)`, `theta = np.arctan2(dy, dx)` over 16M cells
takes ~100–200 ms per entity in NumPy — acceptable fallback.

---

## Open Questions (Deferred Post-Prototype)

1. **Network link speed between backend and frontend.** Over 100 Mbit,
   compression is mandatory to hit 1–3 s. Confirm deployment link speed.

2. **Axis alignment.** Is the output grid always north-up (axis-aligned
   rectangle)? If rotated, four-corner coordinates must be used in
   MapLibre/BitmapLayer instead of a simple bounding box.

3. **Backend slice LRU cache.** Cache rasterized Cartesian slices keyed by
   `(scenarioId, entityId, heightLevel)` to avoid repeated rasterization on
   rapid slider scrubbing. Size limit TBD based on available RAM.

4. **GPU texture size floor.** Verify `gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096`
   at runtime on deployment hardware. Add 2×2 tile fallback if below 4000.

5. **Multi-entity visual layering.** Combination method (max by default) is
   applied server-side before serving. If per-entity overlays are ever needed
   client-side, each entity would require a separate R32F texture and
   alpha-blending logic in the shader.
