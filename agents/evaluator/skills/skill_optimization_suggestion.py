"""
Optimization suggestion skill: generates targeted optimization suggestions.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from typing import Dict, List, Optional, Any
from dataclasses import dataclass


@dataclass
class OptimizationAction:
    """Single optimization action."""
    action_type: str  # "update_skill", "update_prompt", "adjust_parameter", "add_training_data"
    target: str
    description: str
    expected_benefit: str
    implementation_hint: str


class SkillOptimizationSuggestion:
    """
    Skill for generating optimization suggestions based on evaluation results.
    Provides actionable recommendations for improving agent performance.
    """

    def __init__(self):
        self.min_improvement_threshold = 0.05

    def generate_suggestions(
        self,
        accuracy_metrics: Optional[Dict[str, float]] = None,
        process_metrics: Optional[Dict[str, Any]] = None,
        historical_trends: Optional[List[Dict]] = None
    ) -> List[OptimizationAction]:
        """
        Generate optimization suggestions based on evaluation results.
        
        Args:
            accuracy_metrics: Dict with precision, recall, f1, etc.
            process_metrics: Dict with process analysis metrics
            historical_trends: List of historical evaluation results
            
        Returns:
            List of OptimizationAction recommendations
        """
        actions = []

        # Generate accuracy-based suggestions
        if accuracy_metrics:
            actions.extend(self._suggest_from_accuracy(accuracy_metrics))

        # Generate process-based suggestions
        if process_metrics:
            actions.extend(self._suggest_from_process(process_metrics))

        # Generate trend-based suggestions
        if historical_trends:
            actions.extend(self._suggest_from_trends(historical_trends))

        # Sort by expected benefit
        actions.sort(key=lambda a: self._benefit_score(a.expected_benefit), reverse=True)

        return actions[:10]  # Top 10 suggestions

    def _suggest_from_accuracy(
        self,
        metrics: Dict[str, float]
    ) -> List[OptimizationAction]:
        """Generate suggestions based on accuracy metrics."""
        actions = []

        precision = metrics.get("precision", 1.0)
        recall = metrics.get("recall", 1.0)
        f1 = metrics.get("f1_score", 1.0)

        # Low precision - too many false positives
        if precision < 0.6:
            actions.append(OptimizationAction(
                action_type="update_prompt",
                target="fault_detection_prompt",
                description="Improve specificity to reduce false positives",
                expected_benefit="precision_improvement_15_25%",
                implementation_hint=(
                    "Add explicit requirement for evidence before claiming fault. "
                    "Include 'exclude normal conditions' step in reasoning."
                )
            ))

        # Low recall - missing faults
        if recall < 0.6:
            actions.append(OptimizationAction(
                action_type="update_skill",
                target="fault_pattern_recognition",
                description="Improve sensitivity to detect more faults",
                expected_benefit="recall_improvement_20_30%",
                implementation_hint=(
                    "Add more fault signature examples to training. "
                    "Lower detection threshold for edge cases."
                )
            ))

        # Low F1 - overall poor performance
        if f1 < 0.5:
            actions.append(OptimizationAction(
                action_type="add_training_data",
                target="fault_case_library",
                description="Add more training examples for weak fault types",
                expected_benefit="f1_improvement_20_40%",
                implementation_hint=(
                    "Collect 100+ new cases focusing on previously missed fault patterns. "
                    "Prioritize edge cases and multi-NE faults."
                )
            ))

        # Detection latency issues
        latency_score = metrics.get("detection_latency_score", 1.0)
        if latency_score < 0.7:
            actions.append(OptimizationAction(
                action_type="adjust_parameter",
                target="early_detection_threshold",
                description="Improve early fault detection capability",
                expected_benefit="latency_reduction_30_50%",
                implementation_hint=(
                    "Enable pre-symptom detection heuristics. "
                    "Add KPI trend analysis before threshold crossing."
                )
            ))

        return actions

    def _suggest_from_process(
        self,
        metrics: Dict[str, Any]
    ) -> List[OptimizationAction]:
        """Generate suggestions based on process metrics."""
        actions = []

        # Logic completeness issues
        logic_checks = metrics.get("logic_checks", [])
        for check in logic_checks:
            if not check.get("passed", True):
                check_name = check.get("check_name", "")

                if check_name == "hypothesis_generation":
                    actions.append(OptimizationAction(
                        action_type="update_prompt",
                        target="diagnosis_prompt",
                        description="Require multiple hypotheses before conclusion",
                        expected_benefit="reasoning_quality_improvement_25%",
                        implementation_hint=(
                            "Add explicit instruction: 'List at least 3 possible causes'. "
                            "Require comparison of hypotheses."
                        )
                    ))
                elif check_name == "evidence_gathering":
                    actions.append(OptimizationAction(
                        action_type="update_skill",
                        target="evidence_collection",
                        description="Improve evidence collection thoroughness",
                        expected_benefit="evidence_completeness_improvement_30%",
                        implementation_hint=(
                            "Add evidence checklist: [KPI check, Topology check, Log check]. "
                            "Require minimum 3 evidence sources."
                        )
                    ))
                elif check_name == "topology_reference":
                    actions.append(OptimizationAction(
                        action_type="update_skill",
                        target="topology_utilization",
                        description="Better utilize topology information",
                        expected_benefit="topology_usage_improvement_40%",
                        implementation_hint=(
                            "Add step to explicitly reference affected NEs/pools/DCs. "
                            "Include topology in input context."
                        )
                    ))

        # Multi-agent consistency issues
        multi_agent = metrics.get("multi_agent_consistency", {})
        if not multi_agent.get("consensus_reached", True):
            actions.append(OptimizationAction(
                action_type="update_skill",
                target="multi_agent_coordination",
                description="Resolve conflicts between agents",
                expected_benefit="consistency_improvement_50%",
                implementation_hint=(
                    "Add agreement verification step. "
                    "Standardize terminology and fault definitions across agents."
                )
            ))

        return actions

    def _suggest_from_trends(
        self,
        trends: List[Dict]
    ) -> List[OptimizationAction]:
        """Generate suggestions based on historical trends."""
        actions = []

        if len(trends) < 3:
            return actions

        # Analyze recent trend
        recent_metrics = trends[-1]
        earlier_metrics = trends[0]

        # Check if performance is degrading
        recent_f1 = recent_metrics.get("f1_score", 0.5)
        earlier_f1 = earlier_metrics.get("f1_score", 0.5)

        if recent_f1 < earlier_f1 * 0.9:  # 10% degradation
            actions.append(OptimizationAction(
                action_type="add_training_data",
                target="recent_failure_cases",
                description="Performance degradation detected - add recent failure cases",
                expected_benefit="restore_performance_to_previous_level",
                implementation_hint=(
                    "Collect last 20 failed cases and add to training. "
                    "Analyze common failure patterns."
                )
            ))

        # Check for specific fault type degradation
        for fault_type in ["PATH_LINK", "MULTI_NE", "RESOURCE_POOL"]:
            recent_count = sum(
                1 for t in trends[-5:]
                if t.get("fault_type") == fault_type and t.get("f1_score", 1) < 0.5
            )
            if recent_count >= 3:
                actions.append(OptimizationAction(
                    action_type="update_skill",
                    target=f"fault_pattern_{fault_type.lower()}",
                    description=f"Recent regression in {fault_type} detection",
                    expected_benefit=f"{fault_type}_accuracy_restoration",
                    implementation_hint=(
                        f"Add dedicated training for {fault_type} patterns. "
                        f"Review recent changes that may have affected {fault_type}."
                    )
                ))

        return actions

    def _benefit_score(self, benefit: str) -> float:
        """Calculate a numerical score for expected benefit."""
        benefit_lower = benefit.lower()

        if "precision" in benefit_lower:
            return 0.8
        elif "recall" in benefit_lower:
            return 0.8
        elif "f1" in benefit_lower:
            return 0.9
        elif "latency" in benefit_lower:
            return 0.7
        elif "quality" in benefit_lower:
            return 0.6
        elif "consistency" in benefit_lower:
            return 0.7
        elif "improvement" in benefit_lower:
            return 0.5
        else:
            return 0.4

    def prioritize_actions(
        self,
        actions: List[OptimizationAction],
        max_actions: int = 5
    ) -> List[OptimizationAction]:
        """
        Prioritize actions by expected benefit and implementation cost.
        
        Args:
            actions: List of optimization actions
            max_actions: Maximum number of actions to return
            
        Returns:
            Prioritized list of actions
        """
        # Score each action
        scored_actions = []
        for action in actions:
            benefit_score = self._benefit_score(action.expected_benefit)
            cost_score = self._implementation_cost(action.action_type)
            priority_score = benefit_score * (1.0 - cost_score * 0.3)
            scored_actions.append((priority_score, action))

        # Sort by priority
        scored_actions.sort(key=lambda x: x[0], reverse=True)

        return [action for _, action in scored_actions[:max_actions]]

    def _implementation_cost(self, action_type: str) -> float:
        """Estimate implementation cost (0-1, higher is more expensive)."""
        costs = {
            "update_prompt": 0.2,
            "adjust_parameter": 0.1,
            "update_skill": 0.5,
            "add_training_data": 0.7
        }
        return costs.get(action_type, 0.5)
