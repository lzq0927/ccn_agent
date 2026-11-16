"""结论生成：文字结论、关键证据、影响范围、恢复方案、拓扑标注、移交决策执行模块的载荷。"""
from __future__ import annotations

from ..config import NF_DEPTH
from ..topology import Topology, nf_type

CATEGORY_TITLE = {
    "peer_nf": "对端网元异常", "local_nf": "网元整体异常", "pod": "单 POD 异常",
    "user": "用户侧问题", "ran": "无线侧问题", "config": "配置问题",
}


def _pct(x: float) -> str:
    return f"{round(100 * x)}%"


def _dim(series: dict, name: str) -> dict | None:
    return next((d for d in series["dims"] if d["dim"] == name), None)


def build(ctx: dict) -> dict:
    """ctx：pipeline 汇总的各步结果（见 pipeline._analyze）。"""
    topo: Topology = ctx["topo"]
    cv, clustering, kg_result, flows = ctx["crossval"], ctx["clustering"], ctx["kg"], ctx["flows"]
    group = cv["groups"][0]
    by_key = {s["key"]: s for s in clustering["series"]}
    root_series = [by_key[k] for k in group["series"]]
    rates = ctx["rates"]
    hhmm = ctx["hhmm"]
    onset = min(s["onset"] for s in clustering["series"])
    local = group["anchor"]

    nodes = {n: {"role": "normal"} for n in topo.nodes}
    edges: list[dict] = []
    evidence: list[dict] = []
    steps: list[dict] = []
    actions: list[dict] = []
    procedures = sorted({s["procedure"] for s in clustering["series"]})
    impacted = sorted({d["instance"] for d in cv["derived"]})

    # ---- 证据 1：时序
    lead = max(root_series, key=lambda s: s["count"])
    r = rates[lead["key"]]
    evidence.append({
        "kind": "时序", "title": f"{hhmm(onset)} 起 {len(clustering['series'])} 个维度持续突增",
        "detail": f"{lead['instance']} · {lead['procedure']} · {lead['cause']}（{lead['cause_name']}）由基线 "
                  f"{r['baseline']:.1f} 条/分钟升至 {r['current']:.1f} 条/分钟；"
                  f"{hhmm(ctx['minute'] + 1)} 满足“{ctx['settings'].sustain_n} 分钟内 ≥{ctx['settings'].sustain_m} 分钟异常”触发分析。",
    })

    if group["category"] == "link":
        links = group["links"]
        peers = [l["target"] for l in links]
        backend = [n for n in topo.neighbors(local) if NF_DEPTH.get(nf_type(n), 1) > NF_DEPTH.get(nf_type(local), 1)]
        partial = len(peers) < len(backend)
        loss = group["mode"] == "packet_loss"
        symptom = "丢包" if loss else "中断"
        link_txt = "、".join(f"{l['target']}（{l['interface']}）" for l in links)
        title = f"{local} 后端{'部分' if partial else ''}链路{symptom}"
        summary = (f"{local} 后端至 {link_txt} 的链路{symptom}，经由这些链路的 "
                   f"{'、'.join(procedures)} 流程{'超时' if loss else ''}失败"
                   + (f"，并向 {'、'.join(impacted)} 传导" if impacted else "") + "。"
                   + (f"{local} 的其余后端链路未见异常。" if partial else ""))
        root = {"type": f"link_{group['mode']}", "ne": local, "links": links}

        nodes[local] = {"role": "root", "note": title}
        for l in links:
            nodes[l["target"]] = {"role": "link_peer", "note": f"{l['interface']} 链路对端，自身未见异常"}
            edges.append({"source": local, "target": l["target"], "role": "fault",
                          "label": f"{l['interface']} {symptom}"})

        # ---- 证据 2：聚集性（按故障链路合并）
        for l in links:
            group_series = [s for s in root_series if s["cause"] in l["causes"]]
            peer_dim = f"peer_{nf_type(l['target']).lower()}"
            loc = min(_dim(s, "local")["score"] for s in group_series)
            peer = min(_dim(s, peer_dim)["score"] for s in group_series)
            quiet = all(d["grade"] in ("none", "low") for s in group_series for d in s["dims"]
                        if d["dim"] in ("user", "ran", "cell", "tac", "pod"))
            evidence.append({
                "kind": "聚集性", "title": f"{'、'.join(l['causes'])} 的增量集中在 {local} 与 {l['target']}",
                "detail": f"涉及 {'、'.join(l['procedures'])}：本端网元聚集度 ≥{_pct(loc)}，"
                          f"对端 {nf_type(l['target'])} 聚集度 ≥{_pct(peer)}"
                          + ("；用户/基站/小区/区域/POD 维度均无聚集。" if quiet else "。"),
            })
        # ---- 证据 3：图谱
        codes = "、".join(sorted({s["cause"] for s in root_series}))
        evidence.append({
            "kind": "图谱", "title": "图谱场景与聚类特征唯一匹配",
            "detail": f"{codes} 在图谱中均存在“链路{symptom}/对端过载/对端故障/单POD异常”等多种产生场景；"
                      f"只有“{ '；'.join(group['scenarios']) }”同时满足本端聚集、对端聚集、POD 与用户不聚集。",
        })
        # ---- 证据 4：排除
        anomalous_instances = {s["instance"] for s in clustering["series"]}
        clean_peers = [p for p in peers if p not in anomalous_instances]
        others = [n for n in topo.by_type.get(nf_type(local), []) if n != local and n not in anomalous_instances]
        excl = []
        if clean_peers:
            excl.append(f"{'、'.join(clean_peers)} 自身无突增原因码" +
                        (f"，{'、'.join(others)} 经相同对端无突增，排除对端网元故障/过载" if others else ""))
        pods = [_dim(s, "pod") for s in root_series]
        if all(p and p["grade"] in ("none", "low") for p in pods):
            excl.append(f"{local} 各 POD 上的失败分布均匀，排除单 POD 异常")
        if loss:
            excl.append("原因码均为等待响应超时而非连接失败/心跳中断，符合丢包而非链路中断")
        if partial:
            healthy = [n for n in backend if n not in peers]
            excl.append(f"{local} 至 {'、'.join(healthy)} 的链路无突增，故障仅限部分链路")
        evidence.append({"kind": "排除", "title": "其它可能已排除", "detail": "；".join(excl) + "。"})

        # ---- 恢复方案：选可用路径
        for l in links:
            alts = [n for n in topo.neighbors(local, nf_type(l["target"])) if n not in peers]
            for a in alts:
                nodes[a] = {"role": "alternative", "note": f"可用路径：{local} → {a}"}
                edges.append({"source": local, "target": a, "role": "alternative", "label": "可用"})
            if alts:
                steps.append({"title": f"{l['interface']} 选路切换",
                              "detail": f"在 {local} 上将 {nf_type(l['target'])} 选路由 {l['target']} 切换到 {'、'.join(alts)}"
                                        f"（{local} → {alts[0]} 链路窗口内无突增，可用）。"})
                actions.append({"type": "reroute", "ne": local, "interface": l["interface"],
                                "avoid": l["target"], "prefer": alts})
        if others:
            steps.append({"title": "备选：降低网元选择权重",
                          "detail": f"若无法按对端调整选路，在 NRF/AMF 侧调低 {local} 的权重，新建会话优先由 {'、'.join(others)} 承载"
                                    f"（{'、'.join(others)} 无异常）。"})
            actions.append({"type": "deprioritize", "ne": local, "prefer": others, "optional": True})
        ifaces = "/".join(sorted({l["interface"] for l in links}))
        steps.append({"title": "修复与回切",
                      "detail": f"排查 {local} 后端 {ifaces} 承载网络（网卡、vSwitch、交换机端口的丢包/误码计数）；"
                                f"修复后恢复原选路，确认 {codes} 回落到基线。"})
        actions.append({"type": "inspect", "ne": local, "interfaces": sorted({l["interface"] for l in links}),
                        "peers": peers})
    else:
        title = f"{group['anchor']} {CATEGORY_TITLE.get(group['category'], group['category'])}"
        summary = f"匹配场景：{'；'.join(group['scenarios'])}。涉及流程：{'、'.join(procedures)}。"
        root = {"type": group["category"], "ne": group["anchor"], "links": []}
        if topo.has(group["anchor"]):
            nodes[group["anchor"]] = {"role": "root", "note": title}
        for s in root_series:
            evidence.append({"kind": "聚集性", "title": f"{s['cause']} 聚集于 {s['best']['label']}",
                             "detail": f"{s['best']['label']}聚集度 {_pct(s['best']['score'])}（{'、'.join(s['best']['set'])}）。"})
        rec = next((c["recovery"] for it in cv["items"] if it["best"] for c in [it["best"]] if c["recovery"]), "")
        if rec:
            steps.append({"title": "处理", "detail": rec + "。"})
            actions.append({"type": group["category"], "target": group["anchor"], "advice": rec})

    # ---- 证据 5：业务流 / 传导
    if cv["derived"]:
        d_txt = "；".join(f"{d['instance']} {d['cause']} 有 {_pct(d['explained_ratio'])} 可由下游失败解释" for d in cv["derived"])
        top = flows["patterns"][0] if flows["patterns"] else None
        evidence.append({
            "kind": "业务流", "title": "上游网元的失败是传导结果",
            "detail": (f"还原出 {flows['total_flows']} 条用户级失败路径，涉及 {flows['total_users']} 个用户，"
                       f"最多的路径为“{top['path']}”（{top['flows']} 条）。" if top else "") + d_txt + "。",
        })
        for d in cv["derived"]:
            if nodes[d["instance"]]["role"] == "normal":
                nodes[d["instance"]] = {"role": "impacted", "note": "失败由下游传导而来，自身未见异常"}
            if topo.has(local) and topo.connected(local, d["instance"]) and \
                    not any(e["role"] == "propagation" and e["target"] == d["instance"] for e in edges):
                edges.append({"source": local, "target": d["instance"], "role": "propagation", "label": "失败传导"})

    match = sum(group["scores"]) / len(group["scores"])
    explain = (sum(d["explained_ratio"] for d in cv["derived"]) / len(cv["derived"])) if cv["derived"] else 1.0
    confidence = round(0.7 * match + 0.3 * explain, 2)
    kept = ctx["kept"]
    detected = hhmm(ctx["minute"] + 1)
    return {
        "title": title, "summary": summary, "confidence": confidence, "definitive": True,
        "root": root, "onset": hhmm(onset), "detected_at": detected,
        "impact": {"procedures": procedures, "users": int(kept.loc[kept["imsi"] != "", "imsi"].nunique()),
                   "failures": int(len(kept)), "instances": impacted},
        "evidence": evidence,
        "recovery": {"definitive": True, "steps": steps},
        "topology": {"nodes": nodes, "edges": edges},
        "handoff": {
            "incident_id": f"INC-{ctx['t0'].strftime('%Y%m%d')}-{detected.replace(':', '')}",
            "detected_at": detected, "fault_onset": hhmm(onset), "root_cause": root, "title": title,
            "confidence": confidence, "actions": actions,
        },
    }
