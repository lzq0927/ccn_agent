"""RealtimeLiveRunner 全场景端到端(A~G)—— 真实组件 + 确定性诊断(stub LLM)。

覆盖「真实闭环」全链路(与生产 LIVE 唯一差异:LLM 强制 stub → 确定性诊断器;
生产有 key 时同一链路走真 MiniMax agent loop,已在联调中验证):
  select(常驻仿真)→ inject_fault(Agent1 影子校验)→ match(真置信度)→
  root(真工具链诊断)→ apply_policy(通用规划器)→ evaluate(真值比对+恢复效果)。

断言:
  - Agent 1:data_validation 5 维通过(影子自校验)
  - Agent 2:诊断与真值有交集(根因方向正确)
  - 策略:来自通用规划器(recovery_action 带 rationale),无剧本
  - 闭环:≤MAX_ROUNDS 轮内真实恢复(engine.is_recovered)
  - Agent 3:评估报告真值比对 + 恢复效果 + 优化建议 + Skill 沉淀
"""
from __future__ import annotations

import asyncio

import pytest

from agents.simulation.live_scenarios import SCENARIOS


class _CollectBus:
    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    def publish(self, type_: str, payload: dict) -> None:
        self.events.append((type_, payload))


def _drive(bus, scenario, **kw):
    from agents.shared.realtime_runner import RealtimeLiveRunner

    runner = RealtimeLiveRunner(
        session_id="sess_e2e", scenario=scenario, bus=bus, storage=None,
        recorder=None, tick_interval=0.0, sim_window=10000,
        reasoning_step_delay=0.0, recovery_action_delay=0.0, post_policy_settle=0.0,
        **kw,
    )

    async def run():
        runner.start()
        await runner._wait_segment()
        await runner.handle_inject_fault()
        await runner.handle_match()
        await runner.handle_root()
        await runner.handle_apply_policy()
        await runner.handle_evaluate()
        await runner.stop()

    asyncio.run(run())
    return runner


@pytest.mark.parametrize("sid", list(SCENARIOS.keys()))
def test_realtime_e2e_scenario(sid, monkeypatch):
    """A~G:真实 runner 闭环,确定性诊断(stub),≤3 轮恢复 + 完整事件链。"""
    monkeypatch.setenv("CC_LIVE_LLM_MODE", "stub")
    bus = _CollectBus()
    runner = _drive(bus, SCENARIOS[sid])
    types = {t for t, _ in bus.events}

    # 事件链完整性
    for expected in ("runner_state", "tick", "kpi_snapshot", "phase_change",
                     "data_validation", "anomaly_detection", "confidence_assessment",
                     "reasoning_step", "diagnosis_complete", "recovery_action",
                     "evaluation_report", "skill_evolved"):
        assert expected in types, f"{sid}: missing event {expected}: {sorted(types)}"

    # Agent 1:影子自校验 5 维通过
    dv = next(p for t, p in bus.events if t == "data_validation")
    assert dv["passed"] is True, f"{sid}: shadow validation failed: {dv['checks']}"

    # Agent 2:最终诊断(末轮)与真值有交集。首轮允许误诊——真实闭环的契约是
    # 「闭环收敛到正确根因」,不是「首轮必对」(误诊→不恢复→重诊→救回是设计行为)
    diags = [p for t, p in bus.events if t == "diagnosis_complete"]
    truth = runner.engine.snapshot_for_agent()["ground_truth"]["fault_elements"]
    assert set(diags[-1]["fault_elements"]) & set(truth), (
        f"{sid}: final diagnosis {diags[-1]['fault_elements']} misses truth {truth}"
    )

    # 策略:通用规划器产出(带推导依据),非剧本
    actions = [p for t, p in bus.events if t == "recovery_action"]
    assert actions and all(a.get("rationale") for a in actions)

    # 闭环:真实恢复
    ev = next(p for t, p in bus.events if t == "evaluation_report")
    assert ev["recovered"] is True, f"{sid}: not recovered: {ev}"
    assert 1 <= ev["rounds"] <= 3

    # Agent 3:真值比对 + 优化建议 + Skill 沉淀
    assert ev["truth"] == sorted(truth)
    assert ev["metrics"]["precision"] > 0
    assert isinstance(ev["suggestions"], list)
    skill = next(p for t, p in bus.events if t == "skill_evolved")
    assert skill["kind"] in {"NEW", "UPDATE", "CONFIRM"}


def test_realtime_e2e_storm_class_match(monkeypatch):
    """风暴场景:诊断类别过滤(sst=3)与真值 fault_classes 命中;策略为分层准入。"""
    monkeypatch.setenv("CC_LIVE_LLM_MODE", "stub")
    bus = _CollectBus()
    _drive(bus, SCENARIOS["D"])

    diag = [p for t, p in bus.events if t == "diagnosis_complete"][-1]
    assert diag["fault_mode"] == "business"
    assert diag["fault_type"] == "path_session"

    actions = [p for t, p in bus.events if t == "recovery_action"]
    layers = {a["layer"] for a in actions}
    assert layers >= {"AMF", "SMF"}, f"storm should use ingress admission: {layers}"
    assert all("隔离" not in a["cn"] for a in actions), "overload NEs must not be isolated"

    ev = next(p for t, p in bus.events if t == "evaluation_report")
    assert ev["recovered"] is True
    assert ev["class_match"] is True


def test_realtime_e2e_via_api_select_and_control():
    """API 层冒烟:select A → WS 收到缓冲事件流。

    TestClient portal 已知限制(见 test_f_scenario_e2e.py 注释):请求间隙不调度
    background task,tick 循环只在 select 请求期间推进——WS 只能收到 select 期间
    产出并缓冲的事件(runner_state/phase_change/部分 tick)。生产 uvicorn 无此限制。"""
    import time

    from fastapi.testclient import TestClient

    from api.app import create_app

    client = TestClient(create_app())
    sel = client.post("/api/v1/live/select",
                      json={"scenario_id": "A", "tick_interval": 0.0}).json()
    assert sel["capabilities"] == "live" and sel["realtime"] is True

    seen: list[str] = []
    with client.websocket_connect(f"/ws/live?session_id={sel['session_id']}") as ws:
        deadline = time.time() + 10
        while time.time() < deadline and len(seen) < 3:
            try:
                raw = ws.receive_text()
            except Exception:
                break
            import json as _json
            ev = _json.loads(raw)
            if ev.get("type") != "ping":
                seen.append(ev["type"])
    assert any(t in seen for t in ("runner_state", "phase_change", "kpi_snapshot")), seen
