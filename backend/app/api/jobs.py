from __future__ import annotations
import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.db.database import get_pool
from app.worker.queue import subscribe_job, unsubscribe_job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}/events")
async def job_events(job_id: str, request: Request):
    pool = get_pool()
    row = await pool.fetchrow("SELECT id, status FROM jobs WHERE id=$1", job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    # If already done/error, return a single event immediately
    if row["status"] in ("done", "error"):
        async def _terminal():
            if row["status"] == "done":
                run_row = await pool.fetchrow(
                    "SELECT id, scenario_id FROM runs WHERE job_id=$1", job_id
                )
                event = {"type": "done", "scenario_id": str(run_row["scenario_id"]), "run_id": str(run_row["id"])}
            else:
                event = {"type": "error", "message": "Job failed"}
            yield f"data: {json.dumps(event)}\n\n"
        return StreamingResponse(_terminal(), media_type="text/event-stream")

    queue = subscribe_job(job_id)

    async def _stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ": keepalive\n\n"
        finally:
            unsubscribe_job(job_id, queue)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
