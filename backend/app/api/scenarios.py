from __future__ import annotations
import json
from fastapi import APIRouter, HTTPException

from app.db.database import get_pool
from app.models import ScenarioCreate, ScenarioCreateResponse, ScenarioOut, EntityOut, RunOut

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.post("", response_model=ScenarioCreateResponse, status_code=201)
async def create_scenario(body: ScenarioCreate):
    pool = get_pool()

    params = body.model_dump(exclude={"name", "entities"})

    async with pool.acquire() as conn:
        async with conn.transaction():
            scenario_id = await conn.fetchval(
                "INSERT INTO scenarios(name, params) VALUES($1, $2) RETURNING id",
                body.name,
                json.dumps(params),
            )

            for i, entity in enumerate(body.entities):
                await conn.execute(
                    """
                    INSERT INTO entities(scenario_id, lat, lon, radius_km,
                        frequency_hz, power_w, azimuth_deg, antenna_height_m, sort_order)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    """,
                    scenario_id,
                    entity.lat, entity.lon, entity.radius_km,
                    entity.frequency_hz, entity.power_w,
                    entity.azimuth_deg, entity.antenna_height_m, i,
                )

            job_id = await conn.fetchval(
                "INSERT INTO jobs(scenario_id) VALUES($1) RETURNING id",
                scenario_id,
            )

            await conn.execute(
                """
                INSERT INTO runs(scenario_id, job_id, height_min_m, height_max_m, height_step_m)
                VALUES($1,$2,$3,$4,$5)
                """,
                scenario_id, job_id,
                body.height_min_m, body.height_max_m, body.height_step_m,
            )

    return ScenarioCreateResponse(
        scenario_id=str(scenario_id),
        job_id=str(job_id),
    )


@router.get("", response_model=list[ScenarioOut])
async def list_scenarios():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, params, created_at FROM scenarios ORDER BY created_at DESC LIMIT 50"
        )
        result = []
        for row in rows:
            scenario_id = row["id"]
            entities = await conn.fetch(
                "SELECT * FROM entities WHERE scenario_id=$1 ORDER BY sort_order", scenario_id
            )
            runs = await conn.fetch(
                "SELECT * FROM runs WHERE scenario_id=$1 ORDER BY created_at DESC", scenario_id
            )
            result.append(_build_scenario_out(row, entities, runs))
    return result


@router.get("/{scenario_id}", response_model=ScenarioOut)
async def get_scenario(scenario_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, params, created_at FROM scenarios WHERE id=$1", scenario_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Scenario not found")
        entities = await conn.fetch(
            "SELECT * FROM entities WHERE scenario_id=$1 ORDER BY sort_order", scenario_id
        )
        runs = await conn.fetch(
            "SELECT * FROM runs WHERE scenario_id=$1 ORDER BY created_at DESC", scenario_id
        )
    return _build_scenario_out(row, entities, runs)


def _build_scenario_out(row, entities, runs) -> ScenarioOut:
    return ScenarioOut(
        id=str(row["id"]),
        name=row["name"],
        params=dict(row["params"]),
        created_at=row["created_at"].isoformat(),
        entities=[
            EntityOut(
                id=str(e["id"]),
                lat=e["lat"], lon=e["lon"],
                radius_km=e["radius_km"],
                frequency_hz=e["frequency_hz"],
                power_w=e["power_w"],
                azimuth_deg=e["azimuth_deg"],
                antenna_height_m=e["antenna_height_m"],
            )
            for e in entities
        ],
        runs=[
            RunOut(
                id=str(r["id"]),
                job_id=str(r["job_id"]),
                height_min_m=r["height_min_m"],
                height_max_m=r["height_max_m"],
                height_step_m=r["height_step_m"],
                bbox_west=r["bbox_west"],
                bbox_south=r["bbox_south"],
                bbox_east=r["bbox_east"],
                bbox_north=r["bbox_north"],
                is_saved=r["is_saved"],
                name=r["name"],
                created_at=r["created_at"].isoformat(),
            )
            for r in runs
        ],
    )
