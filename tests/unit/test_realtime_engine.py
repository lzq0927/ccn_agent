"""RealtimeEngine 单元测试:消息级 DES + AMF/SMF 计数器 + 故障注入/策略闭环。

策略经**通用规划器**(policy_planner)从诊断推导 —— 与 LIVE runner 同路径。
"""
from __future__ import annotations

import pytest

from agents.simulation.live_scenarios import SCENARIO_A
from agents.simulation.policy_planner import (
    build_plan_context,
    plan_recovery_actions,
)
from agents.simulation.realtime_engine import PolicyAction, RealtimeEngine
from agents.shared.models import DiagnosisResult, Route


def _run_ticks(engine: RealtimeEngine, n: int, start: int = 1):
    last = None
    for i in range(n):
        last = engine.advance_tick(start + i)
    return last


def _sr(engine: RealtimeEngine):
    return engine._success_rates()  # noqa: SLF001


def _diag(elements, fault_type="single_ne", mode="link", flt=None):
    return DiagnosisResult(
        session_id="t", case_id=1, fault_elements=list(elements),
        fault_type=fault_type, fault_mode=mode, confidence=0.8,
        route_taken=Route.WORKFLOW, traffic_filter=flt,
    )


def test_normal_phase_high_success_rate():
    """数据采集阶段(无故障):AMF 注册 / SMF PDU 成功率都接近满。"""
    engine = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    _run_ticks(engine, 15)
    reg_sr, pdu_sr = _sr(engine)
    assert reg_sr > 0.98, f"reg SR too low pre-fault: {reg_sr}"
    assert pdu_sr > 0.98, f"pdu SR too low pre-fault: {pdu_sr}"
    assert engine.is_recovered() is True  # 健康态即"已恢复"


def test_fault_injection_drops_pdu_sr_and_flags_upf1():
    """异常检测:注入 UPF_1 故障后,PDU SR 下降且 link KPI 标出 UPF_1 异常。"""
    engine = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    _run_ticks(engine, 15)
    _, pre_pdu = _sr(engine)

    engine.inject_fault(SCENARIO_A.fault_config)
    _run_ticks(engine, 14, start=16)
    reg_sr, pdu_sr = _sr(engine)

    # UPF 不在注册流程 → AMF 注册 SR 基本不受影响
    assert reg_sr > 0.97, f"reg SR should be unaffected by UPF fault: {reg_sr}"
    # PDU 会话建立走 UPF → SMF PDU SR 明显下降
    assert pdu_sr < pre_pdu - 0.005, f"PDU SR did not drop after fault: {pdu_sr} vs {pre_pdu}"
    assert pdu_sr < 0.992, f"PDU SR should be below recover threshold during fault: {pdu_sr}"
    assert engine.is_recovered() is False

    # Agent 视角:link KPI 应有 UPF_1 相关异常
    agent_view = engine.snapshot_for_agent()
    anomalous = [
        r for r in agent_view["kpi_rows"]
        if str(r.get("level")) == "link" and float(r.get("success_rate", 1.0)) < 0.995
    ]
    assert anomalous, "no anomalous link KPI produced for agent"
    upf1_hits = [r for r in anomalous if "UPF_1" in (r.get("src", ""), r.get("dst", ""))]
    assert upf1_hits, f"UPF_1 not flagged in anomalous links: {anomalous[:3]}"
    # CHR 也要有失败记录(供 Agent 降噪/聚类)
    fails = [c for c in agent_view["chr_records"] if c.get("outcome") == "failure"]
    assert fails, "no failure CHR records produced"
    # 运行时遥测(runtime_context)与真值类别
    assert "ne_cpu" in agent_view["runtime_context"]
    assert "traffic_class_stats" in agent_view["runtime_context"]
    assert "load_reduction_hint" in agent_view["runtime_context"]


def test_planner_policy_recovers_network():
    """正确诊断 → 通用规划器(隔离+重选 UPF_1)→ PDU SR 回升 → is_recovered(闭环)。"""
    engine = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    _run_ticks(engine, 15)
    engine.inject_fault(SCENARIO_A.fault_config)
    _run_ticks(engine, 14, start=16)
    _, fault_pdu = _sr(engine)
    assert fault_pdu < 0.992

    ctx = build_plan_context(engine)
    plan = plan_recovery_actions(_diag(["UPF_1"]), ctx, round_no=1)
    kinds = [(p.policy.kind, p.policy.ne_id or p.policy.from_ne_id) for p in plan]
    assert ("isolate", "UPF_1") in kinds, f"planner should isolate UPF_1: {kinds}"
    assert ("reroute", "UPF_1") in kinds, f"planner should reroute from UPF_1: {kinds}"

    engine.apply_policy([p.policy for p in plan])
    _run_ticks(engine, 14, start=30)
    reg_sr, pdu_sr = _sr(engine)
    assert pdu_sr > 0.99, f"PDU SR did not recover after policy: {pdu_sr}"
    assert pdu_sr > fault_pdu, f"PDU SR did not improve: {pdu_sr} vs {fault_pdu}"
    assert engine.is_recovered() is True


def test_planner_wrong_diagnosis_does_not_recover():
    """误诊(定位健康 SMF_2)→ 策略打错对象 → 真实不恢复(无剧本,诚实失败)。"""
    engine = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    _run_ticks(engine, 15)
    engine.inject_fault(SCENARIO_A.fault_config)
    _run_ticks(engine, 14, start=16)

    ctx = build_plan_context(engine)
    plan = plan_recovery_actions(_diag(["SMF_2"]), ctx, round_no=1)
    assert plan, "planner should still act on a (wrong) diagnosis"
    engine.apply_policy([p.policy for p in plan])
    _run_ticks(engine, 16, start=30)
    assert engine.is_recovered() is False, "wrong diagnosis must NOT recover the network"


def test_flow_control_filter_spares_toc():
    """流控过滤器真实生效:限 sst=3 只削物联类别,ToC(sst=1)不受影响。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    engine = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    _run_ticks(engine, 15)
    engine.inject_fault(SCENARIO_D.fault_config)
    # 先跑 8 个风暴 tick,让窗口装满风暴期到达
    toc_before = sum(engine.advance_tick(t).kpi.get("toc_reg_rate", 0) for t in range(16, 24))
    storm_reg_before = sum(r for r, _ in engine._win_reg)  # noqa: SLF001

    # 只对 sst=3 类别做强准入(AMF 层):总注册到达显著下降
    engine.apply_policy([PolicyAction(
        kind="flow_control", layer="AMF", ratio=0.9, flt={"sst": 3})])
    # 让滚动窗口(12)完全换成本策略下的 tick
    toc_after = sum(engine.advance_tick(t).kpi.get("toc_reg_rate", 0) for t in range(24, 36))
    after_reg_arrivals = sum(r for r, _ in engine._win_reg)  # noqa: SLF001
    assert after_reg_arrivals < storm_reg_before * 0.6, (
        f"AMF admission on sst=3 should cut reg arrivals: {after_reg_arrivals} vs {storm_reg_before}"
    )
    # ToC(sst=1)到达不受 sst=3 过滤器影响(期望值不变,容忍泊松波动)
    assert toc_after >= toc_before * 0.5, (
        f"ToC arrivals should be spared by the sst=3 filter: {toc_after} vs {toc_before}"
    )


def test_ue_backoff_depends_on_terminal_support():
    """UE back-off 只对支持 back-off 的终端生效(不支持者继续冲击 → 部分抑制)。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    engine = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    _run_ticks(engine, 15)
    engine.inject_fault(SCENARIO_D.fault_config)
    _run_ticks(engine, 8, start=16)
    before = sum(r for r, _ in engine._win_reg)  # noqa: SLF001
    engine.apply_policy([PolicyAction(
        kind="flow_control", layer="UE", ratio=0.9, flt={"sst": 3})])
    _run_ticks(engine, 12, start=24)
    backoffs = sum(b for b, _ in engine._win_rejects)  # noqa: SLF001
    after = sum(r for r, _ in engine._win_reg)  # noqa: SLF001
    assert backoffs > 0, "UE backoff should suppress some arrivals"
    assert after < before, f"backoff should reduce arrivals: {after} vs {before}"


def test_surge_filter_only_surges_matching_class():
    """激增过滤器:仅 sst=3 类别到达激增(surge_filter),ToC 基线不变。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    engine = RealtimeEngine(scenario=SCENARIO_D, seed=7)
    _run_ticks(engine, 10)
    base_toc = engine._tick_toc_reg  # noqa: SLF001
    base_iot = engine._tick_iot_reg  # noqa: SLF001

    engine.inject_fault(SCENARIO_D.fault_config)
    _run_ticks(engine, 10, start=11)
    storm_toc = engine._tick_toc_reg  # noqa: SLF001
    storm_iot = engine._tick_iot_reg  # noqa: SLF001

    assert storm_iot > base_iot * 3 + 3, f"iot arrivals should surge: {storm_iot} vs {base_iot}"
    assert storm_toc <= max(base_toc * 1.5, base_toc + 4), (
        f"toc arrivals should stay flat: {storm_toc} vs {base_toc}"
    )


def test_traffic_class_stats_dominant_on_storm():
    """风暴期失败类别归因:主导类别 = sst=3(失败份额显著高于基线占比)。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    engine = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    _run_ticks(engine, 15)
    engine.inject_fault(SCENARIO_D.fault_config)
    _run_ticks(engine, 12, start=16)
    stats = engine.traffic_class_stats()
    assert stats["fail_total"] >= 20
    dom = stats["dominant"]
    assert dom is not None, "storm failures should attribute to a dominant class"
    assert dom["flt"] == {"sst": 3}
    assert dom["fail_share"] > 0.8


def test_load_reduction_hint_scales_with_overload():
    """减载提示:过载越深 hint 越大;未过载接近 0。"""
    from agents.simulation.live_scenarios import SCENARIO_D

    healthy = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    _run_ticks(healthy, 12)
    assert max(healthy.load_reduction_hint().values()) <= 0.05

    storm = RealtimeEngine(scenario=SCENARIO_D, seed=42)
    _run_ticks(storm, 15)
    storm.inject_fault(SCENARIO_D.fault_config)
    _run_ticks(storm, 12, start=16)
    hint = storm.load_reduction_hint()
    assert hint["AMF"] > 0.2 and hint["SMF"] > 0.2, f"storm should need real reduction: {hint}"


def test_kpi_snapshot_has_amf_smf_counters():
    """快照含 AMF 注册成功率/请求数、SMF PDU 成功率/请求数、CPU(给前端展示)。"""
    engine = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    snap = engine.advance_tick(1)
    kpi = snap.kpi
    for key in ("amf_success_rate", "smf_success_rate", "amf_reg_requests", "smf_pdu_requests",
                "amf_cpu", "smf_cpu", "ne_cpu"):
        assert key in kpi, f"snapshot missing {key}"
    assert "UPF_1" in kpi["ne_cpu"]
    assert kpi["amf_reg_requests"] > 0
    assert kpi["smf_pdu_requests"] > 0
    # 流控观测计数
    assert "backoff_rejects" in kpi and "admission_rejects" in kpi


@pytest.mark.parametrize("sid", ["A", "B", "C", "D", "E", "F", "G"])
def test_all_scenarios_real_closed_loop(sid):
    """A~G 全场景真实闭环:注入 → 异常可见 → 正确诊断(确定性诊断器)→ 规划 → 恢复。"""
    import asyncio

    from agents.fault_perception.confidence import ConfidenceAssessor
    from agents.fault_perception.deterministic_diagnoser import diagnose_deterministic
    from agents.shared.models import CaseData
    from agents.simulation.live_scenarios import SCENARIOS

    async def run():
        scen = SCENARIOS[sid]
        engine = RealtimeEngine(scenario=scen, seed=42)
        _run_ticks(engine, 13)
        assert engine.is_recovered(), f"{sid}: healthy phase should look recovered"
        engine.inject_fault(scen.fault_config)
        _run_ticks(engine, 14, start=14)
        assert not engine.is_recovered(), f"{sid}: fault phase should break recovery"

        t0 = 28
        for rnd in (1, 2, 3):
            snap = engine.snapshot_for_agent()
            cd = CaseData(
                case_id=rnd, kpi_rows=snap["kpi_rows"],
                topology_text=snap["topology_text"], process_text=snap["process_text"],
                ground_truth=snap["ground_truth"], chr_records=snap["chr_records"],
                runtime_context=snap["runtime_context"],
            )
            assessment = ConfidenceAssessor().assess(cd)
            diag = await diagnose_deterministic(cd, assessment, f"s{rnd}", assessment.route)
            truth = set(snap["ground_truth"]["fault_elements"])
            assert set(diag.fault_elements) & truth, (
                f"{sid} r{rnd}: diagnosis {diag.fault_elements} misses truth {sorted(truth)}"
            )
            plan = plan_recovery_actions(diag, build_plan_context(engine), round_no=rnd)
            assert plan, f"{sid} r{rnd}: planner produced no actions"
            engine.apply_policy([p.policy for p in plan])
            _run_ticks(engine, 20, start=t0)
            t0 += 20
            if engine.is_recovered():
                break
        assert engine.is_recovered(), f"{sid}: not recovered within 3 rounds"

    asyncio.run(run())
