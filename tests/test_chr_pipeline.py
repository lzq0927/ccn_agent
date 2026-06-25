"""Tests for the Phase-1 free5GC-faithful CHR data pipeline.

Milestone M1.1 covers the data structures: cause-code enums, subscriber/PDU
session identity, the NRF view, and the CHRRecord / SimulationResult models.
Later milestones append tests for CHRGenerator, engine wiring and persistence.
"""

from __future__ import annotations

import hashlib
import json
import re

from agents.data_generation.free5gc_adapter import Free5GCAdapter
from agents.data_generation.simulator_wrapper import SimulatorWrapper
from agents.data_generation.validator import LLMValidator
from agents.fault_perception.confidence import ConfidenceAssessor
from agents.fault_perception.context_manager import ContextManager
from agents.shared.models import CaseData, CaseParams, parse_chr_jsonl
from agents.shared.storage import Storage
from simulator.chr_generator import CHRGenerator
from simulator.engine import SimulationEngine
from simulator.exporter import DataExporter
from simulator.free5gc_types import Cause5GMM, Cause5GSM, SBIStatus, SBI_FAILURE_STATUSES
from simulator.models import (
    CHRRecord,
    FaultConfig,
    FaultMode,
    FaultPointType,
    NetworkElement,
    NEType,
    Scenario,
    SimulationResult,
)
from simulator.nrf_view import enrich_topology
from simulator.subscriber import SubscriberRegistry
from simulator.topology import TopologyGenerator


# ---------------------------------------------------------------------------
# M1.1 — free5GC cause-code enums
# ---------------------------------------------------------------------------


def test_cause_enums_carry_real_5g_values():
    # Spot-check the diagnosis-relevant cause codes the simulator maps faults to.
    assert Cause5GMM.CONGESTION.value == "22"
    assert Cause5GMM.REGISTRATION_REJECT_GENERIC.value == "2"
    assert Cause5GSM.NETWORK_FAILURE.value == "38"
    assert Cause5GSM.REQUEST_REJECTED_UNSPECIFIED.value == "31"
    assert Cause5GSM.INSUFFICIENT_RESOURCES.value == "67"
    # Synthetic "no cause" sentinel.
    assert Cause5GMM.NONE.value == "0"
    assert Cause5GSM.NONE.value == "0"


def test_sbi_failure_status_set_covers_5xx_and_overload():
    assert SBIStatus.SERVICE_UNAVAILABLE in SBI_FAILURE_STATUSES  # 503 NE down
    assert SBIStatus.TOO_MANY_REQUESTS in SBI_FAILURE_STATUSES  # 429 congestion
    assert SBIStatus.INTERNAL_SERVER_ERROR in SBI_FAILURE_STATUSES
    assert SBIStatus.OK not in SBI_FAILURE_STATUSES


# ---------------------------------------------------------------------------
# M1.1 — subscriber identity model (deterministic)
# ---------------------------------------------------------------------------

_SUPI_RE = re.compile(r"^imsi-00101\d{10}$")


def test_subscriber_registry_is_deterministic():
    a = SubscriberRegistry(case_id=7, ue_count=50)
    b = SubscriberRegistry(case_id=7, ue_count=50)
    assert [s.supi for s in a.subscribers] == [s.supi for s in b.subscribers]
    assert [s.imsi for s in a.subscribers] == [s.imsi for s in b.subscribers]


def test_subscriber_registry_different_cases_differ():
    a = SubscriberRegistry(case_id=1, ue_count=20)
    b = SubscriberRegistry(case_id=2, ue_count=20)
    assert a.subscribers[0].supi != b.subscribers[0].supi


def test_subscriber_supi_format_and_pdu_session_range():
    reg = SubscriberRegistry(case_id=3, ue_count=40)
    assert len(reg.subscribers) == 40
    for profile in reg.subscribers:
        assert _SUPI_RE.match(profile.supi), profile.supi
        assert profile.imsi.isdigit() and len(profile.imsi) == 15
        assert profile.dnn == "internet"
        assert profile.snssai == (1, 0x010203)
    for session in reg.sessions:
        assert 1 <= session.pdu_session_id <= 15


def test_subscriber_ue_id_join_key_maps_to_supi():
    reg = SubscriberRegistry(case_id=5, ue_count=10)
    profile = reg.get("UE_1")
    session = reg.session("UE_1")
    assert profile is not None and session is not None
    assert profile.supi == session.supi
    assert reg.get("UE_99") is None  # out of range


# ---------------------------------------------------------------------------
# M1.1 — NRF view enrichment
# ---------------------------------------------------------------------------


def _fresh_topology() -> "object":
    return TopologyGenerator().generate(0, seed=100)


def test_nrf_view_enriches_and_is_idempotent():
    topo = _fresh_topology()
    enrich_topology(topo, case_id=1)
    # Every non-gNB NE gets an SBI endpoint + REGISTERED status.
    for ne in topo.elements.values():
        assert ne.nf_instance_id == ne.id
        assert ne.nf_status == "REGISTERED"
        if ne.ne_type == NEType.gNB:
            assert ne.sbi_endpoint == ""
        else:
            assert ne.sbi_endpoint.startswith("https://")
            assert ne.sbi_endpoint.endswith(".free5gc:8000")
    # Calling again must be a no-op (cached topology safety).
    before = {ne.id: ne.sbi_endpoint for ne in topo.elements.values()}
    enrich_topology(topo, case_id=999)
    after = {ne.id: ne.sbi_endpoint for ne in topo.elements.values()}
    assert before == after


# ---------------------------------------------------------------------------
# M1.1 — CHRRecord / SimulationResult data structures
# ---------------------------------------------------------------------------


def test_chr_record_default_success_contract():
    rec = CHRRecord(
        timestamp=5,
        supi="imsi-001010000000001",
        pdu_session_id=1,
        procedure_type="PDU_Session_Establishment",
        msg_hop="AMF->SMF",
        nf_src="AMF_1",
        nf_dst="SMF_1",
        service="Nsmf_PDUSession_CreateSMContext",
        sbi_status=SBIStatus.OK.value,
        outcome="success",
        cause5gmm=Cause5GMM.NONE.value,
        cause5gsm=Cause5GSM.NONE.value,
        latency_ms=12.0,
        message_name="Nsmf_PDUSession_CreateSMContext Request",
        ue_id="UE_1",
    )
    assert rec.outcome == "success"
    assert rec.sbi_status == 200


def test_simulation_result_has_chr_layer_fields():
    result = SimulationResult()
    assert result.chr_records == []
    assert result.subscribers == []
    assert result.sessions == []


def test_network_element_has_nrf_defaults():
    ne = NetworkElement(id="AMF_1", ne_type=NEType.AMF, pool_id="p", dc_id="d")
    assert ne.nf_instance_id == ""
    assert ne.nf_status == "REGISTERED"  # default before enrichment


# ---------------------------------------------------------------------------
# M1.2 — CHRGenerator cause-code mapping
# ---------------------------------------------------------------------------


def _sbi_hop_kwargs(**overrides):
    """Fixed kwargs for an AMF->SMF SBI hop, overridable per test."""
    base = dict(
        t=25,
        ue_id="UE_1",
        procedure_type="PDU_Session_Establishment",
        msg_hop="AMF->SMF",
        nf_src="AMF_1",
        nf_dst="SMF_1",
        service="Nsmf_PDUSession_CreateSMContext",
        message_name="Nsmf_PDUSession_CreateSMContext Request",
        fault_active=False,
        fault_hit=False,
        fault_mode=None,
        fault_point_type=None,
    )
    base.update(overrides)
    return base


def _gen(case_id: int = 1) -> CHRGenerator:
    # background_fail_rate=0 makes success-path tests non-flaky.
    return CHRGenerator(case_id=case_id, background_fail_rate=0.0)


def test_chr_generator_success_when_no_fault():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(),
    )
    assert rec.outcome == "success"
    assert rec.sbi_status == SBIStatus.OK.value
    assert rec.cause5gmm == Cause5GMM.NONE.value
    assert rec.cause5gsm == Cause5GSM.NONE.value
    assert rec.pdu_session_id == reg.session("UE_1").pdu_session_id


def test_chr_generator_link_fault_maps_to_network_failure():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(
            fault_active=True,
            fault_hit=True,
            fault_mode=FaultMode.LINK,
            fault_point_type=FaultPointType.SINGLE_NE,
        ),
    )
    assert rec.outcome == "failure"
    assert rec.sbi_status in (SBIStatus.SERVICE_UNAVAILABLE.value, SBIStatus.GATEWAY_TIMEOUT.value)
    assert rec.cause5gsm == Cause5GSM.NETWORK_FAILURE.value


def test_chr_generator_business_session_fault():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(
            fault_active=True,
            fault_hit=True,
            fault_mode=FaultMode.BUSINESS,
            fault_point_type=FaultPointType.SINGLE_NE,
        ),
    )
    assert rec.outcome == "failure"
    assert rec.sbi_status == SBIStatus.INTERNAL_SERVER_ERROR.value
    assert rec.cause5gsm in (
        Cause5GSM.REQUEST_REJECTED_UNSPECIFIED.value,
        Cause5GSM.REQUEST_REJECTED.value,
    )


def test_chr_generator_business_registration_fault_uses_5gmm():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(
            procedure_type="Registration",
            msg_hop="AMF->AUSF",
            service="Nausf_UEAuthentication",
            message_name="Nausf_UEAuthentication Authenticate Request",
            fault_active=True,
            fault_hit=True,
            fault_mode=FaultMode.BUSINESS,
            fault_point_type=FaultPointType.SINGLE_NE,
        ),
    )
    assert rec.outcome == "failure"
    assert rec.cause5gmm == Cause5GMM.REGISTRATION_REJECT_GENERIC.value
    assert rec.pdu_session_id is None  # Registration carries no PDU session


def test_chr_generator_resource_pool_congestion():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(
            fault_active=True,
            fault_hit=True,
            fault_mode=FaultMode.LINK,
            fault_point_type=FaultPointType.RESOURCE_POOL,
        ),
    )
    assert rec.sbi_status == SBIStatus.TOO_MANY_REQUESTS.value
    assert rec.cause5gmm == Cause5GMM.CONGESTION.value


def test_chr_generator_path_session_fault():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(
            fault_active=True,
            fault_hit=True,
            fault_mode=FaultMode.BUSINESS,
            fault_point_type=FaultPointType.PATH_SESSION,
        ),
    )
    assert rec.cause5gsm in (
        Cause5GSM.INSUFFICIENT_RESOURCES.value,
        Cause5GSM.UNKNOWN_PDU_SESSION_TYPE.value,
    )


def test_chr_generator_radio_hop_carries_no_sbi_status():
    reg = SubscriberRegistry(case_id=1, ue_count=1)
    rec = _gen().emit(
        subscriber=reg.get("UE_1"),
        session=reg.session("UE_1"),
        **_sbi_hop_kwargs(
            msg_hop="gNB->UE",
            nf_src="gNB_1",
            nf_dst="UE_1",
            service="RRC",
            message_name="RRC Reconfiguration",
            fault_active=True,
            fault_hit=True,
            fault_mode=FaultMode.LINK,
            fault_point_type=FaultPointType.SINGLE_NE,
        ),
    )
    assert rec.sbi_status == 0  # radio/NAS hops are not SBI


def _emit_sequence(gen: CHRGenerator, reg: SubscriberRegistry):
    """Feed a fixed emit sequence; return the produced records."""
    out = []
    out.append(
        gen.emit(subscriber=reg.get("UE_1"), session=reg.session("UE_1"), **_sbi_hop_kwargs())
    )
    out.append(
        gen.emit(
            subscriber=reg.get("UE_1"),
            session=reg.session("UE_1"),
            **_sbi_hop_kwargs(
                t=26,
                fault_active=True,
                fault_hit=True,
                fault_mode=FaultMode.LINK,
                fault_point_type=FaultPointType.SINGLE_NE,
            ),
        )
    )
    out.append(
        gen.emit(
            subscriber=reg.get("UE_1"),
            session=reg.session("UE_1"),
            **_sbi_hop_kwargs(
                t=27,
                fault_active=True,
                fault_hit=True,
                fault_mode=FaultMode.BUSINESS,
                fault_point_type=FaultPointType.RESOURCE_POOL,
            ),
        )
    )
    return out


def test_chr_generator_is_deterministic_per_case_id():
    reg1 = SubscriberRegistry(case_id=42, ue_count=5)
    reg2 = SubscriberRegistry(case_id=42, ue_count=5)
    a = _emit_sequence(_gen(case_id=42), reg1)
    b = _emit_sequence(_gen(case_id=42), reg2)
    assert len(a) == len(b) == 3
    for ra, rb in zip(a, b):
        assert ra.timestamp == rb.timestamp
        assert ra.outcome == rb.outcome
        assert ra.sbi_status == rb.sbi_status
        assert ra.cause5gsm == rb.cause5gsm
        assert ra.cause5gmm == rb.cause5gmm
        assert ra.supi == rb.supi


# ---------------------------------------------------------------------------
# M1.3 — SimulationEngine emits CHR (KPI↔CHR consistent)
# ---------------------------------------------------------------------------

_ANOMALY = 0.995  # the anomaly threshold used everywhere in the system


def _fault_scenario():
    """A deterministic SINGLE_NE LINK fault on an AMF (always on the path)."""
    topo = TopologyGenerator().generate(0, seed=100)
    amf = topo.get_elements_by_type(NEType.AMF)[0]
    fc = FaultConfig(
        fault_point_type=FaultPointType.SINGLE_NE,
        fault_mode=FaultMode.LINK,
        loss_rate=0.06,
        fault_start=25,
        fault_duration=15,
        affected_ne_ids={amf.id},
    )
    return Scenario(
        case_id=1,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=50,
        fault_config=fc,
        is_normal=False,
        is_train=True,
    )


def test_engine_produces_chr_and_subscriber_layer():
    scenario = _fault_scenario()
    engine = SimulationEngine(chr_background_fail_rate=0.0)
    result = engine.simulate(scenario)
    assert result.chr_records, "CHR records should be produced"
    assert len(result.subscribers) == scenario.ue_count
    assert len(result.sessions) == scenario.ue_count
    # Topology got the NRF view.
    for ne in scenario.topology.elements.values():
        assert ne.nf_instance_id == ne.id


def test_engine_chr_failures_appear_during_fault_window():
    scenario = _fault_scenario()
    fc = scenario.fault_config
    engine = SimulationEngine(chr_background_fail_rate=0.0)
    result = engine.simulate(scenario)
    in_window = [
        r
        for r in result.chr_records
        if fc.fault_start <= r.timestamp < fc.fault_start + fc.fault_duration
        and r.outcome == "failure"
    ]
    assert in_window, "CHR should record failures during the active fault window"
    # Failure cause codes must come from the modelled enumerations.
    valid_5gsm = {c.value for c in Cause5GSM}
    valid_5gmm = {c.value for c in Cause5GMM}
    for r in in_window:
        assert r.cause5gsm in valid_5gsm
        assert r.cause5gmm in valid_5gmm
        assert r.sbi_status == 0 or r.sbi_status >= 400


def _trace_kpi_index(result):
    """Index trace KPI rows by (timestamp, ue_id, src, dst) → success_rate."""
    idx = {}
    for rec in result.kpi_records:
        if rec.level == "trace":
            idx[(rec.timestamp, rec.ue_id, rec.src, rec.dst)] = rec.success_rate
    return idx


def test_engine_kpi_chr_failure_consistency():
    """A clearly-degraded trace KPI (< 0.995) must surface as a CHR failure.

    This is the robust KPI→CHR direction. The reverse need not hold: CHR is
    *more* sensitive than the 0.995 threshold — a mildly / indirectly degraded
    hop can fail in CHR while its aggregate success rate stays just above 0.995.
    That headroom is exactly the micro-loss / hidden-fault signal CHR adds.
    """
    scenario = _fault_scenario()
    engine = SimulationEngine(chr_background_fail_rate=0.0)  # zero noise floor
    result = engine.simulate(scenario)
    trace = _trace_kpi_index(result)
    chr_index = {(r.timestamp, r.ue_id, r.nf_src, r.nf_dst): r for r in result.chr_records}

    degraded = [k for k, sr in trace.items() if sr < _ANOMALY]
    assert degraded, "expected some degraded trace KPI rows for a fault scenario"
    for key in degraded:
        chr_rec = chr_index.get(key)
        assert chr_rec is not None, f"degraded KPI hop {key} has no CHR record"
        assert chr_rec.outcome == "failure", (
            f"degraded KPI at {key} (sr={trace[key]:.4f}) but CHR outcome={chr_rec.outcome}"
        )


def test_engine_kpi_chr_success_consistency():
    """Every CHR success on an SBI hop must align with a healthy trace KPI."""
    scenario = _fault_scenario()
    engine = SimulationEngine(chr_background_fail_rate=0.0)
    result = engine.simulate(scenario)
    trace = _trace_kpi_index(result)

    # Sample to keep the assertion fast on the large CHR set.
    successes = [r for r in result.chr_records if r.outcome == "success" and r.sbi_status != 0]
    for chr_rec in successes[:: max(1, len(successes) // 200)]:
        sr = trace.get((chr_rec.timestamp, chr_rec.ue_id, chr_rec.nf_src, chr_rec.nf_dst))
        assert sr is not None
        assert sr >= _ANOMALY, (
            f"CHR success at ts={chr_rec.timestamp} {chr_rec.nf_src}->{chr_rec.nf_dst} "
            f"but trace KPI is degraded ({sr})"
        )


def test_engine_chr_is_deterministic():
    s = _fault_scenario()
    r1 = SimulationEngine(chr_background_fail_rate=0.0).simulate(s)
    r2 = SimulationEngine(chr_background_fail_rate=0.0).simulate(s)
    # Simulation mutates fault_config (path resolution) and topology (NRF view),
    # but CHR output for the same scenario must be byte-identical.
    a = [
        f"{r.timestamp}|{r.supi}|{r.msg_hop}|{r.outcome}|{r.sbi_status}|{r.cause5gsm}"
        for r in r1.chr_records
    ]
    b = [
        f"{r.timestamp}|{r.supi}|{r.msg_hop}|{r.outcome}|{r.sbi_status}|{r.cause5gsm}"
        for r in r2.chr_records
    ]
    assert a == b


# ---------------------------------------------------------------------------
# M1.4 — persistence (exporter / wrapper / storage, dual path)
# ---------------------------------------------------------------------------

_CHR_KEYS = {
    "timestamp",
    "supi",
    "pdu_session_id",
    "procedure_type",
    "msg_hop",
    "nf_src",
    "nf_dst",
    "service",
    "sbi_status",
    "outcome",
    "cause5gmm",
    "cause5gsm",
    "latency_ms",
    "message_name",
    "ue_id",
}


def _single_pkg(case_id: int = 7):
    return SimulatorWrapper().generate(CaseParams(seed=42, ue_count=30), case_id=case_id)


def _parse_jsonl(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def test_wrapper_generate_populates_chr_data():
    pkg = _single_pkg()
    assert pkg.chr_data, "CasePackage.chr_data should be populated"
    rows = _parse_jsonl(pkg.chr_data)
    assert rows
    assert _CHR_KEYS <= set(rows[0].keys())


def test_storage_chr_round_trip(tmp_path):
    storage = Storage(db_path=str(tmp_path / "test.db"))
    pkg = _single_pkg(case_id=3)
    storage.save_case_files(3, pkg)
    files = storage.load_case_files(3)
    assert files is not None
    assert files["chr.jsonl"] == pkg.chr_data


def test_storage_load_without_chr_is_backward_compatible(tmp_path):
    storage = Storage(db_path=str(tmp_path / "test.db"))
    case_dir = tmp_path / "cases" / "case_005"
    case_dir.mkdir(parents=True)
    for name in ["data.csv", "topo.txt", "process.txt", "result.txt", "metadata.json"]:
        (case_dir / name).write_text("dummy", encoding="utf-8")
    files = storage.load_case_files(5)
    assert files is not None
    assert "chr.jsonl" not in files  # old pre-CHR case loads without error


def test_exporter_writes_chr_jsonl(tmp_path):
    scenario = _fault_scenario()
    result = SimulationEngine(chr_background_fail_rate=0.0).simulate(scenario)
    DataExporter(base_dir=str(tmp_path)).export(scenario, result)
    chr_path = tmp_path / f"case{scenario.case_id}" / "chr.jsonl"
    assert chr_path.exists()
    rows = _parse_jsonl(chr_path.read_text(encoding="utf-8"))
    assert rows
    assert _CHR_KEYS <= set(rows[0].keys())


# ---------------------------------------------------------------------------
# M1.5 — consumers: parse_chr_jsonl, closed_loop, perception prompt, validator
# ---------------------------------------------------------------------------


def test_parse_chr_jsonl_helper():
    assert parse_chr_jsonl("") == []
    assert parse_chr_jsonl(None) == []  # type: ignore[arg-type]
    assert parse_chr_jsonl('{"a": 1}\n\n{"a": 2}\n') == [{"a": 1}, {"a": 2}]


def test_closed_loop_load_case_data_carries_chr(tmp_path):
    from agents.closed_loop import ClosedLoopRunner

    runner = ClosedLoopRunner(storage=Storage(db_path=str(tmp_path / "x.db")))
    pkg = SimulatorWrapper().generate(CaseParams(seed=42, ue_count=20), case_id=1)
    case_data = runner._load_case_data(pkg)
    assert case_data.chr_records, "closed_loop should populate CaseData.chr_records"
    assert _CHR_KEYS <= set(case_data.chr_records[0].keys())


def _chr_records_with_failures() -> list[dict]:
    return [
        {
            "outcome": "failure",
            "supi": "imsi-001010000000001",
            "timestamp": 25,
            "nf_src": "AMF_1",
            "nf_dst": "SMF_1",
            "sbi_status": 503,
            "cause5gsm": "38",
            "cause5gmm": "0",
        },
        {
            "outcome": "success",
            "supi": "imsi-001010000000002",
            "timestamp": 1,
            "nf_src": "A",
            "nf_dst": "B",
            "sbi_status": 200,
            "cause5gsm": "0",
            "cause5gmm": "0",
        },
    ]


def test_context_manager_user_message_includes_chr_failures():
    msg = ContextManager().build_user_message(
        CaseData(
            case_id=1,
            kpi_rows=[],
            topology_text="t",
            process_text="p",
            ground_truth={},
            chr_records=_chr_records_with_failures(),
        )
    )
    assert "User-level CHR" in msg
    assert "38(1)" in msg  # cause distribution
    assert "AMF_1->SMF_1" in msg  # failed-attempt sample


def test_context_manager_user_message_omits_chr_when_empty():
    msg = ContextManager().build_user_message(
        CaseData(
            case_id=1,
            kpi_rows=[],
            topology_text="t",
            process_text="p",
            ground_truth={},
        )
    )
    assert "User-level CHR" not in msg


def test_validator_chr_summary_line():
    data = (
        '{"outcome": "failure", "cause5gsm": "38", "cause5gmm": "0"}\n'
        '{"outcome": "success", "cause5gsm": "0", "cause5gmm": "0"}\n'
    )
    line = LLMValidator._chr_summary_line(data)
    assert "1 failures / 2 attempts" in line
    assert "38(1)" in line


def test_validator_chr_summary_line_empty():
    assert LLMValidator._chr_summary_line("") == ""


# ---------------------------------------------------------------------------
# M1.6 — free5GC adapter + end-to-end CHR pipeline (no LLM required)
# ---------------------------------------------------------------------------


def test_free5gc_adapter_tags_source_and_has_chr():
    pkg = Free5GCAdapter().generate_case(
        {"fault_type": "single_ne", "fault_mode": "link", "ue_count": 30},
        case_id=11,
    )
    assert pkg.metadata.source.value == "free5gc"
    assert "free5gc" in pkg.metadata.tags
    assert pkg.chr_data


def test_free5gc_adapter_batch_small_count():
    pkgs = Free5GCAdapter().generate_batch(count=5, seed=42)
    assert len(pkgs) == 5
    for p in pkgs:
        assert p.metadata.source.value == "free5gc"
        assert p.chr_data


def test_chr_pipeline_end_to_end_to_diagnosis_prompt(tmp_path):
    """generate → save → load → CaseData → (rule-based) assess + prompt."""
    storage = Storage(db_path=str(tmp_path / "e2e.db"))
    pkg = Free5GCAdapter().generate_case(
        {"fault_type": "single_ne", "fault_mode": "link", "ue_count": 30},
        case_id=42,
    )
    storage.save_case_files(42, pkg)

    from agents.closed_loop import ClosedLoopRunner

    case_data = ClosedLoopRunner(storage=storage)._load_case_data(pkg)
    assert case_data.chr_records, "CHR must reach CaseData end-to-end"

    # Rule-based assessor runs on CHR-bearing CaseData (no LLM).
    assessment = ConfidenceAssessor().assess(case_data)
    assert assessment.route is not None

    # CHR reaches the diagnosis prompt.
    msg = ContextManager().build_user_message(case_data)
    assert "User-level CHR" in msg


def test_chr_reproducibility_hash():
    spec = {"fault_type": "single_ne", "fault_mode": "link", "ue_count": 30, "seed": 7}
    a = Free5GCAdapter().generate_case(spec, case_id=1).chr_data
    b = Free5GCAdapter().generate_case(spec, case_id=1).chr_data
    assert hashlib.sha256(a.encode()).hexdigest() == hashlib.sha256(b.encode()).hexdigest()
