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
- **One shared circular AOI** (center + radius in km)
  - Entities may sit **outside** the AOI — their propagation still contributes if it enters the AOI
- Height simulation parameters: min height, max height, step size (user-configurable)
- **Angular resolution**: fixed angle between rays (degrees/vector), default determined by research
  - System computes vector count at runtime: `num_vectors = angular_window / step_angle`
  - User can adjust step angle to trade accuracy for speed
  - Research will determine the sensible default (likely 0.1°–0.5°)
  - Arc gap at AOI edge = `AOI_radius_m × step_angle_radians` (e.g. 0.1° at 50km = ~87m gap)
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
1. Compute the angular window from the entity toward the AOI circle
   - If entity is **inside** AOI: full 360° (or user-limited beam)
   - If entity is **outside** AOI: compute tangent angles → angular window that covers the AOI
2. Divide angular window by resolution → list of up to 1000 azimuths (vectors)

### Step 2: Terrain Profile per Vector
For each azimuth:
1. March outward from entity in 100m steps up to AOI radius
2. Convert (entity position, azimuth, distance) → (lat, lon) using geodesic math
3. Query terrain elevation at each (lat, lon) → `height_above_sea_level`
4. Build vector as ordered list of `{ distance_m, lat, lon, terrain_height_m }`

### Step 3: Package for MATLAB
- MATLAB receives polar-format input: per-entity list of vectors
- Each vector: azimuth + distance/height profile
- Format (JSON / binary / HDF5 input file) → **research needed, part of MCR integration study**

### Scale
- 1000 vectors × (AOI_radius_m / 100) distance steps per entity
- E.g., 50 km radius → 500 steps/vector → 500,000 terrain queries per entity
- With 10 entities → 5,000,000 terrain elevation queries per scenario
- Must be fast: vectorized raster sampling preferred over point-by-point API calls

---

## Computation Flow

```
User submits scenario
→ Backend validates + runs preprocessing (vector generation + terrain sampling)
→ Backend packages MATLAB input, queues job (returns job ID)
→ SSE channel opened — client listens for job events
→ Single MATLAB worker picks up job (uses all CPU cores — single queue)
→ MATLAB MCR runs (1–30 min)
→ Outputs 3D matrix [Height × Distance × Angle], 8–40 GB
→ Matrix stored (HDF5 or Zarr); metadata saved to PostgreSQL
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
- Test arc gap at candidate step values (0.05°, 0.1°, 0.2°, 0.5°) against typical AOI radii
- Consider terrain frequency (mountains change faster than flat land — worst case matters)
- Cross-reference with SRTM/Copernicus DEM resolution (30m/10m) — no point going finer than the DEM

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
- Entity placement + circular AOI drawing on map
- Scenario form (name, entities, signal params, height config, angular resolution)
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
