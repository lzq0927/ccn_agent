"""感知与分析引擎：按分钟推进，持续运行。

每分钟调用一次 process_minute(minute, 新到的原始 CHR)，产出事件流：
  step      工作流步骤状态   {stage, step, status: running|done|skipped}
  log       执行日志         {channel: system|agent, stage, time, level, text}
  tick      每分钟感知结果   {minute, time, window, total, n_series, trend_point, series, node_status, incident, ...}
  incident  故障生命周期     {event: opened|updated|recovered, incident}
  result    各步骤产出       {key: perception|flows|clustering|kg|crossval|agent|conclusion, data}
事件带 delay（秒）：建议的停顿，供上层控制前端步骤高亮的节奏。

故障生命周期：
  无故障时出现持续突增维度 -> 开启故障，执行降噪与分析，给出结论并移交；
  故障期间继续感知；出现新的突增维度且距上次分析超过 reanalyze_gap_min -> 重新分析；
  故障相关维度连续 recover_min 分钟回落到基线（每个维度至多 1 个孤立突增点）-> 判定恢复，关闭故障。
"""
from __future__ import annotations

from typing import Iterator

import pandas as pd

from .agent.slow_reasoning import SlowReasoningAgent
from .agent.tools import Tools
from .analysis import clustering as clustering_mod
from .analysis import conclusion as conclusion_mod
from .analysis import crossval as crossval_mod
from .analysis import kg_reasoning
from .analysis.flows import restore_flows
from .config import Settings
from .knowledge import KnowledgeGraph
from .perception.anomaly import SpikeDetector
from .perception.denoise import denoise, pie_compare
from .perception.preprocess import COLUMNS, preprocess
from .topology import Topology

PRE_KEYS = ("input", "output", "bad_timestamp", "missing_key", "unknown_instance", "duplicate", "normalized_instance")


class Engine:
    def __init__(self, settings: Settings, t0: pd.Timestamp, topo: Topology | None = None, kg: KnowledgeGraph | None = None):
        self.s = settings
        self.t0 = t0                                  # 分钟序号的起点
        self.topo = topo or Topology.load(settings.topo_file)
        self.kg = kg or KnowledgeGraph.load(settings.kg_file)
        self.cause_names = self.kg.cause_names()
        self.det = SpikeDetector(settings)
        self.buf = pd.DataFrame(columns=COLUMNS)
        self.pre_total = {k: 0 for k in PRE_KEYS}
        self.incident: dict | None = None
        self.history: list[dict] = []
        self.first_minute: int | None = None          # 引擎见到的第一分钟；更早的时间没有数据，不能当作 0 条参与基线
        self.gaps: set[int] = set()                   # 数据缺口：整分钟没有收到任何有效 CHR

    # ------------------------------------------------------------ 工具
    def hhmm(self, minute: int) -> str:
        return (self.t0 + pd.Timedelta(minutes=int(minute))).strftime("%H:%M")

    def _log(self, stage: str, minute: int, text: str, level: str = "info", channel: str = "system", delay: float = 0.04):
        return {"type": "log", "channel": channel, "stage": stage, "time": self.hhmm(minute), "level": level,
                "text": text, "delay": delay}

    @staticmethod
    def _step(stage: str, step: str, status: str, delay: float = 0.0):
        return {"type": "step", "stage": stage, "step": step, "status": status, "delay": delay}

    def public_incident(self) -> dict | None:
        inc = self.incident
        if inc is None:
            return None
        return {k: inc[k] for k in ("id", "status", "opened_at", "onset_label", "recovered_at", "title", "definitive")}

    def startup_events(self, minute: int, files: list[str]) -> list[dict]:
        return [
            self._log("系统", minute, f"已加载拓扑 {len(self.topo.nodes)} 个网元实例、知识图谱 {len(self.kg.nodes)} 个节点、"
                                     f"CHR 数据源 {len(files)} 个文件"),
            self._log("系统", minute, "慢推理 Agent 待命（仅在交叉验证无法得到唯一结论时启用）", channel="agent"),
        ]

    # ------------------------------------------------------------ 每分钟处理
    def _ingest(self, minute: int, chunk: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict, dict]:
        """预处理新到的 CHR、更新滑窗并评估最新一分钟。返回 (window, counts, 本批清洗统计, 最新一分钟各维度的检测点)。"""
        s = self.s
        clean, st = preprocess(chunk, self.topo, self.t0)
        clean = clean[clean["minute"] == minute] if len(clean) else clean       # 只接收属于本分钟的记录
        st["late"] = st["output"] - len(clean)
        st["output"] = len(clean)
        for k in PRE_KEYS:
            self.pre_total[k] += st[k]
        self.buf = pd.concat([self.buf, clean], ignore_index=True) if len(self.buf) else clean.reset_index(drop=True)
        self.buf = self.buf[self.buf["minute"] > minute - 2 * s.window_min].reset_index(drop=True)
        if self.first_minute is None:
            self.first_minute = minute
        w_start = max(self.first_minute, minute - s.window_min + 1)
        window = self.buf[(self.buf["minute"] >= w_start) & (self.buf["minute"] <= minute)]
        w_minutes = list(range(w_start, minute + 1))
        counts = (window.groupby(["series", "minute"]).size().unstack(fill_value=0)
                  .reindex(columns=w_minutes, fill_value=0))
        if len(clean) == 0:
            self.gaps.add(minute)
        self.gaps = {m for m in self.gaps if m > minute - 2 * s.window_min}
        points = self.det.update(counts, minute, self.gaps)
        self.det.prune(minute)
        return window, counts, st, points

    def warm(self, minute: int, chunk: pd.DataFrame) -> None:
        """启动时用已有的历史数据预热基线，不产生事件、不触发分析。"""
        self._ingest(minute, chunk)

    def process_minute(self, minute: int, chunk: pd.DataFrame) -> Iterator[dict]:
        s, det = self.s, self.det
        tick = minute + 1
        yield self._step("perception", "preprocess", "running", delay=0.12)
        window, counts, st, points = self._ingest(minute, chunk)
        yield self._step("perception", "preprocess", "done")

        yield self._step("perception", "denoise", "running")
        flagged = [k for k, p in points.items() if p.flagged]
        sustained = [k for k in counts.index if det.sustained(k, minute)]
        last = window[window["minute"] == minute]
        node_status = {n: {"count": 0, "flagged": 0, "sustained": 0} for n in self.topo.nodes}
        for inst, n in last["instance"].value_counts().items():
            node_status[inst]["count"] = int(n)
        for k in flagged:
            node_status[k.split("|")[0]]["flagged"] += 1
        for k in sustained:
            node_status[k.split("|")[0]]["sustained"] += 1

        if minute in self.gaps:
            yield self._log("感知", tick, "本分钟未收到任何 CHR，按数据缺口处理（不参与基线与判定），请检查数据源", "warn")
        # 只记录新出现的明显突增（同一维度连续突增不重复记录）
        known = self.incident["series"] if self.incident else set()
        fresh_spikes = [k for k in sorted(flagged, key=lambda k: -points[k].z)
                        if k not in sustained and k not in known and points[k].z >= 6 and len(det.recent_flags(k, minute)) == 1]
        if fresh_spikes:
            k, p = fresh_spikes[0], points[fresh_spikes[0]]
            more = f"等 {len(fresh_spikes)} 个维度同时" if len(fresh_spikes) > 1 else ""
            yield self._log("感知", tick, f"{k.replace('|', ' · ')} {more}出现突增（{int(p.value)} 条/分，基线 {p.baseline:.1f}），"
                                         "未达持续判定，继续观察", "warn")
        yield {
            "type": "tick", "minute": tick, "time": self.hhmm(tick),
            "window": {"from": self.hhmm(counts.columns[0]), "to": self.hhmm(tick)},
            "total": int(len(window)), "n_series": int(len(counts)),
            "n_flagged": len(flagged), "n_sustained": len(sustained),
            "trend_point": {"label": self.hhmm(minute), "total": int(len(last)),
                            "by_nf": {k: int(v) for k, v in last["nf_type"].value_counts().items()}},
            "series": self._pick_series(counts, minute),
            "node_status": node_status, "preprocess": dict(self.pre_total),
            "incident": self.public_incident(), "delay": 0.38,
        }

        inc = self.incident
        if inc is None:
            if sustained:
                yield self._log("感知", tick, f"发现异常：{len(sustained)} 个维度持续突增（{s.sustain_n} 分钟内 ≥{s.sustain_m} 分钟），"
                                             "启动降噪与分析", "alert", delay=0.5)
                yield from self._open(window, counts, minute)
            else:
                yield self._step("perception", "denoise", "done")
            return

        # ---- 故障进行中：恢复判定 / 范围变化
        # 恢复判定：故障相关的每个维度在最近 recover_min 分钟内至多 1 个突增点（容忍偶发的孤立突增）
        quiet_from = minute - s.recover_min
        if all(sum(m > quiet_from for m in det.flags.get(k, ())) <= 1 for k in inc["series"]):
            inc.update(status="recovered", recovered_at=self.hhmm(tick))
            yield self._step("perception", "denoise", "done")
            yield self._log("感知", tick, f"故障恢复：{inc['id']} 相关原因码已连续 {s.recover_min} 分钟回落到基线", "ok")
            yield {"type": "incident", "event": "recovered", "incident": self.public_incident(), "delay": 0.2}
            self.history.append(self.public_incident())
            self.incident = None
            return
        fresh = [k for k in sustained if k not in inc["series"]]
        if fresh and minute - inc["last_analysis"] >= s.reanalyze_gap_min:
            yield from self._reanalyze(window, counts, minute, fresh)
        else:
            yield self._step("perception", "denoise", "done")

    # ------------------------------------------------------------ 故障开启 / 重新分析
    def _open(self, window: pd.DataFrame, counts: pd.DataFrame, minute: int) -> Iterator[dict]:
        tick = minute + 1
        stamp = self.t0 + pd.Timedelta(minutes=tick)
        self.incident = {"id": f"INC-{stamp.strftime('%Y%m%d-%H%M')}", "status": "active", "opened_at": self.hhmm(tick),
                         "onset_label": self.hhmm(minute), "recovered_at": None, "title": "分析中", "definitive": None,
                         "series": set(), "last_analysis": minute}
        yield {"type": "incident", "event": "opened", "incident": self.public_incident(), "delay": 0}
        for ev in self._analyze(window, counts, minute):
            self._absorb(ev)
            yield ev
        yield {"type": "incident", "event": "updated", "incident": self.public_incident(), "delay": 0}

    def _reanalyze(self, window: pd.DataFrame, counts: pd.DataFrame, minute: int, fresh: list[str]) -> Iterator[dict]:
        tick = minute + 1
        inc = self.incident
        events = list(self._analyze(window, counts, minute))
        new = next(e["data"] for e in events if e["type"] == "result" and e["key"] == "conclusion")
        inc["last_analysis"] = minute
        if inc["definitive"] and not new["definitive"]:
            # 已有确切结论时，只接受新的确切结论
            inc["series"] |= set(fresh)
            yield self._step("perception", "denoise", "done")
            yield self._log("感知", tick, f"新增 {len(fresh)} 个突增维度，重新分析未得到更明确的结论，维持原结论", "warn")
            return
        yield self._log("感知", tick, f"故障范围变化：新增 {len(fresh)} 个突增维度，重新分析", "alert", delay=0.4)
        for ev in events:
            self._absorb(ev)
            yield ev
        yield {"type": "incident", "event": "updated", "incident": self.public_incident(), "delay": 0}

    def _absorb(self, ev: dict) -> None:
        """把分析产出同步到当前故障记录。"""
        if ev["type"] != "result":
            return
        if ev["key"] == "perception":
            self.incident["series"] |= {a["key"] for a in ev["data"]["anomalous"]}
        elif ev["key"] == "conclusion":
            self.incident.update(title=ev["data"]["title"], definitive=ev["data"]["definitive"])

    # ------------------------------------------------------------ 降噪 + 分析 + 结论
    def _analyze(self, window: pd.DataFrame, counts: pd.DataFrame, minute: int) -> Iterator[dict]:
        s, det = self.s, self.det
        tick = minute + 1
        inc = self.incident
        kept, dn = denoise(window, det, minute)
        onsets = dn.pop("onsets")
        transient = dn.pop("transient")
        charts = [self._series_chart(k, counts, minute) for k in sorted(onsets, key=lambda k: -counts.loc[k].iloc[-1])]
        charts += [self._series_chart(k, counts, minute) for k in sorted(transient, key=lambda k: -counts.loc[k].max())[:2]]
        steady = [k for k in counts.sum(axis=1).sort_values(ascending=False).index if k not in onsets and k not in transient]
        charts += [self._series_chart(k, counts, minute) for k in steady[:2]]
        perception = {
            "stats": dn, "window": {"from": self.hhmm(counts.columns[0]), "to": self.hhmm(tick)},
            "series": charts, "pies": pie_compare(window, kept, self.cause_names),
            "anomalous": [{"key": k, "onset": self.hhmm(v)} for k, v in sorted(onsets.items())],
        }
        yield self._log("感知", tick, f"降噪：{dn['n_series']} 个维度中 {dn['n_anomalous']} 个持续突增；"
                                     f"窗口 {dn['total']:,} 条 CHR 滤除 {dn['filtered_pct']}%，保留 {dn['kept']:,} 条", "ok")
        yield {"type": "result", "key": "perception", "data": perception, "delay": 0.2}
        yield self._step("perception", "denoise", "done", delay=0.9)

        # ---- 2.1 还原用户级业务流
        yield self._step("analysis", "flows", "running", delay=0.5)
        kept, flows, fsum = restore_flows(kept, self.kg, s)
        top_path = fsum["patterns"][0]["path"] if fsum["patterns"] else "-"
        yield self._log("分析", tick, f"业务流还原：{fsum['total_flows']} 条失败路径 / {fsum['total_users']} 个用户，"
                                     f"最多的是 {top_path}")
        yield {"type": "result", "key": "flows", "data": {"summary": fsum, "flows": flows[:400]}, "delay": 0.2}
        yield self._step("analysis", "flows", "done", delay=0.8)

        # ---- 2.2.1 异常特征聚类 ∥ 2.2.2 图谱推理
        yield self._step("analysis", "cluster", "running")
        yield self._step("analysis", "kg", "running", delay=0.5)
        clustering = clustering_mod.analyze(window, kept, onsets, minute, self.topo, self.kg, s)
        strong = [x for x in clustering["series"] if x["grade"] == "high"]
        where = sorted({v.split(":")[-1] for x in strong for v in x["best"]["set"]})
        yield self._log("分析", tick, f"特征聚类：{len(clustering['series'])} 个突增维度中 {len(strong)} 个强聚集"
                                     + (f"，集中在 {'、'.join(where)}" if where else ""))
        yield {"type": "result", "key": "clustering", "data": clustering, "delay": 0.2}
        yield self._step("analysis", "cluster", "done", delay=0.6)

        rates = {x["key"]: {"baseline": det.baseline.get(x["key"], (0.0, 1.0))[0],
                            "current": x["count"] / (minute - max(x["onset"], int(counts.columns[0])) + 1)}
                 for x in clustering["series"]}
        kg_result = kg_reasoning.reason(
            clustering["series"], kept, self.kg,
            {x["key"]: rates[x["key"]]["baseline"] * (minute - max(x["onset"], int(counts.columns[0])) + 1)
             for x in clustering["series"]})
        n_root = sum(1 for r in kg_result["roles"].values() if r == "root")
        yield self._log("分析", tick, f"图谱推理：{n_root} 个根因侧维度，{len(kg_result['roles']) - n_root} 个为下游失败的传导结果")
        yield {"type": "result", "key": "kg", "data": kg_result, "delay": 0.2}
        yield self._step("analysis", "kg", "done", delay=0.8)

        # ---- 2.3 交叉验证
        yield self._step("analysis", "crossval", "running", delay=0.5)
        cv = crossval_mod.cross_validate(clustering, kg_result, s)
        matched = sorted({it["best"]["name"] for it in cv["items"] if it["best"]})
        yield self._log("分析", tick, "交叉验证：" + (f"唯一匹配 {'；'.join(matched)}" if cv["decision"] == "conclusion" else cv["reason"]),
                        "ok" if cv["decision"] == "conclusion" else "warn")
        yield {"type": "result", "key": "crossval", "data": cv, "delay": 0.2}
        yield self._step("analysis", "crossval", "done", delay=0.8)

        if cv["decision"] == "conclusion":
            yield self._step("analysis", "agent", "skipped")
            yield self._log("Agent", tick, "交叉验证已得到唯一结论，慢推理未触发", channel="agent")
            conclusion = conclusion_mod.build({
                "topo": self.topo, "crossval": cv, "clustering": clustering, "kg": kg_result, "flows": fsum,
                "kept": kept, "rates": rates, "hhmm": self.hhmm, "minute": minute, "settings": s, "t0": self.t0,
            })
        else:
            yield self._step("analysis", "agent", "running", delay=0.4)
            agent_result = None
            for msg in SlowReasoningAgent(Tools(window)).run(cv, clustering):
                yield self._log("Agent", tick, f"[{msg['kind']}] {msg['text']}", channel="agent", delay=0.3)
                agent_result = msg.get("result", agent_result)
            yield {"type": "result", "key": "agent", "data": agent_result, "delay": 0.2}
            yield self._step("analysis", "agent", "done", delay=0.5)
            conclusion = self._tentative(cv, clustering, kept, agent_result, minute)

        # 故障编号与感知时间以故障开启时为准（重新分析不改变）
        conclusion["detected_at"] = inc["opened_at"]
        conclusion["incident_id"] = inc["id"]
        conclusion["handoff"].update(incident_id=inc["id"], detected_at=inc["opened_at"])
        conclusion["node_stats"] = self._node_stats(window, clustering, rates)
        yield self._step("decision", "conclusion", "running", delay=0.5)
        yield self._log("决策", tick, f"结论：{conclusion['title']}（置信度 {conclusion['confidence']:.0%}）",
                        "alert" if conclusion["definitive"] else "warn")
        yield self._log("决策", tick, "恢复方案：" + "；".join(
            f"{'（' + st['tag'] + '）' if st.get('tag') in ('备选', '后续') else ''}{st['title']}" for st in conclusion["recovery"]["steps"]))
        yield {"type": "result", "key": "conclusion", "data": conclusion, "delay": 0.3}
        yield self._step("decision", "conclusion", "done", delay=0.6)
        yield self._step("decision", "handoff", "running", delay=0.4)
        yield self._log("决策", tick, f"已移交决策执行模块：{inc['id']}", "ok")
        yield self._step("decision", "handoff", "done")

    # ------------------------------------------------------------ 展示数据
    def _series_chart(self, key: str, counts: pd.DataFrame, minute: int) -> dict:
        """单个时序维度的展示数据：最近 chart_minutes 分钟的逐分钟条数、突增点，以及逐分钟的动态阈值。

        动态阈值取每一分钟判定时实际使用的阈值（由当时的基线与离散度算出），基线冻结期间保持不变。
        """
        det, s = self.det, self.s
        instance, procedure, cause = key.split("|")
        first = max(self.first_minute if self.first_minute is not None else minute, minute - s.chart_minutes + 1)
        minutes = list(range(first, minute + 1))
        hist = self.buf.loc[self.buf["series"] == key, "minute"].value_counts()
        flags = det.flags.get(key, set())
        points = det.points.get(key, {})

        def threshold_at(m: int) -> float | None:
            p = points.get(m)
            if p is None or not p.judged:
                return None
            return round(float(max(p.baseline + s.z_threshold * p.sigma, p.baseline + s.min_delta)), 2)

        mu = det.baseline.get(key, (None, None))[0]
        in_window = set(counts.columns)
        status = "sustained" if det.sustained(key, minute) else ("transient" if any(m in flags for m in in_window) else "normal")
        return {"key": key, "instance": instance, "procedure": procedure, "cause": cause,
                "cause_name": self.cause_names.get(cause, cause), "labels": [self.hhmm(m) for m in minutes],
                "values": [int(hist.get(m, 0)) for m in minutes], "flags": [m in flags for m in minutes],
                "thresholds": [threshold_at(m) for m in minutes],
                "baseline": mu, "threshold": det.threshold(key), "status": status}

    def _pick_series(self, counts: pd.DataFrame, minute: int) -> list[dict]:
        """挑选典型时序：持续突增的优先，其次是有突增点但未达持续判定的，再补几个量最大的平稳底噪。"""
        det = self.det
        keys = list(counts.index)
        sustained = sorted((k for k in keys if det.sustained(k, minute)), key=lambda k: -counts.loc[k].iloc[-1])
        transient = sorted((k for k in keys if k not in sustained and any(m in det.flags.get(k, ()) for m in counts.columns)),
                           key=lambda k: -counts.loc[k].max())
        steady = [k for k in counts.sum(axis=1).sort_values(ascending=False).index if k not in sustained and k not in transient]
        n = self.s.max_series_charts
        picked = sustained[:n]
        picked += transient[:max(1, min(2, n - len(picked)))] if transient and len(picked) < n else []
        picked += steady[:max(0, n - len(picked))]
        return [self._series_chart(k, counts, minute) for k in picked[:n]]

    def _node_stats(self, window: pd.DataFrame, clustering: dict, rates: dict) -> dict:
        minutes = list(range(int(window["minute"].min()), int(window["minute"].max()) + 1))
        per = window.groupby(["instance", "minute"]).size().unstack(fill_value=0).reindex(columns=minutes, fill_value=0)
        stats = {}
        for n in self.topo.nodes:
            stats[n] = {"labels": [self.hhmm(m) for m in minutes],
                        "values": [int(v) for v in per.loc[n]] if n in per.index else [0] * len(minutes),
                        "series": [{"procedure": x["procedure"], "cause": x["cause"], "cause_name": x["cause_name"],
                                    "baseline": round(rates[x["key"]]["baseline"], 1),
                                    "current": round(rates[x["key"]]["current"], 1),
                                    "best": x["best"]} for x in clustering["series"] if x["instance"] == n]}
        return stats

    def _tentative(self, cv: dict, clustering: dict, kept: pd.DataFrame, agent_result: dict | None, minute: int) -> dict:
        """慢推理后的非确切结论：给出可能原因与处理建议。"""
        hyps = (agent_result or {}).get("hypotheses", [])
        title = "未能确定单一根因（慢推理给出可能原因）"
        return {
            "title": title, "definitive": False, "confidence": round(hyps[0]["score"] * 0.6, 2) if hyps else 0.3,
            "summary": cv["reason"] + "。可能原因：" + "；".join(h["hypothesis"] for h in hyps[:3]) + "。",
            "chain": [{"label": "可能原因", "value": h["hypothesis"], "sub": h["series"].replace("|", " · ")} for h in hyps[:3]],
            "root": {"type": "unknown", "ne": "", "links": []},
            "onset": self.hhmm(min(x["onset"] for x in clustering["series"])), "detected_at": self.hhmm(minute + 1),
            "impact": {"procedures": sorted({x["procedure"] for x in clustering["series"]}),
                       "users": int(kept.loc[kept["imsi"] != "", "imsi"].nunique()), "failures": int(len(kept)), "instances": []},
            "evidence": [{"kind": "慢推理", "title": h["hypothesis"], "metric": f"{h['score']:.2f}", "unit": "评分",
                          "detail": f"{h['series'].replace('|', ' · ')}，评分 {h['score']:.2f}"} for h in hyps],
            "recovery": {"definitive": False,
                         "steps": [{"tag": "建议", "title": f"建议 {i}", "detail": t}
                                   for i, t in enumerate((agent_result or {}).get("suggestions", []), 1)]},
            "topology": {"nodes": {n: {"role": "suspect" if any(x["instance"] == n for x in clustering["series"]) else "normal"}
                                   for n in self.topo.nodes}, "edges": []},
            "handoff": {"title": title, "definitive": False, "hypotheses": hyps, "actions": []},
        }
