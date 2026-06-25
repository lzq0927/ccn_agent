"""Tests for Phase 2 exploration mode (multi-algorithm framework).

M2.1 covers the routing/trigger wiring: Route.EXPLORATION, the CHR-driven
confidence trigger, dispatch in FaultPerceptionAgent, and prompt-builder branch.
Later milestones add the detectors, sweep runner, fusion and orchestration.
"""

from __future__ import annotations

import json
from dataclasses import asdict

from agents.data_generation.simulator_wrapper import SimulatorWrapper
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.fault_perception.confidence import ConfidenceAssessor
from agents.fault_perception.exploration_config import ExplorationConfig
from agents.shared.models import CaseData, FindingsReport, ParamGrid, Route, SweepCell
from agents.shared.storage import Storage
from simulator.engine import SimulationEngine
from simulator.models import FaultConfig, FaultMode, FaultPointType, NEType, Scenario
from simulator.topology import TopologyGenerator
from tools.registry import all_tools, dispatch, import_all_tools


def _case_data(
    loss_rate: float = 0.005,
    fault: bool = True,
    ue: int = 30,
    case_id: int = 1,
    with_chr: bool = True,
) -> CaseData:
    """Build a CaseData with a single-NE AMF link fault (or a normal case)."""
    topo = TopologyGenerator().generate(0, seed=100)
    ne = topo.get_elements_by_type(NEType.AMF)[0] if fault else None
    fc = None
    if fault:
        fc = FaultConfig(
            fault_point_type=FaultPointType.SINGLE_NE,
            fault_mode=FaultMode.LINK,
            loss_rate=loss_rate,
            fault_start=25,
            fault_duration=15,
            affected_ne_ids={ne.id},
        )
    scenario = Scenario(
        case_id=case_id,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=ue,
        fault_config=fc,
        is_normal=not fault,
        is_train=True,
    )
    result = SimulationEngine(chr_background_fail_rate=0.0).simulate(scenario)
    kpi_rows = [asdict(r) for r in result.kpi_records]
    chr_records = [asdict(r) for r in result.chr_records] if with_chr else []
    topo_text = SimulatorWrapper()._export_topo(scenario)
    ground_truth = {"fault_elements": [ne.id] if ne else [], "fault_links": []}
    return CaseData(
        case_id=case_id,
        kpi_rows=kpi_rows,
        topology_text=topo_text,
        process_text="",
        ground_truth=ground_truth,
        chr_records=chr_records,
    )


# ---------------------------------------------------------------------------
# M2.1 — exploration trigger & routing
# ---------------------------------------------------------------------------


def test_route_enum_has_exploration():
    assert Route.EXPLORATION.value == "exploration"


def test_micro_loss_fault_routes_to_exploration():
    """Low loss_rate → mild KPI anomalies (severity<0.03) but real CHR failures."""
    cd = _case_data(loss_rate=0.005)
    features = ConfidenceAssessor()._extract_features(cd)
    assert features.anomaly_severity < 0.03
    assert features.chr_failure_count > 0
    assert features.exploration_trigger is True
    assert ConfidenceAssessor().assess(cd).route == Route.EXPLORATION


def test_strong_fault_not_exploration():
    """A strong single-NE fault has clear KPI severity → routes by score, not exploration."""
    cd = _case_data(loss_rate=0.06)
    features = ConfidenceAssessor()._extract_features(cd)
    assert features.anomaly_severity >= 0.03
    assert features.exploration_trigger is False
    assert ConfidenceAssessor().assess(cd).route != Route.EXPLORATION


def test_normal_case_not_exploration():
    cd = _case_data(fault=False)
    features = ConfidenceAssessor()._extract_features(cd)
    assert features.exploration_trigger is False
    assert ConfidenceAssessor().assess(cd).route != Route.EXPLORATION


def test_exploration_requires_chr_signal():
    """A micro-loss case without CHR must not trigger exploration."""
    cd = _case_data(loss_rate=0.005, with_chr=False)
    features = ConfidenceAssessor()._extract_features(cd)
    assert features.exploration_trigger is False
    assert ConfidenceAssessor().assess(cd).route != Route.EXPLORATION


async def test_agent_diagnose_dispatches_exploration(tmp_path):
    """End-to-end: agent routes a micro-loss case to EXPLORATION and identifies the NE."""
    cd = _case_data(loss_rate=0.005, case_id=4242)
    agent = FaultPerceptionAgent(storage=Storage(db_path=str(tmp_path / "exp.db")))
    res = await agent.diagnose(cd)
    assert res.route_taken == Route.EXPLORATION
    # The multi-algorithm framework should point at the injected faulted NE.
    truth = set(cd.ground_truth["fault_elements"])
    assert truth, "test case should have a faulted NE"
    assert truth & set(res.fault_elements), (
        f"exploration should identify the faulted NE {truth}, got {res.fault_elements}"
    )


# ---------------------------------------------------------------------------
# M2.2 — EWMA / CUSUM detectors + sweep runner
# ---------------------------------------------------------------------------

import_all_tools()  # register tools once at import (idempotent)


def _amf_fault_kpi(loss_rate=0.03, start=30, dur=15, ue=30, case_id=1):
    """Return (kpi_rows, amf_id) for an injected AMF single-NE link fault."""
    topo = TopologyGenerator().generate(0, seed=100)
    amf = topo.get_elements_by_type(NEType.AMF)[0]
    fc = FaultConfig(
        fault_point_type=FaultPointType.SINGLE_NE,
        fault_mode=FaultMode.LINK,
        loss_rate=loss_rate,
        fault_start=start,
        fault_duration=dur,
        affected_ne_ids={amf.id},
    )
    scenario = Scenario(
        case_id=case_id,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=ue,
        fault_config=fc,
        is_normal=False,
        is_train=True,
    )
    result = SimulationEngine(chr_background_fail_rate=0.0).simulate(scenario)
    return [asdict(r) for r in result.kpi_records], amf.id


def test_sweep_dataclasses_construct():
    pg = ParamGrid(algorithm="ewma", data_view="link_kpi", params={"lambda_": [0.1, 0.2]})
    cell = SweepCell(
        algorithm="ewma",
        data_view="link_kpi",
        params={"lambda_": 0.1},
        finding={"a": 1},
        evidence_elements=["AMF_1"],
        confidence=0.8,
    )
    report = FindingsReport(cells=[cell], used_algorithms=["ewma"])
    assert pg.params["lambda_"] == [0.1, 0.2]
    assert report.cells[0].evidence_elements == ["AMF_1"]


def test_exploration_tools_registered_with_handlers():
    tools = all_tools()
    for name in (
        "ewma_changepoint",
        "cusum_changepoint",
        "sweep_runner",
        "pca_residual",
        "isolation_forest",
    ):
        assert name in tools, f"{name} not registered"
        assert tools[name].handler is not None, f"{name} has no handler"


async def test_ewma_detects_fault_onset_and_element():
    kpi, amf = _amf_fault_kpi(loss_rate=0.03, start=30, dur=15)
    out = json.loads(
        await dispatch(
            "ewma_changepoint",
            {"kpi_rows": kpi, "target": amf, "lambda_": 0.2, "threshold_sigma": 3.0},
        )
    )
    cps = out["changepoints"]
    assert cps, "EWMA should detect changepoints for an active fault"
    onset = min(c["timestamp"] for c in cps)
    assert 30 <= onset <= 44  # within/near the fault window
    assert amf in out["evidence_elements"]
    assert out["confidence"] > 0.0


async def test_cusum_detects_fault_onset():
    kpi, amf = _amf_fault_kpi(loss_rate=0.03, start=30, dur=15)
    out = json.loads(
        await dispatch(
            "cusum_changepoint",
            {"kpi_rows": kpi, "target": amf, "drift_k": 0.01, "threshold_h": 5.0},
        )
    )
    cps = out["changepoints"]
    assert cps
    onset = min(c["timestamp"] for c in cps)
    assert 30 <= onset <= 44
    assert amf in out["evidence_elements"]


async def test_sweep_runner_aggregates_param_grid():
    kpi, amf = _amf_fault_kpi(loss_rate=0.03, start=30, dur=15)
    out = json.loads(
        await dispatch(
            "sweep_runner",
            {
                "algorithm": "ewma_changepoint",
                "data_view": "link_kpi",
                "target": amf,
                "kpi_rows": kpi,
                "params": {"lambda_": [0.1, 0.2, 0.3], "threshold_sigma": [2.0, 3.0, 4.0]},
            },
        )
    )
    assert out["param_combos"] == 9
    assert len(out["cells"]) == 9
    # The faulted NE should dominate param concordance.
    assert out["param_concordance"].get(amf, 0.0) >= 0.5
    assert out["best_cell"]["confidence"] > 0.0


async def test_detectors_quiet_on_normal_series():
    topo = TopologyGenerator().generate(0, seed=100)
    sc = Scenario(
        case_id=2,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=30,
        fault_config=None,
        is_normal=True,
        is_train=True,
    )
    res = SimulationEngine(chr_background_fail_rate=0.0).simulate(sc)
    kpi = [asdict(r) for r in res.kpi_records]
    out = json.loads(
        await dispatch(
            "ewma_changepoint",
            {"kpi_rows": kpi, "target": "", "lambda_": 0.2, "threshold_sigma": 3.0},
        )
    )
    assert out["changepoints"] == []
    assert out["confidence"] == 0.0


# ---------------------------------------------------------------------------
# M2.3 — PCA residual + Isolation Forest (sklearn)
# ---------------------------------------------------------------------------


async def test_pca_residual_flags_faulted_ne():
    kpi, amf = _amf_fault_kpi(loss_rate=0.06, start=25, dur=20, ue=40)
    out = json.loads(
        await dispatch("pca_residual", {"kpi_rows": kpi, "n_components": 2, "alpha": 0.05})
    )
    assert out["flagged_links"], "PCA should flag anomalous links for an active fault"
    assert amf in out["evidence_elements"]
    assert out["confidence"] > 0.0


async def test_isolation_forest_flags_faulted_ne():
    kpi, amf = _amf_fault_kpi(loss_rate=0.06, start=25, dur=20, ue=40)
    out = json.loads(
        await dispatch(
            "isolation_forest",
            {"kpi_rows": kpi, "n_estimators": 100, "contamination": 0.15, "seed": 1},
        )
    )
    assert out["flagged_links"]
    assert amf in out["evidence_elements"]


async def test_isolation_forest_is_deterministic_per_seed():
    kpi, _ = _amf_fault_kpi(loss_rate=0.06, start=25, dur=20, ue=40)
    a = json.loads(
        await dispatch(
            "isolation_forest",
            {"kpi_rows": kpi, "n_estimators": 100, "contamination": 0.15, "seed": 7},
        )
    )
    b = json.loads(
        await dispatch(
            "isolation_forest",
            {"kpi_rows": kpi, "n_estimators": 100, "contamination": 0.15, "seed": 7},
        )
    )
    assert a["flagged_links"] == b["flagged_links"]  # same seed → identical output


# ---------------------------------------------------------------------------
# M2.4 — CHR detectors: failure concentration + correlated-failure graph
# ---------------------------------------------------------------------------


def _amf_fault_chr(loss_rate=0.05, start=25, dur=20, ue=40, case_id=1):
    topo = TopologyGenerator().generate(0, seed=100)
    amf = topo.get_elements_by_type(NEType.AMF)[0]
    fc = FaultConfig(
        fault_point_type=FaultPointType.SINGLE_NE,
        fault_mode=FaultMode.LINK,
        loss_rate=loss_rate,
        fault_start=start,
        fault_duration=dur,
        affected_ne_ids={amf.id},
    )
    scenario = Scenario(
        case_id=case_id,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=ue,
        fault_config=fc,
        is_normal=False,
        is_train=True,
    )
    result = SimulationEngine(chr_background_fail_rate=0.0).simulate(scenario)
    return [asdict(r) for r in result.chr_records], amf.id


async def test_ue_failure_concentration_identifies_fault():
    chr_records, amf = _amf_fault_chr()
    out = json.loads(await dispatch("ue_failure_concentration", {"chr_records": chr_records}))
    assert out["failures"] > 0
    assert out["top_nes"], "should report top failing NEs"
    assert out["top_nes"][0]["ne"] == amf  # faulted NE dominates
    assert out["top_ne_share"] > 0.3
    assert amf in out["evidence_elements"]


async def test_correlated_failure_graph_identifies_hub():
    chr_records, amf = _amf_fault_chr()
    out = json.loads(await dispatch("correlated_failure_graph", {"chr_records": chr_records}))
    assert out["hub_ne"] == amf  # faulted NE is the hub
    assert out["hub_degree_share"] > 0.3
    assert out["num_components"] >= 1
    assert amf in out["largest_component"]


async def test_chr_detectors_quiet_on_normal():
    topo = TopologyGenerator().generate(0, seed=100)
    sc = Scenario(
        case_id=9,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=30,
        fault_config=None,
        is_normal=True,
        is_train=True,
    )
    res = SimulationEngine(chr_background_fail_rate=0.0).simulate(sc)
    chr_records = [asdict(r) for r in res.chr_records]
    u = json.loads(await dispatch("ue_failure_concentration", {"chr_records": chr_records}))
    assert u["failures"] == 0 and u["evidence_elements"] == []
    c = json.loads(await dispatch("correlated_failure_graph", {"chr_records": chr_records}))
    assert c["nodes"] == 0 and c["confidence"] == 0.0


# ---------------------------------------------------------------------------
# M2.5 — Bayesian fusion + ExplorationConfig
# ---------------------------------------------------------------------------


def test_exploration_config_defaults():
    cfg = ExplorationConfig()
    assert cfg.min_posterior == 0.6
    assert cfg.min_agreement == 2
    assert "ewma_changepoint" in cfg.grids
    assert cfg.grid_for("ewma_changepoint")["lambda_"] == [0.1, 0.2, 0.3]
    assert cfg.grid_for("nonexistent") == {}


async def test_bayesian_fusion_ranks_agreed_element_top():
    findings = [
        {
            "algorithm": "ewma",
            "data_view": "link_kpi",
            "evidence_elements": ["AMF_1", "SMF_1"],
            "confidence": 0.9,
        },
        {
            "algorithm": "cusum",
            "data_view": "link_kpi",
            "evidence_elements": ["AMF_1"],
            "confidence": 0.9,
        },
        {
            "algorithm": "pca",
            "data_view": "link_kpi",
            "evidence_elements": ["AMF_1", "gNB_1"],
            "confidence": 0.8,
        },
    ]
    out = json.loads(await dispatch("bayesian_fusion", {"findings": findings}))
    assert out["top_element"] == "AMF_1"
    assert out["top_posterior"] > 0.5
    assert out["top_agreement"] == 3  # all three findings flag AMF_1
    assert out["posterior"][0]["element"] == "AMF_1"


async def test_bayesian_fusion_empty_findings():
    out = json.loads(await dispatch("bayesian_fusion", {"findings": []}))
    assert out["top_element"] is None
    assert out["posterior"] == []


async def test_bayesian_fusion_end_to_end_on_fault():
    """All detectors → sweep → fuse ranks the injected NE on top."""
    kpi, amf = _amf_fault_kpi(loss_rate=0.05, start=25, dur=20, ue=40)
    chr_records, _ = _amf_fault_chr(loss_rate=0.05, start=25, dur=20, ue=40, case_id=1)
    cfg = ExplorationConfig()
    findings = []
    for algo, view in [
        ("ewma_changepoint", "link_kpi"),
        ("cusum_changepoint", "link_kpi"),
        ("pca_residual", "link_kpi"),
        ("isolation_forest", "link_kpi"),
    ]:
        r = json.loads(
            await dispatch(
                "sweep_runner",
                {
                    "algorithm": algo,
                    "data_view": view,
                    "target": amf,
                    "kpi_rows": kpi,
                    "params": cfg.grid_for(algo),
                },
            )
        )
        bc = r["best_cell"]
        findings.append(
            {
                "algorithm": algo,
                "data_view": view,
                "evidence_elements": bc["evidence_elements"],
                "confidence": bc["confidence"],
            }
        )
    for algo in ("ue_failure_concentration", "correlated_failure_graph"):
        r = json.loads(await dispatch(algo, {"chr_records": chr_records}))
        findings.append(
            {
                "algorithm": algo,
                "data_view": "chr_attempt",
                "evidence_elements": r["evidence_elements"],
                "confidence": r["confidence"],
            }
        )
    fused = json.loads(await dispatch("bayesian_fusion", {"findings": findings}))
    assert fused["top_element"] == amf
    assert fused["top_posterior"] > 0.5
    assert fused["top_agreement"] >= 4


# ---------------------------------------------------------------------------
# M2.6 — ParallelExplorer orchestration + agent _run_exploration
# ---------------------------------------------------------------------------


async def test_parallel_explorer_identifies_faulted_ne(tmp_path):
    """Direct explorer call (no LLM) fuses detectors and finds the injected NE."""
    from agents.fault_perception.parallel_explorer import ParallelExplorer
    from agents.shared.llm_client import LLMClient, LLMConfig

    cd = _case_data(loss_rate=0.05, case_id=5000)  # clear signal for detectors
    explorer = ParallelExplorer(LLMClient(LLMConfig(model="gpt-4o")))  # no key → deterministic
    result = await explorer.explore(cd, hypotheses=[], system_prompt="", session_id="sess_test")
    assert result.route_taken == Route.EXPLORATION
    truth = set(cd.ground_truth["fault_elements"])
    assert truth & set(result.fault_elements), (
        f"explorer should identify {truth}, got {result.fault_elements}"
    )
    assert result.confidence > 0.0
    # Reasoning trace records the fused findings.
    assert any(s.tool_name == "bayesian_fusion" for s in result.reasoning_trace)


async def test_parallel_explorer_deterministic_without_llm(tmp_path):
    """Without an LLM key the explorer is fully deterministic (same case → same NE)."""
    from agents.fault_perception.parallel_explorer import ParallelExplorer
    from agents.shared.llm_client import LLMClient, LLMConfig

    cd = _case_data(loss_rate=0.05, case_id=5001)
    explorer = ParallelExplorer(LLMClient(LLMConfig(model="gpt-4o")))
    a = await explorer.explore(cd, [], "", "s1")
    b = await explorer.explore(cd, [], "", "s2")
    assert a.fault_elements == b.fault_elements
    assert a.confidence == b.confidence


# ---------------------------------------------------------------------------
# M2.7 — exploration skill injection into the prompt
# ---------------------------------------------------------------------------


def test_exploration_skill_loaded_into_prompt():
    from agents.fault_perception.prompt_builder import PromptBuilder
    from agents.shared.models import ConfidenceAssessment

    assessment = ConfidenceAssessment(score=0.4, route=Route.EXPLORATION)
    prompt = PromptBuilder(skill_dir="./skills", memory_dir="./memory").build_system_prompt(
        case_id=1,
        kpi_summary="k",
        topology_summary="t",
        assessment=assessment,
        mode=Route.EXPLORATION,
        max_iterations=40,
    )
    assert "Exploration Mode" in prompt
    assert "micro-loss" in prompt.lower()


# ---------------------------------------------------------------------------
# M2.8 — ablation (leave-one-out) + flip penalty
# ---------------------------------------------------------------------------


async def _explorer_result(case_id: int):
    from agents.fault_perception.parallel_explorer import ParallelExplorer
    from agents.shared.llm_client import LLMClient, LLMConfig

    cd = _case_data(loss_rate=0.05, case_id=case_id)
    return await ParallelExplorer(LLMClient(LLMConfig(model="gpt-4o"))).explore(cd, [], "", "s")


def _findings_report(result):
    step = next(s for s in result.reasoning_trace if s.tool_name == "exploration_findings")
    return json.loads(step.tool_result)


async def test_exploration_runs_ablation_and_records_findings():
    r = await _explorer_result(7000)
    tools = [s.tool_name for s in r.reasoning_trace]
    assert "bayesian_fusion" in tools
    assert "exploration_findings" in tools
    rep = _findings_report(r)
    assert "ablation" in rep and "robust" in rep["ablation"]
    assert "flipped_by" in rep["ablation"]
    assert isinstance(rep["ablation"]["alternatives"], list)


async def test_exploration_ablation_robust_for_clear_single_ne_fault():
    r = await _explorer_result(7001)
    rep = _findings_report(r)
    # A clear single-NE fault: all detectors agree, so ablation is robust.
    assert rep["ablation"]["robust"] is True
    assert rep["ablation"]["flipped_by"] == []
