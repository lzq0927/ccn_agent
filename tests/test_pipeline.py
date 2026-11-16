"""端到端与关键算法测试。默认仿真数据：第 20 分钟起 SMF:smf_2 后端 N7->pcf_2、N4->upf_1 链路丢包。"""
import json

import pandas as pd
import pytest

from backend.agent.slow_reasoning import SlowReasoningAgent
from backend.agent.tools import Tools
from backend.analysis.clustering import _concentration
from backend.analysis.crossval import cross_validate
from backend.config import ROOT, Settings
from backend.perception.anomaly import SpikeDetector
from backend.perception.preprocess import preprocess
from backend.pipeline import Pipeline


@pytest.fixture(scope="module")
def run():
    events = list(Pipeline().run())
    results = {e["key"]: e["data"] for e in events if e["type"] == "result"}
    return events, results


def test_conclusion_matches_injected_fault(run):
    _, r = run
    truth = json.loads((ROOT / "data" / "scenario_truth.json").read_text(encoding="utf-8"))["fault"]
    c = r["conclusion"]
    assert c["definitive"] and c["root"]["ne"] == truth["ne"]
    assert c["root"]["type"] == "link_packet_loss"
    assert {l["target"] for l in c["root"]["links"]} == {l["target"] for l in truth["links"]}
    assert "部分链路丢包" in c["title"]
    assert c["recovery"]["steps"] and c["confidence"] > 0.8


def test_alarm_timing_and_no_false_alarm(run):
    events, r = run
    # 故障在第 20 分钟注入，4/5 判定最早在第 24 分钟满足；之前不应触发
    assert r["conclusion"]["detected_at"] in ("10:24", "10:25")
    ticks = [e for e in events if e["type"] == "tick"]
    assert all(t["n_sustained"] == 0 for t in ticks if t["minute"] <= 20)


def test_transient_burst_is_suppressed(run):
    events, r = run
    burst = "AMF:amf_1|初始注册|MM-1018"
    assert any(burst.replace("|", " · ") in e["text"] for e in events if e["type"] == "log" and e["level"] == "warn")
    assert burst not in {a["key"] for a in r["perception"]["anomalous"]}


def test_denoise_keeps_only_fault_series(run):
    _, r = run
    stats = r["perception"]["stats"]
    assert stats["filtered_pct"] > 80
    kept_instances = {a["key"].split("|")[0] for a in r["perception"]["anomalous"]}
    assert "SMF:smf_2" in kept_instances and "SMF:smf_1" not in kept_instances


def test_flows_and_roles(run):
    _, r = run
    paths = {p["path"] for p in r["flows"]["summary"]["patterns"]}
    assert "SMF SM-2101 -> AMF MM-1305" in paths
    roles = r["kg"]["roles"]
    assert all(v == "root" for k, v in roles.items() if k.startswith("SMF:smf_2"))
    assert all(v == "derived" for k, v in roles.items() if k.startswith("AMF:"))
    assert r["crossval"]["decision"] == "conclusion"


def test_user_level_fallback_used_when_no_cluster(run):
    _, r = run
    sr = [s for s in r["clustering"]["series"] if s["cause"] == "MM-1105"]
    assert sr and all(s["fallback"] for s in sr)          # ServiceRequest 的 AMF CHR 没有途经网元信息
    assert all(s["best"]["dim"] == "flow_smf" and s["best"]["set"] == ["SMF:smf_2"] for s in sr)


def test_spike_detector_sustain_rule():
    det = SpikeDetector(Settings())
    values = [1, 0, 2, 1, 1, 0, 1, 30, 28, 1, 1, 1, 25, 27, 26, 30, 29]
    for minute in range(len(values)):
        lo = max(0, minute - 14)
        counts = pd.DataFrame([values[lo:minute + 1]], index=["s"], columns=range(lo, minute + 1))
        det.update(counts, minute)
        if minute == 8:
            assert det.flags["s"] == {7, 8} and not det.sustained("s", minute)   # 2 分钟毛刺不告警
    assert det.sustained("s", 15) and not det.sustained("s", 14)
    assert det.baseline["s"][0] < 3                                              # 基线未被故障数据抬高


def test_concentration_measure():
    s = Settings()
    even = _concentration(pd.Series({"a": 50, "b": 50}), pd.Series(dtype=float), 0, None, 2, s)
    one = _concentration(pd.Series({"a": 98, "b": 2}), pd.Series(dtype=float), 0, None, 2, s)
    assert even["score"] < 0.1 and even["grade"] == "none"
    assert one["score"] > 0.9 and one["grade"] == "high" and one["set"] == ["a"]
    # 增量归因：两边底噪相同，增量全在 a
    inc = _concentration(pd.Series({"a": 60, "b": 20}), pd.Series({"a": 20, "b": 20}), 1.0, None, 2, s)
    assert inc["score"] > 0.9


def test_preprocess_cleans_dirty_rows():
    p = Pipeline()
    raw = pd.DataFrame([
        {"ts": "2026-11-16 10:00:01", "cause": "SM-2101", "procedure": "PDU会话建立", "instance": "smf_2 ", "imsi": "1"},
        {"ts": "2026-11-16 10:00:01", "cause": "SM-2101", "procedure": "PDU会话建立", "instance": "smf_2 ", "imsi": "1"},
        {"ts": "N/A", "cause": "SM-2101", "procedure": "PDU会话建立", "instance": "SMF:smf_2", "imsi": "2"},
        {"ts": "2026-11-16 10:00:02", "cause": "", "procedure": "PDU会话建立", "instance": "SMF:smf_2", "imsi": "3"},
        {"ts": "2026-11-16 10:00:03", "cause": "SM-2101", "procedure": "PDU会话建立", "instance": "SMF:smf_9", "imsi": "4"},
    ]).reindex(columns=p.raw.columns, fill_value="")
    clean, st = preprocess(raw, p.topo, p.t0)
    assert len(clean) == 1 and clean.iloc[0]["instance"] == "SMF:smf_2"
    assert (st["duplicate"], st["bad_timestamp"], st["missing_key"], st["unknown_instance"]) == (1, 1, 1, 1)


def test_slow_reasoning_when_no_scenario_matches(run):
    _, r = run
    clustering = json.loads(json.dumps(r["clustering"]))
    for s in clustering["series"]:                      # 抹掉所有聚集特征
        for d in s["dims"]:
            d.update(score=0.05, grade="none")
    cv = cross_validate(clustering, r["kg"], Settings())
    assert cv["decision"] == "slow_reasoning"
    msgs = list(SlowReasoningAgent(Tools(pd.DataFrame(columns=["imsi", "ts"]))).run(cv, clustering))
    assert msgs[-1]["kind"] == "final" and msgs[-1]["result"]["definitive"] is False
