from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Literal
import uuid


class EntityInput(BaseModel):
    lat: float
    lon: float
    radius_km: float = Field(gt=0, le=500)
    frequency_hz: float = Field(gt=0)
    power_w: float = Field(gt=0)
    azimuth_deg: float = Field(default=0.0, ge=0, lt=360)
    antenna_height_m: float = Field(default=30.0, gt=0)


class ScenarioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    entities: list[EntityInput] = Field(min_length=1, max_length=10)
    height_min_m: float = Field(default=0.0, ge=0)
    height_max_m: float = Field(default=500.0, gt=0)
    height_step_m: float = Field(default=10.0, gt=0)
    angular_resolution_deg: float = Field(default=0.1, ge=0.01, le=2.0)
    grid_cell_size_m: float = Field(default=100.0, gt=0)
    include_terrain: bool = True
    combination_method: Literal["max", "sum"] = "max"
    path_loss_exp: float = Field(default=2.0, ge=1.0, le=5.0)
    noise_std_db: float = Field(default=1.5, ge=0.0, le=20.0)


class ScenarioCreateResponse(BaseModel):
    scenario_id: str
    job_id: str


class EntityOut(BaseModel):
    id: str
    lat: float
    lon: float
    radius_km: float
    frequency_hz: float
    power_w: float
    azimuth_deg: float
    antenna_height_m: float


class RunOut(BaseModel):
    id: str
    job_id: str
    height_min_m: float
    height_max_m: float
    height_step_m: float
    bbox_west: float | None
    bbox_south: float | None
    bbox_east: float | None
    bbox_north: float | None
    is_saved: bool
    name: str | None
    created_at: str


class ScenarioOut(BaseModel):
    id: str
    name: str
    params: dict
    created_at: str
    entities: list[EntityOut]
    runs: list[RunOut]


class JobStatusOut(BaseModel):
    id: str
    scenario_id: str
    status: str
    created_at: str
