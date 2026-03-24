"""Read propagation slices from HDF5 and serialize to binary wire format."""
from __future__ import annotations
import struct

import h5py
import numpy as np

# Header layout (56 bytes, little-endian):
# magic(4) + version(2) + reserved(2) + width(4) + height(4) +
# min_val(4) + max_val(4) + west(8) + south(8) + east(8) + north(8)
HEADER_MAGIC = 0x57415645  # "WAVE"
HEADER_VERSION = 1
HEADER_FORMAT = "<IHHIIffdddd"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)  # 56 bytes


def read_slice(hdf5_path: str, height_m: float) -> bytes:
    """
    Read the propagation slice at the given height from an HDF5 file.
    Returns binary: header (56 bytes) + Float32Array body.
    """
    with h5py.File(hdf5_path, "r") as f:
        ds = f["propagation"]
        height_min = float(ds.attrs["height_min_m"])
        height_step = float(ds.attrs["height_step_m"])
        west = float(ds.attrs["bbox_west"])
        south = float(ds.attrs["bbox_south"])
        east = float(ds.attrs["bbox_east"])
        north = float(ds.attrs["bbox_north"])

        height_levels = ds.shape[0]
        idx = int(round((height_m - height_min) / height_step))
        idx = max(0, min(idx, height_levels - 1))

        # Shape: [grid_h, grid_w]
        slice_2d: np.ndarray = ds[idx, :, :]

    # Replace sentinel (-200) with NaN for client
    data = slice_2d.astype(np.float32)
    data[data <= -199.0] = float("nan")

    grid_h, grid_w = data.shape

    valid = data[np.isfinite(data)]
    if valid.size > 0:
        min_val = float(valid.min())
        max_val = float(valid.max())
    else:
        min_val = 0.0
        max_val = 0.0

    header = struct.pack(
        HEADER_FORMAT,
        HEADER_MAGIC,
        HEADER_VERSION,
        0,          # reserved
        grid_w,
        grid_h,
        min_val,
        max_val,
        west,
        south,
        east,
        north,
    )

    return header + data.tobytes()
