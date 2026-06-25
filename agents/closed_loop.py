"""Closed-loop runner: orchestrates the full data gen → perceive → evaluate cycle."""

from __future__ import annotations

import asyncio
import csv
import json
import logging
from typing import Callable

from agents.shared.llm_client import LLMConfig
from agents.shared.llm_config import load_llm_config
from agents.shared.models import CaseData, ValidationStatus, parse_chr_jsonl
from agents.shared.storage import Storage
from agents.shared.message_bus import MessageBus
from agents.data_generation.agent import FaultDataGenerationAgent
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluation.agent import EvaluationOptimizationAgent

logger = logging.getLogger(__name__)


class ClosedLoopRunner:
    """Orchestrates the full closed-loop iteration."""

    def __init__(
        self,
        storage: Storage | None = None,
        message_bus: MessageBus | None = None,
        progress_callback: Callable[[dict], None] | None = None,
        llm_config: LLMConfig | None = None,
    ):
        self.storage = storage or Storage()
        self.bus = message_bus or MessageBus()
        self.progress_callback = progress_callback
        self.llm_config = llm_config or load_llm_config()

        self.gen_agent = FaultDataGenerationAgent(
            storage=self.storage,
            message_bus=self.bus,
            progress_callback=progress_callback,
        )
        self.perception_agent = FaultPerceptionAgent(
            storage=self.storage,
            message_bus=self.bus,
            progress_callback=progress_callback,
        )
        self.eval_agent = EvaluationOptimizationAgent(
            storage=self.storage,
            message_bus=self.bus,
        )

    async def run_iteration(
        self,
        case_count: int = 20,
        seed: int = 42,
        iteration_number: int = 1,
    ) -> dict:
        """Run one full closed-loop iteration."""
        logger.info("=== Closed-Loop Iteration %d ===", iteration_number)
        iteration_id = self.storage.start_loop_iteration(
            loop_type="full_cycle",
            iteration_number=iteration_number,
        )

        self._emit("loop_start", {"iteration": iteration_number, "cases": case_count})

        # Phase 1: Generate cases
        self._emit("phase_start", {"phase": "data_generation"})
        packages = await self.gen_agent.generate_batch(count=case_count, seed=seed + iteration_number)
        passed_cases = [p for p in packages if p.metadata.validation_status == ValidationStatus.PASSED]
        logger.info("Generated %d cases, %d passed validation", len(packages), len(passed_cases))

        # Phase 2: Diagnose each case
        self._emit("phase_start", {"phase": "fault_perception"})
        diagnosis_results = []
        case_data_list = []

        for i, package in enumerate(passed_cases):
            self._emit("perception_progress", {"completed": i, "total": len(passed_cases)})

            # Load case data
            case_data = self._load_case_data(package)
            case_data_list.append(case_data)

            # Diagnose
            result = await self.perception_agent.diagnose(case_data)
            diagnosis_results.append(result)

        # Phase 3: Evaluate
        self._emit("phase_start", {"phase": "evaluation"})
        pairs = list(zip(diagnosis_results, case_data_list))
        reports = await self.eval_agent.evaluate_batch(pairs)

        # Compute aggregate metrics
        exact_matches = sum(1 for r in reports if r.metrics.exact_match)
        avg_f1 = sum(r.metrics.f1 for r in reports) / max(len(reports), 1)
        accuracy = exact_matches / max(len(reports), 1)

        logger.info("=== Iteration %d Results ===", iteration_number)
        logger.info("  Cases: %d generated, %d valid, %d diagnosed, %d evaluated",
                     len(packages), len(passed_cases), len(diagnosis_results), len(reports))
        logger.info("  Accuracy: %.1f%% (%d/%d exact match)", accuracy * 100, exact_matches, len(reports))
        logger.info("  Average F1: %.4f", avg_f1)

        # Complete loop iteration
        self.storage.complete_loop_iteration(
            iteration_id=iteration_id,
            cases_generated=len(packages),
            cases_evaluated=len(reports),
            accuracy_after=accuracy,
            summary=f"Accuracy: {accuracy:.2%}, Avg F1: {avg_f1:.4f}",
        )

        result = {
            "iteration": iteration_number,
            "cases_generated": len(packages),
            "cases_valid": len(passed_cases),
            "cases_evaluated": len(reports),
            "exact_match_accuracy": round(accuracy, 4),
            "avg_f1": round(avg_f1, 4),
            "by_category": self._categorize_reports(reports),
        }

        self._emit("loop_complete", result)
        return result

    async def run_multi_iteration(self, iterations: int = 3, cases_per_iteration: int = 20) -> list[dict]:
        """Run multiple closed-loop iterations."""
        results = []
        for i in range(1, iterations + 1):
            result = await self.run_iteration(
                case_count=cases_per_iteration,
                iteration_number=i,
            )
            results.append(result)
        return results

    def _load_case_data(self, package) -> CaseData:
        """Convert CasePackage to CaseData for diagnosis."""
        # Parse CSV
        kpi_rows = []
        reader = csv.DictReader(package.kpi_data.strip().split("\n"))
        for row in reader:
            kpi_rows.append(row)

        # Parse result.txt
        ground_truth = json.loads(package.result_text)

        # Parse free5GC-faithful CHR (JSONL → list of dicts)
        chr_records = parse_chr_jsonl(package.chr_data)

        return CaseData(
            case_id=package.case_id,
            kpi_rows=kpi_rows,
            topology_text=package.topology_text,
            process_text=package.process_text,
            ground_truth=ground_truth,
            metadata=package.metadata,
            chr_records=chr_records,
        )

    def _categorize_reports(self, reports: list) -> dict:
        cats = {}
        for r in reports:
            cat = r.case_entry.category.value if r.case_entry else "unknown"
            cats[cat] = cats.get(cat, 0) + 1
        return cats

    def _emit(self, event_type: str, data: dict) -> None:
        if self.progress_callback:
            self.progress_callback({"type": event_type, **data})


async def main():
    """CLI entry point for closed-loop runner."""
    import argparse

    parser = argparse.ArgumentParser(description="5GC Closed-Loop Runner")
    parser.add_argument("--cases", type=int, default=10, help="Cases per iteration")
    parser.add_argument("--iterations", type=int, default=1, help="Number of iterations")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    runner = ClosedLoopRunner()

    def progress_handler(event):
        etype = event.get("type", "")
        if "progress" in etype or "start" in etype:
            return  # Skip verbose updates
        print(f"[{etype}] {json.dumps({k: v for k, v in event.items() if k != 'type'}, ensure_ascii=False)}")

    runner.progress_callback = progress_handler

    results = await runner.run_multi_iteration(
        iterations=args.iterations,
        cases_per_iteration=args.cases,
    )

    print("\n=== Final Summary ===")
    for r in results:
        print(f"Iteration {r['iteration']}: accuracy={r['exact_match_accuracy']:.2%}, "
              f"F1={r['avg_f1']:.4f}, evaluated={r['cases_evaluated']}")


if __name__ == "__main__":
    asyncio.run(main())
