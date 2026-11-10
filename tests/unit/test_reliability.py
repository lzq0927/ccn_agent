"""Mechanism effect, reproducibility, and immutable experiment boundaries."""

import copy
import json
import os
import subprocess
import sys
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from reliability.models import Design
from reliability.service import ReliabilityService
from reliability.solver import _observe, digest, freeze_input, solve, validate_design
from reliability.store import ConflictError, Store


@pytest.fixture
def service(tmp_path):
    return ReliabilityService(Store(tmp_path))


@pytest.fixture
def design():
    return Design(name="隔离与重选", seeds=[42, 43], actions=[
        {"kind": "isolate", "ne_id": "UPF_1"},
        {"kind": "reroute", "from_ne_id": "UPF_1", "to_ne_id": "UPF_2"},
    ])


def test_recovery_is_computed_and_replay_ignores_later_draft_edits(service, design):
    item = service.create_design(design)
    run = service.run(item["id"], 1)
    for trial in run["result"]["trials"]:
        assert trial["healthy"]["pdu_success_rate"] > trial["fault"]["pdu_success_rate"]
        assert trial["baseline"]["final_target_met"] is False
        assert trial["candidate"]["final_target_met"] is True
        assert trial["candidate"]["recovery_time"] is not None
    updated = service.update_design(item["id"], design.model_copy(update={"actions": []}), 1)
    assert updated["revision"] == 2
    replay = service.replay(run["id"])
    assert replay["id"] != run["id"]
    assert replay["source_run_id"] == run["id"]
    assert replay["design_revision"] == 1
    assert replay["input_hash"] == run["input_hash"]
    assert replay["result_hash"] == run["result_hash"]
    assert service.store.get_run(run["id"]) == run
    report = service.report(run["id"])
    assert "不是年度可用度" in report
    assert run["result_hash"] in report
    assert '"to_ne_id": "UPF_2"' in report
    assert '"success_rate": 0.99' in report


@pytest.mark.parametrize("scenario_id", list("ABCDEFG"))
def test_no_action_is_an_identical_baseline(scenario_id):
    result = solve(freeze_input(Design(name="现状", scenario_id=scenario_id, seeds=[42],
                                       recovery_ticks=12)))
    trial = result["trials"][0]
    assert trial["baseline"] == trial["candidate"]
    assert result["summary"]["pdu_success_rate_delta"] == 0


def test_wrong_target_does_not_claim_recovery(design):
    wrong = design.model_copy(update={"actions": Design(name="误诊", actions=[
        {"kind": "isolate", "ne_id": "SMF_1"},
        {"kind": "reroute", "from_ne_id": "SMF_1", "to_ne_id": "SMF_2"},
    ]).actions})
    result = solve(freeze_input(wrong))
    assert result["conclusion"] == "simulation_target_not_met"
    assert all(not t["candidate"]["final_target_met"] for t in result["trials"])


def test_flow_control_reports_cost_as_well_as_load():
    design = Design(name="风暴限流", scenario_id="G", seeds=[42], actions=[
        {"kind": "flow_control", "layer": "AMF", "ratio": .8, "flt": {"sst": 3}},
        {"kind": "flow_control", "layer": "SMF", "ratio": .8, "flt": {"sst": 3}},
    ])
    result = solve(freeze_input(design))["summary"]
    assert result["candidate"]["max_core_cpu"] < result["baseline"]["max_core_cpu"]
    assert result["candidate"]["admission_rejects"] > 0


def test_rounding_does_not_turn_a_missed_target_into_success():
    snapshot = SimpleNamespace(kpi={
        "amf_success_rate": .99, "smf_success_rate": .99,
        "amf_reg_successes": 24749, "smf_pdu_successes": 24749,
        "amf_reg_requests": 25000, "smf_pdu_requests": 25000,
        "ne_cpu": {"AMF_1": 40}, "admission_rejects": 0, "backoff_rejects": 0,
    })
    engine = SimpleNamespace(advance_tick=lambda tick: snapshot)
    assert not _observe(engine, 1, Design(name="threshold"))["target_met"]


@pytest.mark.parametrize("patch", [
    {"seeds": [42, 42]}, {"seeds": [True]}, {"seeds": []}, {"scenario_id": "GPU"},
    {"name": " "}, {"warmup_ticks": 0}, {"targets": {"success_rate": float("nan")}},
    {"actions": [{"kind": "flow_control", "layer": "UDM", "ratio": .5}]},
    {"actions": [{"kind": "flow_control", "layer": "AMF", "ratio": 1.0}]},
    {"actions": [{"kind": "flow_control", "layer": "AMF", "ratio": .5,
                  "flt": {"unknown_filter": 3}}]},
])
def test_invalid_experiments_are_rejected(patch):
    with pytest.raises(ValidationError):
        Design.model_validate({"name": "test", **patch})


@pytest.mark.parametrize("action", [
    {"kind": "isolate", "ne_id": "no-such-node"},
    {"kind": "reroute", "from_ne_id": "UPF_1", "to_ne_id": "SMF_2"},
    {"kind": "reroute", "from_ne_id": "UPF_2", "to_ne_id": "UPF_1"},
])
def test_invalid_topology_actions_are_rejected(action):
    with pytest.raises(ValueError):
        validate_design(Design(name="test", actions=[action]))


def test_revision_conflict_is_shared_between_api_and_mcp_processes(service, design):
    item = service.create_design(design)
    other = ReliabilityService(Store(service.store.directory))
    other.update_design(item["id"], design, 1)
    with pytest.raises(ConflictError):
        service.update_design(item["id"], design, 1)
    with pytest.raises(ConflictError):
        service.run(item["id"], 1)
    assert not service.store.list_runs(item["id"])


def test_model_change_refuses_replay_and_input_is_frozen(design):
    frozen = freeze_input(design)
    changed = copy.deepcopy(frozen)
    changed["engine_revision"] = "unknown-engine"
    with pytest.raises(ValueError, match="代码版本已变化"):
        solve(changed)
    changed = copy.deepcopy(frozen)
    changed["runtime"]["python"] = "0.0.0"
    with pytest.raises(ValueError, match="依赖版本已变化"):
        solve(changed)
    original = copy.deepcopy(frozen)
    solve(frozen)
    assert frozen == original


def test_cross_process_seed_reproducibility(design):
    frozen = freeze_input(design)
    expected = digest(solve(frozen))
    completed = subprocess.run(
        [sys.executable, "-c", ("import json,sys; from reliability.solver import solve,digest; "
         "print(digest(solve(json.load(sys.stdin))))")],
        input=json.dumps(frozen), text=True, capture_output=True, check=True,
        env={**os.environ, "PYTHONHASHSEED": "987"},
    )
    assert completed.stdout.strip() == expected


def test_live_source_edits_require_service_restart(design, monkeypatch):
    monkeypatch.setattr("reliability.solver.engine_revision", lambda: "changed-on-disk")
    with pytest.raises(ValueError, match="请重启"):
        freeze_input(design)
