# Phase 1 Prototype QA Plan

## Setup

### Backend
```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash
pip install -e .
uvicorn app.main:app --reload
```

**Requires**: PostgreSQL 16 running locally on port 5432 with DB `wavesim`, user `wavesim`, password `wavesim`.
Quick setup: `docker run -d -p 5432:5432 -e POSTGRES_DB=wavesim -e POSTGRES_USER=wavesim -e POSTGRES_PASSWORD=wavesim postgres:16-alpine`

### Frontend
```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

---

## Test Cases

### TC-01: Backend health
- **Steps**: GET `http://localhost:8000/api/health`
- **Expected**: `{"status": "ok"}` — 200 OK

### TC-02: DB schema init
- **Steps**: Start backend. Check PostgreSQL for tables.
  ```sql
  \dt   -- should list: scenarios, entities, jobs, runs
  ```
- **Expected**: All 4 tables exist.

---

### TC-03: Create scenario (API)
- **Steps**: POST `http://localhost:8000/api/scenarios`
  ```json
  {
    "name": "Test Scenario",
    "entities": [{
      "lat": 51.5, "lon": 0.0, "radius_km": 50,
      "frequency_hz": 900000000, "power_w": 10,
      "azimuth_deg": 0, "antenna_height_m": 30
    }],
    "height_min_m": 0, "height_max_m": 100, "height_step_m": 10,
    "angular_resolution_deg": 0.1, "grid_cell_size_m": 100,
    "include_terrain": true, "combination_method": "max"
  }
  ```
- **Expected**: 201 with `{ "scenario_id": "...", "job_id": "..." }`
- **Check**: `scenario_id` and `job_id` are valid UUIDs.

### TC-04: SSE job progress
- **Steps**: Immediately after TC-03, open `http://localhost:8000/api/jobs/{job_id}/events` in browser or curl:
  ```bash
  curl -N http://localhost:8000/api/jobs/{job_id}/events
  ```
- **Expected sequence** (over ~5–7 seconds):
  ```
  data: {"type": "progress", "pct": 10}
  data: {"type": "progress", "pct": 30}
  data: {"type": "progress", "pct": 70}
  data: {"type": "progress", "pct": 95}
  data: {"type": "done", "scenario_id": "...", "run_id": "..."}
  ```
- **Check**: Connection closes after `done`. No hanging.

### TC-05: Slice endpoint
- **Steps**: After TC-04 completes, GET:
  `http://localhost:8000/api/runs/{run_id}/slice?height_m=50`
- **Expected**: Binary response, Content-Type `application/octet-stream`
- **Check**:
  - Response size > 56 bytes
  - First 4 bytes (little-endian uint32) = `0x57415645`
  - Bytes 8–12 = width (uint32), bytes 12–16 = height (uint32)
  - Both width and height should be 10–500
  - Body after byte 56 is `width * height * 4` bytes

### TC-06: SSE on already-done job
- **Steps**: Re-open SSE for an already-completed job_id
- **Expected**: Single `done` event returned immediately, stream closes.

### TC-07: Invalid slice height
- **Steps**: GET `/api/runs/{run_id}/slice?height_m=99999`
- **Expected**: 200 OK (clamped to max height, not 400/500)

### TC-08: Run not ready
- **Steps**: While a job is still running, GET its run's slice
- **Expected**: 409 Conflict with `{"detail": "Run not yet complete"}`

---

### TC-09: Frontend renders
- **Steps**: Open `http://localhost:5173`
- **Expected**: MapLibre map fills the right panel. Left sidebar visible. OSM tiles load.
- **Check no console errors** about missing files or import errors.

### TC-10: Add entity
- **Steps**: Click "+ Add Entity" in the sidebar.
- **Expected**: Entity card appears with default params (radius 50km, 900 MHz, etc.)

### TC-11: Place entity on map
- **Steps**: Click "📍 Place on map" on Entity 1. Click somewhere on the map.
- **Expected**:
  - Cursor changes to crosshair during placement
  - Banner "Click map to place Entity 1" appears
  - After click: numbered marker appears on the map
  - Radius circle drawn around entity position
  - Button shows lat/lon coordinates

### TC-12: Multiple entities
- **Steps**: Add 3 entities, place each at different map locations.
- **Expected**:
  - Each entity gets a different color marker (red, blue, green)
  - Each has its own radius circle in matching color
  - No source ID conflicts in MapLibre (check browser console)

### TC-13: Run simulation (end-to-end)
- **Steps**:
  1. Add 1 entity, place it on the map
  2. Set height: 0m to 100m, step 10m
  3. Click "▶ Run Simulation"
  4. Watch progress bar in Results tab
- **Expected**:
  - Button disables and shows "Running… X%"
  - Tab auto-switches to Results
  - Progress bar fills from 0 → 10 → 30 → 70 → 95 → 100%
  - After ~7–10 seconds: heatmap appears on the map
  - Height slider shows range 0–100m, 11 levels

### TC-14: Height slider
- **Steps**: After TC-13, drag the height slider.
- **Expected**:
  - Each slider position triggers a new API call to `/runs/{id}/slice?height_m=X`
  - Heatmap on map updates with new data
  - Loading is fast (<2s per slice)
  - No flickering or map viewport reset

### TC-15: Numeric height input
- **Steps**: Type a value directly in the height numeric input field.
- **Expected**: Heatmap updates to that height. Value is clamped to [min, max].

### TC-16: Heatmap coloring
- **Steps**: Observe the heatmap after TC-13.
- **Expected**:
  - Areas close to the entity are yellow/green (strong signal)
  - Areas far away or outside the radius are transparent
  - Color transitions smoothly (viridis-style ramp)
  - No solid black rectangles covering the map

### TC-17: Heatmap bounding box
- **Steps**: After TC-13, verify the heatmap bbox matches entity position.
- **Expected**: Heatmap is centered on the entity with roughly `radius_km` extent in each direction.

---

### TC-18: Form validation
- **Steps**: Clear the scenario name field, click Run.
- **Expected**: "Name is required" validation message. Run does not proceed.

### TC-19: Entity limit
- **Steps**: Try to add 11 entities.
- **Expected**: "+ Add Entity" button disappears after 10.

### TC-20: API list endpoint
- **Steps**: GET `http://localhost:8000/api/scenarios`
- **Expected**: Array of scenarios with nested `entities` and `runs` arrays. `runs[0].hdf5_path` is populated after job completion.

---

## Known Limitations (Not Bugs)

- Map tiles are OSM raster — requires internet connection. No PMTiles for offline use yet.
- No save/discard run flow (Phase 2).
- No real terrain data (dummy random values).
- Height slider triggers a fetch on every step change — no debounce yet.
- No ring-buffer prefetch of adjacent height levels yet.
- Color breakpoints are hardcoded (no user-adjustable UI yet).
- Single job at a time (queue picks up one job and runs it).

## What to Report

File bugs for:
1. Any unhandled 500 errors from the backend
2. CORS errors in browser console
3. MapLibre GL errors (source/layer conflicts)
4. SSE connection not closing after `done`
5. Binary slice parsing producing NaN-only data or wrong width/height
6. Heatmap not appearing after job completes
7. TypeScript build errors (`npm run build`)
