"""Case library builder: categorizes and stores diagnosis cases."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from agents.shared.models import (
    DiagnosisResult, EvaluationMetrics, CaseCategory, CaseDifficulty, CaseLibraryEntry,
)

logger = logging.getLogger(__name__)


class CaseLibraryBuilder:
    """Builds and maintains a case library from evaluation results."""

    def __init__(self, library_path: str = "./storage/case_library"):
        self.library_path = Path(library_path)
        self.library_path.mkdir(parents=True, exist_ok=True)

    def create_entry(
        self,
        diagnosis: DiagnosisResult,
        metrics: EvaluationMetrics,
        ground_truth: dict,
        difficulty: str = "medium",
    ) -> CaseLibraryEntry:
        # Determine category
        if metrics.exact_match:
            category = CaseCategory.SUCCESS
        elif metrics.recall > 0.5:
            category = CaseCategory.PARTIAL_SUCCESS
        elif len(diagnosis.fault_elements) > len(ground_truth.get("fault_elements", [])):
            category = CaseCategory.FALSE_POSITIVE
        else:
            category = CaseCategory.FAILURE

        # Extract key observations from reasoning trace
        observations = []
        for step in diagnosis.reasoning_trace:
            if step.step_type == "conclusion":
                observations.append(step.content)
            elif step.step_type == "tool_call" and step.tool_result:
                observations.append(f"{step.tool_name}: {step.tool_result[:100]}")

        # Extract lessons
        lessons = self._extract_lessons(category, diagnosis, metrics, ground_truth)

        entry = CaseLibraryEntry(
            case_id=diagnosis.case_id,
            session_id=diagnosis.session_id,
            category=category,
            fault_type=diagnosis.fault_type or "unknown",
            difficulty=CaseDifficulty(difficulty),
            diagnosis_correct=metrics.exact_match,
            diagnosis_mode=diagnosis.route_taken.value,
            key_observations=observations[:5],
            lessons=lessons,
        )

        # Save to library
        self._save_entry(entry)

        return entry

    def _extract_lessons(self, category: CaseCategory, diagnosis: DiagnosisResult,
                         metrics: EvaluationMetrics, ground_truth: dict) -> list[str]:
        lessons = []
        truth_elements = set(ground_truth.get("fault_elements", []))
        pred_elements = set(diagnosis.fault_elements)

        if category == CaseCategory.SUCCESS:
            lessons.append(f"Correctly identified {diagnosis.fault_type} fault via {diagnosis.route_taken.value} path")
        elif category == CaseCategory.PARTIAL_SUCCESS:
            missed = truth_elements - pred_elements
            if missed:
                lessons.append(f"Missed elements: {missed}")
            extra = pred_elements - truth_elements
            if extra:
                lessons.append(f"False positives: {extra}")
        elif category == CaseCategory.FAILURE:
            lessons.append(f"Failed to identify {diagnosis.fault_type} fault. Truth: {truth_elements}")
            if diagnosis.route_taken.value == "workflow":
                lessons.append("Workflow path was insufficient for this case; consider using guided/autonomous")
        elif category == CaseCategory.FALSE_POSITIVE:
            lessons.append(f"Over-diagnosed: predicted {pred_elements}, truth was {truth_elements}")

        return lessons

    def _save_entry(self, entry: CaseLibraryEntry) -> None:
        entry_file = self.library_path / f"case_{entry.case_id:03d}.json"
        data = {
            "case_id": entry.case_id,
            "session_id": entry.session_id,
            "category": entry.category.value,
            "fault_type": entry.fault_type,
            "difficulty": entry.difficulty.value,
            "diagnosis_correct": entry.diagnosis_correct,
            "diagnosis_mode": entry.diagnosis_mode,
            "key_observations": entry.key_observations,
            "lessons": entry.lessons,
        }
        entry_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def load_library(self) -> list[dict]:
        entries = []
        for f in sorted(self.library_path.glob("case_*.json")):
            data = json.loads(f.read_text(encoding="utf-8"))
            entries.append(data)
        return entries

    def get_statistics(self) -> dict:
        entries = self.load_library()
        if not entries:
            return {"total": 0}

        by_category = {}
        by_fault_type = {}
        for e in entries:
            cat = e.get("category", "unknown")
            ft = e.get("fault_type", "unknown")
            by_category[cat] = by_category.get(cat, 0) + 1
            by_fault_type[ft] = by_fault_type.get(ft, 0) + 1

        success_count = by_category.get("success", 0) + by_category.get("partial_success", 0)
        return {
            "total": len(entries),
            "success_rate": round(success_count / len(entries), 4),
            "by_category": by_category,
            "by_fault_type": by_fault_type,
        }
