"""LiveEvaluator: 评估 + 优化建议流式 emit。"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _precision_recall(pred: list[str], truth: list[str]) -> tuple[float, float, float]:
    p_set, t_set = set(pred), set(truth)
    if not p_set and not t_set:
        return 1.0, 1.0, 1.0
    tp = len(p_set & t_set)
    precision = tp / len(p_set) if p_set else 0.0
    recall = tp / len(t_set) if t_set else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1


class LiveEvaluator:
    def __init__(self, bus):
        self.bus = bus

    def evaluate_and_emit(
        self,
        diagnosis: dict,
        truth: dict,
        trace_axes: dict,
        skill: Optional[dict],
    ) -> None:
        pred_elems = diagnosis.get("fault_elements") or []
        truth_elems = truth.get("elements") or []
        precision, recall, f1 = _precision_recall(pred_elems, truth_elems)
        exact_match = (set(pred_elems) == set(truth_elems)) and f1 >= 0.99
        report = {
            "metrics": {
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "exact_match": exact_match,
            },
            "trace_axes": trace_axes,
            "suggestions": [],
            "case_entry": {"category": "SUCCESS" if exact_match else "PARTIAL_SUCCESS"},
        }
        self.bus.publish("evaluation_report", report)
        if skill is not None:
            self.bus.publish("skill_evolved", skill)
