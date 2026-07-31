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
from agents.shared.realtime_runner import RealtimeLiveRunner
from agents.simulation.live_scenarios import SCENARIOS as LIVE_SCENARIOS, get_scenario

logger = logging.getLogger(__name__)

router = APIRouter()

_REGISTRY = RunnerRegistry(max_active=10)
_RUNNERS: dict[str, object] = {}
_BUSES: dict[str, "_SessionBus"] = {}


class _FallbackLivePlugin:
    id = "F"
    capabilities = "live"


# Keep the REST contract usable before the scenario-plugin phase is installed.
if "F" not in REGISTRY:
    REGISTRY["F"] = _FallbackLivePlugin()


class SelectRequest(BaseModel):
    scenario_id: str
    tick_interval: Optional[float] = None  # 秒;None 用默认 0.15(演示节奏),0=最快


class ControlRequest(BaseModel):
    session_id: str
    action: str
    payload: Optional[dict] = None


class ReplayRequest(BaseModel):
    scenario_id: str


class _SessionBus:
    """Per-session event buffer + subscriber queues.

    publish() 只 put_nowait 到每个 subscriber 的有界 queue,由各自的
    _sender_loop 逐条 await send_text —— 避免 create_task 风暴(高事件量时
    会卡死 in-process TestClient WS),且慢客户端不会拖垮 publisher。
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._subscribers: list[WebSocket] = []
        self._queues: dict[WebSocket, asyncio.Queue] = {}
        self._buffer: list[dict] = []

    def publish(self, type_: str, payload: dict) -> None:
        event = {
            "type": type_,
            "ts": asyncio.get_event_loop().time(),
            "session_id": self.session_id,
            "payload": payload,
        }
        # 高频逐 tick 数据不进重连缓冲区(tick/chr_record),避免挤掉 runner_state/
        # phase_change/diagnosis_complete 等状态事件;实时仍推给已连接订阅者。
        if type_ not in ("tick", "chr_record"):
            self._buffer.append(event)
            if len(self._buffer) > 1000:
                self._buffer = self._buffer[-500:]
        for q in list(self._queues.values()):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("live bus queue full, dropping event (slow subscriber)")

    def attach(self, websocket: WebSocket) -> None:
        self._subscribers.append(websocket)
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._queues[websocket] = q
        for event in self._buffer[-200:]:
            q.put_nowait(event)
        asyncio.create_task(self._sender_loop(websocket, q))

    def detach(self, websocket: WebSocket) -> None:
        self._subscribers = [s for s in self._subscribers if s is not websocket]
        self._queues.pop(websocket, None)

    async def _sender_loop(self, websocket: WebSocket, q: asyncio.Queue) -> None:
        try:
            while True:
                event = await q.get()
                await websocket.send_text(json.dumps(event, default=str))
        except Exception:  # noqa: BLE001 — WS 关闭/客户端断开
            logger.debug("live bus sender loop ended")
        finally:
            self.detach(websocket)


@router.get("/capabilities")
async def get_capabilities():
    """live_scenarios(A~G)覆盖为 live;plugin 注册表补充未覆盖的场景。"""
    caps = capabilities_snapshot()
    caps.update({sid: "live" for sid in LIVE_SCENARIOS})
    return caps


@router.post("/select")
async def select_scenario(req: SelectRequest):
    scenario = get_scenario(req.scenario_id)
    plugin = REGISTRY.get(req.scenario_id)
    if scenario is None and plugin is None:
        raise HTTPException(status_code=404, detail=f"scenario {req.scenario_id} not found")

    # 真实实时仿真路径(live_scenarios A~G)
    if scenario is not None:
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        _REGISTRY.add(session_id)
        bus = _SessionBus(session_id)
        _BUSES[session_id] = bus

        from agents.shared.storage import Storage

        storage = Storage()
        storage.record_live_session(
            session_id, req.scenario_id, RunnerState.INIT.value, llm_mode="auto"
        )
        recorder = None
        try:
            from pathlib import Path

            from agents.shared.live_data_recorder import LiveDataRecorder

            recorder = LiveDataRecorder(
                session_id=session_id,
                scenario_id=req.scenario_id,
                base_dir=str(Path(storage.db_path).parent),
            )
        except Exception:  # noqa: BLE001
            logger.exception("LiveDataRecorder init failed; LIVE will run without recording")

        tick_interval = 0.15 if req.tick_interval is None else req.tick_interval
        runner = RealtimeLiveRunner(
            session_id=session_id,
            scenario=scenario,
            bus=bus,
            storage=storage,
            recorder=recorder,
            tick_interval=tick_interval,
        )
        runner.start()  # 同步发 runner_state/phase + 起常驻 tick 循环
        _RUNNERS[session_id] = runner
        return {
            "session_id": session_id,
            "scenario_id": req.scenario_id,
            "capabilities": "live",
            "tick_interval": tick_interval,
            "realtime": True,
        }

    # 回落:旧脚本化 plugin(仅 demo 占位)
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

    # 数据落盘记录器(L3);失败不影响 LIVE 运行
    recorder = None
    try:
        from pathlib import Path

        from agents.shared.live_data_recorder import LiveDataRecorder

        recorder = LiveDataRecorder(
            session_id=session_id,
            scenario_id=req.scenario_id,
            base_dir=str(Path(storage.db_path).parent),
        )
    except Exception:  # noqa: BLE001
        logger.exception("LiveDataRecorder init failed; LIVE will run without recording")

    tick_interval = 0.15 if req.tick_interval is None else req.tick_interval
    runner = LiveRunner(
        session_id=session_id,
        scenario_id=req.scenario_id,
        plugin=plugin,
        bus=bus,
        storage=storage,
        recorder=recorder,
        sim_window=60,
        tick_interval=tick_interval,
    )
    _RUNNERS[session_id] = runner
    asyncio.create_task(runner.run())
    return {
        "session_id": session_id,
        "scenario_id": req.scenario_id,
        "capabilities": "live",
        "tick_interval": tick_interval,
    }


async def _runner_control(runner, action: str, payload: dict) -> None:
    """统一处理旧 LiveRunner 与新 RealtimeLiveRunner 的控制动作。"""
    # 新 runner:常驻仿真 + 点击触发阶段
    if isinstance(runner, RealtimeLiveRunner):
        if action == "pause":
            runner.pause()
        elif action == "resume":
            runner.resume()
        elif action == "set_speed":
            runner.set_speed(float(payload.get("speed", 1.0)))
        elif action == "seek":
            runner.seek(int(payload.get("sim_t", 0)))
        elif action == "inject_fault":
            await runner.handle_inject_fault()
        elif action == "diagnose":
            await runner.handle_diagnose()
        elif action == "apply_policy":
            await runner.handle_apply_policy()
        elif action == "evaluate":
            await runner.handle_evaluate()
        return
    # 旧 runner:stepper 控制
    engine = getattr(runner, "_current_engine", None)
    if action == "pause" and engine is not None:
        engine.stepper.pause()
    elif action == "resume" and engine is not None:
        engine.stepper.resume()
    elif action == "set_speed" and engine is not None:
        engine.stepper.set_speed(float(payload.get("speed", 1.0)))
    elif action == "seek" and engine is not None:
        engine.stepper.seek(int(payload.get("sim_t", 0)))


@router.post("/control")
async def control(req: ControlRequest):
    runner = _RUNNERS.get(req.session_id)
    if runner is None:
        raise HTTPException(status_code=404, detail="session not found")
    await _runner_control(runner, req.action, req.payload or {})
    return {"ok": True, "action": req.action}


@router.post("/replay")
async def replay(req: ReplayRequest):
    """按场景回放:读 ``storage/live_replay/{scenario_id}/events.jsonl`` 重发到一个新 WS 会话。

    前端拿到 session_id 后连 ``/ws/live?session_id=...`` 即可观看该场景历史运行回放。
    """
    from pathlib import Path

    from agents.shared.storage import Storage

    base = Path(Storage().db_path).parent
    events_file = base / "live_replay" / req.scenario_id / "events.jsonl"
    if not events_file.is_file():
        raise HTTPException(status_code=404, detail=f"no replay data for scenario {req.scenario_id}")

    session_id = f"replay_{req.scenario_id}_{uuid.uuid4().hex[:6]}"
    _REGISTRY.add(session_id)
    bus = _SessionBus(session_id)
    _BUSES[session_id] = bus
    asyncio.create_task(_stream_replay(bus, events_file))
    return {"session_id": session_id, "scenario_id": req.scenario_id, "replay": True}


async def _stream_replay(bus: "_SessionBus", events_file) -> None:
    """读 events.jsonl,按原顺序(轻量节流)重发到 bus,供 WS 订阅者回放。"""
    import json

    await asyncio.sleep(0.2)  # 让 WS 先连上
    try:
        with open(events_file, encoding="utf-8") as f:
            lines = [ln for ln in f if ln.strip()]
        for i, ln in enumerate(lines):
            try:
                ev = json.loads(ln)
            except Exception:  # noqa: BLE001
                continue
            bus.publish(ev.get("type", ""), ev.get("payload", {}))
            if i % 20 == 0:
                await asyncio.sleep(0.01)
    except Exception:  # noqa: BLE001
        logger.exception("replay stream failed")


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
    finally:
        bus.detach(websocket)
