"""异常特征聚类（聚集性 / 显著性分析）。

粒度：网元实例 + 流程 + 原因码。对每个持续突增的维度，分别在
用户、基站、小区、区域、POD、对端网元、本端网元 上计算聚集度。

聚集度（思路同 Adtributor 的增量归因）：
  1. 只看“增量”：w_v = max(0, 突增期计数 A_v - 按时长折算的基线计数 F_v)，
     这样一直存在的底噪不会稀释或伪造聚集。
  2. 取增量最大的前 k 个值组成集合 S（k <= cluster_max_set），覆盖率 p = sum(w_S) / sum(w)。
  3. 期望占比 q：S 在正常流量（窗口内最早突增之前的同类网元 CHR）中的占比；样本不足时按取值个数均分。
  4. 聚集度 c = (p - q) / (1 - q)，对 k 取最大。两个实例各占一半时 c≈0，全部落在一个实例时 c≈1。
  5. 显著性：z = (p - q) / sqrt(q(1-q)/n)，z 不足或样本过少不评级。

若在该粒度上所有维度都不聚集，则下钻到“+用户”粒度：把每条 CHR 关联到该用户的业务流，
用业务流途经的网元作为维度再分析一次。
"""
from __future__ import annotations

import math

import pandas as pd

from ..config import DIM_LABELS, Settings
from ..knowledge import KnowledgeGraph
from ..topology import Topology, nf_type

BASE_DIMS = {"user": "imsi", "ran": "ran", "cell": "cell", "tac": "tac", "pod": "pod"}
GRADE_ORDER = {"high": 3, "mid": 2, "low": 1, "none": 0}


def _grade(score: float, z: float, n: int, s: Settings) -> str:
    if n < 10 or z < s.cluster_min_z:
        return "none"
    if score >= s.cluster_high:
        return "high"
    if score >= s.cluster_mid:
        return "mid"
    return "low" if score >= 0.3 else "none"


def _concentration(actual: pd.Series, baseline: pd.Series, scale: float, ref: pd.Series | None,
                   domain_size: int, s: Settings, fixed: str | None = None, total_n: int | None = None) -> dict:
    """actual/baseline：按取值的计数；ref：正常流量中按取值的计数（可为空）。"""
    w = actual.astype(float).sub(baseline.astype(float) * scale, fill_value=0.0).clip(lower=0.0)
    w = w[w > 0].sort_values(ascending=False)
    n = int(total_n if total_n is not None else actual.sum())
    total_w = float(w.sum()) if total_n is None else float(total_n)   # total_n：分母含未取到该维度值的记录
    if total_w <= 0 or n == 0:
        return {"score": 0.0, "coverage": 0.0, "expected": 0.0, "z": 0.0, "grade": "none", "set": [], "values": [], "n": n}

    use_ref = ref is not None and ref.sum() >= s.min_ref_samples

    def expected(values: list[str]) -> float:
        if use_ref:
            k = len(set(ref.index) | set(values))
            return float((ref.reindex(values).fillna(0).sum() + 0.5 * len(values)) / (ref.sum() + 0.5 * k))
        return min(1.0, len(values) / max(domain_size, len(values), 1))

    best = None
    candidates = [[fixed]] if fixed else [list(w.index[:k]) for k in range(1, min(s.cluster_max_set, len(w)) + 1)]
    for values in candidates:
        p = float(w.reindex(values).fillna(0).sum() / total_w)
        q = expected(values)
        c = max(0.0, (p - q) / (1 - q)) if q < 0.999 else 0.0
        if best is None or c > best["score"] + 1e-9:
            z = (p - q) / math.sqrt(max(q * (1 - q), 1e-6) / n)
            best = {"score": round(c, 3), "coverage": round(p, 3), "expected": round(q, 3), "z": round(z, 1), "set": values}
    best["grade"] = _grade(best["score"], best["z"], n, s)
    best["values"] = [{"value": v, "share": round(float(x / total_w), 3), "count": int(actual.get(v, 0))}
                      for v, x in w.head(5).items()]
    best["n"] = n
    return best


def analyze(window: pd.DataFrame, kept: pd.DataFrame, onsets: dict[str, int], minute: int,
            topo: Topology, kg: KnowledgeGraph, s: Settings) -> dict:
    """window：滑窗内全部 CHR；kept：降噪后（含业务流标注）；onsets：series -> 突增起始分钟。"""
    w_start = int(window["minute"].min())
    first_onset = min(onsets.values()) if onsets else w_start
    noise = window[window["minute"] < first_onset]      # 正常流量：最早突增之前的窗口数据
    series_out = []

    for key, onset in sorted(onsets.items(), key=lambda kv: kv[0]):
        rec = kept[kept["series"] == key]
        if rec.empty:
            continue
        instance, procedure, cause = key.split("|")
        nft = nf_type(instance)
        base = window[(window["series"] == key) & (window["minute"] < onset)]
        t_anom, t_base = minute - onset + 1, max(onset - w_start, 0)
        scale = t_anom / t_base if t_base else 0.0

        dims = []
        columns = dict(BASE_DIMS)
        for col in [c for c in rec.columns if c.startswith("peer_")]:
            if col != f"peer_{nft.lower()}" and (rec[col] != "").mean() >= 0.5:
                columns[col] = col
        for dim, col in columns.items():
            vals = rec[col][rec[col] != ""]
            if vals.empty:
                continue
            ref_src = noise[(noise["instance"] == instance)] if dim == "pod" else noise[noise["nf_type"] == nft]
            same_proc = ref_src[ref_src["procedure"] == procedure]
            ref_rows = same_proc if (same_proc[col] != "").sum() >= s.min_ref_samples else ref_src
            ref = ref_rows[col][ref_rows[col] != ""].value_counts()
            if dim.startswith("peer_"):
                domain = len(topo.by_type.get(dim[5:].upper(), [])) or 2
            else:
                domain = max(int(window[col][window[col] != ""].nunique()), 2)
            res = _concentration(vals.value_counts(), base[col][base[col] != ""].value_counts(), scale, ref, domain, s)
            dims.append({"dim": dim, "label": DIM_LABELS.get(dim, dim), **res})

        # 本端网元：同一流程+原因码在同类各实例间的增量分布
        same = window[(window["procedure"] == procedure) & (window["cause"] == cause) & (window["nf_type"] == nft)]
        ref_inst = noise[noise["nf_type"] == nft]["instance"].value_counts()
        res = _concentration(same[same["minute"] >= onset]["instance"].value_counts(),
                             same[same["minute"] < onset]["instance"].value_counts(), scale,
                             ref_inst, len(topo.by_type.get(nft, [])) or 2, s, fixed=instance)
        dims.append({"dim": "local", "label": DIM_LABELS["local"], **res})

        clustered = any(d["grade"] in ("high", "mid") for d in dims)
        fallback = None
        if not clustered:
            fallback = _user_level(rec, topo, s)
        all_dims = dims + (fallback["dims"] if fallback else [])
        top = max(all_dims, key=lambda d: (GRADE_ORDER[d["grade"]], d["score"]))
        # 分数接近时优先展示非本端维度（本端聚集对该粒度而言信息量较低）
        near = [d for d in all_dims if d["grade"] == top["grade"] and d["score"] >= top["score"] - 0.05]
        best = max(near, key=lambda d: (d["dim"] != "local", d["score"]))
        series_out.append({
            "key": key, "instance": instance, "nf_type": nft, "procedure": procedure, "cause": cause,
            "cause_name": kg.cause_name(cause), "count": int(len(rec)), "onset": int(onset),
            "dims": dims, "fallback": fallback,
            "best": {"dim": best["dim"], "label": best["label"], "set": best["set"], "score": best["score"], "grade": best["grade"]},
            "grade": best["grade"],
        })

    # 散点：x=原因码在 网元实例+流程 内的占比，y=该 网元实例+流程 的 CHR 总数（突增期）
    period = window[window["minute"] >= first_onset]
    grade_by_key = {x["key"]: x["grade"] for x in series_out}
    group_total = period.groupby(["instance", "procedure"]).size()
    points, groups = [], {}
    for (inst, proc, cause), n in period.groupby(["instance", "procedure", "cause"]).size().items():
        total = int(group_total[(inst, proc)])
        key = f"{inst}|{proc}|{cause}"
        points.append({"key": key, "instance": inst, "procedure": proc, "cause": cause, "cause_name": kg.cause_name(cause),
                       "count": int(n), "group_total": total, "share": round(n / total, 3),
                       "anomalous": key in onsets, "grade": grade_by_key.get(key, "noise")})
        groups.setdefault(f"{inst}|{proc}", []).append({"cause": cause, "name": kg.cause_name(cause), "count": int(n),
                                                        "anomalous": key in onsets})
    for g in groups.values():
        g.sort(key=lambda x: -x["count"])
    return {"series": series_out, "points": points, "groups": groups,
            "period": {"from_minute": int(first_onset), "to_minute": int(minute)},
            "thresholds": {"high": s.cluster_high, "mid": s.cluster_mid}}


def _user_level(rec: pd.DataFrame, topo: Topology, s: Settings) -> dict:
    """下钻到 +用户 粒度：以用户业务流途经的网元为维度。未关联到业务流的记录计入分母。"""
    own = rec["nf_type"].iloc[0]
    dims = []
    for dim, col, t in (("flow_smf", "flow_smf", "SMF"), ("flow_amf", "flow_amf", "AMF")):
        if t == own or col not in rec:
            continue
        vals = rec[col][rec[col] != ""]
        if vals.empty:
            continue
        res = _concentration(vals.value_counts(), pd.Series(dtype=float), 0.0, None,
                             len(topo.by_type.get(t, [])) or 2, s, total_n=len(rec))
        dims.append({"dim": dim, "label": DIM_LABELS[dim], **res})
    linked = int((rec.get("flow_upstream", "") != "").sum())
    return {"reason": "网元实例+流程+原因码粒度未发现聚集，下钻至用户粒度并关联用户业务流",
            "users": int(rec["imsi"].nunique()), "linked_records": linked,
            "linked_ratio": round(linked / len(rec), 3), "dims": dims}
