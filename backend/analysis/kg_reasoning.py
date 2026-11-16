"""图谱推理：查出每个突增原因码的产生场景，并沿传导关系区分“根因侧”与“传导侧”。"""
from __future__ import annotations

import pandas as pd

from ..knowledge import KnowledgeGraph


def reason(series: list[dict], kept: pd.DataFrame, kg: KnowledgeGraph, baseline_counts: dict[str, float] | None = None) -> dict:
    """baseline_counts：各维度在突增期内按基线应有的条数，用于把解释比例折算到增量上。"""
    baseline_counts = baseline_counts or {}
    codes = sorted({s["cause"] for s in series})
    causes = []
    for code in codes:
        node = kg.cause(code)
        if node is None:
            causes.append({"code": code, "name": code, "known": False, "scenarios": [], "sources": [], "targets": []})
            continue
        scenarios = [{"id": sc["id"], "name": sc["name"], "category": sc["category"], "weight": sc["weight"],
                      "condition": sc["condition"], "signature": sc.get("signature", {}), "key": sc.get("key", []),
                      "locate": sc.get("locate", {}), "recovery": sc.get("recovery", "")}
                     for sc in kg.scenarios(code)]
        causes.append({
            "code": code, "name": node["name"], "known": True, "nf_type": node["nf_type"],
            "procedure": node["procedure"], "interface": node["interface"], "protocol": node["protocol"],
            "code_ref": node["code_ref"], "desc": node["desc"], "scenarios": scenarios,
            "sources": [c for c in kg.propagation_sources(code) if c in codes],
            "targets": [c for c in kg.propagation_targets(code) if c in codes],
            "text": _explain(node, scenarios),
        })
    by_code = {c["code"]: c for c in causes}

    # 逐维度判断是否为传导结果：其记录中有多大比例能在用户业务流里找到下游原因码
    roles, chains = {}, []
    for s in series:
        sources = by_code[s["cause"]]["sources"]
        ratio, explained = 0.0, {}
        if sources:
            rec = kept[kept["series"] == s["key"]]
            up = rec["flow_upstream"]
            hit = up.map(lambda v: v.split(" ")[-1] in sources if v else False)
            increment = max(len(rec) - baseline_counts.get(s["key"], 0.0), 1.0)
            ratio = min(1.0, float(hit.sum()) / increment) if len(rec) else 0.0
            explained = up[hit].value_counts().head(5).to_dict()
        derived = bool(sources) and ratio >= 0.5
        roles[s["key"]] = "derived" if derived else "root"
        if sources:
            chains.append({"series": s["key"], "cause": s["cause"], "sources": sources,
                           "explained_ratio": round(ratio, 3), "derived": derived,
                           "explained_by": [{"upstream": k, "count": int(v)} for k, v in explained.items()]})

    nodes = [{"id": f"cause:{c['code']}", "type": "cause", "label": c["code"], "name": c["name"],
              "nf_type": c.get("nf_type", "")} for c in causes]
    edges, seen = [], set()
    for c in causes:
        for sc in c["scenarios"]:
            if sc["id"] not in seen:
                seen.add(sc["id"])
                nodes.append({"id": sc["id"], "type": "scenario", "label": sc["name"], "category": sc["category"]})
            edges.append({"source": f"cause:{c['code']}", "target": sc["id"], "relation": "CAUSED_BY", "weight": sc["weight"]})
        for t in c["targets"]:
            edges.append({"source": f"cause:{c['code']}", "target": f"cause:{t}", "relation": "PROPAGATES_TO"})
    return {"causes": causes, "roles": roles, "chains": chains, "graph": {"nodes": nodes, "edges": edges}}


def _explain(node: dict, scenarios: list[dict]) -> str:
    parts = [f"{i + 1}) {sc['name']}（{sc['condition']}）" for i, sc in enumerate(scenarios)]
    return (f"{node['code']} {node['name']}：产生于 {node['nf_type']} 的{node['procedure']}流程，"
            f"接口 {node['interface']}。可能场景：" + "；".join(parts))
