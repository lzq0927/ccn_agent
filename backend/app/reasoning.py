from __future__ import annotations

from collections import Counter
import json


def load_graph(path):
    graph = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(graph.get("codes"), list) or not isinstance(graph.get("scenarios"), list):
        raise ValueError("Knowledge graph requires codes and scenarios arrays")
    ids = {scenario["id"] for scenario in graph["scenarios"]}
    facts = graph.get("facts", {})
    if len(ids) != len(graph["scenarios"]):
        raise ValueError("Duplicate scenario IDs")
    for code in graph["codes"]:
        if not set(code["scenarios"]) <= ids:
            raise ValueError("Knowledge graph contains an unknown scenario reference")
        if not set(code.get("signals", [])) <= set(facts):
            raise ValueError("Knowledge graph contains an unknown signal reference")
    for scenario in graph["scenarios"]:
        if not set(scenario["requirements"]) <= set(facts) or not set(scenario["critical"]) <= set(scenario["requirements"]):
            raise ValueError("Knowledge graph contains an unknown fact or invalid critical requirement")
    return graph


def cross_validate(retained, clusters, flows, graph, topology):
    if not retained:
        return {"status": "not_triggered", "hypotheses": [], "conclusion": None, "slow_reasoning": None,
                "unknown_codes": [], "graph_version": graph["version"]}
    code_map = {code["id"]: code for code in graph["codes"]}
    unknown = sorted({r.cause for r in retained} - set(code_map))
    hypotheses = []
    for nf in sorted({r.nf for r in retained}):
        records = [r for r in retained if r.nf == nf]
        codes = {r.cause for r in records}
        signals = {signal for code in codes if code in code_map for signal in code_map[code].get("signals", [])}
        significant = [feature for group in clusters["groups"] if group["nf"] == nf for feature in group["features"] if feature["severity"] in ("strong", "significant")]
        pod_counts = Counter(r.pod for r in records)
        peer_counts = Counter(r.peer for r in records if r.peer)
        # Do not paint low-rate incidental timeouts as affected paths.
        supported_peers = sorted(peer for peer, count in peer_counts.items() if count >= max(5, sum(peer_counts.values()) * .1))
        main_pod = pod_counts.most_common(1)[0][0]
        peak_peer = peer_counts.most_common(1)[0][0] if peer_counts else ""
        nf_flows = [f for f in flows["rows"] if f["confirmed_path"] and f["steps"][0]["nf"] == nf]
        facts = {
            "source_enrichment": any(f["dimension"] == "nf" and f["value"] == nf for f in significant),
            "pod_enrichment": any(f["dimension"] == "pod" and f["value"] == main_pod for f in significant),
            "diverse_subscribers": len({r.imsi for r in records}) >= 20 and len({r.ran for r in records}) >= 8 and len({r.region for r in records if r.region}) >= 3,
            "multiple_peer_types": len({peer.split(":")[0] for peer in supported_peers}) >= 2,
            "path_propagation": len(nf_flows) >= 5,
            "retransmission_signal": "retransmission_signal" in signals,
            "resource_signal": "resource_signal" in signals,
            "both_pods": sum(n >= 10 for n in pod_counts.values()) >= 2 and not any(f["dimension"] == "pod" for f in significant),
            "peer_concentration": bool(peer_counts) and max(peer_counts.values()) / sum(peer_counts.values()) >= .8,
            "multiple_sources": bool(peak_peer) and len({r.nf for r in retained if r.peer == peak_peer}) >= 2,
            "configuration_signal": "configuration_signal" in signals,
            "subscriber_enrichment": any(f["dimension"] == "imsi" for f in significant) or any(f["significant"] for f in clusters["fallback"] if f["group_id"].startswith(nf + "|")),
        }
        supported_scenarios = {scenario for code in codes if code in code_map for scenario in code_map[code]["scenarios"]}
        for scenario in graph["scenarios"]:
            if scenario["id"] not in supported_scenarios or nf.split(":")[0] not in scenario["applies_to"]:
                continue
            evidence = [{"id": fact, "label": graph["facts"][fact], "matched": facts.get(fact, False)} for fact in scenario["requirements"]]
            score = sum(item["matched"] for item in evidence) / len(evidence)
            critical_ok = all(facts.get(fact, False) for fact in scenario["critical"])
            hypotheses.append({"id": f"{nf}|{scenario['id']}", "scenario_id": scenario["id"], "nf": nf,
                               "title": scenario["title"], "score": round(score, 3), "eligible": critical_ok and score >= .8,
                               "evidence": evidence, "supporting_codes": sorted(code for code in codes if code in code_map and scenario["id"] in code_map[code]["scenarios"]),
                               "explanation": scenario["explanation"], "limitations": scenario["limitations"],
                               "pod": main_pod, "peers": supported_peers, "peer_counts": dict(peer_counts), "recovery_kind": scenario["recovery_kind"],
                               "affected_users": len({r.imsi for r in records}), "correlated_flows": len(nf_flows)})
    hypotheses.sort(key=lambda h: (-h["score"], h["nf"], h["scenario_id"]))
    eligible = [h for h in hypotheses if h["eligible"]]
    best = eligible[0] if eligible else None
    # All matching hypotheses, not just the first, must be considered. Ties go to slow reasoning.
    unique = len(eligible) == 1 and not any(h["id"] != best["id"] and h["score"] >= best["score"] - .12 for h in hypotheses) if best else False
    if unique and not unknown:
        result = {"status": "resolved", "hypotheses": hypotheses, "unknown_codes": unknown, "graph_version": graph["version"], "slow_reasoning": None}
        result["conclusion"] = {**best, "summary": f"{best['nf']} {best['title']}（CHR 证据推断）",
                                "confidence_label": "高证据一致性", "score_label": "规则证据覆盖率，非校准概率",
                                "recovery": recovery(best, retained, topology)}
        return result
    reason = "存在未映射原因码" if unknown else "多个候选同样匹配或证据接近" if len(eligible) > 1 or best else "聚集性与图谱未形成充分且唯一的匹配"
    return {"status": "slow_reasoning", "hypotheses": hypotheses, "unknown_codes": unknown, "graph_version": graph["version"], "conclusion": None,
            "slow_reasoning": {"status": "awaiting_adapter", "reason": reason,
                               "message": "慢推理 Agent / 工具适配器尚未接入；以下为待办计划，没有执行探测。",
                               "tasks": [{"tool": "user_trace", "action": "对代表性异常用户关联完整信令与时间线", "status": "not_executed"},
                                         {"tool": "colored_probe", "action": "从候选 POD 对后端双实例进行染色拨测，比较丢包和时延", "status": "not_executed"},
                                         {"tool": "configuration_diff", "action": "检查故障前后的路由、策略及配置差异", "status": "not_executed"}],
                               "recommendation": "保留当前配置，补齐上述证据后重新交叉验证。"}}


def recovery(conclusion, retained, topology):
    source = conclusion["nf"]
    adjacency = {}
    for edge in topology["edges"]:
        adjacency.setdefault(edge["source"], set()).add(edge["target"])
        adjacency.setdefault(edge["target"], set()).add(edge["source"])
    impacted = {r.nf for r in retained}
    alternatives = [node["id"] for node in topology["nodes"] if node["type"] == source.split(":")[0] and node["id"] != source and node["id"] not in impacted]
    peers = conclusion["peers"]
    alternatives = [nf for nf in alternatives if all(peer in adjacency.get(nf, set()) for peer in peers)]
    if conclusion["recovery_kind"] == "rollback":
        return {"kind": "rollback", "status": "proposal_only", "alternative": None, "paths": [],
                "steps": [f"比对 {source} 故障前后 DNN/策略配置差异。", "修正已验证的错误字段，或回退至最近一个已验证正常版本；保留当前版本用于反向回退。", "以小流量验证相关流程恢复，再逐步放量。"],
                "preconditions": ["必须取得配置差异和已验证版本，当前 CHR 数据不包含这些信息。"]}
    alternate = alternatives[0] if alternatives else None
    paths = []
    if alternate:
        upstreams = sorted({r.paths.get("AMF") for r in retained if r.nf == source and r.paths.get("AMF")})
        paths = [[up, alternate, peer] for up in upstreams if alternate in adjacency.get(up, set()) for peer in peers]
    return {"kind": "reroute", "status": "proposal_only", "alternative": alternate, "paths": paths,
            "steps": ([f"将 {source} / {conclusion['pod']} 的受影响后端路径从新会话选择中摘除。",
                       f"新建会话优先经 {alternate} 到达 {', '.join(peers)}；已有会话按会话连续性策略排空，不直接搬迁。",
                       "修复故障路径后用染色拨测确认；逐步恢复流量，持续观察至少 15 分钟 CHR 回归基线。"] if alternate else
                      ["拓扑中没有找到满足条件的替代实例，保持现有业务并进入人工路径核查。"]),
            "preconditions": ["候选替代路径在拓扑中可达、当前滑窗未检出同类异常；这不等于已验证健康。",
                              "决策模块执行前必须核验实时可达性、容量、会话亲和及路由策略。"]}
