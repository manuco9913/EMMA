"""Dummy MATLAB worker — generates synthetic propagation data for Phase 1."""
from __future__ import annotations
import asyncio
import math
import os
from pathlib import Path

import h5py
import numpy as np

from app.config import settings


def _compute_bbox(entities: list[dict]) -> tuple[float, float, float, float]:
    """Compute bounding box from entity positions and radii."""
    EARTH_DEG_PER_KM_LAT = 1.0 / 111.0

    west = min(
        e["lon"] - e["radius_km"] * EARTH_DEG_PER_KM_LAT / math.cos(math.radians(e["lat"]))
        for e in entities
    )
    east = max(
        e["lon"] + e["radius_km"] * EARTH_DEG_PER_KM_LAT / math.cos(math.radians(e["lat"]))
        for e in entities
    )
    south = min(e["lat"] - e["radius_km"] * EARTH_DEG_PER_KM_LAT for e in entities)
    north = max(e["lat"] + e["radius_km"] * EARTH_DEG_PER_KM_LAT for e in entities)
    return west, south, east, north


def _generate_dummy_grid(
    entities: list[dict],
    bbox: tuple[float, float, float, float],
    height_levels: int,
    grid_w: int,
    grid_h: int,
) -> np.ndarray:
    """Generate plausible-looking propagation data with distance falloff."""
    west, south, east, north = bbox
    rng = np.random.default_rng(42)

    # Shape: [height_levels, grid_h, grid_w]
    data = np.zeros((height_levels, grid_h, grid_w), dtype=np.float32)

    lon_coords = np.linspace(west, east, grid_w)
    lat_coords = np.linspace(south, north, grid_h)
    lon_grid, lat_grid = np.meshgrid(lon_coords, lat_coords)

    for h_idx in range(height_levels):
        height_factor = 1.0 + h_idx * 0.02  # slightly better coverage at height
        combined = np.full((grid_h, grid_w), -200.0, dtype=np.float32)

        for entity in entities:
            # Distance in degrees (approximate)
            dlat = lat_grid - entity["lat"]
            dlon = (lon_grid - entity["lon"]) * math.cos(math.radians(entity["lat"]))
            dist_deg = np.sqrt(dlat**2 + dlon**2)
            dist_km = dist_deg * 111.0

            # Signal model: free-space path loss + power + noise
            with np.errstate(divide="ignore", invalid="ignore"):
                fspl = np.where(
                    dist_km > 0,
                    20 * np.log10(dist_km + 0.001) + 20 * np.log10(entity["frequency_hz"]) - 147.55,
                    0.0,
                )
            power_dbm = 10 * math.log10(entity["power_w"] * 1000)
            signal = power_dbm - fspl + height_factor * 2
            noise = rng.normal(0, 1.5, size=(grid_h, grid_w)).astype(np.float32)
            signal = signal + noise

            # Mask outside radius
            outside = dist_km > entity["radius_km"]
            signal[outside] = -200.0

            combined = np.maximum(combined, signal)

        data[h_idx] = combined

    return data


async def run_dummy_matlab(
    job_id: str,
    run_id: str,
    scenario_params: dict,
    entities: list[dict],
    notify_fn,
) -> str:
    """Run the dummy MATLAB simulation and return the HDF5 file path."""
    data_dir = Path(settings.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    hdf5_path = str(data_dir / f"run_{run_id}.h5")

    height_min = scenario_params["height_min_m"]
    height_max = scenario_params["height_max_m"]
    height_step = scenario_params["height_step_m"]
    height_levels = max(1, int((height_max - height_min) / height_step) + 1)

    bbox = _compute_bbox(entities)
    west, south, east, north = bbox

    cell_size_m = scenario_params.get("grid_cell_size_m", 100.0)
    deg_per_m_lat = 1.0 / 111000.0
    grid_w = max(10, int((east - west) / (deg_per_m_lat * cell_size_m)))
    grid_h = max(10, int((north - south) / (deg_per_m_lat * cell_size_m)))

    # Cap grid size for prototype performance
    grid_w = min(grid_w, 500)
    grid_h = min(grid_h, 500)

    await notify_fn({"type": "progress", "pct": 10})
    await asyncio.sleep(2)  # simulate preprocessing

    await notify_fn({"type": "progress", "pct": 30})
    await asyncio.sleep(2)  # simulate MATLAB warmup

    # Run in thread pool to avoid blocking event loop
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(
        None,
        _generate_dummy_grid,
        entities,
        bbox,
        height_levels,
        grid_w,
        grid_h,
    )

    await notify_fn({"type": "progress", "pct": 70})
    await asyncio.sleep(1)

    # Write HDF5
    def _write_hdf5():
        with h5py.File(hdf5_path, "w") as f:
            ds = f.create_dataset(
                "propagation",
                data=data,
                chunks=(1, min(grid_h, 64), min(grid_w, 64)),
                compression="gzip",
                compression_opts=4,
            )
            ds.attrs["height_min_m"] = height_min
            ds.attrs["height_max_m"] = height_max
            ds.attrs["height_step_m"] = height_step
            ds.attrs["bbox_west"] = west
            ds.attrs["bbox_south"] = south
            ds.attrs["bbox_east"] = east
            ds.attrs["bbox_north"] = north
            ds.attrs["grid_w"] = grid_w
            ds.attrs["grid_h"] = grid_h

    await loop.run_in_executor(None, _write_hdf5)

    await notify_fn({"type": "progress", "pct": 95})
    await asyncio.sleep(0.5)

    return hdf5_path, bbox
