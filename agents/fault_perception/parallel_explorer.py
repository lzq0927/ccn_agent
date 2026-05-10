"""Parallel explorer for low-confidence autonomous diagnosis."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable

from agents.shared.models import CaseData, DiagnosisResult, Route, SessionStatus
from agents.shared.llm_client import LLMClient

logger = logging.getLogger(__name__)


class ParallelExplorer:
    """Spawns multiple parallel exploration paths for low-confidence cases.

    Each path explores a different hypothesis. Results are merged to produce
    the best diagnosis.
    """

    def __init__(self, llm_client: LLMClient, max_paths: int = 3):
        self.llm = llm_client
        self.max_paths = max_paths

    async def explore(self, case_data: CaseData, hypotheses: list[str],
                      system_prompt: str, session_id: str) -> DiagnosisResult:
        """Run parallel explorations for each hypothesis."""
        tasks = []
        for i, hypothesis in enumerate(hypotheses[:self.max_paths]):
            task = self._explore_path(i, hypothesis, case_data, system_prompt, session_id)
            tasks.append(task)

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter valid results
        valid_results = []
        for r in results:
            if isinstance(r, DiagnosisResult):
                valid_results.append(r)
            else:
                logger.warning("Exploration path failed: %s", r)

        if not valid_results:
            return DiagnosisResult(
                session_id=session_id,
                case_id=case_data.case_id,
                fault_type="unknown",
                confidence=0.0,
                route_taken=Route.AUTONOMOUS,
                status=SessionStatus.FAILED,
            )

        # Pick the result with highest confidence
        best = max(valid_results, key=lambda r: r.confidence)
        return best

    async def _explore_path(self, path_id: int, hypothesis: str,
                            case_data: CaseData, system_prompt: str,
                            session_id: str) -> DiagnosisResult:
        """Explore a single hypothesis path."""
        prompt = f"""Explore this hypothesis: {hypothesis}

Case ID: {case_data.case_id}
Focus your analysis on validating or refuting this specific hypothesis.
Provide your conclusion as a JSON diagnosis."""

        try:
            response = await self.llm.chat_simple(
                system=system_prompt[:2000],
                user=prompt,
                temperature=0.3,
            )

            # Try to parse diagnosis from response
            diagnosis = self._parse_diagnosis_response(response, case_data.case_id, session_id)
            return diagnosis
        except Exception as e:
            logger.error("Path %d exploration failed: %s", path_id, e)
            raise

    def _parse_diagnosis_response(self, response: str, case_id: int, session_id: str) -> DiagnosisResult:
        """Parse LLM response into a DiagnosisResult."""
        # Try to extract JSON from response
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        try:
            data = json.loads(text)
            return DiagnosisResult(
                session_id=session_id,
                case_id=case_id,
                fault_elements=data.get("fault_elements", []),
                fault_links=data.get("fault_links", []),
                fault_type=data.get("fault_type", "unknown"),
                fault_mode=data.get("fault_mode"),
                confidence=float(data.get("confidence", 0.5)),
                route_taken=Route.AUTONOMOUS,
                status=SessionStatus.COMPLETED,
            )
        except (json.JSONDecodeError, ValueError):
            # Fallback: return low-confidence result
            return DiagnosisResult(
                session_id=session_id,
                case_id=case_id,
                fault_type="unknown",
                confidence=0.2,
                route_taken=Route.AUTONOMOUS,
                status=SessionStatus.COMPLETED,
            )
