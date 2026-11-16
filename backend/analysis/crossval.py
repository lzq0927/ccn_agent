"""交叉验证：特征聚类结果 × 图谱场景特征。

图谱中每个场景带有“应呈现的聚集特征”（signature），例如
  链路丢包      ：本端网元聚集 + 对端网元聚集，用户/基站/POD 不聚集
  对端网元过载  ：对端网元聚集，本端网元不聚集（所有本端实例都会受影响）
  单 POD 异常   ：本端网元聚集 + POD 聚集
聚类结果中往往有多个维度同时聚集（如本端与对端都高），由场景特征来判别到底是哪一种。

判定：关键维度全部满足且无矛盾 -> 场景匹配。根因侧各维度的匹配场景归并后，
唯一 -> 输出结论；没有匹配或存在多个 -> 转慢推理。
"""
from __future__ import annotations

from ..config import DIM_LABELS, Settings

HIGH, LOW = 0.6, 0.4          # 观测聚集度 >=HIGH 视为聚集，<LOW 视为不聚集，中间为不确定
SIG_LABELS = {"local": "本端网元", "peer": "对端网元", "pod": "POD", "user": "用户", "ran": "基站/小区/区域"}


def _observed(series: dict, sig_dim: str, scenario: dict) -> tuple[float | None, list[str]]:
    dims = {d["dim"]: d for d in series["dims"]}
    if sig_dim == "ran":
        cand = [dims[k] for k in ("ran", "cell", "tac") if k in dims]
        if not cand:
            return None, []
        best = max(cand, key=lambda d: d["score"])
        return best["score"], best["set"]
    name = {"local": "local", "pod": "pod", "user": "user"}.get(sig_dim)
    if sig_dim == "peer":
        peer_type = scenario.get("locate", {}).get("peer_type", "")
        name = f"peer_{peer_type.lower()}"
    d = dims.get(name)
    return (d["score"], d["set"]) if d else (None, [])


def evaluate_scenario(series: dict, scenario: dict) -> dict:
    checks, num, den, matched = [], 0.0, 0.0, True
    for sig_dim, expect in scenario.get("signature", {}).items():
        observed, values = _observed(series, sig_dim, scenario)
        is_key = sig_dim in scenario.get("key", [])
        if observed is None:
            ok, satisfied = (None, 0.0)
            if is_key:
                matched = False
                den += 3
        else:
            ok = observed >= HIGH if expect == "high" else observed < LOW
            satisfied = observed if expect == "high" else 1 - observed
            weight = 3 if is_key else 1
            num += weight * satisfied
            den += weight
            if not ok and (is_key or (expect == "low" and observed >= HIGH)):
                matched = False
        label = SIG_LABELS[sig_dim]
        if sig_dim == "peer":
            label = DIM_LABELS.get(f"peer_{scenario.get('locate', {}).get('peer_type', '').lower()}", label)
        checks.append({"dim": sig_dim, "label": label, "expect": expect, "observed": observed,
                       "values": values, "pass": ok, "key": is_key})
    if scenario["category"] == "propagated":
        matched = False       # 传导类场景由业务流链路判定，根因侧维度不适用
    match_score = num / den if den else 0.0
    return {"scenario_id": scenario["id"], "name": scenario["name"], "category": scenario["category"],
            "prior": scenario["weight"], "condition": scenario["condition"], "locate": scenario.get("locate", {}),
            "recovery": scenario.get("recovery", ""), "checks": checks, "matched": matched,
            "match_score": round(match_score, 3), "score": round(0.85 * match_score + 0.15 * scenario["weight"], 3)}


def cross_validate(clustering: dict, kg_result: dict, s: Settings) -> dict:
    causes = {c["code"]: c for c in kg_result["causes"]}
    roles = kg_result["roles"]
    items, derived = [], []
    for series in clustering["series"]:
        if roles.get(series["key"]) == "derived":
            chain = next(c for c in kg_result["chains"] if c["series"] == series["key"])
            derived.append({"series": series["key"], "instance": series["instance"], "procedure": series["procedure"],
                            "cause": series["cause"], "cause_name": series["cause_name"],
                            "explained_ratio": chain["explained_ratio"], "explained_by": chain["explained_by"]})
            continue
        cands = sorted((evaluate_scenario(series, sc) for sc in causes[series["cause"]]["scenarios"]),
                       key=lambda c: (-int(c["matched"]), -c["score"]))
        matched = [c for c in cands if c["matched"]]
        if not matched:
            verdict = "none"
        elif len(matched) == 1 or matched[0]["score"] - matched[1]["score"] >= s.match_margin:
            verdict = "unique"
        else:
            verdict = "ambiguous"
        hints = [{"label": d["label"], "set": d["set"], "score": d["score"], "grade": d["grade"]}
                 for d in sorted(series["dims"], key=lambda d: -d["score"]) if d["grade"] in ("high", "mid")]
        items.append({"series": series["key"], "instance": series["instance"], "procedure": series["procedure"],
                      "cause": series["cause"], "cause_name": series["cause_name"], "cluster_hints": hints,
                      "candidates": cands, "verdict": verdict, "best": matched[0] if verdict == "unique" else None})

    # 归并：同一本端网元上的同类故障合并为一个结论
    merged: dict[tuple, dict] = {}
    for it in items:
        if it["verdict"] != "unique":
            continue
        best = it["best"]
        mode = best["locate"].get("mode", best["category"])
        peer_check = next((c for c in best["checks"] if c["dim"] == "peer"), None)
        anchor = it["instance"] if best["category"] in ("link", "local_nf", "pod") else \
            (",".join(peer_check["values"]) if peer_check and best["category"] == "peer_nf" else best["scenario_id"])
        g = merged.setdefault((best["category"], mode, anchor),
                              {"category": best["category"], "mode": mode, "anchor": anchor, "links": {}, "series": [],
                               "scenarios": [], "scores": []})
        g["series"].append(it["series"])
        g["scores"].append(best["match_score"])
        if best["name"] not in g["scenarios"]:
            g["scenarios"].append(best["name"])
        if best["category"] == "link" and peer_check:
            for peer in peer_check["values"]:
                link = g["links"].setdefault(peer, {"source": it["instance"], "target": peer,
                                                    "interface": best["locate"].get("interface", ""),
                                                    "causes": [], "procedures": []})
                if it["cause"] not in link["causes"]:
                    link["causes"].append(it["cause"])
                if it["procedure"] not in link["procedures"]:
                    link["procedures"].append(it["procedure"])
    groups = [{**g, "links": sorted(g["links"].values(), key=lambda l: (-len(l["causes"]), l["interface"]))}
              for g in merged.values()]

    unresolved = [it["series"] for it in items if it["verdict"] != "unique"]
    if not items:
        decision, why = "slow_reasoning", "没有可用于判定的根因侧维度"
    elif unresolved:
        decision, why = "slow_reasoning", f"{len(unresolved)} 个维度的聚类结果无法与图谱场景唯一匹配"
    elif len(groups) != 1:
        decision, why = "slow_reasoning", f"匹配出 {len(groups)} 个相互独立的结论，无法确定单一根因"
    else:
        decision, why = "conclusion", "各根因侧维度的聚类结果与图谱场景唯一匹配，且归并为同一结论"
    return {"items": items, "derived": derived, "groups": groups, "decision": decision, "reason": why,
            "thresholds": {"high": HIGH, "low": LOW}}
