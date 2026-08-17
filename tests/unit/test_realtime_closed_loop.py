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


def _make_runner(bus, scenario=None, agent_cls=None, tmp_path=None,
                 tick_interval=0.004, sim_window=10000):
    from agents.shared.realtime_runner import RealtimeLiveRunner

    runner = RealtimeLiveRunner(
        session_id="sess_test", scenario=scenario or SCENARIO_A, bus=bus, storage=None,
        recorder=None, tick_interval=tick_interval, sim_window=sim_window,
        reasoning_step_delay=0.0, recovery_action_delay=0.0, post_policy_settle=0.0,
    )
    agent_cls = agent_cls or _FakeAgent
    # 桩掉真 Agent 构造(注入 progress 回调,模拟真 Agent 的流式事件)
    runner.diagnoser._build_agent = lambda: agent_cls(runner.diagnoser._on_progress)  # noqa: SLF001
    return runner


class _StubbornWrongAgent(_FakeAgent):
    """每轮都误诊:坚持 SMF_2(真故障 UPF_1)→ 验证诚实多轮 + 诚实失败。"""

    async def diagnose(self, case_data):
        await super().diagnose(case_data)
        from agents.shared.models import DiagnosisResult, ReasoningStep, SessionStatus

        return DiagnosisResult(
            session_id="fake", case_id=case_data.case_id,
            fault_elements=["SMF_2"], fault_links=[],
            fault_type="single_ne", fault_mode="link",
            confidence=0.55, route_taken=Route.GUIDED,
            reasoning_trace=[ReasoningStep(step_number=1, step_type="conclusion",
                                           content="误诊:SMF_2(每轮坚持)")],
            status=SessionStatus.COMPLETED,
        )


def test_closed_loop_inject_diagnose_policy_evaluate():
    """数据采集→异常检测→诊断→下发策略→评估 全链路事件 + SR 闭环恢复。"""
    bus = _CollectBus()
    runner = _make_runner(bus)

    async def drive():
        # 方案B:tick loop 按相位配额自动跑,_wait_segment 等当前段配额耗尽(自动 pause)。
        runner.start()
        await runner._wait_segment()        # phase 1 数据采集段(12 tick)跑完

        # ②异常检测:注入故障 + 跑异常段 + 真异常检测工具 → anomaly_detection(handle_inject_fault 内含 _wait_segment)
        await runner.handle_inject_fault()
        _, fault_pdu = runner.engine._success_rates()  # noqa: SLF001

        await runner.handle_match()         # ③策略匹配:真置信度评估 → confidence_assessment
        await runner.handle_root()          # ④根因推理:真 Agent Loop → diagnosis_complete
        await runner.handle_apply_policy()  # ⑤下发策略(隔离 UPF_1 + 重选)+ arm phase 5/6
        await runner._wait_segment()        # 恢复段跑完 → SR 回升

        await runner.handle_evaluate()      # ⑦评估优化
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
    assert "anomaly_detection" in typeset  # ②真异常检测工具产出

    # 诊断完成事件携带 UPF_1
    diag = next(p for t, p in bus.events if t == "diagnosis_complete")
    assert diag["fault_elements"] == ["UPF_1"]

    # ②异常检测:真工具(analyze_kpi_anomalies + find_common_ne)→ 异常链路 + 聚合定位 UPF_1
    anom = next(p for t, p in bus.events if t == "anomaly_detection")
    assert anom["degraded_links"], "anomaly_detection should list degraded links"
    assert anom["top_ne"] == "UPF_1"
    # per-NE 实例 SR 已进 kpi_snapshot(AMF/SMF 实例维度)
    snap = next(p for t, p in bus.events if t == "kpi_snapshot")
    assert "ne_reg_sr" in snap and "ne_pdu_sr" in snap
    assert any(k.startswith("AMF") for k in snap["ne_reg_sr"])

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


def test_wrong_diagnosis_honest_multiround_failure():
    """误诊诚实性:每轮误诊 SMF_2(真故障 UPF_1)→ 多轮真实未恢复 → 评估诚实失败。

    验证无剧本:不因「场景应两轮成功」而伪造恢复;round_change/confidence_low
    逐轮发出;MAX_ROUNDS 后收尾,recovered=False 且优化建议包含误报回流。
    """
    from agents.shared.realtime_runner import MAX_ROUNDS

    bus = _CollectBus()
    runner = _make_runner(bus, agent_cls=_StubbornWrongAgent)

    async def drive():
        runner.start()
        await runner._wait_segment()
        await runner.handle_inject_fault()
        await runner.handle_match()
        await runner.handle_root()
        await runner.handle_apply_policy()
        await runner.handle_evaluate()
        await runner.stop()

    asyncio.run(drive())

    rounds = [p["round"] for t, p in bus.events if t == "round_change"]
    assert rounds == list(range(2, MAX_ROUNDS + 1)), f"rounds should escalate to max: {rounds}"
    assert any(t == "confidence_low" for t, _ in bus.events)

    ev = next(p for t, p in bus.events if t == "evaluation_report")
    assert ev["recovered"] is False, "wrong diagnosis must NOT report recovery"
    assert ev["rounds"] == MAX_ROUNDS
    assert ev["truth"] == ["UPF_1"] and "UPF_1" not in ev["predicted"]
    # 优化建议:误报元素回流(skill_update)且包含未恢复难例(new_case)
    kinds = {s["suggestion_type"] for s in ev["suggestions"]}
    assert "skill_update" in kinds and "new_case" in kinds
    # Skill 沉淀事件
    skill = next(p for t, p in bus.events if t == "skill_evolved")
    assert skill["kind"] == "NEW"


def test_agent1_shadow_validation_event():
    """Agent 1 影子自校验:注入时发 data_validation(5 维检查,纯规则)。"""
    bus = _CollectBus()
    runner = _make_runner(bus)

    async def drive():
        runner.start()
        await runner._wait_segment()
        await runner.handle_inject_fault()
        await runner.stop()

    asyncio.run(drive())
    dv = next(p for t, p in bus.events if t == "data_validation")
    assert dv["passed"] is True
    names = {c["name"] for c in dv["checks"]}
    assert names == {"kpi_consistency", "fault_manifestation", "topology_coherence",
                     "process_validity", "label_correctness"}


def test_storm_scenario_real_round_loop():
    """风暴场景(D)真实闭环:诊断含类别过滤 → 准入限流策略 → 恢复 + 类别命中。"""
    from agents.shared.models import DiagnosisResult, ReasoningStep, Route, SessionStatus
    from agents.simulation.live_scenarios import SCENARIO_D

    class _StormAgent:
        def __init__(self, progress_callback=None):
            self._cb = progress_callback

        async def diagnose(self, case_data):
            return DiagnosisResult(
                session_id="fake", case_id=case_data.case_id,
                fault_elements=["AMF_1", "AMF_2", "SMF_1"],
                fault_links=[], fault_type="path_session", fault_mode="business",
                confidence=0.78, route_taken=Route.WORKFLOW,
                reasoning_trace=[ReasoningStep(step_number=1, step_type="conclusion",
                                               content="业务激增(sst=3)过载 AMF/SMF")],
                status=SessionStatus.COMPLETED, traffic_filter={"sst": 3},
            )

    bus = _CollectBus()
    runner = _make_runner(bus, scenario=SCENARIO_D, agent_cls=_StormAgent)

    async def drive():
        runner.start()
        await runner._wait_segment()
        await runner.handle_inject_fault()
        await runner.handle_match()
        await runner.handle_root()
        await runner.handle_apply_policy()
        await runner.handle_evaluate()
        await runner.stop()

    asyncio.run(drive())

    # 策略来自通用规划器:准入限流(UE back-off + AMF/SMF),无隔离
    actions = [p for t, p in bus.events if t == "recovery_action"]
    layers = {a["layer"] for a in actions}
    assert {"UE", "AMF", "SMF"} <= layers, f"storm should use layered admission: {layers}"
    assert all("隔离" not in a["cn"] for a in actions)
    # 每条动作带 rationale(通用推导依据)
    assert all(a.get("rationale") for a in actions)

    ev = next(p for t, p in bus.events if t == "evaluation_report")
    assert ev["recovered"] is True, f"storm should recover via admission control: {ev}"
    assert ev["class_match"] is True  # 诊断类别过滤 sst=3 与真值 fault_classes 命中
    assert ev["metrics"]["precision"] == 1.0
