"""场景 G 端到端测试(直接驱动 LiveRunner,避 TestClient portal 限制)。

G = AI 平台故障 → UDM 过载 → AMF/SMF 协同限流(两轮收敛)。
两轮复用 LiveRunner confidence-restart:round1 0.28 → restart → round2 0.8。
"""
import asyncio
import json
from pathlib import Path


class _CollectBus:
    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    def publish(self, type_: str, payload: dict) -> None:
        self.events.append((type_, payload))


def _drive_g(**overrides):
    from agents.shared.live_runner import LiveRunner
    from agents.simulation.plugins.g_udm_overload import PLUGIN

    bus = _CollectBus()
    runner = LiveRunner(
        session_id="sess_g",
        scenario_id="G",
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


def test_g_full_event_chain_direct():
    """直接驱动:G 完整事件链路(首轮 restart + 二轮 3 策略恢复 + 评估)。"""
    runner, bus = _drive_g()
    types = [t for t, _ in bus.events]
    typeset = set(types)

    assert runner._state.value == "done"
    assert "runner_state" in typeset
    assert "tick" in typeset
    assert "kpi_snapshot" in typeset
    # 首轮 confidence 0.28 < 0.3 → restart
    assert "confidence_low" in typeset
    # 二轮恢复:3 策略(UE T3346 + AMF 限 SST=3 + SMF 限 DNN)
    assert "recovery_action" in typeset
    assert types.count("recovery_action") == 3
    # 评估
    assert "evaluation_report" in typeset
    # 推理步:首轮 4 + 二轮 4 = 8
    assert types.count("reasoning_step") >= 8


def test_g_data_recorder_outputs_files(tmp_path):
    """G 落盘 10 文件;data.csv 动态列含 G 专用字段(udm_cpu/ai_platform_reg_share)。"""
    from agents.shared.live_data_recorder import LiveDataRecorder

    recorder = LiveDataRecorder(
        session_id="sess_g_rec", scenario_id="G", base_dir=str(tmp_path)
    )
    runner, _ = _drive_g(recorder=recorder)
    assert runner._state.value == "done"

    session_dir = tmp_path / "live_sessions" / "sess_g_rec"
    expected = [
        "session_meta.json", "topo.txt", "process.txt", "data.csv",
        "chr.jsonl", "alarms.jsonl", "reasoning.jsonl", "recovery.json",
        "evaluation.json", "events.jsonl",
    ]
    for name in expected:
        assert (session_dir / name).is_file(), f"missing {name}"

    # data.csv 动态列含 G 专用字段(recorder 首个 kpi_snapshot 决定列)
    header = (session_dir / "data.csv").read_text(encoding="utf-8").splitlines()[0]
    assert "udm_cpu" in header, header
    assert "ai_platform_reg_share" in header, header
    assert "msg_to_udm" in header, header

    # KPI 行数:两轮 60 tick
    csv_lines = (session_dir / "data.csv").read_text(encoding="utf-8").strip().splitlines()
    assert len(csv_lines) >= 61, f"data.csv too few rows: {len(csv_lines)}"

    # session_meta
    meta = json.loads((session_dir / "session_meta.json").read_text(encoding="utf-8"))
    assert meta["status"] == "done"
    assert meta["scenario_id"] == "G"
    assert meta["expected_round"] == 2

    # recovery.json:二轮 3 策略
    recovery = json.loads((session_dir / "recovery.json").read_text(encoding="utf-8"))
    assert len(recovery) == 3
    assert {a["round"] for a in recovery} == {2}
    layers = {a["layer"] for a in recovery}
    assert layers == {"UE", "AMF", "SMF"}

    # alarms 含 UDM 过载告警
    alarms = [
        json.loads(line)
        for line in (session_dir / "alarms.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    alarm_cats = {a["category"] for a in alarms}
    assert "cpu_overload" in alarm_cats
