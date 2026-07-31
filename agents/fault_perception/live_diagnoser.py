"""LiveDiagnoser: 把 FaultPerceptionAgent.diagnose 流式化(LIVE 闭环用)。

两种用法:
  1. ``run_real_diagnosis(snapshot, round)`` —— **真 Agent**:从引擎快照组装 CaseData,
     调 ``FaultPerceptionAgent.diagnose``;progress_callback 把置信度/工具调用实时推到 bus,
     诊断完成后再补一条结论 + diagnosis_complete。LLM 走 /v1(MiniMax);CC_LIVE_LLM_MODE=stub
     可降级桩(展会兜底)。
  2. ``stream_steps(...)`` —— 旧桩:接受已生成的 ReasoningStep 列表逐条 emit(保留向后兼容)。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class ReasoningStep:
    n: int
    type: str  # "thinking" | "tool_call" | "tool_result" | "conclusion"
    text: str
    tool: Optional[str] = None
    args: Optional[str] = None
    result: Optional[str] = None
    highlight: Optional[dict] = None


class LiveDiagnoser:
    def __init__(self, bus, plugin_id: str):
        self.bus = bus
        self.plugin_id = plugin_id
        self._step_n = 0

    def _next_n(self) -> int:
        self._step_n += 1
        return self._step_n

    # ------------------------------------------------------------------
    # 真 Agent 路径
    # ------------------------------------------------------------------
    def run_real_diagnosis(self, snapshot: dict, round: int = 1) -> Any:
        """组装 CaseData → 跑真 FaultPerceptionAgent → 流式推 bus。返回 DiagnosisResult。

        注:``FaultPerceptionAgent.diagnose`` 是 async,本方法是同步入口(仅组装 + 构造
        progress_callback);实际 await 由 runner 在事件循环里做(见 ``adiagnose``)。
        """
        from agents.shared.models import CaseData

        case_data = CaseData(
            case_id=round,
            kpi_rows=list(snapshot.get("kpi_rows", [])),
            topology_text=snapshot.get("topology_text", ""),
            process_text=snapshot.get("process_text", ""),
            ground_truth=snapshot.get("ground_truth", {}),
            chr_records=list(snapshot.get("chr_records", [])),
        )
        agent = self._build_agent()
        return agent, case_data

    def _build_agent(self):
        from agents.fault_perception.agent import FaultPerceptionAgent, PerceptionConfig

        cfg = PerceptionConfig()
        return FaultPerceptionAgent(config=cfg, progress_callback=self._on_progress)

    def _on_progress(self, ev: dict) -> None:
        """Agent progress_callback → 实时推 bus(置信度 + 工具调用)。"""
        etype = ev.get("type")
        if etype == "confidence_assessment":
            self.bus.publish("confidence_assessment", {
                "score": ev.get("score", 0.0), "route": ev.get("route", ""),
                "breakdown": {}, "matched_patterns": ev.get("patterns", []), "round": 0,
            })
        elif etype == "tool_call":
            self.bus.publish("reasoning_step", {
                "n": self._next_n(), "type": "tool_call",
                "text": f"🔧 调用工具 {ev.get('tool', '')}", "round": 0,
            })
        elif etype in ("workflow_start", "exploration_start"):
            label = "确定性工作流" if etype == "workflow_start" else "自主探索"
            self.bus.publish("reasoning_step", {
                "n": self._next_n(), "type": "thinking",
                "text": f"▸ 进入{label}", "round": 0,
            })

    def emit_diagnosis_result(self, result: Any, round: int) -> None:
        """诊断完成后:补一条结论 + diagnosis_complete。"""
        # 取最后一条 conclusion/thinking 作为结论文本
        conclusion_text = "诊断完成"
        for step in reversed(getattr(result, "reasoning_trace", []) or []):
            if getattr(step, "step_type", "") in ("conclusion", "thinking"):
                conclusion_text = getattr(step, "content", conclusion_text) or conclusion_text
                break
        self.bus.publish("reasoning_step", {
            "n": self._next_n(), "type": "conclusion", "text": conclusion_text, "round": round,
        })
        self.bus.publish("diagnosis_complete", {
            "fault_elements": list(getattr(result, "fault_elements", []) or []),
            "fault_type": getattr(result, "fault_type", "unknown"),
            "fault_mode": getattr(result, "fault_mode", "link"),
            "confidence": float(getattr(result, "confidence", 0.0)),
            "route": getattr(getattr(result, "route_taken", None), "value", "workflow"),
            "iterations": int(getattr(result, "iterations_used", 0)),
            "round": round,
        })

    # ------------------------------------------------------------------
    # 旧桩路径(向后兼容旧测试)
    # ------------------------------------------------------------------
    def emit_confidence(self, score: float, route: str, breakdown: dict | None = None) -> None:
        self.bus.publish("confidence_assessment", {
            "score": score, "route": route, "breakdown": breakdown or {},
        })

    def stream_steps(
        self,
        steps: list[ReasoningStep],
        fault_elements: list[str],
        fault_type: str,
        confidence: float,
        fault_mode: str = "link",
        route: str = "workflow",
    ) -> None:
        for s in steps:
            payload = {"n": s.n, "type": s.type, "text": s.text}
            if s.tool is not None:
                payload["tool"] = s.tool
            if s.args is not None:
                payload["args"] = s.args
            if s.result is not None:
                payload["result"] = s.result
            if s.highlight is not None:
                payload["highlight"] = s.highlight
            self.bus.publish("reasoning_step", payload)
        self.bus.publish("diagnosis_complete", {
            "fault_elements": fault_elements, "fault_type": fault_type, "fault_mode": fault_mode,
            "confidence": confidence, "route": route, "iterations": len(steps),
        })

    def emit_user_breakdown(self, breakdown: dict) -> None:
        self.bus.publish("user_breakdown", breakdown)
