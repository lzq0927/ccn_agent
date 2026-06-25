"""CUSUM (cumulative sum) change-point detector.

One-sided lower CUSUM on a KPI success-rate time series — accumulates evidence
of a sustained downward shift. More sensitive than EWMA to small persistent
changes, which is valuable for micro-loss faults.
"""

from __future__ import annotations

import json

from tools.exploration._series import (
    affected_nes_from_anomalies,
    mean_std,
    normalize_confidence,
    per_timestamp_series,
)
from tools.registry import register


@register(
    name="cusum_changepoint",
    description=(
        "One-sided lower CUSUM change-point detector on a KPI success-rate "
        "series. Signals a sustained downward shift when the cumulative sum "
        "exceeds threshold_h * sigma. Sensitive to small persistent drops."
    ),
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows",
                "items": {"type": "object"},
            },
            "target": {
                "type": "string",
                "description": "NE id to focus on, or '' for all",
                "default": "",
            },
            "level": {
                "type": "string",
                "description": "KPI level: 'link' or 'trace'",
                "default": "link",
            },
            "drift_k": {
                "type": "number",
                "description": "Drift/slack parameter (half the shift to detect)",
                "default": 0.01,
            },
            "threshold_h": {
                "type": "number",
                "description": "Decision threshold in sigma units",
                "default": 5.0,
            },
        },
        "required": ["kpi_rows"],
    },
)
async def cusum_changepoint(
    kpi_rows: list[dict],
    target: str = "",
    level: str = "link",
    drift_k: float = 0.01,
    threshold_h: float = 5.0,
) -> str:
    ts_sorted, series = per_timestamp_series(kpi_rows, target, level)
    if len(series) < 3:
        return json.dumps({"algorithm": "cusum", "changepoints": [], "reason": "series too short"})

    mean, std = mean_std(series)
    std = std or 1e-9
    k = float(drift_k)
    h = float(threshold_h) * std

    # One-sided lower CUSUM: accumulate (mean - x - k); reset at 0.
    s = 0.0
    changepoints = []
    max_excess = 0.0
    for t, x in zip(ts_sorted, series):
        s = max(0.0, s + (mean - x - k))
        if s > h:
            excess_sigma = (s - h) / std
            max_excess = max(max_excess, excess_sigma)
            changepoints.append(
                {
                    "timestamp": t,
                    "direction": "drop",
                    "cusum": round(s, 4),
                    "excess_sigma": round(excess_sigma, 2),
                }
            )

    evidence = [target] if target else affected_nes_from_anomalies(kpi_rows)
    confidence = (
        normalize_confidence(max_excess + float(threshold_h), threshold_h) if changepoints else 0.0
    )
    return json.dumps(
        {
            "algorithm": "cusum",
            "target": target,
            "level": level,
            "drift_k": k,
            "threshold_h": threshold_h,
            "series_length": len(series),
            "mean": round(mean, 4),
            "std": round(std, 4),
            "changepoints": changepoints,
            "evidence_elements": evidence,
            "confidence": round(confidence, 4),
        },
        ensure_ascii=False,
        indent=2,
    )
