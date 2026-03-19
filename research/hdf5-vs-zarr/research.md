# Research: HDF5 vs Zarr (Matrix Storage)

> **Context**: The system stores per-entity 3D propagation matrices of shape
> `[Height × Distance × Angle]`, ranging from 8–40 GB per entity. The dominant
> read pattern is a single height-level slice (`Distance × Angle`, ~200 MB)
> served to the frontend for heatmap rendering. The computation engine is
> MATLAB MCR (Compiled Runtime). The backend is C# .NET 8 (or Python). All
> deployments must be fully offline-capable (Docker-compose, Linux containers,
> no cloud dependencies at runtime).

---

## Overview

Both HDF5 and Zarr are chunked, N-dimensional array formats capable of
handling datasets far larger than RAM. The critical difference for this system
is *who writes the file* and *how well the read access pattern aligns with the
format's chunking model*. MATLAB MCR can write HDF5 natively — this is the
single most important constraint that shapes the recommendation.

| Property | HDF5 | Zarr |
|---|---|---|
| Chunk-based storage | Yes (optional, but standard practice) | Yes (mandatory, by design) |
| Partial/slice reads without full load | Yes — hyperslab API | Yes — first-class operation |
| MATLAB MCR native write | **Yes** | No — requires post-processing |
| C# library | PureHDF (pure managed), HDF5.NET | No mature production library |
| Python library | h5py (mature, widely used) | zarr (mature, widely used) |
| Compression | gzip, szip, LZF, Blosc (plugin) | gzip, Blosc2, Zstd, LZ4 (built-in) |
| Concurrent write (multi-worker) | Requires HDF5-MPI or sequential | Chunk-level: trivially parallel |
| Single-file vs directory | Single file | Directory tree (or zip store) |
| Offline-capable | Yes | Yes |
| Cloud-native | No (added via VOL connectors) | Yes (S3, GCS, Azure native) |
| Maturity / ecosystem | ~25 years, extremely stable | ~8 years, growing fast |

---

## HDF5

HDF5 (Hierarchical Data Format version 5) is a binary container format for
structured scientific data. It is the de facto standard in computational
science and is natively produced by MATLAB, HDF-EOS, NetCDF-4, and many others.

### Chunked Storage and Hyperslab Access

By default, MATLAB writes HDF5 datasets with a specific layout that depends on
how the write call is made:

- `h5create` + `h5write`: the dataset is written as a **contiguous** layout
  by default. A contiguous layout makes full-file reads fast but partial reads
  (hyperslabs) very slow for large files, because the OS must seek through
  the entire file to assemble a non-contiguous slice.
- To get efficient partial reads, the dataset **must be created with chunking
  enabled** (`'ChunkSize'` parameter in `h5create`). With chunking, HDF5
  stores data in fixed-size tile blocks on disk; a hyperslab read that spans
  only a few chunks reads only those chunks.

**Hyperslab access** is the HDF5 API mechanism for reading a rectangular
subregion of an N-dimensional dataset. In MATLAB:

```matlab
data = h5read(filename, dataset, start, count, stride);
```

In C# with PureHDF:

```csharp
var file = H5File.OpenRead(path);
var dataset = file.Dataset("/propagation");
var selection = new HyperslabSelection(
    rank: 3,
    starts:  [heightIndex, 0, 0],
    strides: [1, 1, 1],
    counts:  [1, distanceCount, angleCount],
    blocks:  [1, 1, 1]
);
float[] slice = dataset.Read<float[]>(fileSelection: selection);
```

In Python with h5py:

```python
with h5py.File(path, "r") as f:
    slice_2d = f["propagation"][height_index, :, :]  # ~200 MB
```

**Performance depends entirely on chunk alignment with the access pattern.**
If the file was chunked along the Height dimension (i.e., each chunk is a
complete `Distance × Angle` slab), then each height-level read requires
reading exactly one contiguous chunk per chunk tile — this is optimal.
If chunked along Angle or Distance, a height-level slice will touch every
chunk in the file, causing catastrophic read amplification.

**The chunk shape must be chosen at write time by MATLAB.** If the MATLAB
code that produces the output is not configured to chunk along the Height
dimension, the read performance for this system's access pattern will be poor.

### MATLAB MCR Write Support

MATLAB's HDF5 write functions (`h5create`, `h5write`, `h5writeatt`) are part
of the core MATLAB toolbox, not an add-on. They are **fully available in the
Compiled Runtime (MCR)**. An MCR-compiled executable can write HDF5 files
without a MATLAB license server at runtime — the HDF5 library is bundled
with the MCR installer.

Typical MATLAB write pattern for a 3D matrix:

```matlab
h5create(filename, '/propagation', size(matrix), ...
    'ChunkSize', [1, size(matrix,2), size(matrix,3)], ...
    'Deflate', 4);           % gzip level 4
h5write(filename, '/propagation', matrix);
h5writeatt(filename, '/', 'height_min_m', height_min);
h5writeatt(filename, '/', 'height_max_m', height_max);
h5writeatt(filename, '/', 'height_step_m', height_step);
```

The key is specifying `ChunkSize` as `[1, D, A]` (one height level, all
distance steps, all angles). This makes each chunk exactly one height slice —
the dominant read pattern in this system.

If the MATLAB code is not owned and cannot be modified to control chunk
layout, there is a risk that it writes contiguous or poorly-chunked HDF5.
In that case, a post-processing step (using `h5repack` or h5py) would be
needed to re-chunk the file — the same cost as converting to Zarr.

### Compression in HDF5

HDF5 supports compression as a filter pipeline applied per-chunk:

- **Deflate (gzip)**: built into libhdf5. Level 1–9. Widely supported.
  Typical ratio for float32 propagation data: 2–5x (data dependent).
- **Szip**: patent-encumbered, avoid.
- **LZF**: fast, lower ratio. Available as a plugin.
- **Blosc**: very high throughput (multi-threaded), available as an HDF5
  plugin. Requires the plugin to be installed on the reader side as well —
  a deployment concern for air-gapped systems.

For air-gapped deployments, sticking to **gzip (Deflate)** is safest: it is
built into libhdf5 and requires no additional plugins.

### Pros

- MATLAB MCR writes HDF5 natively — no post-processing step required.
- Mature, stable format with 25+ years of ecosystem support.
- Single file per entity: easier to manage, move, and back up.
- Hyperslab reads are efficient when the dataset is correctly chunked.
- PureHDF (C#) provides full hyperslab read support without native
  dependencies — works inside Linux Docker containers on .NET 8.
- h5py (Python) is the industry standard for HDF5 access.
- Compression (gzip) is built-in, no plugins needed for basic use.
- HDF5 attributes support rich metadata (height range, step, entity ID, etc.)
  stored alongside the data in the same file.
- `h5repack` CLI tool can re-chunk files if the initial chunk layout is wrong.
- HDFView and other tools enable manual inspection without writing code.

### Cons

- Efficient partial reads **require chunking to be set correctly at write
  time**. A contiguous or poorly-chunked dataset will perform badly for
  height-slice reads. If the MATLAB code is not owned or configurable, this
  is a real risk.
- Single-file format: concurrent writes from multiple MATLAB workers to the
  same file require HDF5-MPI (parallel HDF5) or serialized writes. The
  per-entity separate files model sidesteps this issue.
- HDF5 files can become corrupted if a process crashes mid-write without
  flushing. For this use case (write-once, read-many), this is a minor
  concern — a failed write simply produces no file, and the job is retried.
- Blosc compression (for higher throughput) requires a plugin on both writer
  and reader — fragile in air-gapped deployments. Stick to gzip.
- HDF5 library is a C library. PureHDF (C#) avoids the native dependency
  but is less battle-tested than h5py. h5py wraps libhdf5 directly.

---

## Zarr

Zarr is a chunked, compressed, N-dimensional array format designed from the
ground up for parallel access. Each chunk is stored as an independent file
(or object, in cloud storage). There is no single monolithic container file.

### Chunking Model

Zarr stores each chunk as a separate file under a directory tree:

```
entity_123.zarr/
  .zarray          # JSON metadata: shape, dtype, chunk shape, compressor
  .zattrs          # User attributes (JSON)
  0.0.0            # chunk [0, :, :] — first height slice
  1.0.0            # chunk [1, :, :] — second height slice
  ...
```

If the chunk shape is set to `[1, D, A]`, each height slice is exactly one
file on disk. Reading height slice N means reading one file: `N.0.0`. There
is no seek overhead, no coordination with a container format, and no risk of
reading unnecessary data.

### Compression in Zarr

Zarr has built-in support for a rich set of compressors via the `numcodecs`
library:

- **Blosc2** (default in Zarr v3): multi-threaded, uses LZ4 or Zstd. Up to
  2–10 GB/s throughput on modern NVMe.
- **Zstd**: better compression ratio than gzip at similar or faster speed.
- **LZ4**: very fast, lower ratio.
- **gzip**: compatible with HDF5 pipelines.

All required codec code is bundled in the `numcodecs` Python package — no
separate plugin installation needed.

### MATLAB and Zarr

**MATLAB has no native Zarr write support.** There is no `zarr_create` or
equivalent function in the MATLAB standard library or MCR. To use Zarr:

1. **Convert after write**: MATLAB writes HDF5; a Python post-processing
   step (h5py + zarr) converts to Zarr. Adds ~1.5–3 min per 40 GB file and
   doubles disk usage during conversion.
2. **Third-party MATLAB Zarr library compiled into MCR**: Requires owning and
   modifying the MATLAB code. Not feasible if the MATLAB code is third-party.

In all cases, Zarr requires an intermediate step that HDF5 does not.

### C# Support for Zarr

As of early 2026, there is no mature, production-ready Zarr library for C#/.NET.
Community projects (SharpZarr, Zarr.Net) are incomplete — missing codec support,
not actively maintained. This is a significant gap for a C# .NET 8 backend.

### Python Support for Zarr

The `zarr` Python package is mature, actively maintained (v3 released 2024).
`arr[height_index, :, :]` reads exactly the relevant chunks. Excellent
integration with Dask for out-of-core computation.

### Pros

- Chunked by design — slice reads are first-class, no risk of contiguous layout.
- Built-in high-performance compression (Blosc2, Zstd) — no plugin management.
- Trivially parallel writes: multiple workers can write different chunks
  simultaneously without coordination. Ideal for the multi-worker partial-write
  pattern described in the plan.
- Simple format: a chunk is just a compressed binary file — debuggable without
  a library.
- No single-file corruption risk on crash.

### Cons

- MATLAB MCR cannot write Zarr natively — a conversion step is required.
  **This is the decisive constraint.**
- No mature C# library. A C# backend cannot use Zarr without significant
  custom work or subprocess calls.
- Directory-of-files format: harder to move/copy atomically than a single
  HDF5 file. A 40 GB matrix with 1 MB chunks = ~40,000 files.
- Zarr v2 and v3 are not fully interoperable; library version mismatches
  can cause compatibility issues.

---

## MATLAB MCR Output Format

### What MCR Can Write Natively

| Function | Format | Notes |
|---|---|---|
| `h5create` / `h5write` | HDF5 | Full HDF5 write including chunking, compression, attributes |
| `save(filename, '-v7.3')` | HDF5 | `.mat` v7.3 format is HDF5 under the hood |
| `matfile` | HDF5 (.mat v7.3) | Allows incremental write to large `.mat` files |
| `fwrite` | Raw binary | Possible but requires custom reader |

**The `.mat` v7.3 format is HDF5.** MATLAB's `save(filename, '-v7.3')` produces
files that are fully valid HDF5 files, readable by h5py, PureHDF, or HDFView.

**Key finding: MCR writes HDF5, but chunking must be explicit.** A default
`save('-v7.3')` produces a contiguous layout, which is poor for partial reads.
The MATLAB code must use `h5create` with `ChunkSize = [1, D, A]` explicitly.

If the MATLAB code is not owned and cannot be modified, the mitigation is a
mandatory `h5repack` post-processing step:

```bash
h5repack -l propagation:CHUNK=1,D,A -f GZIP=4 input.h5 output.h5
```

This takes ~2–5 min per 40 GB file on NVMe; can run as a background task.

---

## Performance Comparison (Slice Reads, Write Throughput)

### Slice Read Performance

| Scenario | Format | Layout | Expected Read Time (NVMe SSD) |
|---|---|---|---|
| Best case | HDF5 | Chunked `[1, D, A]` | ~0.5–2 s |
| Best case | Zarr | Chunked `[1, D, A]`, Blosc2 | ~0.3–1.5 s |
| Worst case | HDF5 | Contiguous (default `save`) | 10–60+ s |
| Worst case | HDF5 | Chunked on wrong axis | ~10–60 s |

Both formats achieve similar read performance when correctly chunked. The
**chunk shape is the dominant factor**, not the format.

### Write Throughput

Writing a 40 GB matrix from MATLAB:

| Method | Approx. Throughput | Notes |
|---|---|---|
| HDF5 `h5write` (gzip L4, chunked) | ~200–500 MB/s | CPU-bound on compression |
| HDF5 `h5write` (no compression) | ~1–3 GB/s | NVMe-bound |
| Zarr (Python, Blosc2) | ~500 MB/s–2 GB/s | Multi-threaded compression |

For a 40 GB matrix at 400 MB/s effective write throughput (gzip L4), write
time is ~100 s (~1.7 min). Acceptable for a 1–30 min MATLAB job.

---

## Library Support (C# and Python)

### C# (.NET 8)

| Library | Format | Status | Notes |
|---|---|---|---|
| **PureHDF** | HDF5 | Active (2024–2025) | Pure managed C#, no native deps, NuGet. Supports hyperslab reads, gzip works natively. |
| **HDF5.NET** | HDF5 | Active | P/Invoke wrapper around libhdf5. Full API, more complex. |
| **SharpZarr / Zarr.Net** | Zarr | Incomplete | Community projects, not production-ready. |

**Recommendation for C# backend**: use **PureHDF** for its zero-native-dependency
advantage in Linux Docker containers.

### Python (FastAPI or worker process)

| Library | Format | Status | Notes |
|---|---|---|---|
| **h5py** | HDF5 | Mature, production-standard | NumPy-style indexing: `f["ds"][h, :, :]`. Thread-safe reads. |
| **zarr** | Zarr | Mature (v3 stable 2024) | `arr[h, :, :]` reads exactly the relevant chunks. Excellent async support. |

---

## Recommendation

**Use HDF5, written by MATLAB MCR with explicit chunking (`ChunkSize = [1, D, A]`).**

### Rationale

1. **MATLAB MCR writes HDF5 natively.** This is the decisive factor. Adding
   a Zarr conversion step means every job produces a 40 GB file, waits for
   conversion (~1.5–3 min), and requires double disk space during conversion.

2. **HDF5 with correct chunking matches the access pattern.** With
   `ChunkSize = [1, D, A]`, height-slice reads are as fast as Zarr.

3. **C# backend has a solid HDF5 library (PureHDF).** There is no mature C#
   Zarr library.

4. **Single-file management.** A single 40 GB `.h5` file per entity is
   simpler to manage than 40,000 chunk files. The "save/discard run" flow
   requiring atomic deletion is cleaner with single files.

5. **Air-gapped deployment is trivial.** HDF5's gzip compression requires no
   plugins. PureHDF requires no native dependencies.

### What Must Be Done to Make HDF5 Work Well

- The MATLAB code must use `h5create` with `'ChunkSize', [1, D, A]` and
  `'Deflate', 4`. If the MATLAB code is not owned, plan a mandatory
  `h5repack` post-processing step.
- Store metadata as HDF5 root attributes: `height_min_m`, `height_max_m`,
  `height_step_m`, `entity_id`, `scenario_id`, `created_at`.
- Write one file per entity (already planned) — eliminates concurrent-write issues.
- Use gzip/Deflate compression (no plugins needed).

### When to Reconsider Zarr

- The MATLAB code is owned and can write Zarr via a compiled community library.
- The backend is Python-only and Zarr's parallel write model is needed for
  concurrent partial-result saving from MATLAB workers.
- The system expands to cloud storage where Zarr's object-store model is an
  advantage.

None of these conditions apply to the current system as described.

---

## Open Questions

1. **Is the MATLAB code owned?** If yes: add `h5create` with `ChunkSize` and
   `Deflate`. If no: plan mandatory `h5repack` post-processing.

2. **What is the exact HDF5 dataset path in the MATLAB output?** If using
   `save('-v7.3')`, the dataset name is the MATLAB variable name. The backend
   reader must know this path — it cannot be auto-discovered safely.

3. **What dtype does MATLAB output?** `double` (float64) vs `single`
   (float32). Float32 halves the file size. If MATLAB outputs float64,
   consider converting to float32 before storage.

4. **Does MATLAB write one 3D array per entity, or a combined array per
   scenario?** The plan models per-entity separate files — confirm this matches
   MATLAB's actual output.

5. **What is the Height dimension size?** At 1 m step from 0–500 m: 500 slices.
   At 10 m step: 50 slices. Affects `h5repack` time and total file size.

6. **Is SWMR needed?** Only if the frontend must display partial results while
   MATLAB is still writing. Not required by the current design.

7. **PureHDF compatibility with MATLAB-generated HDF5**: MATLAB adds
   non-standard metadata to its HDF5 files. Run a proof-of-concept before
   committing to PureHDF in production.

8. **Disk capacity planning**: at 40 GB per entity, 10 entities per scenario,
   multiple saved runs — storage can reach terabytes quickly. Confirm the
   volume mount targets a sufficiently large disk.
