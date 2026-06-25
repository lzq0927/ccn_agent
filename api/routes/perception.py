"""API routes for Agent 2: Fault Perception."""

from __future__ import annotations

import asyncio
import csv
import json
import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from agents.shared.storage import Storage
from agents.shared.models import CaseData, parse_chr_jsonl

router = APIRouter()

_sessions: dict[str, dict] = {}


class DiagnoseRequest(BaseModel):
    case_id: int | None = None
    case_data: dict | None = None


@router.post("/diagnose")
async def submit_diagnosis(request: DiagnoseRequest):
    session_id = f"sess_{uuid.uuid4().hex[:8]}"
    _sessions[session_id] = {"status": "started", "case_id": request.case_id}

    async def run_diagnosis():
        from agents.fault_perception.agent import FaultPerceptionAgent

        agent = FaultPerceptionAgent(storage=Storage())

        # Load case data
        if request.case_id:
            storage = Storage()
            files = storage.load_case_files(request.case_id)
            if not files:
                _sessions[session_id] = {"status": "failed", "error": "Case not found"}
                return

            # Parse KPI rows
            kpi_rows = []
            for row in csv.DictReader(files["data.csv"].strip().split("\n")):
                kpi_rows.append(row)

            ground_truth = json.loads(files["result.txt"])

            case_data = CaseData(
                case_id=request.case_id,
                kpi_rows=kpi_rows,
                topology_text=files["topo.txt"],
                process_text=files["process.txt"],
                ground_truth=ground_truth,
                chr_records=parse_chr_jsonl(files.get("chr.jsonl", "")),
            )

            result = await agent.diagnose(case_data)
            _sessions[session_id] = {
                "status": "completed",
                "case_id": request.case_id,
                "diagnosis": {
                    "fault_elements": result.fault_elements,
                    "fault_links": result.fault_links,
                    "fault_type": result.fault_type,
                    "confidence": result.confidence,
                    "route": result.route_taken.value,
                    "iterations": result.iterations_used,
                },
            }

    asyncio.create_task(run_diagnosis())
    return {"session_id": session_id, "status": "started"}


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    storage = Storage()
    session = storage.get_session(session_id)
    if session:
        steps = storage.get_reasoning_steps(session_id)
        return {**session, "reasoning_steps": steps}
    return _sessions.get(session_id, {"status": "not_found"})


@router.get("/history")
async def get_history(page: int = 1, page_size: int = 20):
    storage = Storage()
    offset = (page - 1) * page_size
    sessions = storage.list_sessions(limit=page_size, offset=offset)
    return {"page": page, "page_size": page_size, "sessions": sessions}


@router.get("/status")
async def get_agent_status():
    return {
        "status": "idle",
        "active_sessions": len([s for s in _sessions.values() if s.get("status") == "started"]),
    }
