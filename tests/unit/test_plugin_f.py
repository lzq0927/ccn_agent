from agents.simulation.plugins.f_iot_storm_layered import PLUGIN


def test_plugin_f_metadata():
    assert PLUGIN.id == "F"
    assert PLUGIN.capabilities == "live"
    assert PLUGIN.expected_round == 2


def test_plugin_f_topology_has_3_layer_set():
    topo = PLUGIN.build_topology()
    assert topo is not None
    # 场景 F 必含 AMF/SMF/UPF
    types = {n.ne_type.value for n in topo.elements.values()}
    assert {"AMF", "SMF", "UPF"} <= types


def test_plugin_f_first_round_low_confidence():
    from agents.shared.scenario_plugin import DiagnosisContext, TickContext
    ctx = DiagnosisContext(scenario_id="F", round=1, confidence_so_far=0.0, tick_window=[])
    plan = PLUGIN.diagnosis_llm_stub(ctx)
    assert plan.confidence < 0.3  # 首轮 iPhone back-off 失败反升 → 0.28
    assert plan.fault_elements == []  # 首轮未收敛


def test_plugin_f_second_round_converged():
    from agents.shared.scenario_plugin import DiagnosisContext
    ctx = DiagnosisContext(scenario_id="F", round=2, confidence_so_far=0.0, tick_window=[])
    plan = PLUGIN.diagnosis_llm_stub(ctx)
    assert plan.confidence >= 0.3
    assert "AMF_1" in plan.fault_elements or "UPF_1" in plan.fault_elements


def test_plugin_f_recovery_actions_two_rounds():
    from dataclasses import dataclass
    @dataclass
    class P:
        fault_elements: list[str]
        confidence: float
        round: int = 1
    r1 = PLUGIN.recovery_actions(P([], 0.28, round=1))
    assert len(r1) == 3  # UE back-off + AMF NSSAI + SMF DNN
    r2 = PLUGIN.recovery_actions(P(["AMF_1"], 0.6, round=2))
    assert len(r2) == 3
    # 二轮应包含 iPhone 排除提示
    r2_text = " ".join(a.cn for a in r2)
    assert "iPhone" in r2_text or "排除" in r2_text


def test_plugin_f_ue_request_denies_unsupported_backoff():
    from agents.simulation.live_engine import UeRequest, UeResponse
    req = UeRequest(
        ue_id="u1", kind="registration", sim_t=1,
        apn="iot-platform", sst=3, device_type="iphone", supports_backoff=False,
    )
    resp = PLUGIN.on_ue_request(req)
    # 首轮(默认)对不支持 back-off 的 iPhone 应 deny
    assert resp.verdict in ("DENY", "BACKOFF")  # 限流/拦截


def test_plugin_f_rebatch_chr_spec():
    spec = PLUGIN.request_rebatch_chr()
    assert spec is not None
    assert "device_type" in spec.dimensions
    assert "supports_backoff" in spec.dimensions