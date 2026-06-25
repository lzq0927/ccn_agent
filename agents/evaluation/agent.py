"""Evaluation & Optimization Agent - evaluates diagnoses and generates improvements."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable

from agents.shared.llm_client import LLMClient, LLMConfig
from agents.shared.llm_config import load_llm_config
from agents.shared.models import (
    DiagnosisResult,
    CaseData,
    EvaluationReport,
)
from agents.shared.storage import Storage
from agents.shared.message_bus import MessageBus
from agents.evaluation.evaluator import Evaluator
from agents.evaluation.trace_analyzer import TraceAnalyzer
from agents.evaluation.case_library import CaseLibraryBuilder
from agents.evaluation.optimization_advisor import OptimizationAdvisor

logger = logging.getLogger(__name__)


class EvaluationOptimizationAgent:
    """Agent 3: Evaluates diagnosis results and generates optimization suggestions.

    Loop 3 (Design-time):
        Evaluate → Analyze → Build Case Library → Generate Suggestions → Feedback
    """

    def __init__(
        self,
        storage: Storage | None = None,
        message_bus: MessageBus | None = None,
        llm_config: LLMConfig | None = None,
        progress_callback: Callable[[dict], None] | None = None,
    ):
        self.storage = storage or Storage()
        self.bus = message_bus
        self.progress_callback = progress_callback

        llm = LLMClient(llm_config or load_llm_config())

        self.evaluator = Evaluator()
        self.trace_analyzer = TraceAnalyzer(llm)
        self.case_library = CaseLibraryBuilder()
        self.advisor = OptimizationAdvisor(llm)

    async def evaluate(
        self,
        diagnosis: DiagnosisResult,
        case_data: CaseData,
        difficulty: str = "medium",
    ) -> EvaluationReport:
        """Evaluate a single diagnosis against ground truth."""
        # Step 1: Compare against ground truth
        metrics = self.evaluator.compare(diagnosis, case_data.ground_truth)
        logger.info(
            "Case %d: exact=%s, P=%.3f, R=%.3f, F1=%.3f",
            case_data.case_id,
            metrics.exact_match,
            metrics.precision,
            metrics.recall,
            metrics.f1,
        )

        # Step 2: Analyze reasoning trace
        trace_quality = 0.5
        if diagnosis.reasoning_trace:
            trace_analysis = await self.trace_analyzer.analyze(diagnosis.reasoning_trace)
            trace_quality = trace_analysis.get("overall_score", 0.5)
        else:
            trace_analysis = {"overall_score": 0.0, "strengths": [], "weaknesses": ["No trace"]}

        # Step 3: Build case library entry
        case_entry = self.case_library.create_entry(
            diagnosis,
            metrics,
            case_data.ground_truth,
            difficulty=difficulty,
        )

        # Step 4: Generate optimization suggestions if needed
        suggestions = []
        if not metrics.exact_match or metrics.f1 < 0.8:
            suggestions = await self.advisor.analyze(case_entry, diagnosis, metrics)

        # Step 5: Save evaluation
        eval_id = self.storage.save_evaluation(
            session_id=diagnosis.session_id,
            case_id=case_data.case_id,
            exact_match=metrics.exact_match,
            precision=metrics.precision,
            recall=metrics.recall,
            f1=metrics.f1,
            fault_type_match=metrics.fault_type_match,
            case_category=case_entry.category.value,
            trace_quality=trace_quality,
            notes=json.dumps(
                {
                    "strengths": trace_analysis.get("strengths", []),
                    "weaknesses": trace_analysis.get("weaknesses", []),
                },
                ensure_ascii=False,
            ),
        )

        # Save suggestions
        for sug in suggestions:
            self.storage.save_suggestion(
                evaluation_id=eval_id,
                suggestion_type=sug.suggestion_type.value,
                target=sug.target,
                content=sug.content,
                evidence=json.dumps(sug.evidence, ensure_ascii=False),
                priority=sug.priority,
            )

        # Publish events
        if self.bus:
            await self.bus.publish(
                "evaluation.report",
                {
                    "session_id": diagnosis.session_id,
                    "case_id": case_data.case_id,
                    "metrics": {"exact_match": metrics.exact_match, "f1": metrics.f1},
                    "category": case_entry.category.value,
                },
                sender="agent_3",
            )

            for sug in suggestions:
                channel = {
                    "skill_update": "optimization.skill",
                    "workflow_update": "optimization.workflow",
                    "new_case": "optimization.cases",
                }.get(sug.suggestion_type.value, "optimization.skill")
                await self.bus.publish(
                    channel,
                    {
                        "target": sug.target,
                        "content": sug.content,
                        "evidence": sug.evidence,
                    },
                    sender="agent_3",
                )

        self._emit_progress(
            "evaluation_complete",
            {
                "case_id": case_data.case_id,
                "exact_match": metrics.exact_match,
                "f1": metrics.f1,
                "category": case_entry.category.value,
                "suggestions": len(suggestions),
            },
        )

        return EvaluationReport(
            evaluation_id=eval_id,
            session_id=diagnosis.session_id,
            case_id=case_data.case_id,
            metrics=metrics,
            case_entry=case_entry,
            suggestions=suggestions,
            trace_quality_score=trace_quality,
        )

    async def evaluate_batch(
        self,
        results: list[tuple[DiagnosisResult, CaseData]],
    ) -> list[EvaluationReport]:
        """Evaluate a batch of diagnoses."""
        reports = []
        passed = 0
        total = len(results)

        for i, (diagnosis, case_data) in enumerate(results):
            self._emit_progress(
                "evaluation_progress",
                {
                    "completed": i,
                    "total": total,
                },
            )

            report = await self.evaluate(diagnosis, case_data)
            reports.append(report)
            if report.metrics.exact_match:
                passed += 1

        accuracy = passed / max(total, 1)
        logger.info("Batch evaluation: %d/%d exact match (%.1f%%)", passed, total, accuracy * 100)

        return reports

    def _emit_progress(self, event_type: str, data: dict) -> None:
        if self.progress_callback:
            self.progress_callback({"type": event_type, **data})


async def main():
    """CLI entry point for evaluation agent."""
    import argparse

    parser = argparse.ArgumentParser(description="5GC Evaluation & Optimization Agent")
    parser.add_argument(
        "--evaluate-all", action="store_true", help="Evaluate all completed sessions"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )

    EvaluationOptimizationAgent()  # construct to initialize defaults (unused in this placeholder CLI)

    if args.evaluate_all:
        storage = Storage()
        sessions = storage.list_sessions(limit=100)
        print(f"Found {len(sessions)} sessions")

        for session in sessions:
            if session["status"] != "completed":
                continue
            print(f"\nEvaluating session {session['session_id']} (case {session['case_id']})...")
            # Note: would need to load case data and diagnosis result
            # This is a placeholder for the full closed-loop runner
    else:
        print("Use --evaluate-all to evaluate completed sessions")


if __name__ == "__main__":
    asyncio.run(main())
