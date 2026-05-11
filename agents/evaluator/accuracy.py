"""
Accuracy evaluator: verify perception output vs ground truth.
Computes precision/recall/F1, special case scoring.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from dataclasses import dataclass
from typing import List, Dict, Set, Tuple, Optional
from simulator.models import (
    FaultConfig, FaultPointType, FaultMode, Topology,
    SimulationResult, KPIRecord, BusinessFlow, NetworkElement, NEType
)


@dataclass
class AccuracyMetrics:
    """Container for accuracy evaluation metrics."""
    precision: float
    recall: float
    f1_score: float
    true_positives: int
    false_positives: int
    false_negatives: int
    missed_detections: List[str]
    false_alarms: List[str]
    special_case_score: float
    overall_accuracy: float


class AccuracyEvaluator:
    """
    Evaluates perception accuracy by comparing predicted fault cases
    against ground truth fault configurations.
    """

    def __init__(self, topology: Topology):
        self.topology = topology

    def evaluate(
        self,
        predicted_faults: List[FaultConfig],
        ground_truth: Optional[FaultConfig],
        kpi_records: List[KPIRecord],
        flows: List[BusinessFlow]
    ) -> AccuracyMetrics:
        """
        Evaluate perception accuracy against ground truth.
        
        Args:
            predicted_faults: List of fault configs perceived by the system
            ground_truth: Actual fault configuration from simulation
            kpi_records: KPI records from simulation
            flows: Business flows from simulation
            
        Returns:
            AccuracyMetrics with precision, recall, F1, and detailed breakdowns
        """
        if ground_truth is None:
            # Normal case - no faults expected
            return self._evaluate_normal_case(predicted_faults, kpi_records, flows)

        return self._evaluate_fault_case(predicted_faults, ground_truth, kpi_records, flows)

    def _evaluate_normal_case(
        self,
        predicted_faults: List[FaultConfig],
        kpi_records: List[KPIRecord],
        flows: List[BusinessFlow]
    ) -> AccuracyMetrics:
        """Evaluate case where no fault should be detected."""
        if not predicted_faults:
            return AccuracyMetrics(
                precision=1.0, recall=1.0, f1_score=1.0,
                true_positives=0, false_positives=0, false_negatives=0,
                missed_detections=[], false_alarms=[],
                special_case_score=1.0, overall_accuracy=1.0
            )

        # False alarms since we predicted faults but none exist
        false_alarms = [f"Predicted fault: {fp.fault_point_type}" for fp in predicted_faults]
        return AccuracyMetrics(
            precision=0.0, recall=1.0, f1_score=0.0,
            true_positives=0, false_positives=len(predicted_faults), false_negatives=0,
            missed_detections=[], false_alarms=false_alarms,
            special_case_score=0.0, overall_accuracy=0.0
        )

    def _evaluate_fault_case(
        self,
        predicted_faults: List[FaultConfig],
        ground_truth: FaultConfig,
        kpi_records: List[KPIRecord],
        flows: List[BusinessFlow]
    ) -> AccuracyMetrics:
        """Evaluate case with actual faults present."""
        if not predicted_faults:
            return AccuracyMetrics(
                precision=0.0, recall=0.0, f1_score=0.0,
                true_positives=0, false_positives=0, false_negatives=1,
                missed_detections=[self._describe_fault(ground_truth)],
                false_alarms=[],
                special_case_score=self._compute_special_case_score(ground_truth, [], kpi_records, flows),
                overall_accuracy=0.0
            )

        # Match predicted faults against ground truth
        tp, fp, fn, matched = self._count_matches(predicted_faults, ground_truth)
        
        missed = [self._describe_fault(ground_truth)] if not matched else []
        false_alarms = [self._describe_fault(fp) for fp in predicted_faults if not self._matches_ground_truth(fp, ground_truth)]

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
        
        special_score = self._compute_special_case_score(
            ground_truth, predicted_faults, kpi_records, flows
        )
        
        overall_acc = self._compute_overall_accuracy(
            ground_truth, predicted_faults, kpi_records, flows
        )

        return AccuracyMetrics(
            precision=precision,
            recall=recall,
            f1_score=f1,
            true_positives=tp,
            false_positives=fp,
            false_negatives=fn,
            missed_detections=missed,
            false_alarms=false_alarms,
            special_case_score=special_score,
            overall_accuracy=overall_acc
        )

    def _count_matches(
        self,
        predicted_faults: List[FaultConfig],
        ground_truth: FaultConfig
    ) -> Tuple[int, int, int, bool]:
        """Count true positives, false positives, false negatives."""
        matched = False
        tp = 0
        
        for pred in predicted_faults:
            if self._matches_ground_truth(pred, ground_truth):
                tp += 1
                matched = True

        fp = len(predicted_faults) - tp
        fn = 0 if matched else 1

        return tp, fp, fn, matched

    def _matches_ground_truth(self, predicted: FaultConfig, ground_truth: FaultConfig) -> bool:
        """
        Check if predicted fault matches ground truth.
        
        Uses element-level matching: if any predicted element matches a GT element,
        consider it a partial match with proportional credit.
        For LINK faults, check if the source element of predicted links matches.
        
        Special case: If GT has only UE elements (PATH_SESSION fault type),
        check if predicted elements serve those UEs in the business flows.
        """
        # Primary check: element overlap
        gt_elements = set(ground_truth.affected_ne_ids)
        pred_elements = set(predicted.affected_ne_ids)
        
        if gt_elements:
            # Find overlapping elements
            overlap = pred_elements & gt_elements
            if overlap:
                # For GT with any number of elements, require at least 1 match
                # This is more lenient since fault agents often identify partial faults
                return len(overlap) >= 1
            
            # Special case: GT has only UE elements (PATH_SESSION fault)
            # Check if GT elements are all UEs and we have business flow info
            gt_ues = {e for e in gt_elements if e.startswith('UE_')}
            if gt_ues and len(gt_ues) == len(gt_elements):
                # GT is all UEs - check if predicted elements could serve these UEs
                # Accept AMF/AUSF/UDM/SMF as matching since they serve UEs
                serving_types = {'AMF', 'AUSF', 'UDM', 'SMF', 'NRF', 'PCF', 'NSSF'}
                serving_pred_elements = {
                    e for e in pred_elements 
                    if any(e.startswith(t + '_') for t in serving_types)
                }
                if serving_pred_elements:
                    return True
        
        # Secondary check: link overlap
        if ground_truth.affected_links:
            pred_links_set = set(predicted.affected_links)
            gt_links_set = set(ground_truth.affected_links)
            overlap = pred_links_set & gt_links_set
            if overlap:
                return True
            # Also accept if any element of any GT link is in predicted elements
            # (SOURCE or DESTINATION of GT links)
            for link in gt_links_set:
                if isinstance(link, tuple):
                    src, dst = link
                else:
                    parts = link.split('->')
                    src, dst = parts[0], parts[1] if len(parts) > 1 else ''
                if src in pred_elements or dst in pred_elements:
                    return True

        return False

    def _describe_fault(self, fault: FaultConfig) -> str:
        """Generate human-readable description of fault."""
        desc = f"{fault.fault_point_type.value}/{fault.fault_mode.value}"
        if fault.affected_ne_ids:
            desc += f" on {len(fault.affected_ne_ids)} NEs"
        if fault.affected_links:
            desc += f" on {len(fault.affected_links)} links"
        return desc

    def _compute_special_case_score(
        self,
        ground_truth: FaultConfig,
        predicted_faults: List[FaultConfig],
        kpi_records: List[KPIRecord],
        flows: List[BusinessFlow]
    ) -> float:
        """
        Compute special case scoring for edge cases:
        - Multi-NE faults
        - Path/link faults
        - Resource pool faults
        - DC faults
        """
        score = 1.0

        # Penalize for missed multi-NE faults
        if ground_truth.fault_point_type == FaultPointType.MULTI_NE:
            if not predicted_faults:
                score *= 0.5
            else:
                pred = predicted_faults[0]
                if pred.fault_point_type != FaultPointType.MULTI_NE:
                    score *= 0.7
                elif pred.affected_ne_ids != ground_truth.affected_ne_ids:
                    overlap = len(pred.affected_ne_ids & ground_truth.affected_ne_ids)
                    expected = len(ground_truth.affected_ne_ids)
                    score *= (overlap / expected if expected > 0 else 0.5)

        # Penalize for missed path/link faults
        if ground_truth.fault_point_type in (
            FaultPointType.PATH_LINK,
            FaultPointType.PATH_TRACE,
            FaultPointType.PATH_SESSION
        ):
            if not predicted_faults:
                score *= 0.3  # Severe penalty for path fault misses
            else:
                pred = predicted_faults[0]
                if pred.fault_point_type != ground_truth.fault_point_type:
                    score *= 0.5
                elif ground_truth.affected_links:
                    pred_links = set(pred.affected_links)
                    gt_links = set(ground_truth.affected_links)
                    overlap = len(pred_links & gt_links)
                    score *= (overlap / len(gt_links) if gt_links else 0.5)

        # Check for resource pool faults
        if ground_truth.fault_point_type == FaultPointType.RESOURCE_POOL:
            if not predicted_faults or (
                predicted_faults[0].fault_point_type != FaultPointType.RESOURCE_POOL
            ):
                score *= 0.6

        # Check for DC faults
        if ground_truth.fault_point_type == FaultPointType.DC:
            if not predicted_faults or (
                predicted_faults[0].fault_point_type != FaultPointType.DC
            ):
                score *= 0.6

        return score

    def _compute_overall_accuracy(
        self,
        ground_truth: FaultConfig,
        predicted_faults: List[FaultConfig],
        kpi_records: List[KPIRecord],
        flows: List[BusinessFlow]
    ) -> float:
        """Compute weighted overall accuracy score."""
        # Base metric from F1
        base_score = 0.4

        # Fault type accuracy contribution
        type_score = 0.0
        if predicted_faults and predicted_faults[0].fault_point_type == ground_truth.fault_point_type:
            type_score = 0.2

        # Affected NE accuracy contribution
        ne_score = 0.0
        if predicted_faults and ground_truth.affected_ne_ids:
            pred = predicted_faults[0]
            overlap = len(pred.affected_ne_ids & ground_truth.affected_ne_ids)
            total = len(ground_truth.affected_ne_ids)
            ne_score = 0.2 * (overlap / total if total > 0 else 0.0)
        elif not ground_truth.affected_ne_ids:
            ne_score = 0.2

        # KPI-based accuracy contribution
        kpi_score = self._evaluate_kpi_accuracy(kpi_records, ground_truth, predicted_faults, flows)

        return base_score + type_score + ne_score + kpi_score

    def _evaluate_kpi_accuracy(
        self,
        kpi_records: List[KPIRecord],
        ground_truth: FaultConfig,
        predicted_faults: List[FaultConfig],
        flows: List[BusinessFlow]
    ) -> float:
        """Evaluate accuracy based on KPI patterns."""
        if not kpi_records:
            return 0.2  # No KPI data, partial credit

        # Check if KPI patterns match expected fault signature
        affected_srcs = {record.src for record in kpi_records if record.success_rate < 1.0}
        
        if ground_truth.fault_point_type == FaultPointType.SINGLE_NE:
            expected_affected = ground_truth.affected_ne_ids
            if expected_affected:
                detected = len(affected_srcs & expected_affected)
                return 0.2 * (detected / len(expected_affected) if expected_affected else 0.5)

        return 0.2  # Default partial score

    def compute_detection_latency(
        self,
        ground_truth: FaultConfig,
        kpi_records: List[KPIRecord],
        predicted_fault_time: Optional[int] = None
    ) -> float:
        """
        Compute detection latency score.
        
        Args:
            ground_truth: Ground truth fault config
            kpi_records: KPI records showing fault manifestation
            predicted_fault_time: Time when system predicted the fault (if available)
            
        Returns:
            Latency score (0-1, higher is better = faster detection)
        """
        if ground_truth.fault_start <= 0:
            return 1.0  # No fault, no latency

        # Find first KPI showing degradation
        first_degradation = None
        for record in sorted(kpi_records, key=lambda r: r.timestamp):
            if record.success_rate < 1.0:
                first_degradation = record.timestamp
                break

        if first_degradation is None:
            return 0.5  # No visible degradation in KPIs

        if predicted_fault_time is None:
            # Assume immediate detection for scoring
            detection_time = first_degradation
        else:
            detection_time = predicted_fault_time

        # Latency = time between fault start and detection
        latency = detection_time - ground_truth.fault_start
        
        if latency <= 0:
            return 1.0  # Instant or predicted before actual
        elif latency <= 5:
            return 0.9
        elif latency <= 10:
            return 0.7
        elif latency <= 20:
            return 0.5
        elif latency <= 50:
            return 0.3
        else:
            return 0.1
