# Research: MATLAB MCR Integration

## Overview

This document covers integration patterns for invoking a compiled MATLAB MCR (MATLAB Compiler Runtime) executable from a backend service. The MATLAB code is a black box — we do not own or maintain it. It has been compiled by the MATLAB developer into a standalone MCR executable, which we must treat as an opaque process.

Key constraints that drive every decision in this document:

- The MCR executable is a single worker: only one job runs at a time, no parallel MATLAB instances.
- Jobs are long-running: 1–30 minutes, using all CPU cores (MATLAB's parallel pool).
- The system must work fully offline / air-gapped — no license server, no internet access.
- The integration must support two deployment modes: same-machine (child process) and remote compute server.
- Each MATLAB core writes partial results to disk immediately upon completion to prevent RAM flooding and preserve progress on crash.
- The output is a per-entity 3D matrix with dimensions `[Height × Distance × Angle]`.

---

## Why MATLAB Engine API Is Not Viable for MCR

There are two MATLAB Engine APIs commonly considered for programmatic invocation: the Python Engine API (`matlab.engine`) and the .NET Engine API (`MWArray` / COM automation). Both are eliminated for this project.

**The fundamental constraint:** Both Engine APIs require a licensed MATLAB installation on the machine where they run. They connect to a MATLAB process that itself requires a valid license. The MCR (MATLAB Compiler Runtime) is not a licensed MATLAB installation — it is a stripped-down runtime that only executes compiled artifacts. It does not expose the Engine API surface.

Consequences:

- `matlab.engine.start_matlab()` (Python) will fail unless a full MATLAB installation with a valid license is present. An MCR-only machine cannot satisfy this requirement.
- The .NET `MWArray` interop layer is part of the MATLAB Compiler SDK and is used when building .NET-wrapped MCR libraries (`.dll` output type). This is a different compilation target from a standalone executable. If the MATLAB developer compiled to a standalone executable rather than a .NET library, `MWArray` is not applicable.
- Even if the developer were willing to recompile as a .NET library, this would couple the backend to a Windows-only deployment and require the MATLAB Compiler SDK license on the developer's side.

**Conclusion:** Both Engine API options are eliminated. The only viable invocation mechanism is subprocess execution of the compiled MCR executable with file-based I/O.

---

## Invocation: Subprocess Pattern

The compiled MCR executable is invoked as a child process. The backend service:

1. Writes input data to a file (HDF5 or MAT) in a job-specific working directory.
2. Spawns the MCR executable as a subprocess, passing the input file path and output file path (and any other parameters) as command-line arguments.
3. Monitors the process for completion or timeout.
4. Reads the output HDF5 file written by MATLAB.
5. Captures stdout and stderr to a job-specific log file.

The MCR executable's argument signature must be agreed upon with the MATLAB developer. A typical convention is:

```
wave_sim.exe <input_hdf5_path> <output_hdf5_path> [optional_params...]
```

On Linux (remote server), the executable may be a shell wrapper that sets `LD_LIBRARY_PATH` to the MCR installation before launching the binary. This is standard MCR deployment practice.

### Python Implementation

```python
import subprocess
import os
import signal
import logging
from pathlib import Path

def run_mcr_job(
    executable: str,
    input_path: str,
    output_path: str,
    timeout_seconds: int = 2400,  # 40 min ceiling
    log_path: str | None = None,
) -> int:
    """
    Invoke the MCR executable as a subprocess.
    Returns the process exit code.
    Raises subprocess.TimeoutExpired if the job exceeds timeout_seconds.
    """
    cmd = [executable, input_path, output_path]

    log_file = open(log_path, "w") if log_path else subprocess.DEVNULL

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=log_file,
            # Create a new process group so we can kill the entire tree
            # on timeout (MATLAB's parallel pool spawns child workers).
            # On Unix: os.setsid  — on Windows: CREATE_NEW_PROCESS_GROUP
            start_new_session=True,  # Unix
            # creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,  # Windows
        )

        try:
            exit_code = proc.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            # Kill the entire process group, not just the parent.
            # MATLAB's parallel pool spawns child MATLAB workers that
            # will linger if only the parent is killed.
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)  # Unix
            # On Windows: use psutil.Process(proc.pid).children(recursive=True)
            proc.wait()
            raise

        return exit_code

    finally:
        if log_path:
            log_file.close()
```

Key points:
- `start_new_session=True` on Unix places the process in its own session, making it possible to send `SIGKILL` to the entire process group.
- On Windows, use `creationflags=subprocess.CREATE_NEW_PROCESS_GROUP` and `psutil` to enumerate and kill child processes.
- Always wait for the process after killing to avoid zombie processes.
- Never use `proc.kill()` alone when MATLAB is involved — the parallel pool spawns child workers that will not be killed by targeting only the parent PID.

### C# Implementation

```csharp
using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

public static class McrInvoker
{
    /// <summary>
    /// Runs the MCR executable and waits for it to complete.
    /// Kills the entire process tree on cancellation or timeout.
    /// </summary>
    public static async Task<int> RunAsync(
        string executablePath,
        string inputHdf5Path,
        string outputHdf5Path,
        string logFilePath,
        CancellationToken cancellationToken)
    {
        var psi = new ProcessStartInfo
        {
            FileName = executablePath,
            ArgumentList = { inputHdf5Path, outputHdf5Path },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        using var logWriter = new StreamWriter(logFilePath, append: false);

        process.OutputDataReceived += (_, e) => { if (e.Data != null) logWriter.WriteLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) logWriter.WriteLine("[ERR] " + e.Data); };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        var tcs = new TaskCompletionSource<int>();
        process.Exited += (_, _) => tcs.TrySetResult(process.ExitCode);

        using var reg = cancellationToken.Register(() =>
        {
            KillProcessTree(process);
            tcs.TrySetCanceled();
        });

        return await tcs.Task;
    }

    private static void KillProcessTree(Process root)
    {
        // .NET 5+: Kill(entireProcessTree: true) handles Windows job objects.
        try { root.Kill(entireProcessTree: true); }
        catch { /* process may have already exited */ }
    }
}
```

Key points:
- `.Kill(entireProcessTree: true)` is available in .NET 5+ and correctly handles Windows process trees.
- On .NET Framework or older runtimes, use WMI or `taskkill /T /F /PID` to kill the tree.
- Redirect both stdout and stderr to a job-specific log file.
- Use `CancellationToken` for timeout integration with ASP.NET Core or worker services.

---

## MCR Input Format

**Recommended format: HDF5** (request from the MATLAB developer that the executable accepts HDF5 input).

Rationale:

| Format | Verdict | Reason |
|---|---|---|
| HDF5 (`.h5`) | Recommended | Language-agnostic, scales to large arrays, first-class library support in C# (PureHDF), Python (h5py), and natively in MATLAB. |
| MAT v7.3 (`.mat`) | Acceptable | Internally HDF5. MATLAB reads it natively. Slightly less portable than raw HDF5 but acceptable if the developer prefers it. |
| MAT v6 / v7 | Avoid | Binary format with 2 GB size limit. Not HDF5. |
| Raw binary | Avoid | No schema, fragile, requires out-of-band metadata agreement. |
| JSON | Impractical | Not suitable for large numeric arrays. Verbose and slow to parse. |
| CSV | Impractical | Same as JSON — no support for multi-dimensional arrays. |

HDF5 is preferred over MAT v7.3 because:
- It makes the I/O format independent of MATLAB conventions.
- C# and Python libraries (PureHDF, h5py) can read and write it without any MATLAB dependency.
- The schema is self-describing: variable names, shapes, and types are stored in the file.

The input HDF5 file should contain all parameters needed for a single job: entity definitions, geographic/spatial parameters, frequency, environment settings, etc. The exact schema must be defined in collaboration with the MATLAB developer.

---

## MCR Output Format

**MATLAB writes HDF5 output using `h5create` / `h5write`.** These functions are available in compiled MCR executables without any additional toolbox.

### Critical: Chunking for Efficient Reads

The output matrix has dimensions `[Height × Distance × Angle]`. The backend reads height slices (i.e., a single height index, all distances, all angles). Without chunking, the HDF5 file uses contiguous storage, which means reading a height slice requires seeking across the entire file — very slow for large arrays.

**Request that the MATLAB developer writes the output with explicit chunking:**

```matlab
% In the MATLAB source (before compilation):
h5create(output_path, '/results', [num_heights, num_distances, num_angles], ...
    'ChunkSize', [1, num_distances, num_angles], ...
    'Deflate', 4);  % optional gzip compression per chunk
h5write(output_path, '/results', result_matrix);
```

With `ChunkSize=[1, D, A]`, each height slice is stored as a contiguous chunk on disk. A height-slice read then requires reading exactly one chunk — O(D × A) bytes — with no unnecessary I/O.

### If the Output Arrives Without Chunking

If the MATLAB developer uses `save('-v7.3', ...)` (which writes contiguous HDF5), chunking must be applied as a post-processing step using `h5repack`:

```bash
h5repack -l results:CHUNK=1xDxA input.h5 output_chunked.h5
```

`h5repack` is part of the HDF5 tools package and is available on all platforms. This adds latency after the MATLAB job completes but is a one-time transformation per job. Prefer requesting proper chunking from the developer to avoid this step.

### Partial Results

Since each MATLAB core writes partial results immediately upon completion (see the Partial Results section below), the output file may contain intermediate datasets while the job is still running. The backend must be able to read completed datasets from a partially-written HDF5 file. HDF5 supports this: each `h5write` call is atomic at the dataset level, so a completed dataset can be read safely while other datasets are still being written.

---

## MCR Licensing (Air-Gapped)

The MCR is **completely free** with no runtime license requirement.

Details:

- The MCR is a freely redistributable runtime. MathWorks distributes MCR installers publicly at no cost.
- At runtime, the MCR does not contact any license server. It does not require internet access.
- The MCR can be bundled into Docker images and deployed to air-gapped environments with no special configuration.
- The only license that matters is the **MATLAB Compiler license** held by the developer who compiled the executable. Once compiled, the resulting binary + MCR can be distributed and run freely.
- There is no per-seat, per-machine, or per-execution fee for MCR usage.

Air-gapped deployment checklist:

1. Obtain the MCR installer from the MATLAB developer or MathWorks (matching the MATLAB version used for compilation — version must match exactly).
2. Install the MCR on the target machine or bake it into the Docker image.
3. Set environment variables as required by the MCR (typically `LD_LIBRARY_PATH` on Linux, handled by the MCR shell wrapper).
4. No network configuration is needed. No ports need to be opened.

MCR version pinning: The MCR version must exactly match the MATLAB version used to compile the executable (e.g., MATLAB R2024a requires MCR R2024a). Mismatches cause runtime errors. Pin the MCR version in infrastructure-as-code and lock it alongside the executable artifact.

---

## Error Handling

### Exit Code

The MCR executable returns a non-zero exit code on failure. Always check the exit code — do not assume success.

```python
if exit_code != 0:
    raise RuntimeError(f"MCR job failed with exit code {exit_code}. See log: {log_path}")
```

### Stderr

MATLAB writes runtime errors to stderr. Capture stderr to the job log file (same file as stdout for simplicity). On failure, include the last N lines of the log in the error response to the caller.

### Timeout

Set a ceiling timeout (e.g., 40 minutes) above the expected maximum job duration (30 minutes). On timeout:

1. Kill the entire process tree (not just the parent PID — MATLAB's parallel pool spawns child worker processes that will linger and consume CPU if only the parent is killed).
2. Mark the job as `TimedOut` in the job store.
3. Log the timeout event with the job ID and elapsed time.
4. The partial results written to disk before the timeout may still be usable — check which output datasets are complete.

### Process Tree Kill

This is the most common error-handling mistake with MATLAB subprocess integration. MATLAB's `parpool` and `parfeval` spawn additional MATLAB worker processes as children of the main process. If you kill only the parent:

- Worker processes continue running.
- They hold CPU and memory.
- They may continue writing to the output file, corrupting partial results.

Always kill the entire process group (Unix) or process tree (Windows).

### Log File Convention

Use a per-job log file path, e.g.:

```
/jobs/{job_id}/matlab.log
```

This isolates logs per job, simplifies debugging, and makes it trivial to retrieve the log for a specific failed job.

---

## Partial Results / Multi-Worker Write Pattern

The MATLAB code uses a parallel pool internally (`parfor` or `parfeval`). Each worker is assigned a subset of the computation (e.g., a subset of height indices or entities). As each worker completes its assigned slice, it writes the result immediately to disk rather than accumulating in RAM.

### Why This Matters

- **RAM flooding prevention:** A full `[Height × Distance × Angle]` matrix for many entities can exceed available RAM if held entirely in memory. Writing completed slices immediately keeps memory pressure bounded.
- **Crash recovery:** If the MATLAB process crashes mid-job (OOM, hardware fault, timeout), the results written before the crash are preserved on disk and may be partially usable.

### HDF5 Write Pattern (MATLAB Side)

The MATLAB developer should structure the output so that each completed slice is written as a separate named dataset or as a slice into a pre-allocated dataset:

**Option A — Pre-allocated dataset, slice writes:**

```matlab
% Create the full dataset upfront (fills with zeros)
h5create(output_path, '/results', [num_heights, num_distances, num_angles], ...
    'ChunkSize', [1, num_distances, num_angles]);

% Each worker writes its height slice when done:
h5write(output_path, '/results', slice_data, [h, 1, 1], [1, num_distances, num_angles]);
```

This approach writes individual height slices atomically. A reader can check which slices are non-zero (or use a separate completion-tracking dataset) to identify what is available.

**Option B — Per-worker separate datasets:**

```matlab
% Each worker writes its own dataset:
dataset_name = sprintf('/results/height_%04d', height_idx);
h5create(output_path, dataset_name, [num_distances, num_angles]);
h5write(output_path, dataset_name, slice_data);
```

Option B is easier to implement atomically (a dataset either exists or it does not), but requires the backend to assemble slices from multiple datasets after the job completes.

### Backend Read Pattern

When reading partial results during or after a job:

- Open the HDF5 file in read-only mode.
- Enumerate available datasets or check slice completeness.
- Do not hold the file open between polling intervals to avoid locking issues on Windows.

---

## Remote Invocation Strategy

When MATLAB runs on a separate compute server, the backend cannot directly spawn a child process. Two approaches are viable:

### Option A — Lightweight REST Wrapper (Recommended)

Deploy a small HTTP service on the compute server that wraps the MCR subprocess invocation. The backend communicates with it over HTTP.

**API surface:**

```
POST   /jobs           Body: { input_path, output_path, params }  → { job_id }
GET    /jobs/{id}      → { status, progress, started_at, log_tail }
DELETE /jobs/{id}      → cancel (kills process tree)
GET    /jobs/{id}/log  → full log file contents
```

Status values: `queued`, `running`, `completed`, `failed`, `timed_out`, `cancelled`.

The REST wrapper is responsible for:
- Queuing jobs (single worker constraint — reject or queue concurrent requests).
- Spawning and monitoring the MCR process.
- Killing the process tree on DELETE or timeout.
- Exposing log tails for debugging.

File I/O between the backend and the compute server can be handled via:
- **Shared NFS/SMB mount:** Both machines see the same filesystem path. Simplest approach.
- **Object store (S3-compatible):** Backend uploads input, MATLAB server downloads it, writes output, backend downloads it. Works across network boundaries but adds latency and complexity.
- **SCP / SFTP:** Acceptable for low-frequency jobs but awkward to integrate into a service.

Shared NFS is the simplest choice for a controlled air-gapped environment.

### Option B — SSH Exec

The backend SSHes into the compute server and runs the MCR executable directly via `ssh user@host /path/to/wave_sim.exe ...`. Simpler to set up initially, but less robust:

- No structured status polling — must parse stdout to infer progress.
- Cancellation is awkward (requires a second SSH call to kill the process).
- No log retrieval API.
- SSH connection lifetime is tied to job duration (network interruption = lost job reference).

SSH exec is appropriate for manual testing or one-off invocations. For production, prefer the REST wrapper.

---

## Abstract Interface Design

To support both local (same-machine subprocess) and remote (REST wrapper) invocation with the same backend code, define an abstract worker interface. The concrete implementation is injected at startup based on configuration.

```csharp
// C# interface
public interface IMatlabWorker
{
    /// <summary>Submit a job and return an opaque job ID.</summary>
    Task<string> SubmitJobAsync(MatlabJobInput input, CancellationToken ct = default);

    /// <summary>Poll job status and progress.</summary>
    Task<MatlabJobStatus> GetStatusAsync(string jobId, CancellationToken ct = default);

    /// <summary>Cancel a running job (kills process tree).</summary>
    Task CancelAsync(string jobId, CancellationToken ct = default);

    /// <summary>Retrieve the tail of the MATLAB log for a job.</summary>
    Task<string> GetLogTailAsync(string jobId, int lines = 50, CancellationToken ct = default);
}

// Local implementation — wraps Process.Start()
public class LocalMcrWorker : IMatlabWorker
{
    // Uses McrInvoker.RunAsync() internally.
    // Stores job state in an in-memory ConcurrentDictionary<string, JobRecord>.
}

// Remote implementation — calls the REST wrapper on the compute server
public class RemoteMcrWorker : IMatlabWorker
{
    // Uses HttpClient to call POST/GET/DELETE /jobs on the remote service.
}
```

**Registration (ASP.NET Core):**

```csharp
// Program.cs — choose implementation from config
if (config["Matlab:Mode"] == "remote")
    builder.Services.AddSingleton<IMatlabWorker, RemoteMcrWorker>();
else
    builder.Services.AddSingleton<IMatlabWorker, LocalMcrWorker>();
```

**Supporting types:**

```csharp
public record MatlabJobInput(
    string InputHdf5Path,
    string OutputHdf5Path,
    string WorkingDirectory
);

public record MatlabJobStatus(
    string JobId,
    JobState State,           // Queued, Running, Completed, Failed, TimedOut, Cancelled
    double? ProgressPercent,  // null if not reported
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    int? ExitCode
);

public enum JobState { Queued, Running, Completed, Failed, TimedOut, Cancelled }
```

The interface hides all invocation details from the rest of the backend. Switching from local to remote deployment requires only a configuration change, no code changes.

---

## Recommendation

1. **Invocation:** Subprocess only. Do not attempt to use the MATLAB Engine API — it is incompatible with MCR-only deployments.

2. **Input format:** Request HDF5 from the MATLAB developer. If the developer insists on MAT files, MAT v7.3 (HDF5-backed) is acceptable. Provide the developer with the exact schema (dataset names, shapes, types) as a specification document.

3. **Output format:** Request HDF5 with `ChunkSize=[1, num_distances, num_angles]` written via `h5create`/`h5write`. If output arrives without chunking (e.g., via `save('-v7.3',...)`), apply `h5repack` as a post-processing step, but raise this with the developer to get proper chunking at the source.

4. **Partial results:** Request that the MATLAB code pre-allocates the output dataset and writes each completed height slice immediately via `h5write` with an offset. This is the safest write pattern for crash recovery.

5. **MCR licensing:** No action required. The MCR is free and air-gapped-capable. Pin the MCR version to match the compiled executable version and include it in the deployment artifact.

6. **Local deployment:** Use `LocalMcrWorker` with `Process.Kill(entireProcessTree: true)` and a ceiling timeout of 40 minutes.

7. **Remote deployment:** Deploy a lightweight REST wrapper (Python FastAPI or Go HTTP server — both are easy to deploy and have no license requirements) on the compute server. Use `RemoteMcrWorker` in the backend. Share input/output files via NFS or an object store.

8. **Interface:** Implement `IMatlabWorker` from day one, even if only `LocalMcrWorker` is needed initially. The abstraction costs almost nothing and avoids a painful refactor when the remote compute server is introduced.

---

## Open Questions

1. **MCR executable argument signature:** What command-line arguments does the compiled executable accept? Who owns the CLI design — us or the MATLAB developer? This must be locked down before integration work begins.

2. **Input schema:** What datasets does the HDF5 input file need to contain? What are the types and shapes? This requires a collaborative specification session with the MATLAB developer.

3. **Output chunking:** Will the MATLAB developer implement `h5create`/`h5write` with explicit `ChunkSize`, or will they use `save('-v7.3',...)`? If the latter, we need to plan for `h5repack` post-processing.

4. **Partial result signaling:** How does the backend know which height slices are complete in a partially-written output file? Options: (a) a separate `/completed_slices` boolean array dataset, (b) checking for non-zero values (fragile), (c) a sidecar JSON file updated by MATLAB after each slice write.

5. **Progress reporting:** Can the MATLAB executable write progress to stdout (e.g., `PROGRESS:42` lines) so the backend can parse it and expose a percentage to callers? This requires agreement with the MATLAB developer.

6. **MCR version:** What MATLAB release was used to compile the executable? The MCR installer version must match exactly.

7. **Remote compute server OS:** Is the remote server Linux or Windows? This affects the process group kill strategy and the MCR shell wrapper approach.

8. **File staging for remote deployment:** How will input HDF5 files be transferred to the compute server and output files retrieved? NFS mount, object store, or SCP? This determines the file path strategy in `MatlabJobInput`.

9. **Single-worker enforcement:** Where is the "one job at a time" constraint enforced — in the backend queue, in the REST wrapper on the compute server, or both? A miscoordination could allow two jobs to run simultaneously and starve each other of CPU.

10. **Crash recovery:** If the MATLAB process crashes mid-job and partial results are on disk, does the backend attempt to resume or re-run the job from scratch? Resumption requires the MATLAB code to accept a "restart from slice N" parameter.
