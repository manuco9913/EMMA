from __future__ import annotations
import asyncio

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.db.database import get_pool
from app.hdf5.reader import read_slice

router = APIRouter(prefix="/api/runs", tags=["slices"])


@router.get("/{run_id}/slice")
async def get_slice(
    run_id: str,
    height_m: float = Query(0.0, description="Height in metres"),
):
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT hdf5_path, height_min_m, height_max_m FROM runs WHERE id=$1", run_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")
    if not row["hdf5_path"]:
        raise HTTPException(status_code=409, detail="Run not yet complete")

    hdf5_path = row["hdf5_path"]

    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, read_slice, hdf5_path, height_m)

    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Length": str(len(data))},
    )
