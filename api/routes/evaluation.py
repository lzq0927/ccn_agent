"""API routes for Agent 3: Evaluation & Optimization."""

from __future__ import annotations

from fastapi import APIRouter

from agents.shared.storage import Storage

router = APIRouter()


@router.get("/suggestions")
async def list_suggestions(
    status: str | None = None,
    suggestion_type: str | None = None,
):
    storage = Storage()
    return storage.list_suggestions(status=status, suggestion_type=suggestion_type)


@router.put("/suggestions/{suggestion_id}")
async def apply_suggestion(suggestion_id: int, action: str = "apply"):
    storage = Storage()
    if action == "apply":
        storage.apply_suggestion(suggestion_id)
        return {"status": "applied"}
    return {"status": "rejected"}


@router.get("/loop-progress")
async def get_loop_progress():
    storage = Storage()
    summary = storage.get_dashboard_summary()
    return summary


@router.get("/case-library")
async def get_case_library():
    from agents.evaluation.case_library import CaseLibraryBuilder

    library = CaseLibraryBuilder()
    return library.get_statistics()


@router.get("/reports")
async def list_reports(page: int = 1, page_size: int = 20):
    storage = Storage()
    # Get recent evaluations
    with storage._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM evaluations ORDER BY evaluated_at DESC LIMIT ? OFFSET ?",
            (page_size, (page - 1) * page_size),
        ).fetchall()
        return {"page": page, "reports": [dict(r) for r in rows]}
