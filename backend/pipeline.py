"""回放编排：按分钟推进，感知 -> 分析 -> 决策执行（移交），以事件流形式输出。

事件（dict）：
  step    工作流步骤状态   {stage, step, status: running|done|skipped}
  log     执行日志         {channel: system|agent, stage, time, level, text}
  tick    每分钟感知结果   {minute, time, window, total, n_series, trend_point, series, node_status, ...}
  result  各步骤产出       {key: perception|flows|clustering|kg|crossval|agent|conclusion, data}
  done    回放结束
每个事件带 delay（秒，1 倍速下的建议停顿），由服务层用于控制前端播放节奏。
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
from .perception.preprocess import COLUMNS, preprocess, read_raw
from .topology import Topology


class Pipeline:
    def __init__(self, settings: Settings | None = None):
        self.s = settings or Settings()
        self.topo = Topology.load(self.s.topo_file)
        self.kg = KnowledgeGraph.load(self.s.kg_file)
        self.raw = read_raw(self.s.data_dir)
        self.t0 = self.raw["arrival"].min().floor("min")
        self.raw["arrival_minute"] = ((self.raw["arrival"] - self.t0).dt.total_seconds() // 60).astype(int)
        self.n_minutes = int(self.raw["arrival_minute"].max()) + 1
        self.cause_names = self.kg.cause_names()

    # ------------------------------------------------------------ 工具
    def hhmm(self, minute: int) -> str:
        return (self.t0 + pd.Timedelta(minutes=int(minute))).strftime("%H:%M")

    def meta(self) -> dict:
        return {
            "start": self.t0.strftime("%Y-%m-%d %H:%M"), "minutes": self.n_minutes, "raw_rows": int(len(self.raw)),
            "files": self.raw["source_file"].value_counts().sort_index().to_dict(),
            "settings": {"window_min": self.s.window_min, "sustain_n": self.s.sustain_n, "sustain_m": self.s.sustain_m,
                         "z_threshold": self.s.z_threshold},
            "kg": {"nodes": len(self.kg.nodes), "edges": len(self.kg.edges), "version": self.kg.meta.get("version", "")},
        }

    def _log(self, stage: str, minute: int, text: str, level: str = "info", channel: str = "system", delay: float = 0.04):
        return {"type": "log", "channel": channel, "stage": stage, "time": self.hhmm(minute), "level": level,
                "text": text, "delay": delay}

    @staticmethod
    def _step(stage: str, step: str, status: str, delay: float = 0.0):
        return {"type": "step", "stage": stage, "step": step, "status": status, "delay": delay}

    def _series_chart(self, key: str, counts: pd.DataFrame, det: SpikeDetector, minute: int) -> dict:
        instance, procedure, cause = key.split("|")
        minutes = list(counts.columns)
        flags = det.flags.get(key, set())
        mu = det.baseline.get(key, (None, None))[0]
        status = "sustained" if det.sustained(key, minute) else ("transient" if any(m in flags for m in minutes) else "normal")
        return {"key": key, "instance": instance, "procedure": procedure, "cause": cause,
                "cause_name": self.cause_names.get(cause, cause), "labels": [self.hhmm(m) for m in minutes],
                "values": [int(v) for v in counts.loc[key]], "flags": [m in flags for m in minutes],
                "baseline": mu, "threshold": det.threshold(key), "status": status}

    def _pick_series(self, counts: pd.DataFrame, det: SpikeDetector, minute: int) -> list[dict]:
        """挑选典型时序：持续突增的优先，其次是被抑制的瞬时毛刺，再补几个量最大的平稳底噪。"""
        keys = list(counts.index)
        sustained = sorted((k for k in keys if det.sustained(k, minute)), key=lambda k: -counts.loc[k].iloc[-1])
        transient = sorted((k for k in keys if k not in sustained and any(m in det.flags.get(k, ()) for m in counts.columns)),
                           key=lambda k: -counts.loc[k].max())
        steady = [k for k in counts.sum(axis=1).sort_values(ascending=False).index if k not in sustained and k not in transient]
        n = self.s.max_series_charts
        picked = sustained[:n]
        picked += transient[:max(1, min(2, n - len(picked)))] if transient and len(picked) < n else []
        picked += steady[:max(0, n - len(picked))]
        return [self._series_chart(k, counts, det, minute) for k in picked[:n]]

    # ------------------------------------------------------------ 主流程
    def run(self) -> Iterator[dict]:
        s = self.s
        det = SpikeDetector(s)
        buf = pd.DataFrame(columns=COLUMNS)
        pre_total = {"input": 0, "output": 0, "bad_timestamp": 0, "missing_key": 0, "unknown_instance": 0,
                     "duplicate": 0, "normalized_instance": 0}
        m = self.meta()
        yield self._log("系统", 0, f"加载拓扑 {len(self.topo.nodes)} 个网元实例 / {len(self.topo.edges)} 条连接；"
                                  f"知识图谱 {m['kg']['nodes']} 节点 / {m['kg']['edges']} 关系")
        yield self._log("系统", 0, f"CHR 数据源 {len(m['files'])} 个文件，共 {m['raw_rows']:,} 条，"
                                  f"自 {m['start']} 起 {self.n_minutes} 分钟。每分钟感知一次，滑窗 {s.window_min} 分钟")
        yield self._log("系统", 0, "慢推理 Agent 待命（仅在交叉验证无法得到唯一结论时启用）", channel="agent")

        for tick in range(1, self.n_minutes + 1):
            minute = tick - 1                     # 本次新到达的一分钟
            # ---- 1.1 数据预处理
            yield self._step("perception", "preprocess", "running", delay=0.12)
            chunk = self.raw[self.raw["arrival_minute"] == minute]
            clean, st = preprocess(chunk, self.topo, self.t0)
            for k in pre_total:
                pre_total[k] += st[k]
            buf = pd.concat([buf, clean], ignore_index=True) if len(buf) else clean.reset_index(drop=True)
            buf = buf[buf["minute"] > minute - 2 * s.window_min].reset_index(drop=True)
            window = buf[(buf["minute"] > minute - s.window_min) & (buf["minute"] <= minute)]
            yield self._step("perception", "preprocess", "done")

            # ---- 1.2 时序异常检测
            yield self._step("perception", "denoise", "running")
            w_minutes = list(range(max(0, minute - s.window_min + 1), minute + 1))
            counts = (window.groupby(["series", "minute"]).size().unstack(fill_value=0)
                      .reindex(columns=w_minutes, fill_value=0))
            points = det.update(counts, minute)
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

            dropped = st["input"] - st["output"]
            yield self._log("感知", tick,
                            f"新增 {st['output']} 条" + (f"（清洗 {dropped}）" if dropped else "")
                            + f" · 窗口 {len(window):,} 条 · {len(counts)} 维度 · 突增点 {len(flagged)}")
            for k in sorted(flagged, key=lambda k: -points[k].z)[:3]:
                if k in sustained or points[k].z < 6:
                    continue
                p, n_recent = points[k], len(det.recent_flags(k, minute))
                yield self._log("感知", tick,
                                f"{k.replace('|', ' · ')} 突增 {int(p.value)} 条/分（基线 {p.baseline:.1f}）"
                                f"，近 {s.sustain_n} 分钟仅 {n_recent} 分钟异常，继续观察", "warn")
            yield {
                "type": "tick", "minute": tick, "time": self.hhmm(tick),
                "window": {"from": self.hhmm(w_minutes[0]), "to": self.hhmm(tick)},
                "total": int(len(window)), "n_series": int(len(counts)),
                "n_flagged": len(flagged), "n_sustained": len(sustained),
                "trend_point": {"label": self.hhmm(minute), "total": int(len(last)),
                                "by_nf": {k: int(v) for k, v in last["nf_type"].value_counts().items()}},
                "series": self._pick_series(counts, det, minute),
                "node_status": node_status, "preprocess": dict(pre_total), "delay": 0.38,
            }
            if not sustained:
                yield self._step("perception", "denoise", "done")
                continue

            # ---- 发现异常：降噪 + 分析
            yield self._log("感知", tick, f"发现异常：{len(sustained)} 个维度满足“{s.sustain_n} 分钟内 ≥{s.sustain_m} 分钟突增”，"
                                         "启动降噪与分析", "alert", delay=0.5)
            yield from self._analyze(window, counts, det, minute, tick)
            return

        yield self._step("perception", "denoise", "done")
        yield self._log("感知", self.n_minutes, "回放结束，未发现持续异常", "ok")
        yield {"type": "done", "incident": False, "delay": 0}

    def _analyze(self, window: pd.DataFrame, counts: pd.DataFrame, det: SpikeDetector, minute: int, tick: int) -> Iterator[dict]:
        s = self.s
        kept, dn = denoise(window, det, minute)
        onsets = dn.pop("onsets")
        transient = dn.pop("transient")
        charts = [self._series_chart(k, counts, det, minute) for k in sorted(onsets, key=lambda k: -counts.loc[k].iloc[-1])]
        charts += [self._series_chart(k, counts, det, minute) for k in
                   sorted(transient, key=lambda k: -counts.loc[k].max())[:2]]
        steady = [k for k in counts.sum(axis=1).sort_values(ascending=False).index if k not in onsets and k not in transient]
        charts += [self._series_chart(k, counts, det, minute) for k in steady[:2]]
        perception = {
            "stats": dn, "window": {"from": self.hhmm(int(window["minute"].min())), "to": self.hhmm(tick)},
            "series": charts, "pies": pie_compare(window, kept, self.cause_names),
            "anomalous": [{"key": k, "onset": self.hhmm(v)} for k, v in sorted(onsets.items())],
        }
        yield self._log("感知", tick, f"时序异常检测：共分析 {dn['n_series']} 个维度（网元实例×流程×原因码），"
                                     f"{dn['n_anomalous']} 个持续突增"
                                     + (f"（含 {dn['n_co']} 个同期连续突增并入）" if dn["n_co"] else "")
                                     + f"，{dn['n_transient']} 个有突增点但未达持续判定（已抑制）")
        for k in sorted(onsets, key=lambda k: -counts.loc[k].iloc[-1]):
            mu = det.baseline[k][0]
            yield self._log("感知", tick, f"  ↑ {k.replace('|', ' · ')}  基线 {mu:.1f} → {int(counts.loc[k].iloc[-1])} 条/分，"
                                         f"自 {self.hhmm(onsets[k])} 起", "warn")
        yield self._log("感知", tick, f"CHR 降噪：窗口内 {dn['total']:,} 条，保留 {dn['kept']:,} 条，"
                                     f"滤除 {dn['filtered_pct']}%（常态底噪与瞬时毛刺）", "ok")
        yield {"type": "result", "key": "perception", "data": perception, "delay": 0.2}
        yield self._step("perception", "denoise", "done", delay=0.9)

        # ---- 2.1 还原用户级业务流
        yield self._step("analysis", "flows", "running", delay=0.5)
        kept, flows, fsum = restore_flows(kept, self.kg, s)
        yield self._log("分析", tick, f"业务流还原：{fsum['total_flows']} 条用户级失败路径，涉及 {fsum['total_users']} 个用户，"
                                     f"其中 {fsum['multi_hop_flows']} 条跨网元")
        for p in fsum["patterns"][:4]:
            yield self._log("分析", tick, f"  路径 {p['path']}（{p['smf_id'] or '-'}）× {p['flows']}")
        yield {"type": "result", "key": "flows", "data": {"summary": fsum, "flows": flows[:400]}, "delay": 0.2}
        yield self._step("analysis", "flows", "done", delay=0.8)

        # ---- 2.2.1 异常特征聚类 ∥ 2.2.2 图谱推理
        yield self._step("analysis", "cluster", "running")
        yield self._step("analysis", "kg", "running", delay=0.5)
        clustering = clustering_mod.analyze(window, kept, onsets, minute, self.topo, self.kg, s)
        for x in clustering["series"]:
            b = x["best"]
            lvl = {"high": "强聚集", "mid": "中聚集", "low": "弱聚集", "none": "无聚集"}[b["grade"]]
            yield self._log("分析", tick, f"聚类 {x['instance'].split(':')[1]} · {x['cause']}：{b['label']} "
                                         f"{'、'.join(v.split(':')[-1] for v in b['set']) or '-'} {b['score']:.0%}（{lvl}）"
                                         + (" · 用户粒度下钻" if x["fallback"] else ""),
                            "info")
        yield {"type": "result", "key": "clustering", "data": clustering, "delay": 0.2}
        yield self._step("analysis", "cluster", "done", delay=0.6)

        rates = {x["key"]: {"baseline": det.baseline.get(x["key"], (0.0, 1.0))[0],
                            "current": x["count"] / (minute - x["onset"] + 1)} for x in clustering["series"]}
        kg_result = kg_reasoning.reason(
            clustering["series"], kept, self.kg,
            {x["key"]: rates[x["key"]]["baseline"] * (minute - x["onset"] + 1) for x in clustering["series"]})
        for c in kg_result["causes"]:
            top = c["scenarios"][0] if c["scenarios"] else None
            yield self._log("分析", tick, f"图谱 {c['code']} {c['name']} → {len(c['scenarios'])} 种场景"
                                         + (f"，先验最高：{top['name']}（{top['weight']:.2f}）" if top else "，图谱中无此原因码"))
        for ch in kg_result["chains"]:
            if ch["derived"]:
                yield self._log("分析", tick, f"图谱 {ch['series'].replace('|', ' · ')} 为传导结果，"
                                             f"{ch['explained_ratio']:.0%} 可由下游 {'/'.join(ch['sources'])} 解释")
        yield {"type": "result", "key": "kg", "data": kg_result, "delay": 0.2}
        yield self._step("analysis", "kg", "done", delay=0.8)

        # ---- 2.3 交叉验证
        yield self._step("analysis", "crossval", "running", delay=0.5)
        cv = crossval_mod.cross_validate(clustering, kg_result, s)
        for it in cv["items"]:
            if it["best"]:
                yield self._log("分析", tick, f"交叉验证 {it['instance'].split(':')[1]} · {it['cause']} → {it['best']['name']}"
                                             f"（{it['best']['match_score']:.0%}）", "ok")
            else:
                yield self._log("分析", tick, f"交叉验证 {it['instance']} · {it['cause']}：{'无匹配场景' if it['verdict'] == 'none' else '多个场景接近'}", "warn")
        yield self._log("分析", tick, f"交叉验证结论：{cv['reason']}", "ok" if cv["decision"] == "conclusion" else "warn")
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

        conclusion["node_stats"] = self._node_stats(window, clustering, rates)
        yield self._step("decision", "conclusion", "running", delay=0.5)
        yield self._log("决策", tick, f"结论：{conclusion['title']}（置信度 {conclusion['confidence']:.0%}）",
                        "alert" if conclusion["definitive"] else "warn")
        for i, st in enumerate(conclusion["recovery"]["steps"], 1):
            yield self._log("决策", tick, f"恢复方案 {i}. [{st.get('tag', '')}] {st['title']}")
        yield {"type": "result", "key": "conclusion", "data": conclusion, "delay": 0.3}
        yield self._step("decision", "conclusion", "done", delay=0.6)
        yield self._step("decision", "handoff", "running", delay=0.4)
        yield self._log("决策", tick, f"已生成移交载荷 {conclusion['handoff']['incident_id']}，交决策执行模块（本系统不执行）", "ok")
        yield self._step("decision", "handoff", "done")
        yield {"type": "done", "incident": True, "delay": 0}

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
        detected = self.hhmm(minute + 1)
        title = "未能确定单一根因（慢推理给出可能原因）"
        return {
            "title": title, "definitive": False, "confidence": round(hyps[0]["score"] * 0.6, 2) if hyps else 0.3,
            "summary": cv["reason"] + "。可能原因：" + "；".join(h["hypothesis"] for h in hyps[:3]) + "。",
            "chain": [{"label": "可能原因", "value": h["hypothesis"], "sub": h["series"].replace("|", " · ")} for h in hyps[:3]],
            "root": {"type": "unknown", "ne": "", "links": []},
            "onset": self.hhmm(min(x["onset"] for x in clustering["series"])), "detected_at": detected,
            "impact": {"procedures": sorted({x["procedure"] for x in clustering["series"]}),
                       "users": int(kept.loc[kept["imsi"] != "", "imsi"].nunique()), "failures": int(len(kept)), "instances": []},
            "evidence": [{"kind": "慢推理", "title": h["hypothesis"], "metric": f"{h['score']:.2f}", "unit": "评分", "detail": f"{h['series'].replace('|', ' · ')}，评分 {h['score']:.2f}"}
                         for h in hyps],
            "recovery": {"definitive": False,
                         "steps": [{"tag": "建议", "title": f"建议 {i}", "detail": t} for i, t in enumerate((agent_result or {}).get("suggestions", []), 1)]},
            "topology": {"nodes": {n: {"role": "suspect" if any(x["instance"] == n for x in clustering["series"]) else "normal"}
                                   for n in self.topo.nodes}, "edges": []},
            "handoff": {"incident_id": f"INC-{self.t0.strftime('%Y%m%d')}-{detected.replace(':', '')}",
                        "detected_at": detected, "title": title, "definitive": False, "hypotheses": hyps, "actions": []},
        }
