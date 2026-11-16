"""CHR 降噪：只保留“持续突增维度、自突增起始时刻之后”的 CHR。

持续突增维度 = 满足持续性判定的维度（触发告警）+ 告警触发时已连续突增 sustain_m-1 分钟的同期维度。
后者是为了不因个别维度晚一分钟达标而把同一故障的证据滤掉。

平时一直存在的 CHR（个别用户、配置、弱覆盖、网络抖动）以及瞬时毛刺都被视为噪声滤除，
留下的才是本次故障新产生的 CHR，交给分析阶段。
"""
from __future__ import annotations

import pandas as pd

from .anomaly import SpikeDetector


def denoise(window: pd.DataFrame, detector: SpikeDetector, minute: int) -> tuple[pd.DataFrame, dict]:
    series_in_window = window["series"].unique()
    trigger = [s for s in series_in_window if detector.sustained(s, minute)]
    co = [s for s in series_in_window if s not in trigger and detector.emerging(s, minute)] if trigger else []
    onsets = {s: detector.onset(s, minute) for s in trigger + co}
    lo = minute - detector.s.sustain_n + 1
    transient = [s for s in series_in_window if s not in onsets
                 and any(m >= window["minute"].min() for m in detector.flags.get(s, ()))]

    onset_col = window["series"].map(onsets)
    kept = window[onset_col.notna() & (window["minute"] >= onset_col.fillna(10**9))].copy()
    total = len(window)
    stats = {
        "total": total,
        "kept": len(kept),
        "filtered": total - len(kept),
        "filtered_pct": round(100 * (total - len(kept)) / total, 1) if total else 0.0,
        "n_series": int(len(series_in_window)),
        "n_anomalous": len(onsets),
        "n_trigger": len(trigger),
        "n_co": len(co),
        "n_transient": len(transient),
        "onsets": onsets,
        "transient": transient,
        "recent_from": lo,
    }
    return kept, stats


def pie_compare(window: pd.DataFrame, kept: pd.DataFrame, cause_names: dict[str, str], limit: int = 8) -> list[dict]:
    """按 网元实例+流程 粒度给出降噪前后的原因码分布。受影响的组排在前面。"""
    def dist(df):
        out = {}
        for (inst, proc), g in df.groupby(["instance", "procedure"]):
            vc = g["cause"].value_counts()
            out[(inst, proc)] = [{"cause": c, "name": cause_names.get(c, c), "count": int(n)} for c, n in vc.items()]
        return out

    before, after = dist(window), dist(kept)
    keys = sorted(before, key=lambda k: (-sum(x["count"] for x in after.get(k, [])),
                                         -sum(x["count"] for x in before[k])))
    groups = []
    for inst, proc in keys[:max(limit, len(after))]:
        b, a = before[(inst, proc)], after.get((inst, proc), [])
        groups.append({"instance": inst, "procedure": proc, "before": b, "after": a,
                       "before_total": sum(x["count"] for x in b), "after_total": sum(x["count"] for x in a)})
    return groups[:max(limit, len(after))]
