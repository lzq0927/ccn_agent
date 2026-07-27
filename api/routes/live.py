"""Live mode REST and WebSocket endpoints."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from agents.shared.live_runner import LiveRunner, RunnerRegistry, RunnerState
from agents.shared.scenario_plugin import REGISTRY, capabilities_snapshot

logger = logging.getLogger(__name__)

router = APIRouter()

_REGISTRY = RunnerRegistry(max_active=10)
_RUNNERS: dict[str, LiveRunner] = {}
_BUSES: dict[str, "_SessionBus"] = {}


class _FallbackLivePlugin:
    id = "F"
    capabilities = "live"


# Keep the REST contract usable before the scenario-plugin phase is installed.
if "F" not in REGISTRY:
    REGISTRY["F"] = _FallbackLivePlugin()


class SelectRequest(BaseModel):
    scenario_id: str


class ControlRequest(BaseModel):
    session_id: str
    action: str
    payload: Optional[dict] = None


class _SessionBus:
    """Per-session event buffer and subscriber list."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._subscribers: list[WebSocket] = []
        self._buffer: list[dict] = []

    def publish(self, type_: str, payload: dict) -> None:
        event = {
            "type": type_,
            "ts": asyncio.get_event_loop().time(),
            "session_id": self.session_id,
            "payload": payload,
        }
        self._buffer.append(event)
        if len(self._buffer) > 1000:
            self._buffer = self._buffer[-500:]
        for websocket in list(self._subscribers):
            try:
                asyncio.create_task(websocket.send_text(json.dumps(event, default=str)))
            except Exception:
                self._subscribers.remove(websocket)

    def attach(self, websocket: WebSocket) -> None:
        self._subscribers.append(websocket)
        for event in self._buffer[-200:]:
            try:
                asyncio.create_task(websocket.send_text(json.dumps(event, default=str)))
            except Exception:
                logger.exception("failed to replay live event")


@router.get("/capabilities")
async def get_capabilities():
    return capabilities_snapshot()


@router.post("/select")
async def select_scenario(req: SelectRequest):
    plugin = REGISTRY.get(req.scenario_id)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"scenario {req.scenario_id} not found")
    if plugin.capabilities != "live":
        return {
            "session_id": f"demo_{req.scenario_id}",
            "scenario_id": req.scenario_id,
            "capabilities": plugin.capabilities,
            "demo": True,
        }

    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    _REGISTRY.add(session_id)
    bus = _SessionBus(session_id)
    _BUSES[session_id] = bus

    from agents.shared.storage import Storage

    storage = Storage()
    storage.record_live_session(
        session_id, req.scenario_id, RunnerState.INIT.value, llm_mode="auto"
    )
    runner = LiveRunner(
        session_id=session_id,
        scenario_id=req.scenario_id,
        plugin=plugin,
        bus=bus,
        storage=storage,
        sim_window=60,
        tick_interval=0.0,
    )
    _RUNNERS[session_id] = runner
    asyncio.create_task(runner.run())
    return {
        "session_id": session_id,
        "scenario_id": req.scenario_id,
        "capabilities": "live",
    }


@router.post("/control")
async def control(req: ControlRequest):
    runner = _RUNNERS.get(req.session_id)
    if runner is None:
        raise HTTPException(status_code=404, detail="session not found")

    payload = req.payload or {}
    engine = getattr(runner, "_current_engine", None)
    if req.action == "pause" and engine is not None:
        engine.stepper.pause()
    elif req.action == "resume" and engine is not None:
        engine.stepper.resume()
    elif req.action == "set_speed" and engine is not None:
        engine.stepper.set_speed(float(payload.get("speed", 1.0)))
    elif req.action == "seek" and engine is not None:
        engine.stepper.seek(int(payload.get("sim_t", 0)))
    elif req.action == "restart":
        pass
    return {"ok": True, "action": req.action}


@router.get("/state/{session_id}")
async def get_state(session_id: str):
    bus = _BUSES.get(session_id)
    if bus is None:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session_id": session_id, "buffer_size": len(bus._buffer)}


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, session_id: str = ""):
    await websocket.accept()
    bus = _BUSES.get(session_id)
    if bus is None:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "error",
                    "payload": {"fatal": True, "message": "unknown session"},
                }
            )
        )
        await websocket.close()
        return
    bus.attach(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
