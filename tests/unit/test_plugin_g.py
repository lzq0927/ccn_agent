"""场景 G plugin 单测(AI 平台→UDM 过载→AMF/SMF 协同限流)。"""
from agents.simulation.plugins.g_udm_overload import PLUGIN


def test_plugin_g_metadata():
    assert PLUGIN.id == "G"
    assert PLUGIN.capabilities == "live"
    assert PLUGIN.expected_round == 2


def test_plugin_g_topology_has_udm_amf_smf():
    topo = PLUGIN.build_topology()
    assert topo is not None
    types = {n.ne_type.value for n in topo.elements.values()}
    assert {"UDM", "AMF", "SMF"} <= types


def test_plugin_g_first_round_low_confidence():
    from agents.shared.scenario_plugin import DiagnosisContext
    ctx = DiagnosisContext(scenario_id="G", round=1, confidence_so_far=0.0, tick_window=[])
    plan = PLUGIN.diagnosis_llm_stub(ctx)
    assert plan.confidence < 0.3  # 首轮 UDM 过载但根因待溯源 → 0.28
    assert plan.fault_elements == []  # 首轮未定位


def test_plugin_g_second_round_converged():
    from agents.shared.scenario_plugin import DiagnosisContext
    ctx = DiagnosisContext(scenario_id="G", round=2, confidence_so_far=0.0, tick_window=[])
    plan = PLUGIN.diagnosis_llm_stub(ctx)
    assert plan.confidence >= 0.3
    assert "UDM_1" in plan.fault_elements  # 治理点 UDM


def test_plugin_g_recovery_actions_only_round2():
    from dataclasses import dataclass

    @dataclass
    class P:
        fault_elements: list[str]
        confidence: float
        round: int = 1

    r1 = PLUGIN.recovery_actions(P([], 0.28, round=1))
    assert r1 == []  # 首轮 confidence 低 → restart,不下发恢复
    r2 = PLUGIN.recovery_actions(P(["UDM_1"], 0.8, round=2))
    assert len(r2) == 3  # UE T3346 + AMF 限 SST=3 + SMF 限 DNN
    layers = {a.layer for a in r2}
    assert layers == {"UE", "AMF", "SMF"}


def test_plugin_g_ue_request_limits_ai_platform():
    from agents.simulation.live_engine import UeRequest
    req = UeRequest(ue_id="u1", kind="registration", sim_t=1, sst=3, apn="MIot.xx")
    resp = PLUGIN.on_ue_request(req)
    assert resp.verdict == "BACKOFF"
    assert resp.backoff_seconds == 600  # T3346 10min
    # 非 AI 平台终端放行
    req2 = UeRequest(ue_id="u2", kind="registration", sim_t=1, sst=1, apn="internet")
    assert PLUGIN.on_ue_request(req2).verdict == "ALLOW"


def test_plugin_g_rebatch_chr_spec():
    spec = PLUGIN.request_rebatch_chr()
    assert spec is not None
    for dim in ("slice_sst", "dnn", "device_type", "supports_t3346"):
        assert dim in spec.dimensions


def test_plugin_g_on_tick_emits_kpi_with_udm():
    from agents.shared.scenario_plugin import TickContext
    ctx = TickContext(sim_t=36, ne_cpu={}, kpi_window=[], chr_window=[], active_ue=0,
                      round=1, global_t=36)
    events = PLUGIN.on_tick(ctx)
    types = [getattr(e, "type", None) for e in events]
    assert "kpi_snapshot" in types
    assert "chr_record" in types  # 故障期有 CHR
    assert "alarm" in types  # UDM 过载告警
    # ne_cpu 已填(UDM_1 过载)
    assert "UDM_1" in ctx.ne_cpu
    assert ctx.ne_cpu["UDM_1"] >= 85  # 过载峰
    # kpi_snapshot 含 G 专用字段
    kpi = next(e.payload for e in events if getattr(e, "type", None) == "kpi_snapshot")
    assert "udm_cpu" in kpi
    assert "ai_platform_reg_share" in kpi


def test_plugin_g_on_tick_steady_when_no_fault():
    from agents.shared.scenario_plugin import TickContext
    ctx = TickContext(sim_t=10, ne_cpu={}, kpi_window=[], chr_window=[], active_ue=0,
                      round=1, global_t=10)
    events = PLUGIN.on_tick(ctx)
    kpi = next(e.payload for e in events if getattr(e, "type", None) == "kpi_snapshot")
    assert kpi["udm_cpu"] < 50  # 稳态不过载
    # 稳态无 CHR/告警(只有 kpi_snapshot)
    types = [getattr(e, "type", None) for e in events]
    assert "chr_record" not in types
    assert "alarm" not in types
