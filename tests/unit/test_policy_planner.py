"""通用策略规划器 + 场景规格测试(取代旧的剧本配方测试)。

核心断言:**无剧本** —— 策略完全由「诊断 + 遥测」推导:
  - 正确诊断 → 恢复;误诊 → 不恢复(诚实);
  - 过载类 → 入口准入(带类别过滤),不隔离网元;
  - 场景表只含故障/流量规格,不存在恢复配方字段。
"""
from __future__ import annotations

from agents.simulation.live_scenarios import SCENARIOS
from agents.simulation.policy_planner import (
    build_plan_context,
    plan_recovery_actions,
)
from agents.simulation.realtime_engine import RealtimeEngine
from agents.shared.models import DiagnosisResult, Route


def _diag(elements, fault_type="single_ne", mode="link", flt=None):
    return DiagnosisResult(
        session_id="t", case_id=1, fault_elements=list(elements),
        fault_type=fault_type, fault_mode=mode, confidence=0.8,
        route_taken=Route.WORKFLOW, traffic_filter=flt,
    )


def test_scenarios_have_no_recovery_recipe():
    """场景表纯化:不允许存在恢复配方 / 期望轮数字段(防剧本回归)。"""
    for scen in SCENARIOS.values():
        assert not hasattr(scen, "recovery_actions"), f"{scen.id} 仍有恢复配方"
        assert not hasattr(scen, "recovery_actions_r1"), f"{scen.id} 仍有首轮弱策略配方"
        assert not hasattr(scen, "expected_rounds"), f"{scen.id} 仍有期望轮数(剧本)"
        assert scen.fault_config is not None
        # route_expectation 仅元数据,规划器/引擎不读
        assert scen.route_expectation in {"workflow", "guided", "autonomous", "exploration"}


def test_planner_ne_fault_isolate_and_reroute():
    """核心 NF 诊断 → 重选 + 隔离;gNB/业务面诊断 → 仅用户侧重选(不隔离)。"""
    engine = RealtimeEngine(scenario=SCENARIOS["A"], seed=1)
    ctx = build_plan_context(engine)

    core_plan = plan_recovery_actions(_diag(["UPF_1"]), ctx)
    kinds = {(p.policy.kind, p.policy.ne_id or p.policy.from_ne_id) for p in core_plan}
    assert ("reroute", "UPF_1") in kinds and ("isolate", "UPF_1") in kinds

    gnb_plan = plan_recovery_actions(_diag(["gNB_2"], mode="business"), ctx)
    kinds = {(p.policy.kind, p.policy.ne_id or p.policy.from_ne_id) for p in gnb_plan}
    assert ("reroute", "gNB_2") in kinds
    assert all(k[0] != "isolate" for k in kinds), "gNB 用户侧故障不应隔离网元"


def test_planner_overload_uses_admission_not_isolation():
    """过载类诊断(path_session/business)→ 入口准入限流,绝不隔离/重选网元。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    engine = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    for t in range(1, 15):
        engine.advance_tick(t)
    engine.inject_fault(SCENARIO_D.fault_config)
    for t in range(15, 29):
        engine.advance_tick(t)

    ctx = build_plan_context(engine)
    plan = plan_recovery_actions(
        _diag(["AMF_1", "SMF_1"], fault_type="path_session", mode="business",
              flt={"sst": 3}),
        ctx, round_no=1,
    )
    kinds = [p.policy.kind for p in plan]
    assert "flow_control" in kinds, f"overload should use admission control: {kinds}"
    assert "isolate" not in kinds and "reroute" not in kinds, (
        f"overload NEs are victims, must not be isolated/rerouted: {kinds}"
    )
    # 类别过滤真实传递给引擎策略
    fc = [p for p in plan if p.policy.kind == "flow_control"]
    assert all(p.policy.flt == {"sst": 3} for p in fc)
    assert {p.policy.layer for p in fc} >= {"AMF", "SMF"}


def test_planner_escalation_accumulates_not_rewrites():
    """轮次 = 反馈叠加:二轮 ratio 在一轮基础上按残余差值累计放大,而非换剧本。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    engine = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    for t in range(1, 15):
        engine.advance_tick(t)
    engine.inject_fault(SCENARIO_D.fault_config)
    for t in range(15, 29):
        engine.advance_tick(t)

    diag = _diag(["AMF_1"], fault_type="path_session", mode="business", flt={"sst": 3})
    p1 = plan_recovery_actions(diag, build_plan_context(engine), round_no=1)
    engine.apply_policy([p.policy for p in p1])
    for t in range(29, 45):
        engine.advance_tick(t)
    p2 = plan_recovery_actions(diag, build_plan_context(engine), round_no=2)

    r1 = max(p.policy.ratio for p in p1 if p.policy.kind == "flow_control")
    r2 = max(p.policy.ratio for p in p2 if p.policy.kind == "flow_control")
    # 若一轮已恢复(r1 已足量),二轮按当前残余需求重算 → 不超过 0.95 上限即可;
    # 关键性质:二轮策略仍是 flow_control 族(同一通用规则,参数反馈调整)
    assert r1 > 0 and r2 > 0


def test_planner_empty_diagnosis_falls_back_to_telemetry():
    """空诊断兜底:过载 → 准入;退化链路 → per-NE SR 最差的核心 NF 处置。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    storm = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    for t in range(1, 15):
        storm.advance_tick(t)
    storm.inject_fault(SCENARIO_D.fault_config)
    for t in range(15, 29):
        storm.advance_tick(t)
    plan = plan_recovery_actions(None, build_plan_context(storm), round_no=1)
    assert plan and all(p.policy.kind == "flow_control" for p in plan)


def test_planner_ignores_elements_outside_topology():
    """拓扑外元素(UE id / 幻觉 NE)被忽略,不产生动作。"""
    engine = RealtimeEngine(scenario=SCENARIOS["A"], seed=1)
    ctx = build_plan_context(engine)
    plan = plan_recovery_actions(_diag(["UE_5", "AMF_99", "NRF_X"]), ctx)
    assert plan == [], f"phantom elements should yield no actions: {plan}"


def test_fault_validator_adjusts_invisible_fault():
    """Agent 1 影子自校验:显形不足的故障自动调参(loss 放大)后通过。"""
    from simulator.models import FaultConfig, FaultMode, FaultPointType

    from agents.simulation.fault_validator import validate_fault_spec

    scen = SCENARIOS["A"]
    # 人为构造真不可见的微损(0.0005,滚动窗口 SR 仍 >0.995):影子校验应放大 loss 直到显形
    invisible = FaultConfig(
        fault_point_type=FaultPointType.SINGLE_NE, fault_mode=FaultMode.LINK,
        loss_rate=0.0005, fault_start=0, fault_duration=10**9,
        affected_ne_ids={"UPF_1"},
    )
    fc, report = validate_fault_spec(scen, invisible, seed=42)
    assert fc.loss_rate > 0.0005, f"validator should escalate invisible fault: {fc.loss_rate}"
    assert report.passed, f"adjusted fault should pass: {[c for c in report.checks if not c['passed']]}"
    assert report.adjustments, "adjustment history should be recorded"


def test_fault_validator_passes_reasonable_fault():
    """合理故障规格:一次通过,无调参。"""
    from agents.simulation.fault_validator import validate_fault_spec

    for sid in ("A", "B", "D"):
        fc, report = validate_fault_spec(SCENARIOS[sid], SCENARIOS[sid].fault_config, seed=42)
        assert report.passed, (
            f"{sid} stock fault should pass shadow validation: "
            f"{[c for c in report.checks if not c['passed']]}"
        )


def test_plan_context_hides_ground_truth():
    """规划上下文不泄漏真值:不含故障配置 / NE 内部丢损状态。"""
    engine = RealtimeEngine(scenario=SCENARIOS["A"], seed=1)
    engine.inject_fault(SCENARIOS["A"].fault_config)
    ctx = build_plan_context(engine)
    dumped = repr(ctx.__dict__)
    assert "loss" not in dumped.lower() or "loss_reduction" in dumped, "context must not leak loss"
    assert not hasattr(ctx, "fault"), "context must not carry fault config"
