"""API routes for Agent 1: Fault Data Generation."""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, BackgroundTasks

from agents.shared.storage import Storage
from agents.shared.models import CaseParams

router = APIRouter()

# Active batch jobs
_jobs: dict[str, dict] = {}


@router.post("/batch")
async def create_generation_batch(
    count: int = 50,
    difficulty: str = "mixed",
    seed: int = 42,
    background_tasks: BackgroundTasks | None = None,
):
    batch_id = f"gen_{uuid.uuid4().hex[:8]}"
    _jobs[batch_id] = {"status": "started", "count": count, "completed": 0, "results": []}

    async def run_batch():
        from agents.data_generation.agent import FaultDataGenerationAgent
        agent = FaultDataGenerationAgent(storage=Storage())
        packages = await agent.generate_batch(count=count, seed=seed)
        _jobs[batch_id]["status"] = "completed"
        _jobs[batch_id]["completed"] = len(packages)
        _jobs[batch_id]["results"] = [
            {"case_id": p.case_id, "fault_type": p.metadata.fault_type, "validation": p.metadata.validation_status.value}
            for p in packages
        ]

    asyncio.create_task(run_batch())
    return {"batch_id": batch_id, "status": "started", "count": count}


@router.get("/batch/{batch_id}")
async def get_batch_status(batch_id: str):
    return _jobs.get(batch_id, {"status": "not_found"})


@router.get("/cases")
async def list_cases(
    fault_type: str | None = None,
    difficulty: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    storage = Storage()
    offset = (page - 1) * page_size
    cases = storage.list_cases(fault_type=fault_type, difficulty=difficulty,
                                limit=page_size, offset=offset)
    total = storage.count_cases()
    return {"total": total, "page": page, "page_size": page_size, "cases": cases}


@router.get("/cases/{case_id}")
async def get_case(case_id: int):
    storage = Storage()
    case = storage.get_case(case_id)
    if not case:
        return {"error": "Case not found"}
    files = storage.load_case_files(case_id)
    return {**case, "files": files is not None}
