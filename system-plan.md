# Wave Propagation Simulator — System Plan

## Background

Full rewrite of a Unity/.NET 4.8 monolith POC. The pain was Unity — a game engine is
the wrong host for a simulation/analysis platform. This rewrite moves to a proper
web stack with clear service boundaries.

---

## Project Goal

A full-stack platform for simulating and visualizing how waves propagate across
geographic terrain. The wave physics model is generic/abstract (pluggable — not
tied to RF, acoustic, or seismic specifically). Target users: military/defense,
researchers, telecom.

---

## Technology Stack (All Decided)

### Infrastructure


| Concern          | Decision                                       |
| ---------------- | ---------------------------------------------- |
| Containerization | Docker-compose, Linux containers               |
| Deployment modes | Online and offline/air-gapped                  |
| Repo structure   | Monorepo (frontend, backend, infra, contracts) |
| Auth             | None for Phase 1                               |


### Backend


| Concern              | Decision                                            |
| -------------------- | --------------------------------------------------- |
| Language / framework | Python 3.11+ / FastAPI (ASGI, uvicorn)              |
| PostgreSQL driver    | asyncpg                                             |
| Geodesic math        | pyproj (PROJ C library), numpy                      |
| Raster terrain I/O   | rasterio (GDAL C library)                           |
| Array file I/O       | h5py (HDF5)                                         |
| Job queue            | PostgreSQL `FOR UPDATE SKIP LOCKED`                 |
| Job notifications    | SSE — FastAPI `StreamingResponse` + async generator |
| MATLAB invocation    | `asyncio.create_subprocess_exec` (subprocess)       |
| MATLAB data exchange | HDF5 files (input and output)                       |
| Entity parallelism   | `ProcessPoolExecutor` over entities                 |
| Container base image | `ghcr.io/osgeo/gdal:ubuntu-small-latest`            |


### Computation / MATLAB


| Concern             | Decision                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Invocation method   | Subprocess only — MATLAB Engine API incompatible with MCR                                                    |
| Input format        | HDF5 — schema agreed with MATLAB developer (deferred)                                                        |
| Output format       | HDF5, `ChunkSize=[1, D, A]`, float32                                                                         |
| Output dataset path | `/propagation`; root attributes: `entity_id`, `scenario_id`, `height_min_m`, `height_max_m`, `height_step_m` |
| Wrapper ownership   | Owned — wrapper controls HDF5 write with correct chunking                                                    |
| Write pattern       | Wrapper pre-creates file → cores write temp partial files → wrapper assembles via hyperslab writes           |
| MCR licensing       | Free, no license server, air-gapped-capable                                                                  |
| Worker abstraction  | `IMatlabWorker` interface (local subprocess vs remote REST)                                                  |


### Data Storage


| Concern                  | Decision                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| Metadata / app data      | PostgreSQL                                                              |
| Matrix storage format    | HDF5                                                                    |
| Matrix chunking          | `ChunkSize = [1, D, A]` (one chunk = one height slice)                  |
| Matrix dtype             | float32 (single precision)                                              |
| Matrix layout            | Per-entity files; combined output computed on-the-fly at serve time     |
| Terrain data             | Copernicus GLO-30 (NASADEM as fallback)                                 |
| Terrain tile format      | Cloud-Optimized GeoTIFF (COG), 1°×1° tiles                              |
| Terrain access pattern   | GDAL VRT mosaic over pre-downloaded tiles, rebuilt at container startup |
| Typical entity file size | ~86 GB (3,000 slices × 2,000 distance × 3,600 angles × 4 bytes)         |


### Frontend

See `frontend-plan.md` for component structure, form rendering, and color scale details.

| Concern           | Decision                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Framework         | React 19 + Vite 6 + TypeScript 5                                                           |
| Map library       | MapLibre GL JS 4 via react-map-gl v7+                                                      |
| Map tile format   | PMTiles (vector MVT) served from backend static files                                      |
| Tile generation   | Planetiler (from OSM PBF) or Protomaps pre-built extract                                   |
| Heatmap layer     | Custom Deck.gl layer — R32F texture + GLSL fragment shader                                 |
| Color ramp        | User-defined min/max colors + dBm thresholds per stop (2–20); GPU-only (shader uniforms)  |
| Form management   | react-hook-form 7 + Zod 3; forms schema-driven from `/contracts` (see `contracts.md`)     |
| State management  | Zustand 5                                                                                  |
| SSE client        | Browser-native `EventSource`                                                               |


### Heatmap Slice Delivery


| Concern                  | Decision                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| Wire format              | ~56-byte binary header + raw `Float32Array` body                                  |
| Header fields            | magic, version, width, height, min_val, max_val, west/south/east/north (float64)  |
| Transport compression    | HTTP gzip (server middleware) — ~30–50% size reduction on propagation data        |
| Rendering                | Custom Deck.gl R32F texture from day one; no BitmapLayer phase                    |
| Polar → Cartesian        | `scipy.ndimage.map_coordinates(order=1)` — bilinear, no overshoot                 |
| Coordinate arrays        | Pre-computed per entity after preprocessing, cached in memory for active scenario |
| Rasterization timing     | On-the-fly per request, parallelized over entities via `ProcessPoolExecutor`      |
| Multi-entity combination | Element-wise max (default), applied server-side before serving                    |


### Scenario Parameters


| Concern                    | Decision                                                    |
| -------------------------- | ----------------------------------------------------------- |
| Angular resolution default | 0.1°                                                        |
| Angular resolution range   | 0.01° – 2.0° (user-overridable)                             |
| Output grid cell size      | 100 m × 100 m (user-overridable)                            |
| Height axis                | Variable resolution under consideration — decision deferred |


---

## Scenario Model

See `contracts.md` for full field schema. Summary:

- **Name** (string), **2–10 entities**, height range + step, angular resolution (default 0.1°, range 0.01–2.0°), grid cell size (default 100m), terrain toggle, combination method (max/mean/sum)
- **Entity**: label, position (lat/lon), frequency, power, azimuth, antenna_height, radius (km)
- **Per-entity radius**: each entity has its own AOI circle. Combined output = bounding box of all circles. Cells outside an entity's circle = null. Combination applied cell-by-cell per height level.
- **Azimuth** passed through to MATLAB; backend always generates full 360° rays — MATLAB applies gain pattern internally.
- Angular resolution: `vector_count = angular_window / step_angle` (no cap). At 0.1°, full 360° = 3,600 vectors.

### Run / Save Model

- Each scenario has at most **one active (unsaved) run**
- If the user reruns without saving, the old result is shown with a confirmation dialog before deletion (HDF5 file is large — must not silently discard)
- User can **explicitly save** a run with a name → permanently stored, never auto-deleted
- Named saves allow comparison across parameter variations

---

## Backend Preprocessing Pipeline

Runs before MATLAB is invoked. Four steps per entity:

1. **Ray generation** — generate azimuths: `angular_window / step_angle` (e.g. 3,600 at 0.1°)
2. **Terrain profile** — for each azimuth, march outward in 100m steps to entity radius:
   - `pyproj.Geod.fwd` (vectorized) → lat/lon per step
   - `rasterio` window read on GDAL VRT mosaic → terrain height per step
   - Result: list of `{ distance_m, lat, lon, terrain_height_m }` per azimuth
3. **Package for MATLAB** — write HDF5 input (polar format: per-entity list of vectors; schema deferred)
4. **Pre-compute coordinate arrays** — for each entity, compute `r_coords` + `theta_coords` float32 arrays
   of shape `[W_grid × H_grid]` mapping each Cartesian output cell to polar coordinates in entity frame.
   Stored as `entity_{id}_coords.npy`. Invariant across height levels and MATLAB runs.

**Scale**: 0.1° step + 200km radius = 3,600 vectors × 2,000 steps = 7.2M terrain queries/entity.
10 entities → 72M queries. Vectorized via rasterio + NumPy: ~30–120 s.

---

## Polar → Cartesian Rasterization

MATLAB outputs `[Height × Distance × Angle]` per entity. Slice endpoint serves a Cartesian grid.
On-the-fly at request time using pre-computed coordinate arrays:

1. Read polar slice `[D × A]` from HDF5 (h5py hyperslab)
2. `scipy.ndimage.map_coordinates(slice, [r_coords, theta_coords], order=1)` → Cartesian `[W × H_grid]` float32
3. All entities in parallel (`ProcessPoolExecutor`)
4. Element-wise combination (max by default); cells outside entity radius → null
5. Serialize: 56-byte header + `Float32Array` → HTTP response

**Target**: ~0.5–1.5 s for 4000×4000 grid, 10 entities, 8 cores. 1–3 s end-to-end.

---

## Computation Flow

```
User submits scenario
→ Backend validates, runs preprocessing (ray generation + terrain sampling via rasterio)
→ Backend pre-computes rasterization coordinate arrays per entity (.npy files)
→ Backend writes HDF5 input, queues job (PostgreSQL FOR UPDATE SKIP LOCKED)
→ Returns job ID; SSE channel opened — client listens for job events
→ Single MATLAB worker picks up job (uses all CPU cores — single queue)
→ MATLAB MCR runs (1–30 min)
  → Each core handles a subset of computation; writes partial result to temp HDF5 on completion
  → Wrapper assembles temp files into final per-entity HDF5 sequentially as cores finish
→ Final per-entity HDF5 files saved; metadata written to PostgreSQL
→ Backend pushes "done" via SSE (PostgreSQL LISTEN/NOTIFY → SSE generator)
→ User views result — height slider fetches slices
  → Backend reads polar slice from HDF5, rasterizes to Cartesian via map_coordinates,
    combines entities, returns binary
→ User prompted to save or discard (if unsaved, old run deleted with confirmation)
```

**MATLAB location**: Configurable — same machine (child process) or separate compute
server (REST wrapper). Abstracted behind `IMatlabWorker` interface; switching requires
only a config change.

---

## Visualization

- **Phase 1–2**: 2D heatmap overlaid on flat map (custom Deck.gl R32F layer)
- **Height scrubbing**: slider + direct numeric input; ring-buffer prefetch of ±2 adjacent levels
- **Color ramp**: user-defined min/max colors + dBm thresholds (2–20 stops); adjusting updates shader uniforms only — no re-fetch
- **Phase 3+**: 3D terrain visualization (Cesium.js) — not now

---

## Deferred Decisions (Post-Prototype)

These are known unknowns. They will be resolved after the Phase 1 prototype
demonstrates the end-to-end thin slice.

### MATLAB Interface

- Exact CLI argument signature for the compiled MCR executable
- HDF5 input schema: dataset names, shapes, dtypes for entity parameters
- Progress reporting: does the executable emit parseable stdout lines (e.g. `PROGRESS:42`)?
- Partial result signaling: how does the backend identify which height slices are complete?
- MCR version (must match the compiled executable exactly)
- Single-worker enforcement: enforced in PostgreSQL queue, REST wrapper, or both?
- Crash recovery: re-run from scratch or resume from partial results?

### Terrain Pipeline

- Geoid correction: does MATLAB expect AMSL heights (DEM-native) or HAE (GPS-derived)?
Silent mismatch produces incorrect terrain profiles.
- Canopy vs bare earth: Copernicus DEM is a DSM (measures vegetation top), not DTM
(bare earth). Which does the propagation model expect?
- Polar edge tiles: confirm tile naming and manifest structure above ~80° latitude
- VRT rebuild strategy: at every container startup (recommended) vs only on tile set change

### Deployment

- Geographic scope: which regions constitute the operational area? Determines PMTiles extract size
- Maximum map zoom level needed: zoom 14 (neighborhood) vs zoom 15+ (street/building)
- Remote compute server OS (Linux vs Windows — affects process group kill strategy)
- File staging for remote MATLAB deployment: NFS mount vs object store vs SCP

### Frontend / UX

- Satellite / raster imagery requirement (if needed, data pipeline is significantly larger)
- Custom map styling requirements (color scheme, visible feature types)
- Map update cadence (how frequently does OSM tile data need refreshing)
- Axis alignment: is the output grid always north-up? (affects georeferencing in MapLibre)

### Performance Tuning

- Server-side LRU cache for rasterized Cartesian slices (avoids re-rasterization on rapid scrubbing)
- Memory budget for coordinate array cache (10 entities × ~128 MB = ~1.3 GB)
- Adaptive angular resolution: variable step size as function of range (finer at short range)
- Height axis variable resolution: non-uniform step sizes at altitude

---

## Development Phases

### Phase 1 — End-to-End Thin Slice

- React frontend with MapLibre GL JS map (PMTiles, local style)
- Entity placement + per-entity radius circle drawing (MapLibre Marker + GeoJSON fill layer)
- Scenario form (name, entities, signal params, height config, angular resolution,
no-terrain toggle) — react-hook-form + Zod
- FastAPI backend receives scenario, runs **stub preprocessing** (no real terrain),
pre-computes dummy coordinate arrays
- **Dummy MATLAB** — returns synthetic 3D matrix (random values) in correct HDF5 format
- HDF5 stored, metadata in PostgreSQL; coordinate arrays pre-computed
- SSE push on completion (PostgreSQL LISTEN/NOTIFY → FastAPI StreamingResponse)
- Frontend height slider → fetches binary slice → custom R32F Deck.gl layer renders heatmap
- User-adjustable color breakpoints (shader uniforms only)

### Phase 2 — Real Preprocessing + Persistence

- Real terrain data integration (offline Copernicus COG tiles, GDAL VRT, rasterio)
- Full vector generation + terrain sampling pipeline (pyproj + rasterio)
- MATLAB MCR integration (replace dummy subprocess)
- HDF5 slice reads serving real data
- Save/discard run flow with confirmation dialog

### Phase 3 — Polish + Infrastructure

- Offline tile serving (PMTiles pre-bundled for operational region)
- 3D terrain visualization (Cesium.js)
- Docker-compose full stack
- Remote MATLAB compute server (REST wrapper + `RemoteMcrWorker`)
- AWS / cloud deployment path

---

## Repo Structure

```
repo/
├── frontend/               # React 19 + Vite + TypeScript
│   ├── src/
│   │   ├── map/            # MapLibre + react-map-gl components
│   │   ├── heatmap/        # Custom Deck.gl R32F layer + GLSL shaders
│   │   ├── scenario/       # Form (react-hook-form + Zod), entity list
│   │   └── store/          # Zustand slices (scenario, jobs, UI)
│   └── public/static/      # PMTiles file, fonts, sprites, style JSON
├── backend/
│   ├── api/                # FastAPI routes
│   ├── preprocessing/      # Ray generation, terrain sampling, coord array pre-computation
│   ├── worker/             # Job queue consumer, MATLAB subprocess wrapper
│   ├── hdf5/               # h5py slice reads, rasterization (map_coordinates)
│   └── db/                 # asyncpg, PostgreSQL schema, migrations
├── infra/
│   ├── docker-compose.yml
│   └── nginx/
├── contracts/              # JSON Schema files (source of truth — see contracts.md)
├── contracts.md            # Schema contract design
├── frontend-plan.md        # Frontend component structure and form rendering
└── system-plan.md          # This document
```
