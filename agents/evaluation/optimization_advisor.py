"""Optimization advisor: generates improvement suggestions from evaluation results."""

from __future__ import annotations

import json
import logging

from agents.shared.llm_client import LLMClient
from agents.shared.models import (
    CaseLibraryEntry, OptimizationSuggestion, SuggestionType, EvaluationMetrics,
    DiagnosisResult,
)

logger = logging.getLogger(__name__)

OPTIMIZATION_PROMPT = """You are an expert in 5G core network fault diagnosis optimization.

Given a diagnosis case that did not achieve perfect results, analyze what went wrong and suggest improvements.

Consider these improvement areas:
1. **Skill improvements**: Should any diagnostic skill be updated with better procedures?
2. **Workflow improvements**: Should any fixed workflow be modified or should new workflows be added?
3. **Training data gaps**: Should new training cases be generated for specific fault types that are underperforming?

Respond in JSON format:
{
  "suggestions": [
    {
      "type": "skill_update|workflow_update|new_case",
      "target": "skill/workflow name or case description",
      "content": "detailed suggestion",
      "evidence": ["supporting evidence from the case"],
      "priority": 0.0-1.0
    }
  ]
}"""


class OptimizationAdvisor:
    """Generates optimization suggestions from failed or partial diagnoses."""

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client

    async def analyze(self, entry: CaseLibraryEntry, diagnosis: DiagnosisResult,
                      metrics: EvaluationMetrics) -> list[OptimizationSuggestion]:
        """Generate optimization suggestions for a sub-optimal case."""
        if metrics.exact_match and metrics.fault_type_match:
            return []  # Perfect case, no suggestions needed

        prompt = self._build_prompt(entry, diagnosis, metrics)

        try:
            response = await self.llm.chat_simple(
                system=OPTIMIZATION_PROMPT,
                user=prompt,
                temperature=0.2,
            )
            return self._parse_suggestions(response)
        except Exception as e:
            logger.error("Optimization analysis failed: %s", e)
            return [OptimizationSuggestion(
                suggestion_type=SuggestionType.SKILL_UPDATE,
                target="general",
                content=f"Auto-generated: review {entry.fault_type} diagnosis procedures",
                evidence=[f"Case {entry.case_id}: {entry.category.value}"],
                priority=0.3,
            )]

    def _build_prompt(self, entry: CaseLibraryEntry, diagnosis: DiagnosisResult,
                      metrics: EvaluationMetrics) -> str:
        return f"""Analyze this diagnosis case for optimization opportunities:

## Case Summary
- Case ID: {entry.case_id}
- Fault type: {entry.fault_type}
- Difficulty: {entry.difficulty.value}
- Diagnosis mode: {entry.diagnosis_mode}
- Category: {entry.category.value}

## Diagnosis Result
- Predicted elements: {diagnosis.fault_elements}
- Predicted fault type: {diagnosis.fault_type}
- Confidence: {diagnosis.confidence}

## Metrics
- Precision: {metrics.precision}
- Recall: {metrics.recall}
- F1: {metrics.f1}
- Exact match: {metrics.exact_match}
- Fault type match: {metrics.fault_type_match}

## Key Observations
{json.dumps(entry.key_observations, ensure_ascii=False, indent=2)}

## Lessons
{json.dumps(entry.lessons, ensure_ascii=False, indent=2)}

## Reasoning Trace Summary
{json.dumps([{"step": s.step_number, "type": s.step_type, "content": s.content[:100]} for s in diagnosis.reasoning_trace[:10]], ensure_ascii=False, indent=2)}

What improvements would you suggest?"""

    def _parse_suggestions(self, response: str) -> list[OptimizationSuggestion]:
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return []

        suggestions = []
        for s in data.get("suggestions", []):
            try:
                suggestions.append(OptimizationSuggestion(
                    suggestion_type=SuggestionType(s.get("type", "skill_update")),
                    target=s.get("target", ""),
                    content=s.get("content", ""),
                    evidence=s.get("evidence", []),
                    priority=float(s.get("priority", 0.5)),
                ))
            except (ValueError, TypeError):
                continue

        return suggestions
