"""Per-subscriber failure-concentration detector (CHR-driven).

Aggregates free5GC CHR failures by subscriber (SUPI) and by network element to
quantify how concentrated the failures are. Concentrated failures (high NE
share / high Gini) point at a single-NE fault; spread failures point at
multi-NE / resource-pool faults. This is the CHR signal that disambiguates
micro-loss cases where KPIs barely move.
"""

from __future__ import annotations

import json
from collections import Counter

from tools.exploration._series import gini
from tools.registry import register


def _nes_in(record: dict) -> list[str]:
    """NE ids involved in a CHR record (excludes UE endpoints)."""
    out = []
    for key in ("nf_src", "nf_dst"):
        ne = record.get(key)
        if ne and not str(ne).startswith("UE"):
            out.append(str(ne))
    return out


@register(
    name="ue_failure_concentration",
    description=(
        "Aggregate CHR failures per subscriber (SUPI) and per NE. Reports the "
        "Gini concentration, the top failing subscribers/NEs/hops, and a "
        "tentative pattern (single_ne / multi_ne / concentrated). Use this when "
        "KPIs are ambiguous but user-level CHR shows failures."
    ),
    parameters={
        "type": "object",
        "properties": {
            "chr_records": {
                "type": "array",
                "description": "CHR records",
                "items": {"type": "object"},
            },
            "top_k": {
                "type": "integer",
                "description": "Number of top entries to return",
                "default": 10,
            },
        },
        "required": ["chr_records"],
    },
)
async def ue_failure_concentration(chr_records: list[dict], top_k: int = 10) -> str:
    fails = [r for r in chr_records if r.get("outcome") == "failure"]
    total = len(chr_records)
    if not fails:
        return json.dumps(
            {
                "algorithm": "ue_failure_concentration",
                "total_attempts": total,
                "failures": 0,
                "failed_supis": [],
                "top_nes": [],
                "gini_supi": 0.0,
                "gini_ne": 0.0,
                "pattern": "none",
                "evidence_elements": [],
                "confidence": 0.0,
            }
        )

    per_supi = Counter(r.get("supi") for r in fails if r.get("supi"))
    per_ne: Counter = Counter()
    for r in fails:
        for ne in _nes_in(r):
            per_ne[ne] += 1
    per_hop = Counter(f"{r.get('nf_src', '')}->{r.get('nf_dst', '')}" for r in fails)

    gini_supi = gini(list(per_supi.values()))
    gini_ne = gini(list(per_ne.values()))
    ne_total = sum(per_ne.values()) or 1
    top_ne, top_ne_count = per_ne.most_common(1)[0]
    top_ne_share = top_ne_count / ne_total

    # Tentative pattern from concentration profile.
    if top_ne_share > 0.4:
        pattern = "single_ne"
    elif gini_ne < 0.3 and len(per_ne) > 3:
        pattern = "multi_ne"
    else:
        pattern = "concentrated"

    top_nes = [
        {"ne": ne, "failures": cnt, "share": round(cnt / ne_total, 3)}
        for ne, cnt in per_ne.most_common(top_k)
    ]
    # evidence 只取显著 NE:份额 ≥ top 一半(背景噪声元素计数 1-2,
    # 混入会稀释贝叶斯融合,把真根因挤下 posterior 榜首)
    _top_cnt = per_ne.most_common(1)[0][1] if per_ne else 0
    evidence = [ne for ne, cnt in per_ne.most_common(top_k)
                if _top_cnt and cnt >= max(_top_cnt / 2, 2)]
    confidence = round(min(max(top_ne_share, gini_supi), 1.0), 4)

    return json.dumps(
        {
            "algorithm": "ue_failure_concentration",
            "total_attempts": total,
            "failures": len(fails),
            "failure_rate": round(len(fails) / max(total, 1), 4),
            "distinct_failed_supis": len(per_supi),
            "failed_supi_ratio": round(
                len(per_supi) / max(len({r.get("supi") for r in chr_records if r.get("supi")}), 1),
                4,
            ),
            "gini_supi": round(gini_supi, 4),
            "gini_ne": round(gini_ne, 4),
            "top_ne_share": round(top_ne_share, 4),
            "top_nes": top_nes,
            "top_hops": [{"hop": h, "failures": c} for h, c in per_hop.most_common(top_k)],
            "pattern": pattern,
            "evidence_elements": evidence,
            "confidence": confidence,
        },
        ensure_ascii=False,
        indent=2,
    )
