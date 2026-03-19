# Wave Propagation Simulator — Initial Project Plan

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

## What Is Decided

| Concern | Decision |
|---|---|
| Computation engine | MATLAB Compiled Runtime (MCR) — code not owned, called as subprocess |
| Backend language | **Research needed** — C# .NET 8 vs Python (see below) |
| Large matrix storage | **Research needed** — HDF5 vs Zarr (see below) |
| Metadata / app data | PostgreSQL (plain, no PostGIS for Phase 1) |
| Infrastructure | Docker-compose, Linux containers |
| Deployment | Must support **both** online and offline/air-gapped |
| Auth | None for now |
| Repo structure | Monorepo (frontend, backend, infra, contracts) |
| Job queue | Simplest thing that works — PostgreSQL-backed queue preferred over RabbitMQ unless research says otherwise |
| Job notification | **SSE** (Server-Sent Events) — one-way push, simpler than WebSocket |
| Visualization | 2D heatmap on flat map (Phase 1–2); 3D terrain rendering deferred to Phase 3+ |
| Phase 1 goal | End-to-end thin slice: UI → backend → dummy compute → heatmap on map |

---

## Scenario Model

A **scenario** has:
- A **name** (user-defined)
- **2–10 entities** (wave sources), each configured with:
  - Geographic position (lat/lon, placed on map)
  - Frequency, Power/amplitude, Beam direction/azimuth, Antenna height
- **Per-entity radius** (km): each entity has its own circle, drawn on the map by dragging a circle handle. No shared AOI.
  - Combined output area = **bounding box** of all entity circles
    - West: min(entity_lon − radius), East: max(entity_lon + radius), North/South: same
  - Cells outside a given entity's circle = null (no contribution from that entity)
  - Combination (max by default) is applied cell-by-cell across all entity grids per height level
- **Beam direction/azimuth**: property passed through to MATLAB. Backend always generates full 360° ray list; MATLAB applies antenna gain pattern internally.
- Height simulation parameters: min height, max height, step size (user-configurable)
- **Angular resolution**: fixed angle between rays (degrees/vector), default **0.1°**
  - Vector count = `angular_window / step_angle` — no cap
  - At 0.1° step, full 360° = 3,600 vectors
  - User can adjust step angle to trade accuracy for speed
  - Arc gap at 200km: 0.1° → 349m, 0.05° → 175m
- **Output Cartesian grid cell size**: default **100m × 100m**, user-overridable
  - Independent from angular step (angular step controls ray count in polar domain; cell size controls rasterization resolution in Cartesian output domain)
  - At 100m cells, 200km radius bounding box ≈ 4,000 × 4,000 = 16M cells per height level per entity
- **Include terrain data** toggle (default: on)
  - When off: terrain profile is flat (all elevations = 0), no DEM queries — same ray list and MATLAB invocation, trivial terrain data
  - Use cases: sea-level scenarios, quick feasibility checks, parameter sweeps
- **Combination method** for multi-entity results: max (default), sum, or other (user-selectable)

### Run / Save Model
- Each scenario has at most **one active (unsaved) run**
- If the user reruns without saving, the old result is shown with a confirmation dialog before deletion (HDF5 file is large — must not silently discard)
- User can **explicitly save** a run with a name → permanently stored, never auto-deleted
- Named saves allow comparison across parameter variations

---

## Backend Preprocessing Pipeline

The backend is **not just an API** — it does significant geometric preprocessing before
MATLAB is invoked.

### Step 1: Angular Coverage Calculation
For each entity:
1. Generate full 360° ray list (or user-limited beam sector if applicable)
2. Divide angular window by resolution → list of azimuths, count = `angular_window / step_angle`
   - E.g., 0.1° step, full 360° → 3,600 azimuths

### Step 2: Terrain Profile per Vector
For each azimuth:
1. March outward from entity in 100m steps up to entity's radius
2. Convert (entity position, azimuth, distance) → (lat, lon) using geodesic math
3. Query terrain elevation at each (lat, lon) → `height_above_sea_level`
4. Build vector as ordered list of `{ distance_m, lat, lon, terrain_height_m }`

### Step 3: Package for MATLAB
- MATLAB receives polar-format input: per-entity list of vectors
- Each vector: azimuth + distance/height profile
- Format (JSON / binary / HDF5 input file) → **research needed, part of MCR integration study**

### Scale
- Vector count = `angular_window / step_angle` — no cap
- At 0.1° step, full 360° = 3,600 vectors; at 200km radius = 2,000 distance steps/vector → **7.2M terrain queries per entity**
- With 10 entities → 72M terrain elevation queries per scenario
- Must be fast: vectorized raster sampling preferred over point-by-point API calls
- 200km is a typical scenario scale, not a hard maximum

---

## Computation Flow

```
User submits scenario
→ Backend validates + runs preprocessing (vector generation + terrain sampling)
→ Backend packages MATLAB input, queues job (returns job ID)
→ SSE channel opened — client listens for job events
→ Single MATLAB worker picks up job (uses all CPU cores — single queue)
→ MATLAB MCR runs (1–30 min)
  → Each core handles a subset of computation; when finished saves partial result to disk immediately, then picks up next work unit (prevents RAM flooding, preserves partial results on crash)
→ Outputs per-entity 3D matrix [Height × Distance × Angle], stored as separate per-entity Zarr/HDF5 files; metadata saved to PostgreSQL
→ Combined output is NOT stored — computed on-the-fly when serving height slices to frontend:
  read per-entity slice → rasterize to common Cartesian grid → element-wise max → return
  (allows changing combination method without re-running MATLAB)
→ Backend pushes "done" via SSE
→ User views result — height slider loads slices (~200 MB each, delays OK)
→ User prompted to save or discard (if unsaved, old run deleted with confirmation)
```

**MATLAB location**: Configurable — same machine as backend (child process) or separate
compute server (called remotely). Must be abstracted behind an interface in the backend.

---

## Visualization

- **Phase 1–2**: 2D heatmap overlaid on flat map
- **Height scrubbing**: slider from min to max height; each level fetches a new ~200 MB slice. 1–3s delays acceptable.
- **Phase 3+**: 3D terrain visualization (Cesium.js or equivalent) — not now

---

## What Needs Research → `research.md`

### 1. HDF5 vs Zarr (Matrix Storage)
**Why it matters**: The backend needs to write 8–40 GB matrices and read individual
height slices (~200 MB) without loading the full file.
- **HDF5**: Mature, MATLAB can write natively, hyperslab reads possible but require careful config
- **Zarr**: Modern, chunked by design (slice reads are first-class), cloud-native, better compression, no native MATLAB write support (would need post-processing step)
- **Key question**: Does the MATLAB MCR output HDF5 directly? If yes, Zarr may require an extra conversion step.

### 2. C# (.NET 8) vs Python (FastAPI) for Backend
**Why it matters**: The backend does heavy geospatial preprocessing (geodesic math,
raster terrain sampling at millions of points).
- **C# arguments**: Team has .NET experience from POC, MATLAB .NET Engine API exists, .NET 8 is fast, PureHDF for HDF5
- **Python arguments**: rasterio (vectorized GeoTIFF sampling), pyproj (geodesic math), NumPy/SciPy, h5py/zarr, MATLAB Engine API for Python — all mature and battle-tested for this exact workload
- **Key question**: Can C# match Python's rasterio vectorized performance for 5M terrain lookups? What .NET geospatial libs exist?

### 3. Terrain / Topography Data Source
**Constraint**: Must work offline (air-gapped deployments)
- **SRTM** (NASA, 30m resolution, global, free, GeoTIFF)
- **Copernicus DEM** (EU, 10m resolution, global, free, GeoTIFF)
- **Strategy**: Download tiles covering scenario AOI, cache locally, sample from local GeoTIFF
- **Key questions**: Tile download strategy for offline use? Storage size for regional tiles?

### 4. Map Tile Provider
**Constraint**: Must work offline
- **OpenStreetMap + self-hosted tiles** (MBTiles / PMTiles, fully offline-capable)
- **Mapbox** (high quality but requires internet + API key)
- **MapLibre GL JS** can serve self-hosted tiles natively
- **Key question**: How to bundle/cache tiles for offline deployment?

### 5. Frontend Framework + Map Library
**Fully open** — nothing locked in.
- **Framework**: React vs Svelte (Svelte is lighter, faster builds; React has larger ecosystem)
- **Map library**: MapLibre GL JS (WebGL, open source, self-hosted tiles) + Deck.gl for heatmap layer
- **Key concern**: 200 MB heatmap slice needs WebGL — Leaflet alone is insufficient

### 6. MATLAB MCR Integration
- **Invocation**: `Process.Start()` vs MATLAB Engine API (.NET or Python)
- **Input format**: What does MCR expect? File path to preprocessed data? Stdin? Named pipes?
- **Output**: Does MCR write HDF5 directly? File path handoff?
- **License**: Does MCR require a license server at runtime?
- **Error handling**: How are MATLAB errors surfaced to the backend?

### 7. Angular Resolution Default Value
**Goal**: Find the angular step that gives acceptable terrain accuracy for typical scenarios (regional scale, 50–500 km²) without making computation prohibitively slow.

**Arc gap at 200km** (typical scenario scale):

| Step angle | Arc gap at 200km |
|---|---|
| 0.05° | 175m |
| 0.1° | 349m |
| 0.2° | 698m |
| 0.5° | 1,745m |

**Lower bound — Fresnel zone radius** (frequency-dependent): at 1GHz over 200km ≈ 173m. Going finer than the Fresnel zone gives no additional accuracy.

**Upper bound — DEM resolution**: SRTM 30m, Copernicus 10m — no point going finer than the DEM in the angular domain.

**Recommended default: 0.1°** (349m arc gap at 200km edge — acceptable for most use cases)
- Finer step needed for microwave links at long range
- Coarser step acceptable for HF / broadcast scenarios
- User can always override

- Consider terrain frequency (mountains change faster than flat land — worst case matters)

### 8. Heatmap Slice Delivery to Frontend
- **Options**: Raw binary HTTP response, server-side XYZ tile generation, progressive streaming
- **Tiling**: Pre-computing map tiles from the matrix enables smooth zoom/pan but is complex
- **Raw binary**: Simple, client converts typed array to canvas — viable for Phase 1

---

## Recommended `research.md` Structure

```markdown
# Research

## 1. Matrix Storage: HDF5 vs Zarr
## 2. Backend Language: C# vs Python
## 3. Terrain Data Source
## 4. Map Tile Provider (Offline-capable)
## 5. Frontend Framework + Map Library
## 6. MATLAB MCR Integration
## 7. Heatmap Slice Delivery
```

Each section: options evaluated → recommendation → rationale → open questions.

---

## Development Phases

### Phase 1 — End-to-End Thin Slice
- Chosen frontend framework with map
- Entity placement + per-entity radius circle drawing on map
- Scenario form (name, entities, signal params, height config, angular resolution, no-terrain toggle)
- ASP.NET / FastAPI backend receives scenario, runs **stub preprocessing** (no real terrain), queues job
- **Dummy MATLAB** — returns a synthetic 3D matrix (random values)
- Matrix stored, metadata in PostgreSQL
- SSE push on completion
- Frontend height slider → fetches slice → renders heatmap

### Phase 2 — Real Preprocessing + Persistence
- Real terrain data integration (offline-cached GeoTIFF tiles)
- Full vector generation + terrain sampling pipeline
- MATLAB MCR integration (replace dummy)
- HDF5/Zarr slice reads serving real data
- Save/discard run flow with confirmation dialog

### Phase 3 — Polish + Infrastructure
- Offline tile serving (self-hosted map tiles)
- 3D terrain visualization (Cesium.js)
- Docker-compose full stack
- AWS / cloud deployment path

---

## Repo Structure

```
repo/
├── frontend/          # Chosen framework app
├── backend/           # API + preprocessing + job worker
├── infra/             # docker-compose, nginx, tile server
├── contracts/         # Shared API schemas / types
├── research.md        # Technology research findings (to be completed first)
└── initial-plan.md    # This document
```

---

## Immediate Next Steps

1. **Complete `research.md`** — cover all 7 research topics before writing any code
2. **Make final tech decisions** — especially backend language and matrix storage format
3. **Define MATLAB interface** — what input format does MCR expect? What does it output?
4. **Scaffold monorepo** — folder structure, tooling, docker-compose skeleton
5. **Build Phase 1** — end-to-end thin slice with dummy computation
