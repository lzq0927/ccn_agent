"""慢推理 Agent 可调用的工具。当前为桩实现：用户跟踪基于已有 CHR，拨测染色未接入真实工具。"""
from __future__ import annotations

import pandas as pd


class Tools:
    def __init__(self, window: pd.DataFrame):
        self.window = window

    def user_trace(self, imsi: str) -> dict:
        """用户跟踪：返回该用户在窗口内的全部 CHR（内网替换为信令跟踪工具）。"""
        rec = self.window[self.window["imsi"] == imsi].sort_values("ts")
        return {"imsi": imsi, "records": [
            {"time": r.ts.strftime("%H:%M:%S"), "instance": r.instance, "procedure": r.procedure, "cause": r.cause}
            for r in rec.itertuples()][:20]}

    def dial_test(self, source: str, target: str) -> dict:
        """拨测染色：沿 source -> target 发起染色拨测（桩：未接入，返回未执行）。"""
        return {"source": source, "target": target, "executed": False, "note": "拨测染色工具未接入，仿真环境不执行"}
