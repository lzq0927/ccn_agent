"""Fault isolation tools for narrowing down root cause."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from tools.registry import register


@register(
    name="isolate_fault_candidates",
    description="Isolate fault candidate NEs by cross-referencing degraded links with topology. Returns ranked candidates.",
    parameters={
        "type": "object",
        "properties": {
            "degraded_pairs": {
                "type": "array",
                "description": "List of degraded src->dst link pair strings",
                "items": {"type": "string"},
            },
            "topology_text": {
                "type": "string",
                "description": "Topology text for spatial analysis",
            },
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows for temporal analysis",
                "items": {"type": "object"},
            },
        },
        "required": ["degraded_pairs"],
    },
)
async def isolate_fault_candidates(
    degraded_pairs: list[str],
    topology_text: str = "",
    kpi_rows: list[dict] | None = None,
) -> str:
    # Count NE appearances in degraded pairs
    ne_count: dict[str, int] = defaultdict(int)
    for pair in degraded_pairs:
        parts = pair.split("->")
        if len(parts) == 2:
            ne_count[parts[0]] += 1
            ne_count[parts[1]] += 1

    total_pairs = max(len(degraded_pairs), 1)
    candidates = sorted(ne_count.items(), key=lambda x: -x[1])

    # Classify: single NE dominant, multiple NEs, or scattered
    if not candidates:
        pattern = "no_anomaly"
    elif candidates[0][1] / (total_pairs * 2) > 0.4:
        pattern = "single_ne_dominant"
    elif len(candidates) >= 2 and candidates[0][1] - candidates[1][1] < 2:
        pattern = "multi_ne_balanced"
    else:
        pattern = "few_ne_dominant"

    result = {
        "total_degraded_pairs": total_pairs,
        "pattern": pattern,
        "candidates": [
            {"ne_id": ne, "appearances": cnt, "dominance": round(cnt / (total_pairs * 2), 4)}
            for ne, cnt in candidates[:10]
        ],
        "top_candidate": candidates[0][0] if candidates else None,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


@register(
    name="check_temporal_pattern",
    description="Analyze KPI temporal pattern to detect fault window: sudden onset time, duration, and recovery.",
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows",
                "items": {"type": "object"},
            },
            "ne_id": {
                "type": "string",
                "description": "Optional NE ID to filter for specific NE analysis",
            },
            "threshold": {
                "type": "number",
                "description": "Anomaly threshold for success rate",
                "default": 0.995,
            },
        },
        "required": ["kpi_rows"],
    },
)
async def check_temporal_pattern(
    kpi_rows: list[dict],
    ne_id: str = "",
    threshold: float = 0.995,
) -> str:
    # Filter for specific NE if provided
    rows = []
    for r in kpi_rows:
        if str(r.get("level", "")) != "link":
            continue
        if ne_id and str(r.get("src", "")) != ne_id and str(r.get("dst", "")) != ne_id:
            continue
        rows.append({
            "timestamp": int(r.get("timestamp", 0)),
            "success_rate": float(r.get("success_rate", 1.0)),
        })

    if not rows:
        return json.dumps({"error": "No matching KPI rows found"})

    # Group by timestamp
    by_ts: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        by_ts[r["timestamp"]].append(r["success_rate"])

    ts_sorted = sorted(by_ts.keys())
    ts_avg = {ts: sum(rates) / len(rates) for ts, rates in by_ts.items()}

    # Detect fault window: first and last timestamp where avg drops below threshold
    fault_ts = [ts for ts in ts_sorted if ts_avg[ts] < threshold]

    if not fault_ts:
        result = {
            "fault_detected": False,
            "note": "No temporal anomaly detected",
            "timestamps": len(ts_sorted),
        }
    else:
        fault_start = min(fault_ts)
        fault_end = max(fault_ts)
        # Check for sudden onset
        pre_fault = [ts_avg[ts] for ts in ts_sorted if ts < fault_start]
        post_fault = [ts_avg[ts] for ts in ts_sorted if ts > fault_end]

        result = {
            "fault_detected": True,
            "fault_start": fault_start,
            "fault_end": fault_end,
            "fault_duration": fault_end - fault_start,
            "fault_window_size": len(fault_ts),
            "pre_fault_avg": round(sum(pre_fault) / max(len(pre_fault), 1), 4) if pre_fault else None,
            "during_fault_avg": round(sum(ts_avg[ts] for ts in fault_ts) / len(fault_ts), 4),
            "post_fault_avg": round(sum(post_fault) / max(len(post_fault), 1), 4) if post_fault else None,
            "sudden_onset": bool(pre_fault and ts_avg.get(fault_start, 1.0) < threshold * 0.99),
            "sudden_recovery": bool(post_fault and ts_avg.get(fault_end, 0) < threshold),
        }

    return json.dumps(result, ensure_ascii=False, indent=2)


@register(
    name="compare_diagnoses",
    description="Compare a predicted diagnosis against ground truth. Returns match metrics.",
    parameters={
        "type": "object",
        "properties": {
            "predicted_elements": {
                "type": "array",
                "description": "Predicted faulty NE IDs",
                "items": {"type": "string"},
            },
            "predicted_links": {
                "type": "array",
                "description": "Predicted faulty link pairs",
                "items": {"type": "string"},
            },
            "ground_truth_elements": {
                "type": "array",
                "description": "Ground truth faulty NE IDs",
                "items": {"type": "string"},
            },
            "ground_truth_links": {
                "type": "array",
                "description": "Ground truth faulty link pairs",
                "items": {"type": "string"},
            },
        },
        "required": ["predicted_elements", "ground_truth_elements"],
    },
)
async def compare_diagnoses(
    predicted_elements: list[str],
    ground_truth_elements: list[str],
    predicted_links: list[str] | None = None,
    ground_truth_links: list[str] | None = None,
) -> str:
    pred_set = set(predicted_elements)
    truth_set = set(ground_truth_elements)

    tp = len(pred_set & truth_set)
    fp = len(pred_set - truth_set)
    fn = len(truth_set - pred_set)

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-9)
    exact_match = pred_set == truth_set

    link_pred = set(predicted_links or [])
    link_truth = set(ground_truth_links or [])
    link_exact = link_pred == link_truth

    result = {
        "exact_match": exact_match,
        "partial_match": tp > 0,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "true_positives": sorted(pred_set & truth_set),
        "false_positives": sorted(pred_set - truth_set),
        "false_negatives": sorted(truth_set - pred_set),
        "link_exact_match": link_exact,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)
