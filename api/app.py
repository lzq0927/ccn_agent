"""FastAPI application factory."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import generation, perception, evaluation, websocket

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(
        title="5GC Fault Diagnosis Agent System",
        version="0.1.0",
        description="Cloud Core Network fault data generation, perception, and evaluation closed-loop system",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:8000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(generation.router, prefix="/api/v1/generation", tags=["generation"])
    app.include_router(perception.router, prefix="/api/v1/perception", tags=["perception"])
    app.include_router(evaluation.router, prefix="/api/v1/evaluation", tags=["evaluation"])
    app.include_router(websocket.router, prefix="/ws", tags=["websocket"])

    @app.get("/api/v1/dashboard/summary")
    async def dashboard_summary():
        from agents.shared.storage import Storage

        storage = Storage()
        return storage.get_dashboard_summary()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
