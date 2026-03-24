"""Job queue consumer — runs as a background asyncio task."""
from __future__ import annotations
import asyncio
import json
import logging
import traceback
from collections import defaultdict

from app.db.database import get_pool
from app.worker.dummy_matlab import run_dummy_matlab

logger = logging.getLogger(__name__)

# In-memory SSE channels: job_id -> list of asyncio.Queue
_sse_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


def subscribe_job(job_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _sse_subscribers[job_id].append(q)
    return q


def unsubscribe_job(job_id: str, q: asyncio.Queue) -> None:
    try:
        _sse_subscribers[job_id].remove(q)
    except ValueError:
        pass
    if not _sse_subscribers[job_id]:
        del _sse_subscribers[job_id]


async def _broadcast(job_id: str, event: dict) -> None:
    for q in list(_sse_subscribers.get(job_id, [])):
        await q.put(event)


async def _process_job(job_id: str, scenario_id: str) -> None:
    pool = get_pool()

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status='running', updated_at=NOW() WHERE id=$1", job_id
        )
        row = await conn.fetchrow("SELECT params FROM scenarios WHERE id=$1", scenario_id)
        params = json.loads(row["params"]) if isinstance(row["params"], str) else dict(row["params"])
        entities = await conn.fetch(
            "SELECT * FROM entities WHERE scenario_id=$1 ORDER BY sort_order", scenario_id
        )
        entity_list = [dict(e) for e in entities]
        run_row = await conn.fetchrow(
            "SELECT id FROM runs WHERE job_id=$1", job_id
        )
        run_id = str(run_row["id"])

    async def notify(event: dict):
        await _broadcast(job_id, event)

    try:
        hdf5_path, bbox = await run_dummy_matlab(
            job_id=job_id,
            run_id=run_id,
            scenario_params=params,
            entities=entity_list,
            notify_fn=notify,
        )

        west, south, east, north = bbox
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE runs SET
                    hdf5_path=$1,
                    bbox_west=$2, bbox_south=$3, bbox_east=$4, bbox_north=$5
                WHERE id=$6
                """,
                hdf5_path, west, south, east, north, run_id,
            )
            await conn.execute(
                "UPDATE jobs SET status='done', updated_at=NOW() WHERE id=$1", job_id
            )

        await _broadcast(job_id, {
            "type": "done",
            "scenario_id": scenario_id,
            "run_id": run_id,
        })

    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE jobs SET status='error', updated_at=NOW() WHERE id=$1", job_id
            )
        await _broadcast(job_id, {"type": "error", "message": str(exc)})


async def queue_worker() -> None:
    """Background task: polls for queued jobs and runs them one at a time."""
    logger.info("Job queue worker started")
    pool = get_pool()

    while True:
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT id, scenario_id FROM jobs
                    WHERE status='queued'
                    ORDER BY created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """
                )

            if row:
                job_id = str(row["id"])
                scenario_id = str(row["scenario_id"])
                logger.info("Processing job %s", job_id)
                await _process_job(job_id, scenario_id)
            else:
                await asyncio.sleep(1)

        except Exception:
            logger.exception("Queue worker error")
            await asyncio.sleep(2)
