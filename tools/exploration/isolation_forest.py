"""Isolation Forest multivariate outlier detector.

Treats each link as a point in feature space (mean/std/min/max/anomaly-ratio of
its success-rate series) and isolates the structurally anomalous links. A link
serving a faulty NE stands out from healthy links. ``random_state`` is seeded
for reproducible ablations.

Requires scikit-learn; guarded by registry.import_all_tools.
"""

from __future__ import annotations

import json

import numpy as np
from sklearn.ensemble import IsolationForest

from tools.exploration._series import link_feature_matrix, ne_ids_in_link
from tools.registry import register


@register(
    name="isolation_forest",
    description=(
        "Isolation Forest outlier detector on a per-link feature matrix. "
        "Returns links that are structurally anomalous (likely faulty) with "
        "anomaly scores. Good for catching multi-NE / scattered faults."
    ),
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows",
                "items": {"type": "object"},
            },
            "level": {"type": "string", "description": "KPI level", "default": "link"},
            "n_estimators": {"type": "integer", "description": "Number of trees", "default": 100},
            "contamination": {
                "type": "number",
                "description": "Expected anomaly fraction (0.03-0.2)",
                "default": 0.1,
            },
            "seed": {
                "type": "integer",
                "description": "Random seed for reproducibility",
                "default": 0,
            },
        },
        "required": ["kpi_rows"],
    },
)
async def isolation_forest(
    kpi_rows: list[dict],
    level: str = "link",
    n_estimators: int = 100,
    contamination: float = 0.1,
    seed: int = 0,
) -> str:
    link_ids, matrix = link_feature_matrix(kpi_rows, level)
    n_links = len(link_ids)
    if n_links < 3:
        return json.dumps(
            {"algorithm": "isolation_forest", "flagged_links": [], "reason": "too few links"}
        )

    X = np.array(matrix, dtype=float)
    mean = X.mean(axis=0)
    scale = X.std(axis=0)
    scale[scale == 0] = 1.0
    Xs = (X - mean) / scale

    contam = min(max(float(contamination), 1.0 / n_links), 0.5)
    iso = IsolationForest(
        n_estimators=int(n_estimators),
        contamination=contam,
        random_state=int(seed),
    )
    iso.fit(Xs)
    labels = iso.predict(Xs)  # -1 anomaly, 1 normal
    scores = -iso.score_samples(Xs)  # higher = more anomalous

    flagged = []
    for lid, lab, sc in zip(link_ids, labels, scores):
        if lab == -1:
            flagged.append(
                {"link": lid, "anomaly_score": round(float(sc), 4), "nes": ne_ids_in_link(lid)}
            )

    evidence: list[str] = []
    for f in flagged:
        for ne in f["nes"]:
            if ne not in evidence:
                evidence.append(ne)

    if flagged and scores.size:
        denom = float(scores.std()) or 1e-9
        confidence = min((float(max(scores)) - float(scores.mean())) / (denom * 3.0), 1.0)
    else:
        confidence = 0.0

    return json.dumps(
        {
            "algorithm": "isolation_forest",
            "level": level,
            "n_estimators": int(n_estimators),
            "contamination": contam,
            "n_links": n_links,
            "flagged_links": flagged,
            "evidence_elements": evidence,
            "confidence": round(confidence, 4),
        },
        ensure_ascii=False,
        indent=2,
    )
