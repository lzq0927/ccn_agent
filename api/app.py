"""FastAPI application factory."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import evaluation, generation, live, perception, websocket

logger = logging.getLogger(__name__)

_LIVE_ENABLED = os.getenv("CC_LIVE_ENABLED", "1") == "1"


def create_app() -> FastAPI:
    app = FastAPI(
        title="5GC Fault Diagnosis Agent System",
        version="0.1.0",
        description="Cloud Core Network fault data generation, perception, and evaluation closed-loop system",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",  # frontend-show(展会演示前端)
            "http://localhost:5175",  # frontend-flow(方案流程演示 LIVE 模式)
            "http://localhost:5179",  # frontend-flow-demo(引导式展会 LIVE 真实仿真)
            "http://localhost:8000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(generation.router, prefix="/api/v1/generation", tags=["generation"])
    app.include_router(perception.router, prefix="/api/v1/perception", tags=["perception"])
    app.include_router(evaluation.router, prefix="/api/v1/evaluation", tags=["evaluation"])
    app.include_router(websocket.router, prefix="/ws", tags=["websocket"])
    if _LIVE_ENABLED:
        app.include_router(live.router, prefix="/api/v1/live", tags=["live"])
        app.add_api_websocket_route("/ws/live", live.ws_endpoint)

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
