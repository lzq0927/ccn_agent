"""EWMA (exponentially weighted moving average) change-point detector.

Detects mean-shift drops in a KPI success-rate time series. Suitable for
locating a fault's onset timestamp even when the drop is subtle (micro-loss) —
the EWMA smooths noise so a small but sustained shift crosses the control limit.
"""

from __future__ import annotations

import json
import math

from tools.exploration._series import (
    affected_nes_from_anomalies,
    mean_std,
    normalize_confidence,
    per_timestamp_series,
)
from tools.registry import register


@register(
    name="ewma_changepoint",
    description=(
        "EWMA change-point detector on a KPI success-rate time series. "
        "Locates fault-onset timestamps where the EWMA drops below the lower "
        "control limit (mean - threshold_sigma * sigma_ewma). Use target='' for "
        "the aggregate series, or a NE id to analyse that NE's links."
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
            "lambda_": {
                "type": "number",
                "description": "EWMA smoothing factor (0-1)",
                "default": 0.2,
            },
            "threshold_sigma": {
                "type": "number",
                "description": "Control-limit width in sigma units",
                "default": 3.0,
            },
        },
        "required": ["kpi_rows"],
    },
)
async def ewma_changepoint(
    kpi_rows: list[dict],
    target: str = "",
    level: str = "link",
    lambda_: float = 0.2,
    threshold_sigma: float = 3.0,
) -> str:
    ts_sorted, series = per_timestamp_series(kpi_rows, target, level)
    if len(series) < 3:
        return json.dumps({"algorithm": "ewma", "changepoints": [], "reason": "series too short"})

    lam = float(lambda_)
    ewma = [series[0]]
    for x in series[1:]:
        ewma.append(lam * x + (1 - lam) * ewma[-1])

    mean, std = mean_std(series)
    std = std or 1e-9
    sigma_ewma = std * math.sqrt(lam / (2 - lam))
    lcl = mean - threshold_sigma * sigma_ewma

    changepoints = []
    max_sigma = 0.0
    for t, z in zip(ts_sorted, ewma):
        if z < lcl:
            sigma_exceeded = (mean - z) / (sigma_ewma or 1e-9)
            max_sigma = max(max_sigma, sigma_exceeded)
            changepoints.append(
                {
                    "timestamp": t,
                    "direction": "drop",
                    "magnitude": round(mean - z, 4),
                    "sigma_exceeded": round(sigma_exceeded, 2),
                }
            )

    evidence = [target] if target else affected_nes_from_anomalies(kpi_rows)
    confidence = normalize_confidence(max_sigma, threshold_sigma) if changepoints else 0.0
    return json.dumps(
        {
            "algorithm": "ewma",
            "target": target,
            "level": level,
            "lambda_": lam,
            "threshold_sigma": threshold_sigma,
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
