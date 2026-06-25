"""Evaluator: compares diagnosis results against ground truth."""

from __future__ import annotations

import logging

from agents.shared.models import DiagnosisResult, EvaluationMetrics

logger = logging.getLogger(__name__)


class Evaluator:
    """Compares diagnosis results against ground truth."""

    def compare(self, diagnosis: DiagnosisResult, ground_truth: dict) -> EvaluationMetrics:
        pred_elements = set(diagnosis.fault_elements)
        truth_elements = set(ground_truth.get("fault_elements", []))

        pred_links = set(diagnosis.fault_links)
        truth_links = set(ground_truth.get("fault_links", []))

        # Element-level metrics
        tp = len(pred_elements & truth_elements)
        fp = len(pred_elements - truth_elements)
        fn = len(truth_elements - pred_elements)

        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-9)

        exact_match = pred_elements == truth_elements and pred_links == truth_links

        # Fault type match
        gt_fault_type = self._infer_fault_type(truth_elements, ground_truth)
        fault_type_match = diagnosis.fault_type == gt_fault_type

        return EvaluationMetrics(
            exact_match=exact_match,
            precision=round(precision, 4),
            recall=round(recall, 4),
            f1=round(f1, 4),
            fault_type_match=fault_type_match,
        )

    def _infer_fault_type(self, truth_elements: set, ground_truth: dict) -> str:
        """Infer fault type from ground truth if not directly available."""
        if not truth_elements and not ground_truth.get("fault_links"):
            return "normal"
        return "unknown"
