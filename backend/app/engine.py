from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import time

from .clustering import analyze_clusters
from .config import SETTINGS
from .detection import Detector
from .flows import reconstruct
from .reasoning import cross_validate


class Engine:
    def __init__(self, records, quality, topology, graph, label="CSV 数据源"):
        self.records, self.quality, self.topology, self.graph = records, quality, topology, graph
        self.detector = Detector(records)
        self.label = label
        self.cache = {}

    def meta(self):
        return {"label": self.label, "start": self.detector.start.isoformat(), "duration_minutes": self.detector.duration,
                "record_count": len(self.records), "nf_count": len(self.topology["nodes"]), "edge_count": len(self.topology["edges"]),
                "settings": asdict(SETTINGS), "quality": self.quality,
                "procedures": sorted({r.procedure for r in self.records}), "knowledge": self.graph,
                "topology_missing_nfs": sorted({r.nf for r in self.records} - {node["id"] for node in self.topology["nodes"]})}

    def events(self, minute):
        if not 1 <= minute <= self.detector.duration:
            raise ValueError("Minute outside data range")
        logs = []
        clock = time.perf_counter()

        def event(stage, message, level="info", component="Pipeline"):
            entry = {"id": len(logs) + 1, "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                     "elapsed_ms": round((time.perf_counter() - clock) * 1000), "stage": stage,
                     "message": message, "level": level, "component": component}
            logs.append(entry)
            return {"type": "log", "data": entry}

        yield event("perception", f"读取已完成的前 {minute} 分钟；本次分析只使用截至该时刻的记录。", component="Preprocessor")
        perception, window, retained = self.detector.snapshot(minute)
        yield event("perception", f"当前滑窗 {len(window):,} 条有效 CHR，检查 {perception['dimensions']} 个网元×流程×原因码维度。", component="Detector")
        yield event("perception", f"同维度最近 5 分钟最大命中 {perception['max_hits']}/5；确认 {perception['confirmed_dimensions']} 个异常维度。", "success" if retained else "info", "Detector")
        yield event("perception", f"保留 {len(retained):,} 条，过滤 {perception['removed_percent']}%；未确认维度与稳定背景不进入分析。", component="Denoiser")
        if retained:
            yield event("analysis", "异常确认，开始分析同一个 15 分钟滑窗。", component="Analyzer")
        flows = reconstruct(retained)
        if retained:
            yield event("analysis", f"重建 {flows['total']} 条用户流程，其中 {flows['correlated']} 条由 TRACE_ID 确认跨网元关联。", component="Flow correlator")
        confirmed_keys = {r.key for r in retained}
        onset = min((i for key in confirmed_keys for i in range(minute) if self.detector.flags[key][i]), default=minute)
        historical = [r for i in range(max(0, onset - 15), onset) for r in self.detector.buckets[i]]
        clusters = analyze_clusters(retained, historical, window)
        if retained:
            yield event("analysis", f"完成六类维度的 {clusters['hypotheses_tested']} 项统计检验；BH 校正后 {sum(g['significant'] for g in clusters['groups'])} 组显著。", component="Significance")
            yield event("analysis", f"无显著聚集的 {clusters['fallback_attempted']} 组进入用户粒度重分析，检查 {clusters.get('fallback_hypotheses', 0)} 个条件假设。", component="Significance")
        reasoning = cross_validate(retained, clusters, flows, self.graph, self.topology)
        if retained:
            yield event("analysis", f"知识图谱 v{self.graph['version']} 产生 {len(reasoning['hypotheses'])} 个候选，完成逐项证据交叉验证。", component="Knowledge graph")
        conclusion = reasoning["conclusion"]
        if conclusion:
            yield event("handoff", conclusion["summary"], "success", "Cross validator")
            yield event("handoff", "已生成决策交接载荷；未连接执行模块，未执行任何网络变更。", component="Handoff")
        elif reasoning["status"] == "slow_reasoning":
            yield event("analysis", reasoning["slow_reasoning"]["reason"] + "；已生成慢推理待办，Agent 适配器未接入。", "warning", "Agent planner")
        else:
            yield event("perception", "尚未满足异常确认条件，继续感知。", component="Pipeline")
        counts = Counter(r.nf for r in retained)
        topology = {"nodes": [{**node, "anomalies": counts[node["id"]],
                               "status": "root" if conclusion and node["id"] == conclusion["nf"] else "affected" if counts[node["id"]] else "normal",
                               "pods": sorted({r.pod for r in window if r.nf == node["id"]})} for node in self.topology["nodes"]],
                    "edges": [{**edge, "status": "suspected" if conclusion and
                               ((edge["source"] == conclusion["nf"] and edge["target"] in conclusion["peers"]) or
                                (edge["target"] == conclusion["nf"] and edge["source"] in conclusion["peers"])) else
                               "propagation" if any(f["confirmed_path"] and {edge["source"], edge["target"]}.issubset({s["nf"] for s in f["steps"]}) for f in flows["rows"]) else "normal"}
                              for edge in self.topology["edges"]]}
        result = {"minute": minute, "timestamp": (self.detector.start + timedelta(minutes=minute)).isoformat(),
                  "stage": "handoff" if conclusion else "analysis" if retained else "perception", "perception": perception,
                  "flows": flows, "clusters": clusters, "reasoning": reasoning, "topology": topology,
                  "quality": self.quality, "logs": logs,
                  "handoff": {"schema_version": "1.0", "status": "ready" if conclusion else "pending_evidence", "delivered": False,
                              "decision_execution_implemented": False, "window_end": perception["window_end"],
                              "conclusion": conclusion, "evidence": {"anomaly_dimensions": perception["confirmed_dimensions"],
                              "retained_chr": len(retained), "correlated_flows": flows["correlated"], "graph_version": self.graph["version"]}}}
        self.cache[minute] = result
        yield {"type": "result", "data": result}

    def snapshot(self, minute):
        if minute in self.cache:
            return self.cache[minute]
        for event in self.events(minute):
            if event["type"] == "result":
                return event["data"]
