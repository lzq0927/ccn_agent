"""RealtimeEngine 单元测试:消息级 DES + AMF/SMF 计数器 + 故障注入/策略闭环。"""
from __future__ import annotations

from agents.simulation.live_scenarios import SCENARIO_A
from agents.simulation.policy_resolver import resolve_policy_actions
from agents.simulation.realtime_engine import RealtimeEngine


def _run_ticks(engine: RealtimeEngine, n: int, start: int = 1):
    last = None
    for i in range(n):
        last = engine.advance_tick(start + i)
    return last


def _sr(engine: RealtimeEngine):
    return engine._success_rates()  # noqa: SLF001


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


def test_policy_execution_recovers_network():
    """下发策略:隔离 UPF_1 + 重选会话后,PDU SR 回升,is_recovered 转 True(闭环)。"""
    engine = RealtimeEngine(scenario=SCENARIO_A, seed=42)
    _run_ticks(engine, 15)
    engine.inject_fault(SCENARIO_A.fault_config)
    _run_ticks(engine, 14, start=16)
    _, fault_pdu = _sr(engine)
    assert fault_pdu < 0.992

    actions = resolve_policy_actions(SCENARIO_A, diagnosis=None)
    assert any(a.kind == "isolate" and a.ne_id == "UPF_1" for a in actions)
    assert any(a.kind == "reroute" and a.from_ne_id == "UPF_1" for a in actions)

    engine.apply_policy(actions)
    _run_ticks(engine, 14, start=30)
    reg_sr, pdu_sr = _sr(engine)
    assert pdu_sr > 0.99, f"PDU SR did not recover after policy: {pdu_sr}"
    assert pdu_sr > fault_pdu, f"PDU SR did not improve: {pdu_sr} vs {fault_pdu}"
    assert engine.is_recovered() is True


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
