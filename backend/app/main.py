from __future__ import annotations
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.database import create_pool, close_pool, get_pool
from app.api import scenarios, jobs, slices
from app.worker.queue import queue_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _init_db():
    schema_path = Path(__file__).parent / "db" / "schema.sql"
    sql = schema_path.read_text()
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(sql)
    logger.info("Database schema initialized")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    await create_pool()
    await _init_db()
    worker_task = asyncio.create_task(queue_worker())
    logger.info("Application started")

    yield

    # Shutdown
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    await close_pool()
    logger.info("Application stopped")


app = FastAPI(title="Wave Propagation Simulator API", lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenarios.router)
app.include_router(jobs.router)
app.include_router(slices.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_STATIC_DIR = Path(__file__).parent.parent / "static"
_STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/static", StaticFiles(directory=_STATIC_DIR), name="static")
