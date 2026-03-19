# Research: Frontend Framework + Map Library

## Overview

This document evaluates frontend technology choices for the Wave Propagation Simulator — a web application that renders a geographic map with interactive entity placement, heatmap overlays (from large binary data slices), and a height slider for scrubbing through simulation output. The application must operate fully offline, bundle all assets, and integrate with a backend that streams job progress via Server-Sent Events.

Core requirements driving these choices:

- Geographic map with lat/lon entity markers and per-entity draggable radius circles
- Heatmap overlay sourced from ~200 MB binary data slices per height level, rendered as a color-mapped WebGL layer
- Height slider that triggers fetch + re-render on each step
- Full offline operation — no CDN, everything bundled
- Self-hosted map tiles via PMTiles / MapLibre GL JS
- SSE for live job progress
- Complex scenario forms: 2–10 entities each with lat/lon, frequency, power, azimuth, height; plus scenario-level parameters (height range, angular resolution, combination method)

---

## React vs Svelte Comparison

### React

React 19 is the current stable release. It introduces Concurrent Mode (automatic batching, transitions, `useDeferredValue`) and Server Components. Server Components are not relevant for this SPA, but Concurrent Mode benefits are relevant: the height slider can wrap expensive re-renders in `startTransition` so that scrubbing remains responsive while fetches and Deck.gl layer updates are deferred.

Key React characteristics relevant to this project:

- **Virtual DOM diffing** — overhead exists but is well-understood and acceptable at this component count. The hot path (heatmap re-render) bypasses React entirely via imperative Deck.gl layer updates.
- **Ecosystem depth** — react-hook-form handles complex nested/dynamic forms with field arrays (the 2–10 entity list maps directly to `useFieldArray`). Validation libraries (Zod + react-hook-form resolvers) are production-hardened.
- **State management** — Zustand and Jotai are lightweight and well-maintained. Either fits the scenario-form atom model (one atom per entity, derived atoms for validation state) without boilerplate.
- **react-map-gl v7+** — official Vis.gl wrapper for MapLibre GL JS (and Mapbox GL JS). It exposes a controlled React API over the map while allowing full imperative escape hatches for Deck.gl custom layers. Deck.gl itself ships first-class React bindings.
- **TypeScript** — React's type definitions are comprehensive. react-hook-form and Zustand have excellent TypeScript support.
- **Bundle size** — React + ReactDOM is approximately 130 KB gzipped. Not minimal, but well within acceptable limits for a desktop-class internal tool.
- **Community / examples** — the overwhelming majority of Deck.gl integration examples, MapLibre + React tutorials, and heatmap rendering guides target React. Debugging resources are readily available.

### Svelte

Svelte 5 ships the runes reactivity model (`$state`, `$derived`, `$effect`), which makes reactive declarations more explicit and composable than Svelte 4 stores. Because Svelte compiles components to vanilla JS with no virtual DOM, bundles are smaller and runtime overhead is lower.

Key Svelte characteristics relevant to this project:

- **Compiled reactivity** — fine-grained updates without a diffing step. For highly dynamic UI (frequent slider events), this can reduce CPU time on the main thread.
- **Smaller runtime** — Svelte's runtime footprint is negligible compared to React; total bundle savings on a medium-complexity app are roughly 40–80 KB gzipped.
- **svelte-maplibre** — a community library wrapping MapLibre GL JS for Svelte exists and is maintained, but its community is significantly smaller than react-map-gl's. Edge cases (custom Deck.gl integration, complex layer ordering) have fewer documented solutions.
- **Form ecosystem** — Svelte lacks an equivalent of react-hook-form for dynamic nested field arrays. Superforms (a popular Svelte form library) covers validation well but its field-array story for 2–10 dynamic entities requires more manual wiring.
- **State management** — Svelte stores and runes handle application state elegantly for simpler cases; the equivalent of Zustand slices requires more discipline to structure cleanly.
- **Deck.gl** — Deck.gl does not ship official Svelte bindings. Integration requires using the imperative `Deck` class directly, which is possible but loses the declarative layer management that `@deck.gl/react` provides.
- **TypeScript** — fully supported via `lang="ts"` in `.svelte` files; type inference within templates has historically lagged behind React's but has improved in Svelte 5.

### Verdict

**React with react-map-gl is the recommended choice.**

The deciding factors are:

1. **Complex dynamic forms** — `useFieldArray` from react-hook-form is the most mature solution for the 2–10 entity form with add/remove. This alone would make React preferable.
2. **Deck.gl integration** — `@deck.gl/react` provides first-class declarative layer management. Hundreds of production examples exist for React + MapLibre + Deck.gl setups.
3. **Ecosystem risk** — svelte-maplibre is a smaller community project. For a production simulator that may need obscure MapLibre features (custom layer ordering, terrain, fog), react-map-gl's larger contributor base reduces risk.
4. **SSE state** — Zustand makes it trivial to share SSE-derived job state across the component tree without prop drilling.

The bundle size difference (~50–80 KB gzipped) is not a meaningful concern for an offline-deployed desktop tool.

---

## MapLibre GL JS

MapLibre GL JS is an open-source, WebGL-based map rendering library — a community fork of Mapbox GL JS v1 created after Mapbox changed its license in 2021. It is the standard choice for open-source, self-hosted, WebGL map applications.

Relevant capabilities:

- **PMTiles support** — the `pmtiles` JS package registers a custom protocol (`pmtiles://`) with MapLibre's `addProtocol` API. This allows serving a single-file tile archive directly from the application server with no tile server process required. Ideal for offline deployment.
- **Custom layers API** — MapLibre exposes `map.addLayer({ type: 'custom', ... })` with `onAdd`, `render`, and `onRemove` hooks that receive the WebGL context. This is the integration point for Deck.gl's interleaved rendering mode (Deck.gl layers rendered into MapLibre's WebGL context, respecting depth and order).
- **react-map-gl v7+** — this version of react-map-gl supports MapLibre GL JS as a drop-in replacement for Mapbox GL JS (via the `mapLib` prop or aliasing `mapbox-gl` to `maplibre-gl` in the bundler). The component API is identical.
- **Markers and circles** — MapLibre supports GeoJSON `circle` layers natively. Entity radius circles can be driven by a GeoJSON source updated on drag events. Draggable handles are implemented either as MapLibre `Marker` elements (DOM-based, easy to drag) or as Deck.gl `ScatterplotLayer` + pointer event handling.
- **License** — BSD 3-Clause. No usage restrictions, no token required.
- **WebGL requirement** — WebGL 1 minimum; MapLibre itself does not require WebGL 2. Deck.gl's advanced layers (including BitmapLayer) require WebGL 2, which is universally supported in Chromium-based and Firefox browsers on any hardware released in the last eight years.

---

## Deck.gl for Heatmap Overlay

Deck.gl (by Vis.gl / Foursquare) is a WebGL2-based data visualization framework designed to overlay large datasets on geographic maps. It integrates with MapLibre GL JS via the custom layers API.

Two integration modes exist:

- **Overlay mode** — Deck.gl renders in its own canvas stacked above the MapLibre canvas. Simpler but depth/occlusion between map and Deck.gl layers is not respected.
- **Interleaved mode** — Deck.gl injects itself as a MapLibre custom layer, sharing the WebGL context. Map labels and 3D geometry can appear above or below Deck.gl layers. Recommended for a clean visual stack.

For the heatmap overlay, two Deck.gl layer types are candidates:

### BitmapLayer (Phase 1)

`BitmapLayer` accepts an `image` prop which can be an `HTMLImageElement`, `ImageBitmap`, `HTMLCanvasElement`, or a URL. The layer is georeferenced via a `bounds` prop (`[west, south, east, north]`). It renders the image as a textured quad over the map — essentially a georeferenced image overlay.

This is the simplest path: color-map the float data on the CPU (in a Web Worker), produce an `ImageBitmap`, and pass it to `BitmapLayer`. Updating the layer on height-slider change requires only replacing the `image` prop; Deck.gl handles the texture upload.

GPU memory for a 4000×4000 RGBA8 texture: 4000 × 4000 × 4 bytes = 64 MB VRAM. This is within the budget of any discrete GPU and most modern integrated GPUs. Render time for a single textured quad is well under 1 ms.

### Custom Layer with R32F Texture (Phase 2)

A custom Deck.gl layer can upload the raw `Float32Array` directly to the GPU as an `R32F` (single-channel 32-bit float) texture. A GLSL fragment shader then samples the texture, applies a color ramp (encoded as a 1D lookup texture or hardcoded piecewise function), and outputs the final color. This approach:

- Eliminates the CPU color-mapping step (saving 100–300 ms per height level)
- Keeps the full float precision on the GPU (useful if color ramp parameters need to change without re-fetching)
- Requires authoring a custom Deck.gl layer class with WebGL2 texture management

For Phase 1, BitmapLayer is sufficient and delivers the feature immediately. Phase 2 is a performance optimization worth pursuing if the CPU color-mapping step becomes the bottleneck.

---

## Rendering 200 MB Heatmap Slices

A single height-level slice is approximately 200 MB. Assuming a 4000×4000 grid of float32 values: 4000 × 4000 × 4 bytes = 64 MB. (If 200 MB is the raw size before any compression, the actual float grid may be larger or the format may include metadata; the pipeline below applies regardless of exact size.)

### Phase 1: CPU Color Mapping (Web Worker + BitmapLayer)

This is the recommended initial implementation path.

**Pipeline:**

1. **Fetch** — `fetch('/api/slices/{height}')` with `response.arrayBuffer()`. This avoids any string parsing overhead; the raw bytes arrive as an `ArrayBuffer`.
2. **Zero-copy transfer to Web Worker** — `worker.postMessage({ buffer }, [buffer])` transfers ownership of the `ArrayBuffer` to the worker thread without copying. The main thread can no longer access it, but no memory is duplicated.
3. **Float32Array view** — inside the worker: `const floats = new Float32Array(buffer)`. No copy; this is a view into the transferred buffer.
4. **Color mapping** — iterate over `floats`, compute a color per value (normalize to [0,1], sample a color ramp), write RGBA bytes into a `Uint8ClampedArray`. This step takes approximately 100–300 ms for a 4000×4000 grid depending on color ramp complexity and CPU speed.
5. **ImageData → ImageBitmap** — `createImageBitmap(new ImageData(rgba, width, height))`. `createImageBitmap` is available in workers (it is not a DOM API). This produces an `ImageBitmap` that can be transferred back to the main thread.
6. **Transfer back** — `self.postMessage({ bitmap }, [bitmap])`. `ImageBitmap` is transferable; no copy.
7. **BitmapLayer update** — on the main thread, receive the `ImageBitmap` and update the Deck.gl `BitmapLayer`'s `image` prop. Deck.gl uploads it to GPU as a texture.

**Total latency** (excluding network): approximately 150–400 ms per height level, dominated by the CPU color-mapping step. This is acceptable for a height slider where the user expects a brief loading state between levels.

**Memory** — the 200 MB `ArrayBuffer` lives only in the worker during processing; once the `ImageBitmap` is created and the `Float32Array` is no longer needed, the worker can release the buffer. Peak memory usage is approximately: 200 MB (raw) + ~64 MB (RGBA Uint8ClampedArray) + ~64 MB (ImageBitmap) = ~328 MB. This is manageable on a desktop machine.

### Phase 2: GPU Color Mapping (Custom Layer + GLSL Shader)

Instead of color-mapping on the CPU, the float data is uploaded directly to the GPU as an `R32F` texture. A GLSL fragment shader performs the color mapping at render time.

**Pipeline:**

1. **Fetch** — same as Phase 1 (`ArrayBuffer` → `Float32Array`).
2. **GPU texture upload** — in a custom Deck.gl layer's `updateState` method: create a `Texture2D` (via luma.gl, which Deck.gl uses internally) with `format: GL.R32F, type: GL.FLOAT`. Upload the `Float32Array` as the texture data. WebGL2 supports `R32F` textures with the `EXT_color_buffer_float` extension (available on all WebGL2-capable hardware).
3. **GLSL color ramp** — the fragment shader samples the R32F texture, normalizes the value against a uniform `[minVal, maxVal]` range, and maps it through a color ramp. The ramp can be a hardcoded piecewise function (e.g., viridis approximation in GLSL) or sampled from a 256×1 RGBA8 lookup texture.
4. **Render** — Deck.gl calls the layer's draw method each frame; the shader executes on the GPU.

**Advantages over Phase 1:**
- CPU color-mapping step is eliminated; the 100–300 ms processing time disappears.
- Color ramp parameters (min/max, palette) can be changed without re-fetching or re-processing data.
- The float data remains on the GPU; scrubbing the height slider only requires uploading a new texture (not re-running color mapping).

**Disadvantages:**
- Requires authoring a custom Deck.gl layer (approximately 100–200 lines of JavaScript).
- luma.gl API (Deck.gl's internal WebGL abstraction) is less documented than the standard Deck.gl layer API.
- `R32F` texture filtering: linear interpolation between float values is supported in WebGL2 with `OES_texture_float_linear` (widely available but worth verifying in the target environment).

---

## SSE Client Integration

Server-Sent Events (SSE) provide a unidirectional server-to-client stream over HTTP. They are natively supported in all modern browsers and do not require WebSocket infrastructure.

**Basic pattern in React:**

```typescript
useEffect(() => {
  const es = new EventSource(`/api/jobs/${jobId}/events`);

  es.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    useJobStore.getState().updateJob(jobId, data);
  });

  es.addEventListener('complete', (event) => {
    useJobStore.getState().setJobComplete(jobId);
    es.close();
  });

  es.onerror = () => {
    // EventSource auto-reconnects on network errors; handle terminal errors explicitly
    es.close();
  };

  return () => es.close(); // cleanup on unmount
}, [jobId]);
```

**State integration with Zustand:**

A `useJobStore` Zustand store holds a map of `jobId → JobStatus`. The SSE listener calls `useJobStore.getState().updateJob(...)` (imperative Zustand access, safe to call outside React components). Components subscribe to specific job slices via `useJobStore(state => state.jobs[jobId])` with shallow equality to avoid spurious re-renders.

**Offline considerations:**

SSE requires an HTTP connection to the backend. Since the backend runs locally in the offline deployment scenario, this is not a concern. The `EventSource` URL should be relative (`/api/...`) rather than absolute to avoid hardcoding hostnames.

**Reconnection:**

`EventSource` reconnects automatically on dropped connections (with a default ~3 second delay). The server should emit a `Last-Event-ID`-compatible stream so the client can resume without missing events if the connection drops briefly.

---

## State Management for Scenario Forms

The scenario form is the most state-intensive part of the UI. It contains:

- Scenario-level fields: name, height range (min/max/step), angular resolution, combination method
- A dynamic list of 2–10 entities, each with: lat/lon, frequency, power, azimuth, height

**Recommended approach: react-hook-form + Zod + Zustand**

| Concern | Tool | Rationale |
|---|---|---|
| Form field registration and submission | react-hook-form | `useFieldArray` handles dynamic entity add/remove with minimal re-renders (uncontrolled inputs by default) |
| Validation schema | Zod | Declarative schema co-located with TypeScript types; react-hook-form has a first-class Zod resolver |
| Cross-component form state | react-hook-form `FormProvider` | Allows child components (e.g., `EntityRow`) to access the form context without prop drilling |
| Application state (saved scenarios, active scenario) | Zustand | Lightweight, no boilerplate; persists to localStorage via `zustand/middleware/persist` for offline use |
| SSE / job status | Zustand | Same store, separate slice |

**Entity field array pattern:**

```typescript
const { fields, append, remove } = useFieldArray({
  control,
  name: 'entities',
});

// fields is an array of { id, lat, lon, frequency, power, azimuth, height }
// append({ lat: 0, lon: 0, frequency: 0, power: 0, azimuth: 0, height: 0 }) adds a row
// remove(index) removes a row
```

React Hook Form tracks each entity row by a stable `id` field (not array index), which prevents key-related re-render bugs when rows are reordered or removed.

**Validation:**

A Zod schema enforces:
- `entities` array length: min 2, max 10
- lat in [-90, 90], lon in [-180, 180]
- frequency, power, height: positive numbers
- azimuth: [0, 360)
- Scenario-level: height step must be positive and less than (max - min)

Validation runs on submit (or per-field on blur for UX). The Zod schema doubles as the TypeScript type source via `z.infer<typeof ScenarioSchema>`.

---

## Recommended Stack

| Layer | Choice | Version (approx.) |
|---|---|---|
| UI framework | React | 19.x |
| Build tool | Vite | 6.x |
| Language | TypeScript | 5.x |
| Map library | MapLibre GL JS | 4.x |
| React map wrapper | react-map-gl | 7.x (MapLibre mode) |
| Tile format | PMTiles | via `pmtiles` JS plugin |
| Data visualization | Deck.gl | 9.x |
| Heatmap (Phase 1) | Deck.gl BitmapLayer | — |
| Heatmap (Phase 2) | Custom Deck.gl layer (R32F + GLSL) | — |
| Form management | react-hook-form | 7.x |
| Validation | Zod | 3.x |
| State management | Zustand | 5.x |
| SSE | Browser-native EventSource | — |
| Offline bundling | Vite static build (all assets inlined) | — |

**No CDN dependencies.** All packages are installed as `node_modules` and bundled by Vite. Map tiles are served from a local PMTiles file via the application server.

---

## Open Questions

1. **Exact heatmap data format** — Is the 200 MB slice a raw `Float32Array` (4 bytes/value), a compressed format (e.g., gzip, Zstd), or a structured binary with a header? This affects the Web Worker decode step. If compressed, a WASM-based decompressor (e.g., `fflate`) in the worker would be needed.

2. **Grid dimensions** — What are the actual width × height pixel dimensions of the float grid per height level? This determines VRAM requirements, color-mapping time, and whether Phase 2 GPU path is necessary from day one.

3. **Color ramp specification** — Is the color ramp fixed (e.g., viridis, dBm-to-color mapping) or user-configurable? User-configurable ramps favor the Phase 2 GPU approach (no re-processing on ramp change).

4. **Number of height levels** — How many levels does a single simulation produce? If the user is expected to scrub through dozens of levels, prefetching adjacent levels in the background (and caching decoded `ImageBitmap` objects) would smooth the scrubbing experience.

5. **Target browser** — Is the deployment browser locked to a specific Chromium version (e.g., Electron shell or a pinned browser)? This affects how confidently WebGL2 and `R32F` texture support can be assumed, and whether Vite's build targets need adjustment.

6. **Heatmap georeferencing** — Does each slice carry its own bounding box metadata, or is the bounding box fixed per scenario? This determines how the `BitmapLayer` `bounds` prop is populated.

7. **Entity circle interaction** — Are the draggable radius handles implemented as MapLibre native features (GeoJSON circle layer + drag event), as Deck.gl layers, or as DOM overlays? The choice affects how dragging updates propagate back to the form state.

8. **Persistence of scenarios** — Should saved scenarios survive a browser refresh? If so, Zustand's `persist` middleware with localStorage is sufficient for small scenario JSON objects. If the backend owns scenario storage, the form state is ephemeral and only submitted on "Run Simulation."
