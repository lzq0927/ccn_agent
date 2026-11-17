"""慢推理 Agent。

交叉验证得不到唯一结论时进入：汇总候选假设，调用用户跟踪/拨测染色等工具补充证据，
给出“可能原因 + 处理建议”（非确切结论）。当前为规则化的桩实现，保留与 LLM Agent 对接的接口：
替换 SlowReasoningAgent.run 即可，输入输出结构不变。
"""
from __future__ import annotations

from typing import Iterator

from .tools import Tools


class SlowReasoningAgent:
    def __init__(self, tools: Tools):
        self.tools = tools

    def run(self, crossval: dict, clustering: dict) -> Iterator[dict]:
        """逐步产出 {"kind": thought|tool|observation|final, "text": ..., "result"?: ...}。"""
        yield {"kind": "thought", "text": f"进入慢推理：{crossval['reason']}"}
        hypotheses = []
        for it in crossval["items"]:
            if it["verdict"] == "unique":
                hypotheses.append({"series": it["series"], "hypothesis": it["best"]["name"], "score": it["best"]["score"]})
                continue
            top = it["candidates"][:3]
            yield {"kind": "thought",
                   "text": f"{it['series']} 候选场景：" + "；".join(f"{c['name']}({c['score']:.2f})" for c in top)}
            hypotheses += [{"series": it["series"], "hypothesis": c["name"], "score": c["score"]} for c in top]
            series = next(s for s in clustering["series"] if s["key"] == it["series"])
            user = next((d for d in series["dims"] if d["dim"] == "user"), None)
            if user and user["values"]:
                imsi = user["values"][0]["value"]
                yield {"kind": "tool", "text": f"user_trace(imsi={imsi})"}
                trace = self.tools.user_trace(imsi)
                yield {"kind": "observation", "text": f"该用户窗口内 {len(trace['records'])} 条 CHR"}
            for c in top:
                peer = next((ck for ck in c["checks"] if ck["dim"] == "peer" and ck["values"]), None)
                if peer:
                    yield {"kind": "tool", "text": f"dial_test({it['instance']} -> {peer['values'][0]})"}
                    res = self.tools.dial_test(it["instance"], peer["values"][0])
                    yield {"kind": "observation", "text": res["note"]}
                    break
        hypotheses.sort(key=lambda h: -h["score"])
        result = {
            "definitive": False,
            "hypotheses": hypotheses[:5],
            "suggestions": [
                "对聚集度最高的网元/链路发起拨测染色，确认失败是否可复现",
                "抽取受影响用户做信令跟踪，核对失败发生的具体接口与消息",
                "结合告警与 KPI 交叉确认后再执行隔离或切换",
            ],
        }
        yield {"kind": "final", "text": "未能得出确切结论，给出可能原因与处理建议", "result": result}
