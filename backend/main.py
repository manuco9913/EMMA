"""Minimal FastAPI backend for Wave Propagation Simulator Phase 0.5."""

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Wave Propagation Simulator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CONTRACTS_DIR = Path(__file__).parent.parent / "contracts"


@app.get("/api/schema/scenario")
def get_scenario_schema() -> dict:
    return json.loads((CONTRACTS_DIR / "scenario.schema.json").read_text())


@app.get("/api/schema/entity")
def get_entity_schema() -> dict:
    return json.loads((CONTRACTS_DIR / "entity.schema.json").read_text())
