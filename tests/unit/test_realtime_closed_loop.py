"""RealtimeLiveRunner 闭环测试:常驻仿真 + 点击触发(注入→诊断→策略→评估)。

Agent 用桩替换(避免 CI 打真实 LLM);真 LLM 验证靠手动联调。
"""
from __future__ import annotations

import asyncio

from agents.shared.models import DiagnosisResult, ReasoningStep, Route, SessionStatus
from agents.simulation.live_scenarios import SCENARIO_A


class _CollectBus:
    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    def publish(self, type_: str, payload: dict) -> None:
        self.events.append((type_, payload))


class _FakeAgent:
    """跳过真 LLM:diagnose 直接返回 UPF_1 诊断 + 一条推理;模拟 progress 回调。"""

    def __init__(self, progress_callback=None):
        self.called_with = None
        self._cb = progress_callback

    async def diagnose(self, case_data):
        self.called_with = case_data
        if self._cb:
            self._cb({"type": "confidence_assessment", "score": 0.9, "route": "workflow", "patterns": ["single_ne"]})
            self._cb({"type": "tool_call", "tool": "isolate_fault_candidates"})
        return DiagnosisResult(
            session_id="fake", case_id=case_data.case_id,
            fault_elements=["UPF_1"], fault_links=[],
            fault_type="single_ne", fault_mode="link",
            confidence=0.9, route_taken=Route.WORKFLOW,
            reasoning_trace=[ReasoningStep(step_number=1, step_type="conclusion",
                                           content="根因 UPF_1(均质化比较定位)")],
            status=SessionStatus.COMPLETED,
        )


def _make_runner(bus, tmp_path=None, tick_interval=0.004, sim_window=10000):
    from agents.shared.realtime_runner import RealtimeLiveRunner

    runner = RealtimeLiveRunner(
        session_id="sess_test", scenario=SCENARIO_A, bus=bus, storage=None,
        recorder=None, tick_interval=tick_interval, sim_window=sim_window,
        reasoning_step_delay=0.0, recovery_action_delay=0.0,
    )
    # 桩掉真 Agent 构造(注入 progress 回调,模拟真 Agent 的流式事件)
    runner.diagnoser._build_agent = lambda: _FakeAgent(runner.diagnoser._on_progress)  # noqa: SLF001
    return runner


def test_closed_loop_inject_diagnose_policy_evaluate():
    """数据采集→异常检测→诊断→下发策略→评估 全链路事件 + SR 闭环恢复。"""
    bus = _CollectBus()
    runner = _make_runner(bus)

    async def drive():
        runner.start()
        await asyncio.sleep(0.05)           # 让常驻循环先发若干 tick/kpi 事件
        runner.pause()                      # 冻结常驻循环,改直接驱动引擎(确定性)

        await runner.handle_inject_fault()  # 异常检测
        for _ in range(14):                 # 故障 tick(充分填充滚动窗口)
            runner.engine.advance_tick(runner.engine.sim_t + 1)
        _, fault_pdu = runner.engine._success_rates()  # noqa: SLF001

        await runner.handle_diagnose()      # 诊断(桩 Agent)
        await runner.handle_apply_policy()  # 下发策略(隔离 UPF_1 + 重选)
        for _ in range(14):                 # 恢复 tick
            runner.engine.advance_tick(runner.engine.sim_t + 1)

        await runner.handle_evaluate()      # 评估优化
        await runner.stop()
        return fault_pdu

    fault_pdu = asyncio.run(drive())
    types = [t for t, _ in bus.events]
    typeset = set(types)

    # 事件链路
    assert "runner_state" in typeset
    assert "tick" in typeset
    assert "kpi_snapshot" in typeset
    assert "phase_change" in typeset
    assert "confidence_assessment" in typeset
    assert "reasoning_step" in typeset
    assert "diagnosis_complete" in typeset
    assert "recovery_action" in typeset
    assert "evaluation_report" in typeset

    # 诊断完成事件携带 UPF_1
    diag = next(p for t, p in bus.events if t == "diagnosis_complete")
    assert diag["fault_elements"] == ["UPF_1"]

    # 闭环:策略为隔离 UPF_1 + 重选(真回灌引擎)
    assert runner.engine._ne_status["UPF_1"] == "down"  # noqa: SLF001

    # 评估报告:恢复 + 精确匹配
    ev = next(p for t, p in bus.events if t == "evaluation_report")
    assert ev["recovered"] is True
    assert ev["metrics"]["exact_match"] is True

    # 故障期 PDU SR 确曾下降(< 恢复后)
    reg_sr, pdu_sr = runner.engine._success_rates()  # noqa: SLF001
    assert fault_pdu < 0.992, f"fault PDU SR should have dropped: {fault_pdu}"
    assert pdu_sr >= 0.99, f"PDU SR should recover after policy: {pdu_sr}"

    # 诊断被喂了引擎快照(含 KPI/CHR/拓扑)→ diagnosis_complete 已发出
    diag_events = [p for t, p in bus.events if t == "diagnosis_complete"]
    assert diag_events


def test_control_actions_via_runner_pause_resume():
    """pause/resume/set_speed/seek 不报错且生效(stepper 状态变化)。"""
    bus = _CollectBus()
    runner = _make_runner(bus)

    async def drive():
        runner.start()
        await asyncio.sleep(0.05)
        runner.pause()
        paused = runner.stepper._paused  # noqa: SLF001
        runner.resume()
        running = runner.stepper._paused  # noqa: SLF001
        runner.set_speed(2.0)
        await runner.stop()
        return paused, running

    paused, running = asyncio.run(drive())
    assert paused is True
    assert running is False
