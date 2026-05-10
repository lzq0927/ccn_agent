"""Statistical analysis tools for fault diagnosis."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from tools.registry import register


@register(
    name="compute_success_rate_stats",
    description="Compute statistical summary (mean, std, min, max) of success rates grouped by NE or link pair.",
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows",
                "items": {"type": "object"},
            },
            "group_by": {
                "type": "string",
                "description": "Group by: 'ne', 'link_pair', 'timestamp'",
                "default": "ne",
            },
            "level": {
                "type": "string",
                "description": "KPI level filter: 'link', 'trace', 'session'",
                "default": "link",
            },
        },
        "required": ["kpi_rows"],
    },
)
async def compute_success_rate_stats(
    kpi_rows: list[dict],
    group_by: str = "ne",
    level: str = "link",
) -> str:
    rows = [
        r for r in kpi_rows
        if str(r.get("level", "")) == level
    ]

    groups: dict[str, list[float]] = defaultdict(list)

    for r in rows:
        sr = float(r.get("success_rate", 1.0))
        if group_by == "ne":
            src, dst = str(r.get("src", "")), str(r.get("dst", ""))
            groups[src].append(sr)
            groups[dst].append(sr)
        elif group_by == "link_pair":
            key = f"{r.get('src', '')}->{r.get('dst', '')}"
            groups[key].append(sr)
        elif group_by == "timestamp":
            key = str(r.get("timestamp", 0))
            groups[key].append(sr)

    stats = {}
    for key, rates in sorted(groups.items()):
        n = len(rates)
        mean = sum(rates) / n
        variance = sum((r - mean) ** 2 for r in rates) / n
        stats[key] = {
            "count": n,
            "mean": round(mean, 4),
            "std": round(variance ** 0.5, 6),
            "min": round(min(rates), 4),
            "max": round(max(rates), 4),
        }

    # Sort by mean (most degraded first)
    sorted_stats = dict(sorted(stats.items(), key=lambda x: x[1]["mean"]))

    return json.dumps({
        "group_by": group_by,
        "level": level,
        "group_count": len(sorted_stats),
        "stats": sorted_stats,
    }, ensure_ascii=False, indent=2)


@register(
    name="detect_anomaly_sudden_change",
    description="Detect sudden changes in KPI time series using difference of consecutive means.",
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows (link level)",
                "items": {"type": "object"},
            },
            "target": {
                "type": "string",
                "description": "Specific NE or link pair to analyze. Empty for all.",
                "default": "",
            },
            "sensitivity": {
                "type": "number",
                "description": "Threshold for change detection (success rate drop)",
                "default": 0.005,
            },
        },
        "required": ["kpi_rows"],
    },
)
async def detect_anomaly_sudden_change(
    kpi_rows: list[dict],
    target: str = "",
    sensitivity: float = 0.005,
) -> str:
    # Filter link-level rows
    rows = [
        r for r in kpi_rows
        if str(r.get("level", "")) == "link"
    ]

    # Group by timestamp, compute average
    by_ts: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        if target and target not in str(r.get("src", "")) and target not in str(r.get("dst", "")):
            continue
        ts = int(r.get("timestamp", 0))
        by_ts[ts].append(float(r.get("success_rate", 1.0)))

    ts_sorted = sorted(by_ts.keys())
    ts_avg = {ts: sum(rates) / len(rates) for ts, rates in by_ts.items()}

    # Detect sudden drops
    changes = []
    for i in range(1, len(ts_sorted)):
        prev_ts = ts_sorted[i - 1]
        curr_ts = ts_sorted[i]
        diff = ts_avg[curr_ts] - ts_avg[prev_ts]
        if diff < -sensitivity:
            changes.append({
                "timestamp": curr_ts,
                "previous_avg": round(ts_avg[prev_ts], 4),
                "current_avg": round(ts_avg[curr_ts], 4),
                "drop": round(abs(diff), 4),
                "type": "drop",
            })
        elif diff > sensitivity:
            changes.append({
                "timestamp": curr_ts,
                "previous_avg": round(ts_avg[prev_ts], 4),
                "current_avg": round(ts_avg[curr_ts], 4),
                "rise": round(diff, 4),
                "type": "recovery",
            })

    result = {
        "total_timestamps": len(ts_sorted),
        "changes_detected": len(changes),
        "changes": changes,
        "overall_min": round(min(ts_avg.values()), 4) if ts_avg else 1.0,
        "overall_max": round(max(ts_avg.values()), 4) if ts_avg else 1.0,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)
