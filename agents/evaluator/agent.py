"""
Main evaluator agent: orchestrates accuracy, process analysis, and optimization.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from datetime import datetime

from simulator.models import Topology, FaultConfig, SimulationResult, KPIRecord
from agents.evaluator.accuracy import AccuracyEvaluator, AccuracyMetrics
from agents.evaluator.process_analyzer import (
    ProcessAnalyzer, ProcessAnalysisResult, ReasoningQuality
)
from agents.evaluator.optimizer import Optimizer, OptimizationReport, OptimizationSuggestion
from agents.evaluator.skills.skill_case_analysis import SkillCaseAnalysis, CaseAnalysisResult
from agents.evaluator.skills.skill_optimization_suggestion import (
    SkillOptimizationSuggestion, OptimizationAction
)


@dataclass
class EvaluationResult:
    """Complete evaluation result for a single case."""
    case_id: int
    timestamp: str
    accuracy: AccuracyMetrics
    process_analysis: ProcessAnalysisResult
    case_analysis: CaseAnalysisResult
    overall_score: float
    recommendations: List[str] = field(default_factory=list)


@dataclass
class AggregatedMetrics:
    """Aggregated metrics across multiple evaluations."""
    total_cases: int
    accuracy_summary: Dict[str, float]
    process_quality_distribution: Dict[str, int]
    common_failures: List[str]
    improvement_trends: List[Dict]
    skill_update_suggestions: Dict[str, str]


class EvaluatorAgent:
    """
    Main evaluator agent that orchestrates all evaluation components.
    
    Responsibilities:
    1. Evaluate perception accuracy vs ground truth
    2. Analyze reasoning trace quality
    3. Generate optimization suggestions
    4. Track iteration progress and maintain case library
    """

    def __init__(self, topology: Topology):
        self.topology = topology
        
        # Initialize components
        self.accuracy_evaluator = AccuracyEvaluator(topology)
        self.process_analyzer = ProcessAnalyzer(topology)
        self.optimizer = Optimizer(topology)
        self.case_analyzer = SkillCaseAnalysis(topology)
        self.optimization_skill = SkillOptimizationSuggestion()
        
        # Evaluation history
        self.evaluation_history: List[EvaluationResult] = []

    def evaluate_case(
        self,
        case_id: int,
        predicted_faults: List[FaultConfig],
        ground_truth: Optional[FaultConfig],
        simulation_result: SimulationResult,
        reasoning_trace: List[Dict[str, Any]]
    ) -> EvaluationResult:
        """
        Evaluate a single fault diagnosis case.
        
        Args:
            case_id: Case identifier
            predicted_faults: Fault configs predicted by perception system
            ground_truth: Actual fault configuration
            simulation_result: Simulation output with KPIs and flows
            reasoning_trace: Reasoning steps from the agent
            
        Returns:
            EvaluationResult with detailed evaluation
        """
        # Step 1: Evaluate accuracy
        accuracy_metrics = self.accuracy_evaluator.evaluate(
            predicted_faults=predicted_faults,
            ground_truth=ground_truth,
            kpi_records=simulation_result.kpi_records,
            flows=simulation_result.flows
        )

        # Step 2: Analyze process quality
        process_result = self.process_analyzer.analyze(
            reasoning_trace=reasoning_trace,
            ground_truth=ground_truth
        )

        # Step 3: Analyze case characteristics
        case_analysis = self.case_analyzer.analyze(
            case_id=str(case_id),
            fault_config=ground_truth,
            kpi_records=simulation_result.kpi_records,
            flows=simulation_result.flows
        )

        # Step 4: Compute overall score
        overall_score = self._compute_overall_score(
            accuracy_metrics, process_result
        )

        # Step 5: Generate recommendations
        recommendations = self._generate_recommendations(
            accuracy_metrics, process_result, case_analysis
        )

        # Create result
        result = EvaluationResult(
            case_id=case_id,
            timestamp=datetime.now().isoformat(),
            accuracy=accuracy_metrics,
            process_analysis=process_result,
            case_analysis=case_analysis,
            overall_score=overall_score,
            recommendations=recommendations
        )

        # Store in history
        self.evaluation_history.append(result)

        return result

    def _compute_overall_score(
        self,
        accuracy: AccuracyMetrics,
        process: ProcessAnalysisResult
    ) -> float:
        """Compute weighted overall score."""
        # Accuracy weight: 50%
        accuracy_score = (
            accuracy.f1_score * 0.3 +
            accuracy.overall_accuracy * 0.2
        )

        # Process quality weight: 30%
        process_score = process.overall_score * 0.3

        # Special case score weight: 20%
        special_score = accuracy.special_case_score * 0.2

        return accuracy_score + process_score + special_score

    def _generate_recommendations(
        self,
        accuracy: AccuracyMetrics,
        process: ProcessAnalysisResult,
        case: CaseAnalysisResult
    ) -> List[str]:
        """Generate recommendations based on evaluation."""
        recommendations = []

        # Accuracy-based recommendations
        if accuracy.precision < 0.7:
            recommendations.append("Reduce false positives by requiring stronger evidence")
        if accuracy.recall < 0.7:
            recommendations.append("Improve fault detection sensitivity")
        if accuracy.f1_score < 0.6:
            recommendations.append("Balance precision and recall")

        # Missed detections
        for missed in accuracy.missed_detections:
            recommendations.append(f"Add training for: {missed}")

        # False alarms
        for alarm in accuracy.false_alarms:
            recommendations.append(f"Reduce false alarm for: {alarm}")

        # Process-based recommendations
        recommendations.extend(process.recommendations)

        # Case-based recommendations
        if case.difficulty_score > 0.7:
            recommendations.append(f"Case is difficult ({case.difficulty_score:.1f}): {case.fault_pattern}")
            recommendations.extend(case.recommended_approaches[:2])

        return list(dict.fromkeys(recommendations))[:5]  # Top 5 unique

    def evaluate_batch(
        self,
        cases: List[Dict[str, Any]]
    ) -> List[EvaluationResult]:
        """
        Evaluate multiple cases.
        
        Args:
            cases: List of case dicts with keys:
                - case_id
                - predicted_faults
                - ground_truth
                - simulation_result
                - reasoning_trace
                
        Returns:
            List of EvaluationResult
        """
        results = []
        for case in cases:
            result = self.evaluate_case(
                case_id=case["case_id"],
                predicted_faults=case.get("predicted_faults", []),
                ground_truth=case.get("ground_truth"),
                simulation_result=case["simulation_result"],
                reasoning_trace=case.get("reasoning_trace", [])
            )
            results.append(result)
        return results

    def generate_optimization_report(
        self,
        case_library: Optional["CaseLibraryManager"] = None
    ) -> OptimizationReport:
        """
        Generate optimization report based on accumulated evaluations.
        
        Args:
            case_library: Optional case library for historical analysis
            
        Returns:
            OptimizationReport with suggestions
        """
        # Convert evaluation history to dict format
        accuracy_results = []
        for result in self.evaluation_history:
            accuracy_results.append({
                "case_id": result.case_id,
                "true_positives": result.accuracy.true_positives,
                "false_positives": result.accuracy.false_positives,
                "false_negatives": result.accuracy.false_negatives,
                "precision": result.accuracy.precision,
                "recall": result.accuracy.recall,
                "f1_score": result.accuracy.f1_score,
                "fault_type": result.case_analysis.fault_pattern,
                "detection_latency_score": 0.8  # Default
            })

        process_results = []
        for result in self.evaluation_history:
            process_results.append({
                "case_id": result.case_id,
                "logic_checks": [
                    {"check_name": c.check_name, "passed": c.passed, "score": c.score}
                    for c in result.process_analysis.logic_checks
                ],
                "topology_usage": {
                    "ne_types_missing": [
                        t.value for t in result.process_analysis.topology_usage.ne_types_missing
                    ]
                },
                "multi_agent_consistency": {
                    "agent_ids": result.process_analysis.multi_agent_consistency.agent_ids,
                    "conflicts": result.process_analysis.multi_agent_consistency.conflicts
                }
            })

        # Generate optimization report
        return self.optimizer.generate_optimizations(
            accuracy_results=accuracy_results,
            process_results=process_results,
            case_library=case_library
        )

    def get_skill_suggestions(
        self,
        accuracy_metrics: Optional[Dict[str, float]] = None,
        process_metrics: Optional[Dict[str, Any]] = None
    ) -> List[OptimizationAction]:
        """
        Get skill update suggestions.
        
        Args:
            accuracy_metrics: Current accuracy metrics
            process_metrics: Current process metrics
            
        Returns:
            List of OptimizationAction
        """
        return self.optimization_skill.generate_suggestions(
            accuracy_metrics=accuracy_metrics,
            process_metrics=process_metrics
        )

    def aggregate_metrics(
        self,
        recent_n: Optional[int] = None
    ) -> AggregatedMetrics:
        """
        Aggregate metrics across evaluations.
        
        Args:
            recent_n: If specified, only consider last N evaluations
            
        Returns:
            AggregatedMetrics
        """
        history = self.evaluation_history[-recent_n:] if recent_n else self.evaluation_history

        if not history:
            return AggregatedMetrics(
                total_cases=0,
                accuracy_summary={},
                process_quality_distribution={},
                common_failures=[],
                improvement_trends=[],
                skill_update_suggestions={}
            )

        # Accuracy summary
        total_tp = sum(r.accuracy.true_positives for r in history)
        total_fp = sum(r.accuracy.false_positives for r in history)
        total_fn = sum(r.accuracy.false_negatives for r in history)

        precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
        recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        accuracy_summary = {
            "precision": precision,
            "recall": recall,
            "f1_score": f1,
            "avg_accuracy": sum(r.overall_score for r in history) / len(history)
        }

        # Process quality distribution
        quality_counts = {}
        for r in history:
            quality = r.process_analysis.quality.value
            quality_counts[quality] = quality_counts.get(quality, 0) + 1

        # Common failures
        all_recommendations = []
        for r in history:
            all_recommendations.extend(r.recommendations)
        
        from collections import Counter
        recommendation_counts = Counter(all_recommendations)
        common_failures = [rec for rec, count in recommendation_counts.most_common(5)]

        # Improvement trends
        improvement_trends = []
        for r in history:
            improvement_trends.append({
                "case_id": r.case_id,
                "timestamp": r.timestamp,
                "overall_score": r.overall_score,
                "f1_score": r.accuracy.f1_score
            })

        # Skill update suggestions
        opt_report = self.generate_optimization_report()
        skill_update_suggestions = opt_report.skill_updates

        return AggregatedMetrics(
            total_cases=len(history),
            accuracy_summary=accuracy_summary,
            process_quality_distribution=quality_counts,
            common_failures=common_failures,
            improvement_trends=improvement_trends,
            skill_update_suggestions=skill_update_suggestions
        )

    def get_case_with_lowest_score(self) -> Optional[EvaluationResult]:
        """Get the case with the lowest overall score for focused improvement."""
        if not self.evaluation_history:
            return None
        return min(self.evaluation_history, key=lambda r: r.overall_score)

    def get_cases_by_fault_type(self, fault_type: str) -> List[EvaluationResult]:
        """Get all cases of a specific fault type."""
        return [
            r for r in self.evaluation_history
            if r.case_analysis.fault_pattern == fault_type
        ]

    def export_results(self) -> List[Dict]:
        """Export evaluation results for external use."""
        results = []
        for r in self.evaluation_history:
            results.append({
                "case_id": r.case_id,
                "timestamp": r.timestamp,
                "overall_score": r.overall_score,
                "accuracy": {
                    "precision": r.accuracy.precision,
                    "recall": r.accuracy.recall,
                    "f1_score": r.accuracy.f1_score,
                    "true_positives": r.accuracy.true_positives,
                    "false_positives": r.accuracy.false_positives,
                    "false_negatives": r.accuracy.false_negatives
                },
                "process_quality": r.process_analysis.quality.value,
                "fault_pattern": r.case_analysis.fault_pattern,
                "recommendations": r.recommendations
            })
        return results
