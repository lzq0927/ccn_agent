"""KPI data analysis tools for fault diagnosis."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from tools.registry import register


def _parse_kpi_rows(kpi_rows: list[dict]) -> list[dict]:
    return [
        {
            "timestamp": int(r.get("timestamp", 0)),
            "level": str(r.get("level", "")),
            "ue_id": str(r.get("ue_id", "")),
            "src": str(r.get("src", "")),
            "dst": str(r.get("dst", "")),
            "success_rate": float(r.get("success_rate", 1.0)),
        }
        for r in kpi_rows
    ]


def _group_by_level(rows: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[r["level"]].append(r)
    return dict(groups)


async def analyze_kpi_anomalies(
    kpi_rows: list[dict], level: str = "all", threshold: float = 0.995
) -> str:
    rows = _parse_kpi_rows(kpi_rows)
    grouped = _group_by_level(rows)
    result: dict[str, Any] = {}

    levels = ["link", "trace", "session"] if level == "all" else [level]

    for lv in levels:
        lv_rows = grouped.get(lv, [])
        anomalies = [r for r in lv_rows if r["success_rate"] < threshold]

        if lv == "link":
            by_pair: dict[str, list] = defaultdict(list)
            for a in anomalies:
                key = f"{a['src']}->{a['dst']}"
                by_pair[key].append(a)
            result[lv] = {
                "total_entries": len(lv_rows),
                "anomaly_count": len(anomalies),
                "anomaly_ratio": len(anomalies) / max(len(lv_rows), 1),
                "degraded_pairs": {
                    k: {
                        "count": len(v),
                        "min_sr": min(x["success_rate"] for x in v),
                        "avg_sr": round(sum(x["success_rate"] for x in v) / len(v), 4),
                        "timestamps": [x["timestamp"] for x in v],
                    }
                    for k, v in by_pair.items()
                },
            }
        elif lv == "trace":
            by_pair2: dict[str, list] = defaultdict(list)
            for a in anomalies:
                key = f"{a['src']}->{a['dst']}"
                by_pair2[key].append(a)
            result[lv] = {
                "total_entries": len(lv_rows),
                "anomaly_count": len(anomalies),
                "degraded_pairs": {
                    k: {"count": len(v), "min_sr": min(x["success_rate"] for x in v)}
                    for k, v in by_pair2.items()
                },
            }
        else:
            by_ue: dict[str, list] = defaultdict(list)
            for a in anomalies:
                by_ue[a["ue_id"]].append(a)
            result[lv] = {
                "total_entries": len(lv_rows),
                "anomaly_count": len(anomalies),
                "degraded_ues": len(by_ue),
                "by_ue": {
                    k: {"count": len(v), "min_sr": min(x["success_rate"] for x in v)}
                    for k, v in by_ue.items()
                },
            }

    return json.dumps(result, ensure_ascii=False, indent=2)


async def find_common_ne(degraded_pairs: list[str]) -> str:
    ne_count: dict[str, int] = defaultdict(int)
    for pair in degraded_pairs:
        parts = pair.split("->")
        if len(parts) == 2:
            ne_count[parts[0]] += 1
            ne_count[parts[1]] += 1

    sorted_nes = sorted(ne_count.items(), key=lambda x: -x[1])
    total_pairs = len(degraded_pairs)

    result = {
        "total_degraded_pairs": total_pairs,
        "ne_frequency": [
            {"ne_id": ne, "count": cnt, "ratio": round(cnt / max(total_pairs * 2, 1), 4)}
            for ne, cnt in sorted_nes
        ],
        "top_ne": sorted_nes[0][0] if sorted_nes else None,
        "top_ratio": round(sorted_nes[0][1] / max(total_pairs * 2, 1), 4) if sorted_nes else 0,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


def degradation_exclusivity(link_rows: list[dict], ne_id: str,
                            threshold: float = 0.995) -> tuple[float, int]:
    """候选 NE 的「全路径退化独占率」= 该 NE 涉及的退化链路 / 该 NE 涉及的全部链路。

    均质化比较原则的通用实现:真根因 NE 的**所有**路径都退化(独占率→1.0);
    「共享链路的对端」(如退化路径上仅剩的 SMF/AMF)只有到根因的路径退化,
    到其它 NF 的路径健康(独占率低)。用于退化链路端点计数并列时区分根因
    与受害者(workflow 引擎 / 确定性诊断器 / 探索器共用)。
    """
    involved = [r for r in link_rows
                if str(r.get("src", "")) == ne_id or str(r.get("dst", "")) == ne_id]
    if not involved:
        return 0.0, 0
    degraded = [r for r in involved if float(r.get("success_rate", 1.0)) < threshold]
    return len(degraded) / len(involved), len(involved)


async def get_kpi_summary(kpi_rows: list[dict]) -> str:
    rows = _parse_kpi_rows(kpi_rows)
    grouped = _group_by_level(rows)
    result = {}
    for lv, lv_rows in grouped.items():
        rates = [r["success_rate"] for r in lv_rows]
        result[lv] = {
            "count": len(rates),
            "min": round(min(rates), 4) if rates else 1.0,
            "max": round(max(rates), 4) if rates else 1.0,
            "mean": round(sum(rates) / len(rates), 4) if rates else 1.0,
            "below_099": sum(1 for r in rates if r < 0.99),
        }
    return json.dumps(result, ensure_ascii=False, indent=2)


# Register tools with handlers (after function definitions)
register(
    name="analyze_kpi_anomalies",
    description="Analyze KPI data to find anomalous entries below a threshold. Returns grouped results by level (link/trace/session).",
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "Array of KPI data rows",
                "items": {"type": "object"},
            },
            "level": {
                "type": "string",
                "description": "KPI level: 'link', 'trace', 'session', or 'all'",
                "default": "all",
            },
            "threshold": {
                "type": "number",
                "description": "Success rate threshold for anomaly detection",
                "default": 0.995,
            },
        },
        "required": ["kpi_rows"],
    },
    handler=analyze_kpi_anomalies,
)

register(
    name="find_common_ne",
    description="Find network elements that appear most frequently in degraded link pairs.",
    parameters={
        "type": "object",
        "properties": {
            "degraded_pairs": {
                "type": "array",
                "description": "List of degraded src->dst link pair strings",
                "items": {"type": "string"},
            },
        },
        "required": ["degraded_pairs"],
    },
    handler=find_common_ne,
)

register(
    name="get_kpi_summary",
    description="Get statistical summary of KPI data: min, max, mean success rates per level.",
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "Array of KPI data rows",
                "items": {"type": "object"},
            },
        },
        "required": ["kpi_rows"],
    },
    handler=get_kpi_summary,
)
