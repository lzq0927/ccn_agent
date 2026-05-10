"""
Optimizer: generate optimization suggestions for skills, prompts, and data augmentation.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from collections import defaultdict
from simulator.models import Topology, FaultConfig, FaultPointType


@dataclass
class OptimizationSuggestion:
    """Single optimization suggestion."""
    category: str  # "skill", "prompt", "data_augmentation", "parameter"
    target: str  # Which skill/prompt to optimize
    priority: int  # 1-5, higher is more important
    description: str
    expected_impact: str
    specific_changes: List[str] = field(default_factory=list)


@dataclass
class OptimizationReport:
    """Complete optimization report."""
    overall_priority: int  # 1-5
    suggestions: List[OptimizationSuggestion] = field(default_factory=list)
    skill_updates: Dict[str, str] = field(default_factory=dict)
    prompt_templates: Dict[str, str] = field(default_factory=dict)
    data_augmentation_hints: List[str] = field(default_factory=list)
    parameter_adjustments: Dict[str, float] = field(default_factory=dict)


class Optimizer:
    """
    Generates optimization suggestions based on evaluation results.
    Analyzes patterns in failures to recommend targeted improvements.
    """

    def __init__(self, topology: Topology):
        self.topology = topology

    def generate_optimizations(
        self,
        accuracy_results: List[Dict],
        process_results: List[Dict],
        case_library: Optional["CaseLibraryManager"] = None
    ) -> OptimizationReport:
        """
        Generate optimization suggestions based on accumulated results.
        
        Args:
            accuracy_results: List of accuracy evaluation results
            process_results: List of process analysis results
            case_library: Optional case library for historical analysis
            
        Returns:
            OptimizationReport with targeted suggestions
        """
        suggestions = []

        # Analyze accuracy patterns
        accuracy_suggestions = self._analyze_accuracy_patterns(accuracy_results)
        suggestions.extend(accuracy_suggestions)

        # Analyze process patterns
        process_suggestions = self._analyze_process_patterns(process_results)
        suggestions.extend(process_suggestions)

        # Analyze fault type patterns
        fault_type_suggestions = self._analyze_fault_type_patterns(accuracy_results)
        suggestions.extend(fault_type_suggestions)

        # Analyze topology usage patterns
        topology_suggestions = self._analyze_topology_usage_patterns(process_results)
        suggestions.extend(topology_suggestions)

        # Analyze multi-agent consistency patterns
        multi_agent_suggestions = self._analyze_multi_agent_patterns(process_results)
        suggestions.extend(multi_agent_suggestions)

        # Sort by priority
        suggestions.sort(key=lambda s: s.priority, reverse=True)

        # Compute overall priority
        overall_priority = self._compute_overall_priority(suggestions)

        # Generate skill updates
        skill_updates = self._generate_skill_updates(suggestions)

        # Generate prompt templates
        prompt_templates = self._generate_prompt_templates(suggestions)

        # Generate data augmentation hints
        data_augmentation_hints = self._generate_data_augmentation_hints(
            suggestions, accuracy_results, case_library
        )

        # Generate parameter adjustments
        parameter_adjustments = self._generate_parameter_adjustments(suggestions)

        return OptimizationReport(
            overall_priority=overall_priority,
            suggestions=suggestions,
            skill_updates=skill_updates,
            prompt_templates=prompt_templates,
            data_augmentation_hints=data_augmentation_hints,
            parameter_adjustments=parameter_adjustments
        )

    def _analyze_accuracy_patterns(self, results: List[Dict]) -> List[OptimizationSuggestion]:
        """Analyze patterns in accuracy results."""
        suggestions = []

        if not results:
            return suggestions

        # Aggregate metrics
        total_tp = sum(r.get("true_positives", 0) for r in results)
        total_fp = sum(r.get("false_positives", 0) for r in results)
        total_fn = sum(r.get("false_negatives", 0) for r in results)

        precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
        recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0

        # High false positive rate -> improve specificity
        if total_fp > total_tp * 0.5:
            suggestions.append(OptimizationSuggestion(
                category="prompt",
                target="fault_detection_prompt",
                priority=4,
                description="High false positive rate detected",
                expected_impact="Reduce false alarms by 30-50%",
                specific_changes=[
                    "Add more specific fault conditions",
                    "Require stronger evidence before claiming fault",
                    "Include confidence threshold in prompt"
                ]
            ))

        # High false negative rate -> improve sensitivity
        if total_fn > total_tp * 0.3:
            suggestions.append(OptimizationSuggestion(
                category="skill",
                target="fault_pattern_recognition",
                priority=4,
                description="High miss rate for fault detection",
                expected_impact="Improve detection recall by 40%",
                specific_changes=[
                    "Add more fault signature examples",
                    "Train on edge case patterns",
                    "Improve symptom-to-fault mapping"
                ]
            ))

        # Low precision with good recall -> balance needed
        if precision < 0.5 and recall > 0.7:
            suggestions.append(OptimizationSuggestion(
                category="parameter",
                target="detection_confidence_threshold",
                priority=3,
                description="Trade-off favors sensitivity over specificity",
                expected_impact="Better precision/recall balance",
                specific_changes=[
                    "Increase confidence threshold from 0.5 to 0.7",
                    "Add secondary validation step"
                ]
            ))

        return suggestions

    def _analyze_process_patterns(self, results: List[Dict]) -> List[OptimizationSuggestion]:
        """Analyze patterns in process analysis results."""
        suggestions = []

        if not results:
            return suggestions

        # Count logic check failures
        logic_failures = defaultdict(int)
        for result in results:
            for check in result.get("logic_checks", []):
                if not check.get("passed", True):
                    logic_failures[check.get("check_name", "unknown")] += 1

        # Identify common logic failures
        for check_name, count in logic_failures.items():
            if count >= len(results) * 0.5:  # Failed in majority of cases
                if check_name == "hypothesis_generation":
                    suggestions.append(OptimizationSuggestion(
                        category="skill",
                        target="hypothesis_generation",
                        priority=4,
                        description="Hypothesis generation is consistently weak",
                        expected_impact="Better exploration of fault possibilities",
                        specific_changes=[
                            "Add prompt to generate 3+ alternative hypotheses",
                            "Include 'differential diagnosis' approach"
                        ]
                    ))
                elif check_name == "evidence_gathering":
                    suggestions.append(OptimizationSuggestion(
                        category="skill",
                        target="evidence_collection",
                        priority=4,
                        description="Evidence gathering is consistently incomplete",
                        expected_impact="More thorough diagnosis",
                        specific_changes=[
                            "Add checklist for required evidence",
                            "Include KPI, topology, and log checks explicitly"
                        ]
                    ))
                elif check_name == "conclusion_derivation":
                    suggestions.append(OptimizationSuggestion(
                        category="prompt",
                        target="conclusion_prompt",
                        priority=3,
                        description="Conclusions often premature or missing",
                        expected_impact="More reliable fault identification",
                        specific_changes=[
                            "Require explicit evidence summary before conclusion",
                            "Add 'final_answer' format with confidence"
                        ]
                    ))

        return suggestions

    def _analyze_fault_type_patterns(self, results: List[Dict]) -> List[OptimizationSuggestion]:
        """Analyze accuracy by fault type to identify specific weaknesses."""
        suggestions = []

        # Group results by fault type
        fault_type_metrics: Dict[str, Dict] = defaultdict(
            lambda: {"tp": 0, "fp": 0, "fn": 0, "count": 0}
        )

        for result in results:
            fault_type = result.get("fault_type", "unknown")
            fault_type_metrics[fault_type]["count"] += 1
            fault_type_metrics[fault_type]["tp"] += result.get("true_positives", 0)
            fault_type_metrics[fault_type]["fp"] += result.get("false_positives", 0)
            fault_type_metrics[fault_type]["fn"] += result.get("false_negatives", 0)

        # Identify weak fault types
        for fault_type, metrics in fault_type_metrics.items():
            if metrics["count"] < 3:
                continue  # Skip if not enough samples

            precision = metrics["tp"] / (metrics["tp"] + metrics["fp"]) if (metrics["tp"] + metrics["fp"]) > 0 else 0
            recall = metrics["tp"] / (metrics["tp"] + metrics["fn"]) if (metrics["tp"] + metrics["fn"]) > 0 else 0

            if precision < 0.5:
                suggestions.append(OptimizationSuggestion(
                    category="data_augmentation",
                    target=fault_type,
                    priority=4,
                    description=f"Low precision for {fault_type} faults",
                    expected_impact=f"Improve {fault_type} detection accuracy",
                    specific_changes=[
                        f"Add more {fault_type} training examples",
                        f"Create synthetic {fault_type} cases for training"
                    ]
                ))

            if recall < 0.5:
                suggestions.append(OptimizationSuggestion(
                    category="skill",
                    target=f"fault_pattern_{fault_type}",
                    priority=4,
                    description=f"Low recall for {fault_type} faults",
                    expected_impact=f"Improve {fault_type} detection sensitivity",
                    specific_changes=[
                        f"Focus training on {fault_type} patterns",
                        f"Add {fault_type} case studies to skill"
                    ]
                ))

        return suggestions

    def _analyze_topology_usage_patterns(self, results: List[Dict]) -> List[OptimizationSuggestion]:
        """Analyze topology usage patterns in process results."""
        suggestions = []

        if not results:
            return suggestions

        # Collect missing NE types
        all_missing_types: Dict[str, int] = defaultdict(int)
        
        for result in results:
            topology_usage = result.get("topology_usage", {})
            for missing_type in topology_usage.get("ne_types_missing", []):
                all_missing_types[missing_type] += 1

        # Suggest improvements for commonly missing types
        for ne_type, count in all_missing_types.items():
            if count >= len(results) * 0.3:
                suggestions.append(OptimizationSuggestion(
                    category="skill",
                    target="topology_awareness",
                    priority=3,
                    description=f"Often missing {ne_type} in analysis",
                    expected_impact="Better network element utilization",
                    specific_changes=[
                        f"Add {ne_type} specific patterns to skill",
                        f"Include {ne_type} in topology walkthrough"
                    ]
                ))

        return suggestions

    def _analyze_multi_agent_patterns(self, results: List[Dict]) -> List[OptimizationSuggestion]:
        """Analyze multi-agent consistency patterns."""
        suggestions = []

        if not results:
            return suggestions

        conflict_count = 0
        total_multi_agent = 0

        for result in results:
            multi_agent = result.get("multi_agent_consistency", {})
            if multi_agent.get("agent_ids") and len(multi_agent["agent_ids"]) > 1:
                total_multi_agent += 1
                conflict_count += len(multi_agent.get("conflicts", []))

        if total_multi_agent > 0 and conflict_count > total_multi_agent * 0.5:
            suggestions.append(OptimizationSuggestion(
                category="skill",
                target="multi_agent_coordination",
                priority=3,
                description="Frequent conflicts between agents",
                expected_impact="More consistent multi-agent conclusions",
                specific_changes=[
                    "Add conflict resolution protocol",
                    "Include agent agreement checkpoints",
                    "Standardize terminology across agents"
                ]
            ))

        return suggestions

    def _compute_overall_priority(self, suggestions: List[OptimizationSuggestion]) -> int:
        """Compute overall optimization priority (1-5)."""
        if not suggestions:
            return 1

        # Average priority weighted by frequency
        avg_priority = sum(s.priority for s in suggestions) / len(suggestions)

        # Count high-priority suggestions
        high_priority_count = sum(1 for s in suggestions if s.priority >= 4)

        if avg_priority >= 4 or high_priority_count >= 3:
            return 5
        elif avg_priority >= 3.5 or high_priority_count >= 2:
            return 4
        elif avg_priority >= 3 or high_priority_count >= 1:
            return 3
        elif avg_priority >= 2:
            return 2
        else:
            return 1

    def _generate_skill_updates(
        self,
        suggestions: List[OptimizationSuggestion]
    ) -> Dict[str, str]:
        """Generate skill update recommendations."""
        updates = {}

        skill_suggestions = [s for s in suggestions if s.category == "skill"]
        
        for suggestion in skill_suggestions[:3]:  # Top 3 skill suggestions
            updates[suggestion.target] = (
                f"Update skill to address: {suggestion.description}. "
                f"Changes: {'; '.join(suggestion.specific_changes)}"
            )

        return updates

    def _generate_prompt_templates(
        self,
        suggestions: List[OptimizationSuggestion]
    ) -> Dict[str, str]:
        """Generate prompt template updates."""
        templates = {}

        prompt_suggestions = [s for s in suggestions if s.category == "prompt"]

        for suggestion in prompt_suggestions[:2]:  # Top 2 prompt suggestions
            templates[suggestion.target] = self._create_prompt_template(suggestion)

        return templates

    def _create_prompt_template(self, suggestion: OptimizationSuggestion) -> str:
        """Create an improved prompt template based on suggestion."""
        base_template = f"""## Task: Fault Detection Analysis

### Context
You are analyzing network faults for {self.topology.get_dc_ids()} datacenters.

### Instructions
1. **Observe**: Identify symptoms from KPI records and logs
2. **Hypothesize**: Generate at least 3 possible fault hypotheses
3. **Investigate**: Check relevant topology elements
4. **Conclude**: Provide final fault identification with confidence

### Output Format
{{
    "fault_type": "<detected_fault_type>",
    "confidence": <0.0-1.0>,
    "evidence": ["list of supporting evidence"],
    "reasoning": "explanation of conclusion"
}}

### Important
- {suggestion.specific_changes[0] if suggestion.specific_changes else "Be thorough and precise"}
"""
        return base_template

    def _generate_data_augmentation_hints(
        self,
        suggestions: List[OptimizationSuggestion],
        accuracy_results: List[Dict],
        case_library: Optional["CaseLibraryManager"]
    ) -> List[str]:
        """Generate data augmentation hints."""
        hints = []

        # Analyze weak fault types
        weak_types = set()
        for suggestion in suggestions:
            if suggestion.category == "data_augmentation":
                weak_types.add(suggestion.target)

        for fault_type in weak_types:
            hints.append(
                f"Add 50+ synthetic cases for {fault_type} fault type"
            )

        # Check for missing NE types in training
        if case_library:
            all_fault_types_in_library = case_library.get_all_fault_types()
            for ft in FaultPointType:
                if ft not in all_fault_types_in_library:
                    hints.append(f"Add training data for {ft.value} fault type")

        # Check for edge cases
        high_latency_cases = [
            r for r in accuracy_results 
            if r.get("detection_latency_score", 1.0) < 0.5
        ]
        if high_latency_cases:
            hints.append(
                "Add more early-detection training examples to reduce latency"
            )

        # Remove duplicates
        return list(dict.fromkeys(hints))[:5]

    def _generate_parameter_adjustments(
        self,
        suggestions: List[OptimizationSuggestion]
    ) -> Dict[str, float]:
        """Generate parameter adjustment recommendations."""
        adjustments = {}

        for suggestion in suggestions:
            if suggestion.category == "parameter":
                target = suggestion.target
                if "threshold" in target.lower():
                    # Parse suggested threshold from description
                    adjustments[target] = 0.7  # Default suggested value
                elif "weight" in target.lower():
                    adjustments[target] = 1.2  # Increase by 20%

        return adjustments

    def suggest_data_augmentation(
        self,
        fault_type: FaultPointType,
        count: int = 50
    ) -> List[Dict]:
        """
        Generate synthetic data augmentation cases for a specific fault type.
        
        Args:
            fault_type: The fault type to generate cases for
            count: Number of cases to generate
            
        Returns:
            List of synthetic case configurations
        """
        cases = []

        for i in range(count):
            case = self._generate_synthetic_case(fault_type, i)
            cases.append(case)

        return cases

    def _generate_synthetic_case(
        self,
        fault_type: FaultPointType,
        seed: int
    ) -> Dict:
        """Generate a single synthetic case for augmentation."""
        import random
        random.seed(seed)

        # Get available topology elements
        all_ne_ids = list(self.topology.elements.keys())
        all_ne_types = list(set(ne.ne_type for ne in self.topology.elements.values()))

        if fault_type == FaultPointType.SINGLE_NE:
            affected_ne = random.choice(all_ne_ids)
            return {
                "fault_point_type": fault_type.value,
                "affected_ne_ids": {affected_ne}
            }
        elif fault_type == FaultPointType.MULTI_NE:
            num_affected = random.randint(2, min(5, len(all_ne_ids)))
            affected = random.sample(all_ne_ids, num_affected)
            return {
                "fault_point_type": fault_type.value,
                "affected_ne_ids": set(affected)
            }
        elif fault_type == FaultPointType.PATH_LINK:
            # Generate random link fault
            return {
                "fault_point_type": fault_type.value,
                "num_affected_paths": random.randint(1, 3)
            }
        else:
            return {
                "fault_point_type": fault_type.value,
                "affected_ne_ids": set(random.sample(all_ne_ids, 1))
            }
