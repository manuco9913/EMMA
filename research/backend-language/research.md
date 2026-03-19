# Research: Backend Language — C# (.NET 8) vs Python (FastAPI)

## Overview

The backend for this wave propagation simulator has three primary responsibilities:

1. **Heavy geospatial preprocessing** — generating ray paths via geodesic math and sampling elevation from GeoTIFF rasters at up to 72 million points per scenario (10 entities × 3,600 rays × 2,000 distance steps at 100 m intervals).
2. **MATLAB MCR orchestration** — invoking compiled MATLAB routines (the actual propagation model) and exchanging data via HDF5 or Zarr files.
3. **Job lifecycle management** — pulling work from a PostgreSQL queue, executing preprocessing + MATLAB, and streaming status updates to clients via Server-Sent Events (SSE).

This document evaluates C# (.NET 8) and Python (FastAPI) against each of these responsibilities. The evaluation is grounded in the actual library ecosystems available on Linux/Docker, the throughput requirements of the preprocessing workload, and the team's existing experience.

---

## Python Stack

### Geospatial Libraries (rasterio, pyproj, numpy)

Python's geospatial ecosystem is one of the most mature in any language, driven by the fact that the underlying heavy lifting is performed by battle-tested C and C++ libraries (GDAL, PROJ, GEOS) with thin Python bindings.

**rasterio — GeoTIFF elevation sampling**

`rasterio` wraps GDAL and exposes a `dataset.sample(coords)` method that accepts an iterable of `(x, y)` coordinate pairs and returns elevation values. Critically, this is not a Python loop over individual points — the call descends into GDAL's C block cache machinery, which groups points by raster tile block, reads each block once from disk, and resolves all point lookups within that block before moving on. The result is that 2,000 points along a single ray, which are geographically clustered, will typically hit only a small number of raster blocks, keeping I/O minimal.

For the full 72 M-point scenario, coordinates are best batched per ray (2,000 points) or per entity (7.2 M points) and passed to `dataset.sample()` in a single vectorized call. There is no per-point Python overhead beyond constructing the coordinate array — the loop is inside GDAL's C runtime.

Key operational detail: rasterio opens a GeoTIFF in a context manager and is not thread-safe per dataset handle, but multiple handles to the same file can be opened concurrently (one per worker process). This maps naturally to a multiprocessing or `ProcessPoolExecutor` fan-out across the 10 entities.

**pyproj — geodesic math**

`pyproj.Geod.fwd()` computes forward geodesic problems (given start lat/lon, azimuth, and distance, compute end lat/lon) and accepts full NumPy arrays. The function signature is:

```python
lons2, lats2, back_az = geod.fwd(lons, lats, azimuths, distances)
```

When called with NumPy arrays, execution is vectorized inside PROJ's C library. Benchmarks for WGS-84 geodesic math via PROJ's C API consistently land in the range of 5–15 million points per second on modern server hardware. For 72 M points this yields an estimated 5–15 seconds of pure geodesic computation. In practice this is parallelizable across entities, reducing wall-clock time further.

The algorithm used by PROJ for WGS-84 geodesics is Karney's method (Geodesics on an ellipsoid of revolution, 2011), which achieves sub-nanometer accuracy globally — more than sufficient for RF propagation modeling.

**numpy — array orchestration**

NumPy ties rasterio and pyproj together. Ray azimuth generation, distance step arrays (`np.linspace`), and coordinate reshaping are all native NumPy operations with negligible overhead. The full coordinate array for one entity (3,600 rays × 2,000 steps) is a 7.2 M-element array of float64 pairs — approximately 115 MB in memory, well within normal process limits.

**h5py / zarr — file I/O with MATLAB**

`h5py` provides a Pythonic interface to HDF5 files, supporting chunked reads/writes and optional compression. Writing a 72 M-point elevation profile to HDF5 for MATLAB consumption is straightforward. `zarr` offers similar chunked array semantics with a simpler on-disk format and native support for cloud storage backends, but the library ecosystem around it is younger. Both are mature enough for production use on Linux.

### Performance

End-to-end preprocessing time estimate for a 72 M-point scenario (10 entities, 3,600 rays, 2,000 steps):

| Step | Method | Estimated time |
|---|---|---|
| Azimuth generation | `np.linspace` / arithmetic | < 1 s |
| Geodesic math (72 M pts) | `pyproj.Geod.fwd` vectorized | 5–15 s |
| GeoTIFF sampling (72 M pts) | `rasterio.dataset.sample()` | 5–20 s (I/O-bound) |
| HDF5 write | `h5py` chunked write | 2–10 s |
| **Total preprocessing** | | **~10–30 s** |

This compares favorably to the MATLAB propagation runtime of 1–30 minutes, meaning preprocessing is not the bottleneck and the 10–30 s estimate is acceptable. With `ProcessPoolExecutor` over 10 entities in parallel on a multi-core server, wall-clock time for the geodesic and sampling steps could be reduced by 4–8× on a typical 8-core VM.

### Web Framework (FastAPI)

FastAPI is an ASGI framework built on Starlette and Pydantic. It is a natural fit for this backend's API surface for several reasons:

**PostgreSQL job queue with asyncpg**

`asyncpg` is a high-performance async PostgreSQL driver. The standard pattern for a reliable job queue — `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction — is well-documented with asyncpg and requires no additional queue infrastructure (no Redis, no RabbitMQ). A worker loop polls the queue, claims a row atomically, runs preprocessing + MATLAB, and updates the row status on completion. This is a proven, simple pattern that is easy to reason about and debug.

```sql
-- Claim one pending job atomically
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

**Server-Sent Events**

FastAPI's `StreamingResponse` with an `async def` generator is the idiomatic way to implement SSE. The generator yields newline-delimited `data:` frames, and FastAPI handles the chunked HTTP response. This integrates naturally with asyncpg's `LISTEN`/`NOTIFY` mechanism — the SSE generator can await PostgreSQL notifications and forward them to the browser without polling:

```python
@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    async def event_stream():
        async with db_pool.acquire() as conn:
            await conn.execute(f"LISTEN job_{job_id}")
            async for notification in conn.notifications():
                yield f"data: {notification.payload}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

**Async/sync boundary for preprocessing**

FastAPI runs on an async event loop (uvicorn). CPU-bound preprocessing must not block the event loop. The correct pattern is `asyncio.get_event_loop().run_in_executor(None, preprocessing_fn)` or, better, delegating preprocessing to a worker process pool started at application startup. Heavy NumPy/rasterio work belongs in a `ProcessPoolExecutor` rather than a `ThreadPoolExecutor` due to the GIL.

### Pros / Cons

**Pros**

- rasterio and pyproj provide genuinely vectorized geospatial operations backed by GDAL and PROJ C libraries; no custom low-level code required.
- The 72 M-point preprocessing workload is achievable in 10–30 s without writing any native extensions.
- FastAPI + asyncpg + SSE is a proven, idiomatic stack for async job orchestration with real-time status push.
- h5py and zarr are both mature and well-maintained on Linux.
- Large community: most geospatial questions have answered Stack Overflow threads or GitHub issues.
- Docker images with GDAL, PROJ, and rasterio pre-installed are widely available (e.g., `ghcr.io/osgeo/gdal`).

**Cons**

- The GIL means CPU-bound preprocessing must use `multiprocessing` or a `ProcessPoolExecutor`, not threads. This is manageable but adds process-management complexity.
- Python type safety is opt-in (Pydantic helps at API boundaries, but internal logic is untyped unless annotated).
- The team's existing experience is primarily in .NET; there will be a ramp-up period.
- Memory profiling and debugging multiprocessing pipelines can be more opaque than equivalent .NET tooling.

---

## C# Stack

### Geospatial Libraries (GDAL.NET, CoordinateSharp, NetTopologySuite)

**GDAL.NET — GeoTIFF sampling**

GDAL.NET provides P/Invoke bindings to the GDAL C library. The bindings expose the full GDAL API, but they are lower-level than rasterio — there is no equivalent of `dataset.sample(coords)`. Implementing efficient multi-point raster sampling in C# requires writing custom block-grouping logic: for a given set of (x, y) coordinates, group them by raster block, read each block once using `Band.ReadRaster()`, resolve lookups within the block, and collect results. This is approximately 250–350 lines of non-trivial C# that duplicates logic rasterio provides for free. It must also correctly handle coordinate transformations from geographic (lat/lon) to pixel space using the dataset's geotransform matrix.

The underlying GDAL C performance is identical to rasterio's — the difference is purely in how much application code must be written and tested.

**CoordinateSharp — geodesic math**

CoordinateSharp is the most commonly cited C# library for geodetic computation. Its `Coordinate` class supports WGS-84 operations, but it is designed for individual point calculations, not batch/vectorized operations. Each geodesic forward computation constructs a new `Coordinate` object, performs the math in managed code, and returns. For 72 M points this means 72 M object allocations and 72 M individual method calls through managed C# — even with object pooling and aggressive GC tuning, this is 5–10× slower than pyproj's vectorized PROJ calls.

Matching pyproj's throughput in C# requires one of:

1. **P/Invoke to libproj directly** — call `proj_geod_direct()` from the PROJ C library via DllImport, passing arrays of coordinates. This achieves the same performance as pyproj but requires writing and maintaining native interop code, including marshalling float arrays across the managed/unmanaged boundary.
2. **Custom SIMD with `System.Runtime.Intrinsics`** — implement Karney's geodesic algorithm using AVX2 or SSE4.2 SIMD intrinsics in C#. This is a significant engineering undertaking (several weeks) and requires expert-level knowledge of both geodesic mathematics and SIMD programming.
3. **Wrapping a Rust or C crate** — compile a native shared library and P/Invoke into it. Adds a third language and build toolchain to the project.

None of these options are "free" — each represents substantial additional implementation work.

**NetTopologySuite — geometry operations**

NetTopologySuite (NTS) is a high-quality C# port of JTS and is the de facto standard for geometric operations in .NET. However, this workload does not primarily need geometric operations (union, intersection, buffering) — it needs geodesic point projection and raster value lookup. NTS does not provide either of these natively, so it does not reduce the gap.

### Performance

For the geodesic math step, CoordinateSharp in scalar mode on 72 M points:

- Assume 500 K–1 M points/second for managed C# scalar geodesic math (conservative, based on typical benchmark overhead for managed object allocation vs. PROJ C throughput).
- Estimated time: **72–144 seconds** for geodesic math alone, compared to 5–15 s with pyproj.

For GeoTIFF sampling with custom block-grouping logic:
- Once the block-grouping logic is correctly implemented, GDAL C performance is equivalent to rasterio.
- The implementation effort, not the runtime, is the cost here.

To reach Python-equivalent performance in C#, the team would need to invest in P/Invoke to libproj (or a native SIMD implementation), which recovers the geodesic throughput but at significant development cost.

### Web Framework (ASP.NET Core)

ASP.NET Core is a mature, high-performance web framework with excellent async support, strong typing, and good tooling. For this specific workload:

- **SSE** is supported via `IActionResult` with a custom `StreamContent` or by writing directly to `Response.Body` in a long-running controller action. It works but is less idiomatic than FastAPI's `StreamingResponse`; the controller must manage connection lifetime, cancellation tokens, and flushing manually.
- **PostgreSQL job queue** is well-supported via Npgsql, which supports `FOR UPDATE SKIP LOCKED` and `LISTEN`/`NOTIFY`. This is functionally equivalent to the asyncpg approach.
- **Background workers** via `IHostedService` / `BackgroundService` are first-class in ASP.NET Core, making job worker processes easy to structure.

ASP.NET Core does not confer a meaningful advantage or disadvantage for this specific backend compared to FastAPI.

### Pros / Cons

**Pros**

- The team has existing .NET experience from the POC phase; no language ramp-up required.
- Strong static typing catches more errors at compile time.
- Excellent IDE support (Visual Studio, Rider) with mature debugging and profiling tools.
- ASP.NET Core background services are well-structured and testable.
- Npgsql is a high-quality async PostgreSQL driver on par with asyncpg.

**Cons**

- No production-ready Zarr library for C# exists as of early 2026. If Zarr is chosen as the HDF5 alternative for MATLAB data exchange, C# would require either a custom implementation, a subprocess workaround (calling a Python or CLI tool), or abandoning Zarr entirely. HDF5 via PInvoke wrappers exists but is also less ergonomic than h5py.
- Matching pyproj's geodesic throughput requires P/Invoke to libproj or custom SIMD — several weeks of engineering work that Python provides for free.
- Efficient multi-point GeoTIFF sampling requires ~300 lines of custom block-grouping code that rasterio provides out of the box.
- The geospatial library ecosystem in C# is significantly thinner than Python's; many capabilities that exist as one-line Python calls require custom implementation in C#.
- CoordinateSharp scalar geodesic math is an order of magnitude slower than pyproj for batch workloads without native interop.

---

## MATLAB Integration Comparison

The MATLAB MCR (Compiled MATLAB Runtime) integration is a wash between the two languages.

**MATLAB Engine API** — MathWorks provides a MATLAB Engine API for Python (`matlab.engine`) and a .NET Engine API. However, both require the full MATLAB installation (not just MCR) on the host machine and are not compatible with compiled MCR deployments (`.ctf` archives or standalone executables). Since the requirement is to invoke compiled MATLAB routines via MCR, neither Engine API is applicable.

**Subprocess invocation** — Both Python (`subprocess.run`, `asyncio.create_subprocess_exec`) and C# (`System.Diagnostics.Process`) can launch the compiled MATLAB executable as a subprocess, pass arguments, and wait for completion. The compiled MATLAB executable reads inputs from files (HDF5 or Zarr) and writes outputs to files. Both languages handle this equally well.

**File-based I/O** — HDF5 (via h5py in Python, HDF5DotNet or custom P/Invoke in C#) and Zarr (zarr-python in Python, no production library in C#) are used to exchange data between the backend and MATLAB. Python has a clear advantage for Zarr; for HDF5 the gap is smaller but h5py remains more ergonomic than C# alternatives.

**Conclusion for MATLAB integration:** Subprocess invocation is equivalent in both languages. File format support slightly favors Python, especially if Zarr is in scope.

---

## Performance Benchmarks (Estimated)

All estimates are for a single-server deployment (8 cores, 32 GB RAM) processing one scenario: 10 entities × 3,600 rays × 2,000 steps = 72 M elevation points.

### Python (pyproj + rasterio)

| Phase | Implementation | Estimated wall-clock time |
|---|---|---|
| Ray azimuth generation | `np.linspace` | < 1 s |
| Geodesic forward projections (72 M pts) | `pyproj.Geod.fwd` vectorized | 5–15 s |
| GeoTIFF elevation sampling (72 M pts) | `rasterio.dataset.sample()` | 5–20 s |
| HDF5 write | `h5py` chunked | 2–10 s |
| **Total preprocessing** | | **~10–30 s** |
| MATLAB MCR propagation | Subprocess | 1–30 min |

With `ProcessPoolExecutor(max_workers=8)` over 10 entities, the preprocessing steps scale near-linearly with core count, potentially reducing wall-clock to 3–8 s.

### C# (.NET 8) — CoordinateSharp (no native interop)

| Phase | Implementation | Estimated wall-clock time |
|---|---|---|
| Ray azimuth generation | Array arithmetic | < 1 s |
| Geodesic forward projections (72 M pts) | CoordinateSharp scalar | 72–144 s |
| GeoTIFF elevation sampling (72 M pts) | Custom GDAL.NET block logic | 5–20 s (after correct impl.) |
| HDF5 write | HDF5 .NET wrapper | 2–10 s |
| **Total preprocessing** | | **~80–175 s** |

### C# (.NET 8) — with P/Invoke to libproj

| Phase | Implementation | Estimated wall-clock time |
|---|---|---|
| Geodesic forward projections (72 M pts) | P/Invoke libproj | 5–15 s |
| GeoTIFF sampling + HDF5 write | Same as above | 7–30 s |
| **Total preprocessing** | | **~12–45 s** |
| Additional implementation cost | | Several weeks |

The P/Invoke approach matches Python performance but requires significant upfront engineering investment to implement and test the native interop layer.

### Context: MATLAB runtime dominates

At 1–30 minutes for MATLAB propagation, preprocessing at 10–30 s (Python) vs. 80–175 s (C# without native interop) represents the difference between a negligible overhead and a 2–5% overhead on the median scenario. Neither is a true bottleneck. However, the engineering cost to reach Python-equivalent C# performance is not justified when the bottleneck lies elsewhere.

---

## Recommendation

**Use Python (FastAPI) for the backend.**

The decision is driven primarily by the geospatial preprocessing workload. Python's ecosystem — rasterio, pyproj, numpy — provides genuinely vectorized, GDAL/PROJ-backed geospatial operations out of the box that would require substantial custom C# development to replicate. Specifically:

- `pyproj.Geod.fwd` on NumPy arrays delivers 5–15 M geodesic points/second through PROJ's C library with zero custom code. The C# equivalent (P/Invoke to libproj) requires several weeks of implementation and native interop maintenance.
- `rasterio.dataset.sample()` handles GeoTIFF block caching and multi-point lookup through GDAL's C runtime. The C# equivalent requires ~300 lines of custom block-grouping logic.
- No production Zarr library exists for C#. If Zarr is chosen for HDF5 data exchange with MATLAB, C# hits a hard dependency gap; Python does not.

FastAPI is a capable, async-first web framework that handles the SSE + job queue requirements idiomatically. The asyncpg + `FOR UPDATE SKIP LOCKED` PostgreSQL job queue pattern is well-proven and requires no additional infrastructure.

The team's existing .NET experience is a real cost to switching, but it is a one-time ramp-up. The geospatial library gap in C# is an ongoing cost that compounds with every new preprocessing feature, every raster format, and every geodesic edge case encountered in production.

**Recommended stack:**

| Concern | Technology |
|---|---|
| Web framework | FastAPI (ASGI, uvicorn) |
| Geospatial math | pyproj (PROJ), numpy |
| Raster I/O | rasterio (GDAL) |
| Array file I/O | h5py (HDF5) or zarr |
| PostgreSQL driver | asyncpg |
| Job queue | PostgreSQL `FOR UPDATE SKIP LOCKED` |
| SSE | FastAPI `StreamingResponse` + async generator |
| MATLAB invocation | `asyncio.create_subprocess_exec` |
| Parallelism | `ProcessPoolExecutor` over entities |
| Container base image | `ghcr.io/osgeo/gdal:ubuntu-small-latest` or `osgeo/gdal` |

---

## Open Questions

1. **HDF5 vs. Zarr for MATLAB data exchange** — If MATLAB's compiled routines can read/write HDF5 natively (which MATLAB supports via `h5read`/`h5write`), HDF5 is the simpler choice and removes the Zarr dependency. If Zarr's chunked access patterns or storage flexibility are required, confirm MATLAB MCR can handle Zarr (likely via a custom MATLAB function in the compiled package). See the `hdf5-vs-zarr` research directory.

2. **GeoTIFF tiling and block size** — rasterio's `dataset.sample()` performance is sensitive to whether the GeoTIFF is internally tiled (e.g., 256×256 or 512×512 tile blocks) vs. strip-organized. For random-access point sampling across 72 M geographically distributed points, tiled GeoTIFFs are strongly preferred. The terrain data pipeline should ensure GeoTIFFs are retiled with `gdal_translate -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512` if they are not already.

3. **Coordinate reference system of terrain rasters** — `rasterio.dataset.sample()` expects coordinates in the dataset's native CRS. If the GeoTIFFs are in a projected CRS (e.g., UTM) and geodesic math produces WGS-84 lat/lon, a `pyproj.Transformer` step is required between the geodesic computation and the raster sampling. This adds negligible overhead (vectorized transformer) but must be accounted for in the pipeline.

4. **Memory footprint for 72 M points** — A 72 M × 2 float64 coordinate array is ~1.15 GB. If all 10 entities are processed simultaneously in separate processes, peak memory consumption is ~11.5 GB for coordinates alone, plus GDAL block cache. Server sizing should account for this. Processing entities serially (or in batches of 4–5) reduces peak memory at the cost of wall-clock time.

5. **ProcessPoolExecutor vs. Celery/worker processes** — For the initial implementation, `ProcessPoolExecutor` within the FastAPI process is sufficient. If the simulation workload grows to require distributed execution across multiple machines, a task queue (Celery, Dramatiq, or a custom PostgreSQL-backed queue with separate worker processes) may be preferable. The PostgreSQL `FOR UPDATE SKIP LOCKED` pattern already supports multiple independent worker processes and scales horizontally without additional infrastructure.

6. **Python version and dependency pinning** — Confirm that the target Docker base image provides Python 3.11 or 3.12 (both are supported by all recommended libraries). Pin all dependencies in `requirements.txt` or `pyproject.toml` with hashes for reproducibility in offline deployments.

7. **Team Python upskilling plan** — Given the team's primary background in .NET, budget time for onboarding to Python async patterns (particularly the `async`/`await` model in FastAPI, the GIL and `ProcessPoolExecutor`, and NumPy broadcasting idioms). The learning curve is real but bounded; the geospatial libraries have good documentation and the FastAPI async patterns are well-documented.
