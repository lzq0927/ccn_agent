"""Trace analyzer: evaluates the quality of reasoning traces."""

from __future__ import annotations

import json
import logging

from agents.shared.llm_client import LLMClient
from agents.shared.models import ReasoningStep

logger = logging.getLogger(__name__)

TRACE_ANALYSIS_PROMPT = """You are evaluating the quality of a fault diagnosis reasoning trace.

Analyze the following reasoning steps and score them on:
1. **Logical coherence** (0-1): Do the steps follow a logical sequence?
2. **Tool efficiency** (0-1): Were the right tools used? Were there unnecessary calls?
3. **Evidence quality** (0-1): Was the conclusion supported by strong evidence?
4. **Missed signals** (0-1): Were there important data points that were overlooked?

Respond in JSON format:
{
  "logical_coherence": float,
  "tool_efficiency": float,
  "evidence_quality": float,
  "missed_signals": float,
  "overall_score": float,
  "strengths": ["list of things done well"],
  "weaknesses": ["list of things that could improve"]
}"""


class TraceAnalyzer:
    """Analyzes reasoning traces for diagnostic quality."""

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client

    async def analyze(self, trace: list[ReasoningStep]) -> dict:
        """Analyze a reasoning trace and return quality scores."""
        if not trace:
            return {"overall_score": 0.0, "strengths": [], "weaknesses": ["No reasoning trace"]}

        # Format trace for LLM analysis
        steps_text = []
        for step in trace:
            if step.step_type == "thinking":
                steps_text.append(f"[Step {step.step_number}] Thinking: {step.content}")
            elif step.step_type == "tool_call":
                args_str = json.dumps(step.tool_args, ensure_ascii=False) if step.tool_args else ""
                result_str = (step.tool_result or "")[:200]
                steps_text.append(f"[Step {step.step_number}] Tool: {step.tool_name}({args_str}) -> {result_str}")
            elif step.step_type == "conclusion":
                steps_text.append(f"[Step {step.step_number}] Conclusion: {step.content}")

        trace_text = "\n".join(steps_text)

        # Truncate if too long
        if len(trace_text) > 3000:
            trace_text = trace_text[:1500] + "\n...\n" + trace_text[-1500:]

        try:
            response = await self.llm.chat_simple(
                system=TRACE_ANALYSIS_PROMPT,
                user=f"Analyze this reasoning trace:\n\n{trace_text}",
                temperature=0.1,
            )
            return self._parse_response(response)
        except Exception as e:
            logger.error("Trace analysis failed: %s", e)
            return {"overall_score": 0.5, "strengths": [], "weaknesses": [f"Analysis failed: {e}"]}

    def _parse_response(self, response: str) -> dict:
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"overall_score": 0.5, "strengths": [], "weaknesses": ["Could not parse analysis"]}
