"""Bayesian fusion of multi-algorithm exploration findings.

Each detector run contributes a likelihood ratio over candidate fault elements
(NEs). Fusing them multiplicatively (Bayesian odds update with a uniform prior)
yields a posterior that rewards agreement across *independent* algorithms — an
NE flagged by EWMA + IsolationForest + the CHR concentration analyser gets a far
higher posterior than one flagged by a single detector.

Input ``findings`` is a list of objects, each typically one (algorithm, view)
summary with ``evidence_elements`` (the NEs it flags) and ``confidence`` in
[0, 1]. Output is a ranked posterior plus the top candidate's agreement breadth
(number of distinct findings that flag it) — used by the exploration stop rule.
"""

from __future__ import annotations

import json

from tools.registry import register

_EPS = 1e-6


@register(
    name="bayesian_fusion",
    description=(
        "Fuse multi-algorithm detector findings into a ranked fault posterior. "
        "Each finding flags some NEs with a confidence; fusion rewards NEs that "
        "independent algorithms agree on. Returns ranked posterior, top "
        "candidate, and its agreement breadth (how many findings flag it)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "description": "Detector findings to fuse",
                "items": {
                    "type": "object",
                    "properties": {
                        "algorithm": {"type": "string"},
                        "data_view": {"type": "string"},
                        "evidence_elements": {"type": "array", "items": {"type": "string"}},
                        "confidence": {"type": "number"},
                    },
                },
            },
            "base_rate": {
                "type": "number",
                "description": "False-positive base rate",
                "default": 0.1,
            },
        },
        "required": ["findings"],
    },
)
async def bayesian_fusion(findings: list[dict], base_rate: float = 0.1) -> str:
    # Normalise findings: drop those with no usable evidence/confidence.
    clean = []
    for f in findings or []:
        ev = [str(e) for e in (f.get("evidence_elements") or [])]
        conf = float(f.get("confidence", 0.0) or 0.0)
        if ev and conf > 0:
            clean.append(
                {
                    "algorithm": f.get("algorithm", "?"),
                    "data_view": f.get("data_view", "?"),
                    "evidence_elements": ev,
                    "confidence": conf,
                }
            )

    candidates = sorted({ne for f in clean for ne in f["evidence_elements"]})
    if not candidates:
        return json.dumps(
            {
                "posterior": [],
                "top_element": None,
                "top_posterior": 0.0,
                "top_agreement": 0,
                "num_findings": len(clean),
                "evidence_elements": [],
            }
        )

    base = max(float(base_rate), _EPS)
    odds: dict[str, float] = {}
    for x in candidates:
        o = 1.0
        for f in clean:
            if x in f["evidence_elements"]:
                # Likelihood ratio for "flagged": confidence vs base false-positive rate.
                o *= (f["confidence"] + _EPS) / base
            # not flagged → LR = 1 (no change to odds)
        odds[x] = o

    total = sum(odds.values())
    ranked = sorted(((x, o / total) for x, o in odds.items()), key=lambda kv: -kv[1])
    posterior = [{"element": x, "posterior": round(p, 4)} for x, p in ranked]

    top_element = ranked[0][0]
    top_posterior = round(ranked[0][1], 4)
    top_agreement = sum(1 for f in clean if top_element in f["evidence_elements"])

    return json.dumps(
        {
            "posterior": posterior,
            "top_element": top_element,
            "top_posterior": top_posterior,
            "top_agreement": top_agreement,
            "num_findings": len(clean),
            "num_candidates": len(candidates),
            "evidence_elements": [p["element"] for p in posterior],
            "confidence": top_posterior,
        },
        ensure_ascii=False,
        indent=2,
    )
