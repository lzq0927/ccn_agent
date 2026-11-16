"""还原用户级业务流：把同一用户、同一流程、时间相邻的跨网元 CHR 串成一条失败路径。

路径按调用深度由后端向前端排列（先失败的在前），例如
    SMF SM-2101 -> AMF MM-1305
"""
from __future__ import annotations

import pandas as pd

from ..config import NF_DEPTH, Settings
from ..knowledge import KnowledgeGraph


def restore_flows(kept: pd.DataFrame, kg: KnowledgeGraph, settings: Settings) -> tuple[pd.DataFrame, list[dict], dict]:
    """返回 (带业务流标注的 kept, 业务流列表, 汇总)。

    kept 新增列：flow_id、flow_amf、flow_smf、flow_upstream（该记录下游一跳的 “实例 原因码”）。
    """
    kept = kept.copy()
    for col in ("flow_amf", "flow_smf", "flow_upstream"):
        kept[col] = ""
    kept["flow_id"] = -1
    flows: list[dict] = []
    gap = pd.Timedelta(seconds=settings.corr_window_s)

    with_user = kept[kept["imsi"] != ""].sort_values(["imsi", "procedure", "ts"])
    for (imsi, procedure), g in with_user.groupby(["imsi", "procedure"], sort=False):
        start = 0
        ts = g["ts"].to_list()
        for i in range(1, len(g) + 1):
            if i == len(g) or ts[i] - ts[i - 1] > gap:
                _add_flow(kept, flows, g.iloc[start:i], imsi, procedure)
                start = i

    patterns: dict[tuple, dict] = {}
    for f in flows:
        key = (f["procedure"], f["path"], f["smf_id"])
        p = patterns.setdefault(key, {"procedure": f["procedure"], "path": f["path"], "smf_id": f["smf_id"],
                                      "flows": 0, "users": set(), "amf_ids": set(), "hops": f["hops"]})
        p["flows"] += 1
        p["users"].add(f["imsi"])
        if f["amf_id"]:
            p["amf_ids"].add(f["amf_id"])
    pattern_list = sorted(
        ({**p, "users": len(p["users"]), "amf_ids": sorted(p["amf_ids"])} for p in patterns.values()),
        key=lambda p: -p["flows"])
    summary = {
        "total_flows": len(flows),
        "total_users": len({f["imsi"] for f in flows}),
        "multi_hop_flows": sum(1 for f in flows if len(f["hops"]) > 1),
        "records": len(kept),
        "records_without_user": int((kept["imsi"] == "").sum()),
        "patterns": pattern_list,
    }
    return kept, flows, summary


def _add_flow(kept: pd.DataFrame, flows: list[dict], g: pd.DataFrame, imsi: str, procedure: str) -> None:
    g = g.assign(depth=g["nf_type"].map(NF_DEPTH).fillna(1)).sort_values(["depth", "ts"], ascending=[False, True])
    hops, seen = [], set()
    for row in g.itertuples():
        key = (row.instance, row.cause)
        if key not in seen:
            seen.add(key)
            hops.append({"nf_type": row.nf_type, "instance": row.instance, "cause": row.cause})

    def find(nf: str) -> str:
        for h in hops:
            if h["nf_type"] == nf:
                return h["instance"]
        col = g[f"peer_{nf.lower()}"]
        col = col[col != ""]
        return col.iloc[0] if len(col) else ""

    amf_id, smf_id = find("AMF"), find("SMF")
    flow_id = len(flows)
    flows.append({
        "id": flow_id, "imsi": imsi, "procedure": procedure,
        "time": g["ts"].min().strftime("%H:%M:%S"),
        "path": " -> ".join(f"{h['nf_type']} {h['cause']}" for h in hops),
        "hops": hops, "amf_id": amf_id, "smf_id": smf_id,
    })
    kept.loc[g.index, "flow_id"] = flow_id
    kept.loc[g.index, "flow_amf"] = amf_id
    kept.loc[g.index, "flow_smf"] = smf_id
    # 每条记录的下游一跳（比自己更靠后端、最近的一跳）
    for row in g.itertuples():
        deeper = [h for h in hops if NF_DEPTH.get(h["nf_type"], 1) > row.depth]
        if deeper:
            kept.at[row.Index, "flow_upstream"] = f"{deeper[-1]['instance']} {deeper[-1]['cause']}"
