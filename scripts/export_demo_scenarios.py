"""Export REAL diagnosis + evaluation data for the frontend-show DEMO scenarios.

对真实 case_003 / case_005 / case_9001 跑完整「故障感知诊断 + 评估优化」闭环
(外加不落库的 trace 四维、confidence 五维),并把真实遥测 KPI 聚合后,
输出 `frontend-show/src/data/real-cases.json`,让 DEMO 的 3 个场景(A/B/C)
由真实仿真管线产出全真驱动,而非前端合成数据。

用法:
    python scripts/export_demo_scenarios.py

依赖 config/llm.local.yaml 中的 LLM key(诊断 GUIDED 路由与评估 trace 分析需要)。
副作用:会向 storage/ccn_agent.db 写入 diagnosis_sessions / reasoning_steps /
evaluations / optimization_suggestions 行(真实闭环的正常留存)。
"""

from __future__ import annotations

import asyncio
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agents.shared.storage import Storage  # noqa: E402
from agents.shared.models import CaseData, CaseMetadata, parse_chr_jsonl  # noqa: E402
from agents.fault_perception.agent import FaultPerceptionAgent  # noqa: E402
from agents.evaluation.agent import EvaluationOptimizationAgent  # noqa: E402

# (DEMO 场景 id, 真实 case_id)默认全集。B 可用命令行 `B:<case_id>` 覆盖以试命中。
DEFAULT_TARGETS: list[tuple[str, int]] = [("A", 3), ("B", 102), ("C", 9001)]
SCENARIO_ORDER = ["A", "B", "C"]

TIMESTEPS = 60
ANOMALY_THRESHOLD = 0.995
BASELINE_SR = 0.999
OUT_PATH = ROOT / "frontend-show" / "src" / "data" / "real-cases.json"


def edge_id(a: str, b: str) -> str:
    """与前端 network.ts::edgeId 一致:排序后 __ 连接。"""
    return "__".join(sorted([a, b]))


# ---------------------------------------------------------------------------
# 从 storage/cases/ 重建 CaseData(参考 api/routes/perception.py:37-59)
# ---------------------------------------------------------------------------
def build_case_data(storage: Storage, case_id: int) -> tuple[CaseData, CaseMetadata]:
    files = storage.load_case_files(case_id)
    if not files:
        raise FileNotFoundError(f"case_{case_id:03d} files not found under storage/cases/")
    kpi_rows = list(csv.DictReader(files["data.csv"].strip().split("\n")))
    meta = CaseMetadata.from_json(files["metadata.json"])
    case_data = CaseData(
        case_id=case_id,
        kpi_rows=kpi_rows,
        topology_text=files["topo.txt"],
        process_text=files["process.txt"],
        ground_truth=json.loads(files["result.txt"]),
        chr_records=parse_chr_jsonl(files.get("chr.jsonl", "")),  # 必填:决定真实路由
        metadata=meta,
    )
    return case_data, meta


# ---------------------------------------------------------------------------
# 聚合真实 KPI(复刻 frontend-show/src/data/live.ts::buildLiveModel)
# 只取 link 层行 → 逐链路逐时间步均值 → overall / nodes 时序。不导出原始大 CSV。
# ---------------------------------------------------------------------------
def aggregate_kpi(
    kpi_rows: list[dict], meta: CaseMetadata
) -> tuple[dict, list[list[str]]]:
    link_rows = [
        r for r in kpi_rows
        if str(r.get("level", "")) == "link" and r.get("src") and r.get("dst")
    ]

    flow_pairs: list[list[str]] = []
    seen_edges: set[str] = set()
    edge_series: dict[str, list[float | None]] = {}
    edge_count: dict[str, list[int]] = {}

    for r in link_rows:
        try:
            t = int(float(r["timestamp"]))
            sr = float(r["success_rate"])
        except (ValueError, KeyError):
            continue
        if not (1 <= t <= TIMESTEPS):
            continue
        eid = edge_id(r["src"], r["dst"])
        if eid not in seen_edges:
            seen_edges.add(eid)
            flow_pairs.append([r["src"], r["dst"]])
            edge_series[eid] = [None] * TIMESTEPS
            edge_count[eid] = [0] * TIMESTEPS
        idx = t - 1
        cur = edge_series[eid][idx]
        cnt = edge_count[eid][idx]
        if cnt == 0:
            edge_series[eid][idx] = sr
        else:
            edge_series[eid][idx] = (cur * cnt + sr) / (cnt + 1)  # type: ignore[arg-type]
        edge_count[eid][idx] = cnt + 1

    # 缺失时间步填基线
    for arr in edge_series.values():
        for i in range(TIMESTEPS):
            if arr[i] is None:
                arr[i] = BASELINE_SR

    # 总体 = 各链路逐 t 均值
    overall: list[float] = []
    for t in range(TIMESTEPS):
        vals = [edge_series[eid][t] for eid in edge_series]  # type: ignore[index]
        overall.append(sum(vals) / len(vals) if vals else BASELINE_SR)

    # 节点 = 关联业务链路逐 t 均值
    node_order: list[str] = []
    node_edges: dict[str, list[str]] = defaultdict(list)
    for a, b in flow_pairs:
        eid = edge_id(a, b)
        for x in (a, b):
            if x not in node_order:
                node_order.append(x)
            if eid not in node_edges[x]:
                node_edges[x].append(eid)
    nodes: dict[str, list[float]] = {}
    for nid in node_order:
        inc = node_edges[nid]
        arr: list[float] = []
        for t in range(TIMESTEPS):
            vals = [edge_series[eid][t] for eid in inc]  # type: ignore[index]
            arr.append(sum(vals) / len(vals) if vals else BASELINE_SR)
        nodes[nid] = arr

    fault_start = meta.fault_start or 20
    fault_end = fault_start + (meta.fault_duration or 15)
    kpi = {
        "steps": TIMESTEPS,
        "overall": overall,
        "edges": edge_series,  # type: ignore[dict-item]
        "nodes": nodes,
        "faultStart": fault_start,
        "faultEnd": fault_end,
        "threshold": ANOMALY_THRESHOLD,
    }
    return kpi, flow_pairs


# ---------------------------------------------------------------------------
# confidence 五维(assess 不暴露 pattern/spatial/ambiguity,从 _extract_features 补)
# ---------------------------------------------------------------------------
def build_confidence(assessor, case_data: CaseData) -> dict:
    assessment = assessor.assess(case_data)
    features = assessor._extract_features(case_data)  # noqa: SLF001 — 取未持久化的中间量
    pattern_name = features.pattern_match or (
        assessment.matched_patterns[0] if assessment.matched_patterns else ""
    )
    return {
        "pattern": round(features.pattern_strength, 4),
        "severity": round(features.anomaly_severity, 4),
        "temporal": round(features.temporal_clarity, 4),
        "spatial": round(features.spatial_clarity, 4),
        "ambiguity": round(features.ambiguity, 4),
        "score": assessment.score,
        "route": assessment.route.value,
        "patternName": pattern_name,
        "matchedSkills": list(assessment.suggested_skills),
        "affectedNeCount": assessment.affected_ne_count,
    }


def trace_to_dicts(trace) -> list[dict]:
    return [
        {
            "step_number": s.step_number,
            "step_type": s.step_type,
            "content": s.content,
            "tool_name": s.tool_name,
            "tool_args": s.tool_args,
            "tool_result": s.tool_result,
            "timestamp": s.timestamp,
        }
        for s in trace
    ]


def diagnosis_to_dict(diag) -> dict:
    return {
        "session_id": diag.session_id,
        "fault_elements": list(diag.fault_elements),
        "fault_links": list(diag.fault_links),
        "fault_type": diag.fault_type,
        "fault_mode": diag.fault_mode,
        "confidence": diag.confidence,
        "route_taken": diag.route_taken.value,
        "iterations_used": diag.iterations_used,
        "llm_model": diag.llm_model,
        "status": diag.status.value,
        "reasoning_trace": trace_to_dicts(diag.reasoning_trace),
    }


def evaluation_to_dict(report, trace_axes: dict) -> dict:
    return {
        "metrics": {
            "exact_match": report.metrics.exact_match,
            "precision": report.metrics.precision,
            "recall": report.metrics.recall,
            "f1": report.metrics.f1,
            "fault_type_match": report.metrics.fault_type_match,
        },
        "case_category": report.case_entry.category.value if report.case_entry else "failure",
        "trace_quality_score": report.trace_quality_score,
        "trace_axes": {
            "logical_coherence": trace_axes.get("logical_coherence", report.trace_quality_score),
            "tool_efficiency": trace_axes.get("tool_efficiency", report.trace_quality_score),
            "evidence_quality": trace_axes.get("evidence_quality", report.trace_quality_score),
            "missed_signals": trace_axes.get("missed_signals", 0.2),
            "overall_score": trace_axes.get("overall_score", report.trace_quality_score),
        },
        "suggestions": [
            {
                "suggestion_type": s.suggestion_type.value,
                "target": s.target,
                "content": s.content,
                "priority": s.priority,
            }
            for s in report.suggestions
        ],
    }


async def run_one(
    scenario_id: str,
    case_id: int,
    perception: FaultPerceptionAgent,
    evaluator: EvaluationOptimizationAgent,
    storage: Storage,
) -> dict:
    case_data, meta = build_case_data(storage, case_id)

    diag = await perception.diagnose(case_data)
    report = await evaluator.evaluate(diag, case_data, difficulty=meta.difficulty.value)
    # evaluate() 内部只存了 overall,这里再分析一次拿四维明细
    trace_axes = await evaluator.trace_analyzer.analyze(diag.reasoning_trace)
    confidence = build_confidence(perception.assessor, case_data)
    kpi, flow_pairs = aggregate_kpi(case_data.kpi_rows, meta)

    print(
        f"  [{scenario_id}] case_{case_id:04d}: "
        f"truth={case_data.ground_truth.get('fault_elements')} "
        f"predicted={diag.fault_elements} "
        f"route={diag.route_taken.value} conf={diag.confidence:.3f} "
        f"| eval: P={report.metrics.precision:.2f} R={report.metrics.recall:.2f} "
        f"F1={report.metrics.f1:.2f} exact={report.metrics.exact_match} "
        f"cat={report.case_entry.category.value if report.case_entry else 'n/a'} "
        f"suggestions={len(report.suggestions)}",
        flush=True,
    )

    return {
        "scenario_id": scenario_id,
        "case_id": case_id,
        "meta": {
            "fault_type": meta.fault_type,
            "fault_mode": meta.fault_mode,
            "loss_rate": meta.loss_rate,
            "fault_start": meta.fault_start,
            "fault_duration": meta.fault_duration,
            "ue_count": meta.ue_count,
            "difficulty": meta.difficulty.value,
        },
        "topo": case_data.topology_text,
        "flowPairs": flow_pairs,
        "truth": {
            "elements": list(case_data.ground_truth.get("fault_elements", [])),
            "links": list(case_data.ground_truth.get("fault_links", [])),
        },
        "kpi": kpi,
        "diagnosis": diagnosis_to_dict(diag),
        "evaluation": evaluation_to_dict(report, trace_axes),
        "confidence": confidence,
    }


def parse_targets(argv: list[str]) -> list[tuple[str, int]]:
    """命令行参数 `scenario:case_id`(如 B:102)。无参数则用 DEFAULT_TARGETS。"""
    targets: list[tuple[str, int]] = []
    for arg in argv[1:]:
        if ":" in arg:
            sid, cid = arg.split(":", 1)
            targets.append((sid.strip().upper(), int(cid)))
    return targets or list(DEFAULT_TARGETS)


async def main() -> int:
    targets = parse_targets(sys.argv)
    storage = Storage()
    perception = FaultPerceptionAgent(storage=storage)
    evaluator = EvaluationOptimizationAgent(storage=storage)

    # 增量合并:读现有 JSON,未重跑的 scenario 保留,避免重复跑已命中的 A/C
    existing: dict[str, dict] = {}
    if OUT_PATH.exists():
        try:
            for rc in json.loads(OUT_PATH.read_text(encoding="utf-8")):
                existing[rc["scenario_id"]] = rc
        except Exception:
            pass

    for scenario_id, case_id in targets:
        print(f"[scenario] {scenario_id} <- case_{case_id:04d} ...", flush=True)
        try:
            existing[scenario_id] = await run_one(
                scenario_id, case_id, perception, evaluator, storage
            )
        except Exception as exc:  # 单 case 失败不阻断其余
            print(f"  [ERROR] scenario {scenario_id} case_{case_id}: {exc!r}", flush=True)

    results = [existing[s] for s in SCENARIO_ORDER if s in existing]
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n[OK] wrote {len(results)} scenarios -> {OUT_PATH}", flush=True)
    return 0 if len(results) == len(SCENARIO_ORDER) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
