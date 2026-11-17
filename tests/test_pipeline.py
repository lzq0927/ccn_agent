"""端到端与关键算法测试。data/ 下的样例数据：第 20 分钟起 SMF:smf_2 后端 N7->pcf_2、N4->upf_1 链路丢包。"""
import csv
import json
import time
from datetime import datetime

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
from backend.runner import StepRunner
from backend.source import CsvTailSource
from datagen.generate import Generator, write_batch


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


# ---------------------------------------------------------------- 持续运行相关

def test_incident_stays_open_while_fault_persists(run):
    events, _ = run
    inc = [e for e in events if e["type"] == "incident"]
    assert [e["event"] for e in inc] == ["opened", "updated"]            # 故障持续到数据结束，只开启一次
    assert inc[-1]["incident"]["status"] == "active" and inc[-1]["incident"]["definitive"] is True
    late_ticks = [e for e in events if e["type"] == "tick" and e["minute"] > 30]
    assert late_ticks and all(t["n_sustained"] > 0 for t in late_ticks)   # 基线冻结，故障期间持续判为突增


def test_incident_recovers_after_fault_clears(tmp_path):
    gen = Generator(7, datetime(2026, 11, 16, 10, 0, 0), fault_from=20, fault_to=28, end_min=45)
    write_batch(gen, tmp_path, 45)
    events = list(Pipeline(Settings(data_dir=tmp_path / "data")).run())
    inc = [e for e in events if e["type"] == "incident"]
    assert [e["event"] for e in inc] == ["opened", "updated", "recovered"]
    assert inc[1]["incident"]["title"] == "SMF:smf_2 后端部分链路丢包"
    assert inc[2]["incident"]["status"] == "recovered"
    assert "10:32" <= inc[2]["incident"]["recovered_at"] <= "10:35"      # 故障 10:28 结束，连续 5 分钟回落后恢复
    after = [e for e in events if e["type"] == "tick" and e["time"] > inc[2]["incident"]["recovered_at"]]
    assert after and all(t["incident"] is None and t["n_sustained"] == 0 for t in after)


def test_reanalysis_keeps_conclusion():
    p = Pipeline(Settings(reanalyze_gap_min=1))
    events, dropped = [], None
    for ev in p.run():
        events.append(ev)
        if ev["type"] == "incident" and ev["event"] == "updated" and dropped is None:
            # 从故障记录里拿掉一个传导侧维度，下一分钟它会作为“新增突增维度”触发重新分析
            dropped = next(k for k in p.engine.incident["series"] if k.startswith("AMF:"))
            p.engine.incident["series"].discard(dropped)
    logs = [e["text"] for e in events if e["type"] == "log"]
    assert any("故障范围变化" in t for t in logs)
    conclusions = [e["data"] for e in events if e["type"] == "result" and e["key"] == "conclusion"]
    assert len(conclusions) >= 2
    assert all(c["root"]["ne"] == "SMF:smf_2" and c["definitive"] for c in conclusions)
    assert len({c["incident_id"] for c in conclusions}) == 1 and len({c["detected_at"] for c in conclusions}) == 1
    assert dropped in p.engine.incident["series"]


def test_data_gap_is_not_treated_as_zero():
    s = Settings()
    def feed(det, gaps):
        values = [30, 28, 31, 29, 30, 0, 0, 0, 0, 0, 0, 30, 29, 31, 30, 28]     # 中间 6 分钟数据源中断
        flagged = []
        for minute, _ in enumerate(values):
            lo = max(0, minute - 14)
            counts = pd.DataFrame([values[lo:minute + 1]], index=["s"], columns=range(lo, minute + 1))
            det.update(counts, minute, gaps)
            if minute in det.flags.get("s", ()):
                flagged.append(minute)
        return flagged
    assert feed(SpikeDetector(s), frozenset(range(5, 11))) == []          # 按缺口处理：恢复后的正常流量不告警
    assert feed(SpikeDetector(s), frozenset()) != []                      # 当作 0 条则会被误判为突增


def test_tail_source_reads_only_new_complete_lines(tmp_path):
    path = tmp_path / "chr_smf.csv"
    cols = ["Timestamp", "Inner_Cause", "Procedure", "IMSI", "NE_Instance", "Serving_PCF_ID"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerow(["2026-11-16 10:00:01", "SM-2101", "PDU会话建立", "1", "SMF:smf_2", "PCF:pcf_2"])
    src = CsvTailSource(tmp_path)
    first = src.poll()
    assert len(first) == 1 and first.iloc[0]["cause"] == "SM-2101" and first.iloc[0]["peer_pcf"] == "PCF:pcf_2"
    assert src.poll().empty
    with open(path, "a", newline="", encoding="utf-8") as f:
        f.write("2026-11-16 10:00:02,SM-2201,PDU会话建立,2,SMF:smf_2,\n2026-11-16 10:00:03,SM-22")   # 第二行未写完
    second = src.poll()
    assert list(second["cause"]) == ["SM-2201"]
    with open(path, "a", newline="", encoding="utf-8") as f:
        f.write("11,ServiceRequest,3,SMF:smf_2,\n")
    assert list(src.poll()["cause"]) == ["SM-2211"]


# ---------------------------------------------------------------- 运行控制（按数据时间推进）

def _wait(cond, timeout=60.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_step_runner_start_pause_resume_restart():
    r = StepRunner(Settings(step_seconds=0), flow="auto")   # 0 表示不停顿，尽快推进
    r.start()
    try:
        q, snap = r.subscribe()
        assert snap["run"]["status"] == "idle" and snap["run"]["total"] == 40 and snap["tick"] is None

        r.control("start")
        assert _wait(lambda: r.pos >= 3)
        r.control("pause")
        time.sleep(0.2)
        held = r.pos
        time.sleep(0.4)
        assert r.status == "paused" and r.pos == held          # 暂停期间不再推进

        r.control("resume")
        assert _wait(lambda: r.status == "finished")
        st = r.snapshot()
        assert st["run"]["minute"] == 40 and st["conclusion"]["root"]["ne"] == "SMF:smf_2"
        assert st["incident"]["status"] == "active" and len(st["trend"]) == 40

        r.control("restart")                                   # 回到起点并立即重新运行
        assert _wait(lambda: r.status == "running" and r.pos < 20)
        while not q.empty():
            last = q.get()
            if last["type"] == "snapshot":
                assert last["conclusion"] is None and last["incident"] is None
        assert _wait(lambda: r.status == "finished")
        assert r.snapshot()["conclusion"]["title"] == "SMF:smf_2 后端部分链路丢包"
    finally:
        r.stop()


def test_interactive_flow_waits_for_confirmation():
    r = StepRunner(Settings(step_seconds=0))            # 默认交互方式
    r.start()
    try:
        assert r.snapshot()["run"]["flow"] == "interactive"
        r.control("start")
        # 感知到异常并完成降噪后停住，等待确认开始分析
        assert _wait(lambda: r.pending == "analysis")
        time.sleep(0.3)
        st = r.snapshot()
        assert st["run"]["pending"] == "analysis" and st["tick"]["time"] == "10:24"
        assert st["perception"] is not None and st["flows"] is None and st["conclusion"] is None
        assert r.pos == 23                               # 等待期间时间不再推进

        r.control("proceed")
        assert _wait(lambda: r.pending == "decision")    # 分析完成后再次停住
        st = r.snapshot()
        assert st["crossval"]["decision"] == "conclusion" and st["conclusion"] is None
        assert st["steps"].get("decision.conclusion") is None

        r.control("proceed")
        assert _wait(lambda: r.snapshot()["conclusion"] is not None)
        assert _wait(lambda: r.status == "finished")
        st = r.snapshot()
        assert st["conclusion"]["root"]["ne"] == "SMF:smf_2" and st["run"]["pending"] is None

        # 切到自动后重新开始：不再等待
        r.control("auto")
        r.control("restart")
        assert _wait(lambda: r.status == "finished" and r.pos == 40)
        assert r.snapshot()["conclusion"] is not None and r.pending is None

        # 等待中切到自动：闸门随即放行
        r.control("interactive")
        r.control("restart")
        assert _wait(lambda: r.pending == "analysis")
        r.control("auto")
        assert _wait(lambda: r.status == "finished")
    finally:
        r.stop()
