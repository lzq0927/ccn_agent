"""PCA residual (Q-statistic / SPE) multivariate detector.

Builds a per-link feature matrix (mean/std/min/max/anomaly-ratio of each link's
success-rate series), fits PCA on the dominant structure, and flags links whose
reconstruction residual (Q-statistic) exceeds the significance threshold. Links
that deviate from the principal structure are the faulty candidates.

Requires scikit-learn. If sklearn is unavailable at import time this module
fails to import — registry.import_all_tools guards it so only this tool is
disabled, not the whole registry.
"""

from __future__ import annotations

import json

import numpy as np
from scipy import stats
from sklearn.decomposition import PCA

from tools.exploration._series import link_feature_matrix, ne_ids_in_link
from tools.registry import register


@register(
    name="pca_residual",
    description=(
        "PCA residual (Q-statistic) detector on a per-link feature matrix. "
        "Flags links that deviate from the dominant principal-component "
        "structure — i.e. behave differently from the rest. Returns the "
        "anomalous links and their contributing NEs."
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
            "n_components": {
                "type": "integer",
                "description": "PCA components retained",
                "default": 2,
            },
            "alpha": {
                "type": "number",
                "description": "Significance level (0.01-0.1)",
                "default": 0.05,
            },
        },
        "required": ["kpi_rows"],
    },
)
async def pca_residual(
    kpi_rows: list[dict],
    level: str = "link",
    n_components: int = 2,
    alpha: float = 0.05,
) -> str:
    link_ids, matrix = link_feature_matrix(kpi_rows, level)
    n_links = len(link_ids)
    if n_links < 3:
        return json.dumps({"algorithm": "pca", "flagged_links": [], "reason": "too few links"})

    X = np.array(matrix, dtype=float)
    n_feat = X.shape[1]
    # Standardise features so PCA isn't dominated by scale.
    mean = X.mean(axis=0)
    scale = X.std(axis=0)
    scale[scale == 0] = 1.0
    Xs = (X - mean) / scale

    n_comp = max(1, min(int(n_components), n_feat - 1, n_links - 1))
    pca = PCA(n_components=n_comp)
    pca.fit(Xs)
    reconstructed = pca.inverse_transform(pca.transform(Xs))
    q = np.sum((Xs - reconstructed) ** 2, axis=1)  # SPE per link

    # Threshold via the Jackson–Mudholkar-style normal approximation on Q:
    # use mean + z_{1-alpha} * std as a robust per-case SPE limit.
    q_mean, q_std = float(q.mean()), float(q.std())
    z = float(stats.norm.ppf(1.0 - alpha))
    threshold = q_mean + z * (q_std or 1e-9)

    flagged = []
    max_excess = 0.0
    for lid, qval in zip(link_ids, q):
        if qval > threshold:
            excess = float((qval - threshold) / (q_std or 1e-9))
            max_excess = max(max_excess, excess)
            flagged.append(
                {
                    "link": lid,
                    "q_stat": round(float(qval), 4),
                    "excess_sigma": round(excess, 2),
                    "nes": ne_ids_in_link(lid),
                }
            )

    evidence: list[str] = []
    for f in flagged:
        for ne in f["nes"]:
            if ne not in evidence:
                evidence.append(ne)

    confidence = min(max_excess / 3.0, 1.0) if flagged else 0.0
    explained = [round(float(v), 4) for v in pca.explained_variance_ratio_]
    return json.dumps(
        {
            "algorithm": "pca",
            "level": level,
            "n_components": n_comp,
            "alpha": alpha,
            "n_links": n_links,
            "explained_variance_ratio": explained,
            "q_threshold": round(threshold, 4),
            "flagged_links": flagged,
            "evidence_elements": evidence,
            "confidence": round(confidence, 4),
        },
        ensure_ascii=False,
        indent=2,
    )
