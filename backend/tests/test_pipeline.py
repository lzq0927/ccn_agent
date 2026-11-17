from collections import Counter
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import csv
import json

import pytest
from fastapi.testclient import TestClient

from backend.app.config import ROOT
from backend.app.detection import Detector
from backend.app.engine import Engine
from backend.app.flows import reconstruct
from backend.app.ingestion import load_data, normalize_rows, load_topology
from backend.app.clustering import adjust_bh, analyze_clusters
from backend.app.reasoning import cross_validate, load_graph
from backend.app.simulation import generate, write_dataset
from backend.app.main import app, file_engine


@pytest.fixture(scope="module")
def engine():
    return file_engine()


def make_engine(base, scenario="packet_loss", seed=42, nf="SMF:smf_2"):
    rows, _ = generate(seed, scenario, nf)
    records, quality = normalize_rows(rows)
    return Engine(records, quality, base.topology, base.graph)


def test_reference_case_four_of_five_then_unique_root(engine):
    for minute in range(1, 24):
        p, _, _ = engine.detector.snapshot(minute)
        assert p["confirmed_dimensions"] == 0
    result = engine.snapshot(24)
    assert result["perception"]["first_alert_minute"] == 24
    assert result["perception"]["max_hits"] == 4
    assert result["reasoning"]["conclusion"]["nf"] == "SMF:smf_2"
    assert result["reasoning"]["conclusion"]["scenario_id"] == "backend_packet_loss"
    assert result["reasoning"]["conclusion"]["pod"] == "smf_2-pod-1"
    assert result["handoff"]["delivered"] is False
    assert result["handoff"]["decision_execution_implemented"] is False
    assert result["flows"]["correlated"] > 200
    for minute in (30, 40):
        assert engine.snapshot(minute)["reasoning"]["conclusion"]["nf"] == "SMF:smf_2"


@pytest.mark.parametrize("scenario", ["normal", "transient"])
def test_normal_and_two_minute_spike_never_confirm(engine, scenario):
    detector = make_engine(engine, scenario).detector
    assert not any(any(flags) for flags in detector.confirmed.values())
    if scenario == "transient":
        assert any(any(flags) for flags in detector.flags.values())


@pytest.mark.parametrize("seed,nf", [(42, "SMF:smf_1"), (7, "SMF:smf_2"), (2026, "SMF:smf_1")])
def test_localization_tracks_data_not_scenario_name(engine, seed, nf):
    result = make_engine(engine, seed=seed, nf=nf).snapshot(24)
    assert result["reasoning"]["conclusion"]["nf"] == nf
    assert result["reasoning"]["conclusion"]["recovery"]["alternative"] != nf


def test_no_future_lookahead(engine):
    cutoff = engine.detector.start + timedelta(minutes=24)
    prefix = [r for r in engine.records if r.timestamp < cutoff]
    truncated = Engine(prefix, engine.quality, engine.topology, engine.graph)
    full, short = engine.snapshot(24), truncated.snapshot(24)
    for field in ("perception", "clusters", "flows", "reasoning", "topology", "handoff"):
        assert full[field] == short[field]


def test_confirmation_is_per_key_not_union(engine):
    records = [replace(engine.records[0], timestamp=engine.detector.start + timedelta(minutes=i),
                       nf="AMF:isolated", cause="A", trace=f"warm-{i}") for i in range(15)]
    for minute in range(20, 25):
        records += [replace(records[0], timestamp=engine.detector.start + timedelta(minutes=minute, seconds=j),
                            cause=f"different-{minute}", trace=f"{minute}-{j}") for j in range(30)]
    detector = Detector(records)
    assert sum(any(f) for f in detector.flags.values()) == 5
    assert not any(any(f) for f in detector.confirmed.values())


def test_only_anomalous_minutes_retained_and_stable_noise_removed(engine):
    p, window, retained = engine.detector.snapshot(24)
    assert len(window) == p["raw_count"]
    assert len(retained) + p["removed_count"] == len(window)
    assert all(engine.detector.flags[r.key][engine.detector.minute_of(r)] for r in retained)
    assert all(r.cause != "5GSM:27" for r in retained)
    assert any(r.cause == "5GSM:27" for r in window)
    assert p["removed_percent"] == round(100 * (len(window) - len(retained)) / len(window), 2)


def test_schema_aliases_invalid_rows_and_imsi_preserved():
    row = {"时间戳": "2026-11-16 09:00:01", "Inner Cause": "5GSM:38", "流程标记": "PDU会话建立",
           "IMSI": "001010000000001", "网元实例": "smf_1", "RAN_ID": "ran_1", "POD_ID": "pod_1",
           "Serving PCF ID": "pcf_2", "Serving_UPF_ID": "upf_1"}
    records, q = normalize_rows([row, row, {**row, "时间戳": "bad"}, {**row, "IMSI": "1.23e4"}])
    assert q["duplicates"] == 1 and q["invalid_rows"] == 2
    assert records[0].imsi == "001010000000001"
    assert records[0].nf == "SMF:smf_1"
    assert records[0].paths == {"PCF": "PCF:pcf_2", "UPF": "UPF:upf_1"}
    assert records[0].timestamp.utcoffset().total_seconds() == 0
    assert q["missing_optional"]["cell"] == 1


def test_header_only_files_are_reported(tmp_path):
    (tmp_path / "data.csv").write_text("Timestamp,Inner Cauce,Procedure,IMSI,NF_ID,RAN_ID,POD_ID\n")
    with pytest.raises(ValueError, match="no valid"):
        load_data(tmp_path)


def test_duplicates_across_files_are_counted_once(tmp_path):
    rows, _ = generate(42, "normal")
    write_dataset(tmp_path, rows)
    (tmp_path / "repeated_smf.csv").write_bytes((tmp_path / "data.csv").read_bytes())
    records, quality = load_data(tmp_path)
    assert len(records) == len(rows)
    assert quality["duplicates"] > 0
    assert quality["valid_rows"] + quality["duplicates"] == quality["input_rows"]


def test_six_separate_files_and_fullmesh_topology(tmp_path):
    rows, truth = generate()
    write_dataset(tmp_path, rows)
    assert len(list(tmp_path.glob("*.csv"))) == 6
    for path in tmp_path.glob("*.csv"):
        with path.open() as stream:
            file_rows = list(csv.DictReader(stream))
        assert len({r["NF_ID"].split(":")[0] for r in file_rows}) == 1
    topology = load_topology(ROOT / "topo/topo.csv")
    assert len(topology["nodes"]) == 12 and len(topology["edges"]) == 60
    assert all(e["source"].split(":")[0] != e["target"].split(":")[0] for e in topology["edges"])
    assert all("fault" not in key.lower() for row in rows for key in row)


def test_user_flow_separates_procedures_and_flags_ambiguous_matches(engine):
    base = engine.records[0]
    a = replace(base, nf="SMF:smf_1", trace="same", procedure="ServiceRequest", paths={})
    b = replace(a, nf="AMF:amf_1", timestamp=a.timestamp + timedelta(seconds=2))
    c = replace(a, procedure="PduSessionEstablishment")
    result = reconstruct([a, b, c])
    assert result["total"] == 2 and result["correlated"] == 1
    no_trace = reconstruct([replace(r, trace="") for r in (a, b)])
    assert no_trace["correlated"] == 0
    assert no_trace["rows"][0]["correlation"] == "time_window"
    repeated = reconstruct([replace(a, trace=""), replace(a, trace="", timestamp=a.timestamp + timedelta(seconds=1)), replace(b, trace="")])
    assert repeated["ambiguous"] == 1


def test_unknown_codes_and_multiple_valid_hypotheses_require_slow_reasoning(engine):
    result = engine.snapshot(24)
    _, window, retained = engine.detector.snapshot(24)
    unknown_record = replace(retained[0], cause="VENDOR_NEW_CODE")
    unknown = cross_validate(retained + [unknown_record], result["clusters"], result["flows"], engine.graph, engine.topology)
    assert unknown["status"] == "slow_reasoning" and unknown["conclusion"] is None
    assert unknown["slow_reasoning"]["tasks"][0]["status"] == "not_executed"
    graph = deepcopy(engine.graph)
    alternative = deepcopy(graph["scenarios"][0])
    alternative.update(id="equally_valid", title="等价候选")
    graph["scenarios"].append(alternative)
    for code in graph["codes"]:
        if "backend_packet_loss" in code["scenarios"]:
            code["scenarios"].append("equally_valid")
    ambiguous = cross_validate(retained, result["clusters"], result["flows"], graph, engine.topology)
    assert ambiguous["status"] == "slow_reasoning" and ambiguous["conclusion"] is None


def test_timeout_without_retransmission_is_insufficient(engine):
    result = engine.snapshot(24)
    _, _, retained = engine.detector.snapshot(24)
    retained = [r for r in retained if r.cause != "SIM_TRANSPORT_RETRANS_EXHAUSTED"]
    reasoning = cross_validate(retained, result["clusters"], result["flows"], engine.graph, engine.topology)
    assert reasoning["status"] == "slow_reasoning"


def test_vendor_codes_can_replace_simulation_codes_through_graph(engine):
    renamed = {"SIM_SBI_TIMEOUT": "VENDOR:7001", "SIM_TRANSPORT_RETRANS_EXHAUSTED": "VENDOR:7002",
               "SIM_AMF_UPSTREAM_FAILURE": "VENDOR:9001"}
    graph = deepcopy(engine.graph)
    for code in graph["codes"]:
        code["id"] = renamed.get(code["id"], code["id"])
    records = [replace(r, cause=renamed.get(r.cause, r.cause)) for r in engine.records]
    custom = Engine(records, engine.quality, engine.topology, graph)
    conclusion = custom.snapshot(24)["reasoning"]["conclusion"]
    assert conclusion["nf"] == "SMF:smf_2"
    assert conclusion["scenario_id"] == "backend_packet_loss"
    assert "VENDOR:7002" in conclusion["supporting_codes"]


def test_incidental_peers_do_not_expand_fault_paths(engine):
    conclusion = engine.snapshot(24)["reasoning"]["conclusion"]
    assert set(conclusion["peers"]) == {"UDM:udm_1", "PCF:pcf_1"}
    assert all(path[1] == "SMF:smf_1" for path in conclusion["recovery"]["paths"])


def test_significance_corrects_multiple_tests_and_reports_missing_dimensions(engine):
    tests = [{"p_value": .001}, {"p_value": .03}, {"p_value": .8}]
    adjust_bh(tests)
    assert tests[0]["q_value"] == pytest.approx(.003)
    assert tests[1]["q_value"] == pytest.approx(.045)
    result = engine.snapshot(24)
    root_groups = [g for g in result["clusters"]["groups"] if g["nf"] == "SMF:smf_2"]
    assert any(any(f["dimension"] == "pod" and f["severity"] != "none" for f in g["features"]) for g in root_groups)
    assert all(f["severity"] not in ("strong", "significant") for g in root_groups for f in g["features"] if f["dimension"] in ("imsi", "ran", "cell", "region"))


def test_user_fallback_runs_without_tautological_user_feature(engine):
    base = engine.records[0]
    historical = [replace(base, timestamp=base.timestamp + timedelta(seconds=i), nf="SMF:test", procedure="test", cause="base", imsi=f"00101{i%2:010d}", pod="a" if i % 2 else "b", paths={}) for i in range(100)]
    retained = [replace(r, timestamp=base.timestamp + timedelta(minutes=20, seconds=i), cause="unmapped", pod="b" if i % 2 else "a") for i, r in enumerate(historical)]
    result = analyze_clusters(retained, historical, retained)
    assert result["fallback_attempted"] == 1
    assert len(result["fallback"]) == 2
    assert any(item["significant"] for item in result["fallback"])
    assert all(f["dimension"] != "imsi" for item in result["fallback"] for f in item["features"])


def test_api_events_report_and_invalid_range():
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/snapshot?minute=41").status_code == 422
        assert client.get("/api/snapshot?run_id=missing").status_code == 404
        stream = client.get("/api/events?minute=24")
        assert "event: log" in stream.text and "event: result" in stream.text
        payload = client.get("/api/report?minute=24").json()
        assert payload["reasoning"]["conclusion"]["nf"] == "SMF:smf_2"
        report = client.get("/api/report?minute=24&format=markdown")
        assert "SMF:smf_2" in report.text and "未执行" in report.text
        assert 'filename="chr-report-minute-24.md"' in report.headers["content-disposition"]
        assert client.post("/api/runs", json={"seed": -1}).status_code == 422


def test_json_is_finite(engine):
    json.dumps(engine.snapshot(40), allow_nan=False)
