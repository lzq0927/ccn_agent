"""场景 F 端到端测试。

两种驱动方式:
  1. API + TestClient WS —— 验证 select/WS 连通(注意:TestClient portal 在
     请求间隙不调度 background task,runner 只能跑到第一个 await,所以 WS
     验证只覆盖 simulate 阶段事件;生产环境 uvicorn 无此限制)
  2. 直接 await LiveRunner.run() —— 验证完整事件链路 + 数据落盘(秒过,可靠)
"""
import asyncio
import json
import time
from pathlib import Path

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# 1. API + WS 连通性
# ---------------------------------------------------------------------------


def test_f_api_ws_simulate_events_flow():
    """select F → WS 连上 → 收到 simulate 阶段事件(runner_state/tick/kpi_snapshot)。

    TestClient portal 限制:background runner 只跑到第一个 await(生产环境
    uvicorn 会跑完全链路),所以这里只验「事件流通」,全链路由直接驱动测试覆盖。
    """
    from api.app import create_app
    app = create_app()
    client = TestClient(app)

    sel = client.post(
        "/api/v1/live/select", json={"scenario_id": "F", "tick_interval": 0.0}
    ).json()
    sid = sel["session_id"]
    assert sel["capabilities"] == "live"

    seen: list[str] = []
    with client.websocket_connect(f"/ws/live?session_id={sid}") as ws:
        deadline = time.time() + 10
        while time.time() < deadline and len(seen) < 5:
            try:
                raw = ws.receive_text()
            except Exception:
                break
            ev = json.loads(raw)
            if ev.get("type") == "ping":
                continue
            seen.append(ev.get("type"))

    assert seen, "WS received no events"
    assert "runner_state" in seen, f"missing runner_state in {seen}"


def test_f_api_select_returns_session():
    """stub 缺失/正常:LiveRunner 不崩,前端能拿到 session。"""
    from api.app import create_app
    app = create_app()
    client = TestClient(app)
    sel = client.post(
        "/api/v1/live/select", json={"scenario_id": "F", "tick_interval": 0.0}
    ).json()
    assert "session_id" in sel
    assert sel["capabilities"] == "live"


# ---------------------------------------------------------------------------
# 2. 直接驱动:完整事件链路
# ---------------------------------------------------------------------------


class _CollectBus:
    """收集所有 publish 事件,供断言事件链路。"""

    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    def publish(self, type_: str, payload: dict) -> None:
        self.events.append((type_, payload))


def _drive_runner(**overrides):
    """直接 await LiveRunner.run() —— 不经 API,避开 TestClient portal 限制。"""
    from agents.shared.live_runner import LiveRunner
    from agents.simulation.plugins.f_iot_storm_layered import PLUGIN

    bus = _CollectBus()
    runner = LiveRunner(
        session_id="sess_test",
        scenario_id="F",
        plugin=PLUGIN,
        bus=bus,
        storage=None,
        sim_window=60,
        tick_interval=0.0,
        phase_transition_delay=0.0,
        reasoning_step_delay=0.0,
        recovery_action_delay=0.0,
        **overrides,
    )
    asyncio.run(runner.run())
    return runner, bus


def test_f_full_event_chain_direct():
    """直接驱动:验证 F 完整事件链路(首轮 restart + 二轮收敛 + 评估)。"""
    runner, bus = _drive_runner()
    types = [t for t, _ in bus.events]
    typeset = set(types)

    assert runner._state.value == "done"
    assert "runner_state" in typeset
    # simulate 阶段:tick + KPI/CHR/告警
    assert "tick" in typeset
    assert "kpi_snapshot" in typeset
    assert "chr_record" in typeset
    assert "alarm" in typeset
    # diagnose 阶段:置信度 + 推理链 + 诊断完成
    assert "confidence_assessment" in typeset
    assert "reasoning_step" in typeset
    assert "diagnosis_complete" in typeset
    # F 首轮 confidence<0.3 → restart
    assert "confidence_low" in typeset
    # recover + evaluate
    assert "recovery_action" in typeset
    assert "evaluation_report" in typeset

    # 推理步数:首轮 3 + 二轮 3 = 6
    assert types.count("reasoning_step") >= 6
    # 恢复动作:二轮 3 个
    assert types.count("recovery_action") == 3


def test_f_data_recorder_outputs_files(tmp_path):
    """直接驱动 + recorder:验证全部数据文件落盘。"""
    from agents.shared.live_data_recorder import LiveDataRecorder

    recorder = LiveDataRecorder(
        session_id="sess_rec", scenario_id="F", base_dir=str(tmp_path)
    )
    runner, _ = _drive_runner(recorder=recorder)

    assert runner._state.value == "done"
    session_dir = tmp_path / "live_sessions" / "sess_rec"
    assert session_dir.is_dir(), f"session dir not created: {session_dir}"

    expected = [
        "session_meta.json", "topo.txt", "process.txt", "data.csv",
        "chr.jsonl", "alarms.jsonl", "reasoning.jsonl", "recovery.json",
        "evaluation.json", "events.jsonl",
    ]
    for name in expected:
        assert (session_dir / name).is_file(), f"missing {name}"

    # data.csv:Header + 至少 60 行 KPI(两轮 60 tick)
    csv_lines = (session_dir / "data.csv").read_text(encoding="utf-8").strip().splitlines()
    assert len(csv_lines) >= 61, f"data.csv too few rows: {len(csv_lines)}"
    assert "amf_cpu" in csv_lines[0]

    # events.jsonl 含完整链路
    events = [
        json.loads(line)
        for line in (session_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_types = {e["type"] for e in events}
    assert {"runner_state", "tick", "kpi_snapshot", "confidence_low", "evaluation_report"} <= event_types

    # session_meta done
    meta = json.loads((session_dir / "session_meta.json").read_text(encoding="utf-8"))
    assert meta["status"] == "done"
    assert meta["scenario_id"] == "F"
    assert meta["expected_round"] == 2

    # alarms 非空(风暴期 CPU 过载 + 注册突增)
    alarms = [
        json.loads(line)
        for line in (session_dir / "alarms.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(alarms) >= 2

    # recovery.json:二轮 3 个动作
    recovery = json.loads((session_dir / "recovery.json").read_text(encoding="utf-8"))
    assert len(recovery) == 3
    assert {a["round"] for a in recovery} == {2}

    # topo.txt 含网元
    topo = (session_dir / "topo.txt").read_text(encoding="utf-8")
    assert "AMF" in topo and "SMF" in topo and "UPF" in topo
