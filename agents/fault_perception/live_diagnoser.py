"""LiveDiagnoser: 把 FaultPerceptionAgent.diagnose 流式化。

MVP: 接受已生成的 ReasoningStep 列表,逐条 emit reasoning_step 事件。
后续: 接入 FaultPerceptionAgent._run_agent_loop 的流式回调。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
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
            payload = {
                "n": s.n,
                "type": s.type,
                "text": s.text,
            }
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
            "fault_elements": fault_elements,
            "fault_type": fault_type,
            "fault_mode": fault_mode,
            "confidence": confidence,
            "route": route,
            "iterations": len(steps),
        })

    def emit_user_breakdown(self, breakdown: dict) -> None:
        self.bus.publish("user_breakdown", breakdown)