"""
Process analyzer: analyze reasoning trace quality.
Checks logic completeness, topology usage, multi-agent consistency.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from dataclasses import dataclass, field
from typing import List, Dict, Set, Tuple, Optional, Any
from enum import Enum
from simulator.models import Topology, FaultConfig, FaultPointType, NEType


class ReasoningQuality(Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    FAILED = "failed"


@dataclass
class LogicCheck:
    """Result of a single logic check."""
    check_name: str
    passed: bool
    score: float
    details: str
    suggestions: List[str] = field(default_factory=list)


@dataclass
class TopologyUsageCheck:
    """Result of topology usage analysis."""
    ne_types_mentioned: Set[NEType] = field(default_factory=set)
    ne_types_correct: Set[NEType] = field(default_factory=set)
    ne_types_missing: Set[NEType] = field(default_factory=set)
    ne_ids_mentioned: Set[str] = field(default_factory=set)
    ne_ids_correct: Set[str] = field(default_factory=set)
    pool_ids_mentioned: Set[str] = field(default_factory=set)
    dc_ids_mentioned: Set[str] = field(default_factory=set)
    score: float = 0.0


@dataclass
class MultiAgentConsistencyCheck:
    """Result of multi-agent consistency analysis."""
    agent_ids: List[str] = field(default_factory=list)
    conclusions: Dict[str, str] = field(default_factory=dict)
    conflicts: List[Tuple[str, str]] = field(default_factory=list)
    consensus_reached: bool = True
    score: float = 1.0


@dataclass
class ProcessAnalysisResult:
    """Complete process analysis result."""
    quality: ReasoningQuality
    overall_score: float
    logic_checks: List[LogicCheck] = field(default_factory=list)
    topology_usage: TopologyUsageCheck = field(default_factory=TopologyUsageCheck)
    multi_agent_consistency: MultiAgentConsistencyCheck = field(default_factory=MultiAgentConsistencyCheck)
    reasoning_depth: int = 0
    missing_steps: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)


class ProcessAnalyzer:
    """
    Analyzes reasoning trace quality for fault diagnosis.
    Evaluates logic completeness, topology usage, and multi-agent consistency.
    """

    def __init__(self, topology: Topology):
        self.topology = topology

    def analyze(
        self,
        reasoning_trace: List[Dict[str, Any]],
        ground_truth: Optional[FaultConfig] = None
    ) -> ProcessAnalysisResult:
        """
        Analyze reasoning trace quality.
        
        Args:
            reasoning_trace: List of reasoning steps, each with keys:
                - step_id: int
                - agent_id: str (optional)
                - action: str
                - observation: str
                - conclusion: str (optional)
                - confidence: float (optional)
            ground_truth: Ground truth fault config for validation
            
        Returns:
            ProcessAnalysisResult with detailed analysis
        """
        if not reasoning_trace:
            return self._create_failed_result("Empty reasoning trace")

        # Run all checks
        logic_checks = self._check_logic_completeness(reasoning_trace, ground_truth)
        topology_usage = self._analyze_topology_usage(reasoning_trace, ground_truth)
        multi_agent_consistency = self._check_multi_agent_consistency(reasoning_trace)

        # Compute overall score
        logic_score = sum(c.score for c in logic_checks) / len(logic_checks) if logic_checks else 0.0
        overall_score = (
            logic_score * 0.4 +
            topology_usage.score * 0.35 +
            multi_agent_consistency.score * 0.25
        )

        # Determine quality rating
        quality = self._determine_quality(overall_score)

        # Identify missing steps
        missing_steps = self._identify_missing_steps(reasoning_trace, ground_truth)

        # Generate recommendations
        recommendations = self._generate_recommendations(
            logic_checks, topology_usage, multi_agent_consistency, missing_steps
        )

        return ProcessAnalysisResult(
            quality=quality,
            overall_score=overall_score,
            logic_checks=logic_checks,
            topology_usage=topology_usage,
            multi_agent_consistency=multi_agent_consistency,
            reasoning_depth=len(reasoning_trace),
            missing_steps=missing_steps,
            recommendations=recommendations
        )

    def _create_failed_result(self, reason: str) -> ProcessAnalysisResult:
        """Create a failed analysis result."""
        return ProcessAnalysisResult(
            quality=ReasoningQuality.FAILED,
            overall_score=0.0,
            logic_checks=[LogicCheck(
                check_name="overall",
                passed=False,
                score=0.0,
                details=reason
            )],
            topology_usage=TopologyUsageCheck(),
            multi_agent_consistency=MultiAgentConsistencyCheck(),
            missing_steps=["No reasoning trace available"],
            recommendations=["Provide valid reasoning trace"]
        )

    def _check_logic_completeness(
        self,
        reasoning_trace: List[Dict[str, Any]],
        ground_truth: Optional[FaultConfig]
    ) -> List[LogicCheck]:
        """Check completeness and correctness of reasoning logic."""
        checks = []

        # Check 1: Initial observation present
        checks.append(self._check_initial_observation(reasoning_trace))

        # Check 2: Hypothesis generation
        checks.append(self._check_hypothesis_generation(reasoning_trace))

        # Check 3: Evidence gathering
        checks.append(self._check_evidence_gathering(reasoning_trace))

        # Check 4: Conclusion derivation
        checks.append(self._check_conclusion_derivation(reasoning_trace))

        # Check 5: Topology reference
        checks.append(self._check_topology_reference(reasoning_trace))

        # Check 6: Fault type consideration
        if ground_truth:
            checks.append(self._check_fault_type_considered(reasoning_trace, ground_truth))

        return checks

    def _check_initial_observation(self, trace: List[Dict[str, Any]]) -> LogicCheck:
        """Check if initial observation step exists."""
        if not trace:
            return LogicCheck(
                check_name="initial_observation",
                passed=False,
                score=0.0,
                details="No reasoning steps found"
            )

        first_step = trace[0]
        action = first_step.get("action", "").lower()
        
        if any(kw in action for kw in ["observe", "see", "notice", "detect", "kpi", "alert"]):
            return LogicCheck(
                check_name="initial_observation",
                passed=True,
                score=1.0,
                details="Initial observation properly recorded"
            )
        else:
            return LogicCheck(
                check_name="initial_observation",
                passed=False,
                score=0.5,
                details="First step may not be an observation",
                suggestions=["Start with symptom observation"]
            )

    def _check_hypothesis_generation(self, trace: List[Dict[str, Any]]) -> LogicCheck:
        """Check if multiple hypotheses were considered."""
        hypothesis_keywords = ["hypothesis", "possible", "may", "might", "could", "assume"]
        
        hypothesis_steps = []
        for step in trace:
            action = step.get("action", "").lower()
            conclusion = step.get("conclusion", "").lower()
            text = action + " " + conclusion
            if any(kw in text for kw in hypothesis_keywords):
                hypothesis_steps.append(step)

        if len(hypothesis_steps) >= 2:
            return LogicCheck(
                check_name="hypothesis_generation",
                passed=True,
                score=1.0,
                details=f"Generated {len(hypothesis_steps)} hypotheses"
            )
        elif len(hypothesis_steps) == 1:
            return LogicCheck(
                check_name="hypothesis_generation",
                passed=True,
                score=0.7,
                details="Only one hypothesis considered",
                suggestions=["Consider alternative hypotheses"]
            )
        else:
            return LogicCheck(
                check_name="hypothesis_generation",
                passed=False,
                score=0.3,
                details="No explicit hypothesis generation found",
                suggestions=["Generate and compare multiple hypotheses"]
            )

    def _check_evidence_gathering(self, trace: List[Dict[str, Any]]) -> LogicCheck:
        """Check if evidence was gathered to support reasoning."""
        evidence_keywords = ["check", "verify", "query", "inspect", "examine", "fetch", "get"]
        
        evidence_steps = [s for s in trace if any(
            kw in s.get("action", "").lower() for kw in evidence_keywords
        )]

        if len(evidence_steps) >= 2:
            return LogicCheck(
                check_name="evidence_gathering",
                passed=True,
                score=1.0,
                details=f"Gathered evidence in {len(evidence_steps)} steps"
            )
        elif len(evidence_steps) == 1:
            return LogicCheck(
                check_name="evidence_gathering",
                passed=True,
                score=0.6,
                details="Limited evidence gathering",
                suggestions=["Gather more evidence before concluding"]
            )
        else:
            return LogicCheck(
                check_name="evidence_gathering",
                passed=False,
                score=0.2,
                details="No evidence gathering steps found",
                suggestions=["Check KPIs, topology, and logs for evidence"]
            )

    def _check_conclusion_derivation(self, trace: List[Dict[str, Any]]) -> LogicCheck:
        """Check if conclusions are properly derived."""
        conclusion_keywords = ["conclude", "therefore", "thus", "hence", "result", "fault", "cause"]
        
        conclusion_steps = []
        for step in trace:
            conclusion = step.get("conclusion", "").lower()
            if any(kw in conclusion for kw in conclusion_keywords):
                conclusion_steps.append(step)

        if not conclusion_steps:
            return LogicCheck(
                check_name="conclusion_derivation",
                passed=False,
                score=0.0,
                details="No conclusions drawn",
                suggestions=["Derive conclusions from evidence"]
            )

        # Check if conclusions follow from previous steps
        last_step_idx = trace.index(conclusion_steps[-1]) if conclusion_steps else 0
        
        if last_step_idx < len(trace) - 1:
            return LogicCheck(
                check_name="conclusion_derivation",
                passed=False,
                score=0.5,
                details="Conclusions reached before using all evidence",
                suggestions=["Wait for all evidence before concluding"]
            )

        return LogicCheck(
            check_name="conclusion_derivation",
            passed=True,
            score=1.0,
            details=f"Drew {len(conclusion_steps)} conclusions"
        )

    def _check_topology_reference(self, trace: List[Dict[str, Any]]) -> LogicCheck:
        """Check if topology was properly referenced."""
        topology_keywords = ["ne", "node", "pool", "dc", "link", "network", "topology"]
        
        relevant_steps = []
        for step in trace:
            text = (step.get("action", "") + " " + step.get("observation", "")).lower()
            if any(kw in text for kw in topology_keywords):
                relevant_steps.append(step)

        if len(relevant_steps) >= 2:
            return LogicCheck(
                check_name="topology_reference",
                passed=True,
                score=1.0,
                details=f"Referenced topology in {len(relevant_steps)} steps"
            )
        elif len(relevant_steps) == 1:
            return LogicCheck(
                check_name="topology_reference",
                passed=True,
                score=0.6,
                details="Limited topology reference",
                suggestions=["Use topology information more extensively"]
            )
        else:
            return LogicCheck(
                check_name="topology_reference",
                passed=False,
                score=0.2,
                details="No topology references found",
                suggestions=["Consult topology for network structure"]
            )

    def _check_fault_type_considered(
        self,
        trace: List[Dict[str, Any]],
        ground_truth: FaultConfig
    ) -> LogicCheck:
        """Check if correct fault type was considered."""
        fault_type_keywords = {
            FaultPointType.SINGLE_NE: ["single", "one", "individual"],
            FaultPointType.MULTI_NE: ["multiple", "multi", "several"],
            FaultPointType.ALL_TYPE_NE: ["all", "every", "type"],
            FaultPointType.MULTI_TYPE_NE: ["multi-type", "mixed-type"],
            FaultPointType.RESOURCE_POOL: ["pool", "resource"],
            FaultPointType.DC: ["dc", "datacenter", "data-center"],
            FaultPointType.PATH_LINK: ["link", "path-link"],
            FaultPointType.PATH_TRACE: ["trace", "path-trace"],
            FaultPointType.PATH_SESSION: ["session", "path-session"],
            FaultPointType.SWITCH: ["switch"],
            FaultPointType.NORMAL: ["normal", "no-fault", "healthy"],
        }

        ground_truth_type = ground_truth.fault_point_type
        expected_keywords = fault_type_keywords.get(ground_truth_type, [])

        found_steps = []
        for step in trace:
            text = (step.get("action", "") + " " + step.get("conclusion", "")).lower()
            if any(kw in text for kw in expected_keywords):
                found_steps.append(step)

        if expected_keywords and not found_steps:
            return LogicCheck(
                check_name="fault_type_considered",
                passed=False,
                score=0.0,
                details=f"Did not consider {ground_truth_type.value} fault type",
                suggestions=[f"Investigate {ground_truth_type.value} patterns"]
            )

        score = min(1.0, len(found_steps) / 2)
        return LogicCheck(
            check_name="fault_type_considered",
            passed=score >= 0.5,
            score=score,
            details=f"Considered {ground_truth_type.value} in {len(found_steps)} steps"
        )

    def _analyze_topology_usage(
        self,
        trace: List[Dict[str, Any]],
        ground_truth: Optional[FaultConfig]
    ) -> TopologyUsageCheck:
        """Analyze how well topology information was used."""
        result = TopologyUsageCheck()

        mentioned_ne_ids = set()
        mentioned_ne_types = set()
        mentioned_pool_ids = set()
        mentioned_dc_ids = set()

        # Collect all mentioned topology elements
        for step in trace:
            text = (step.get("action", "") + " " + step.get("observation", "") + 
                    " " + step.get("conclusion", "")).lower()
            
            # Check NE IDs
            for ne_id in self.topology.elements.keys():
                if ne_id.lower() in text:
                    mentioned_ne_ids.add(ne_id)
                    result.ne_ids_mentioned.add(ne_id)
                    mentioned_ne_types.add(self.topology.elements[ne_id].ne_type)

            # Check NE types
            for ne_type in NEType:
                if ne_type.value.lower() in text:
                    mentioned_ne_types.add(ne_type)
                    result.ne_types_mentioned.add(ne_type)

            # Check pool IDs
            for pool_id in self.topology.get_pool_ids():
                if pool_id.lower() in text:
                    mentioned_pool_ids.add(pool_id)
                    result.pool_ids_mentioned.add(pool_id)

            # Check DC IDs
            for dc_id in self.topology.get_dc_ids():
                if dc_id.lower() in text:
                    mentioned_dc_ids.add(dc_id)
                    result.dc_ids_mentioned.add(dc_id)

        # Check correctness if ground truth available
        if ground_truth:
            # NE IDs
            if ground_truth.affected_ne_ids:
                correct = mentioned_ne_ids & ground_truth.affected_ne_ids
                result.ne_ids_correct = correct
                missing = ground_truth.affected_ne_ids - mentioned_ne_ids
                result.ne_types_missing = {
                    self.topology.elements[ne_id].ne_type 
                    for ne_id in missing 
                    if ne_id in self.topology.elements
                }

            # NE types
            if ground_truth.affected_ne_ids:
                expected_types = {
                    self.topology.elements[ne_id].ne_type 
                    for ne_id in ground_truth.affected_ne_ids
                    if ne_id in self.topology.elements
                }
                result.ne_types_correct = mentioned_ne_types & expected_types

        # Calculate score
        score = 0.0
        total_weight = 0.0

        # NE ID coverage (most important)
        if ground_truth and ground_truth.affected_ne_ids:
            coverage = len(result.ne_ids_correct) / len(ground_truth.affected_ne_ids)
            score += coverage * 0.5
            total_weight += 0.5

        # NE type coverage
        if mentioned_ne_types:
            score += min(1.0, len(mentioned_ne_types) / 3) * 0.2
            total_weight += 0.2

        # Pool/DC reference
        if mentioned_pool_ids or mentioned_dc_ids:
            score += 0.15
            total_weight += 0.15

        # Breadth of topology usage
        if len(mentioned_ne_ids) >= 3:
            score += 0.15
            total_weight += 0.15

        result.score = score / total_weight if total_weight > 0 else 0.0

        return result

    def _check_multi_agent_consistency(
        self,
        trace: List[Dict[str, Any]]
    ) -> MultiAgentConsistencyCheck:
        """Check consistency across multiple agents."""
        result = MultiAgentConsistencyCheck()

        # Extract agent conclusions
        agent_conclusions: Dict[str, str] = {}
        agent_ids = set()

        for step in trace:
            agent_id = step.get("agent_id")
            if agent_id:
                agent_ids.add(agent_id)
                conclusion = step.get("conclusion", "")
                if conclusion:
                    agent_conclusions[agent_id] = conclusion

        result.agent_ids = list(agent_ids)
        result.conclusions = agent_conclusions

        if len(agent_ids) <= 1:
            result.score = 1.0
            return result

        # Check for conflicts between agents
        for i, agent1 in enumerate(agent_ids):
            for agent2 in list(agent_ids)[i+1:]:
                conclusion1 = agent_conclusions.get(agent1, "")
                conclusion2 = agent_conclusions.get(agent2, "")
                
                if not self._are_conclusions_consistent(conclusion1, conclusion2):
                    result.conflicts.append((agent1, agent2))

        if result.conflicts:
            result.consensus_reached = False
            result.score = max(0.0, 1.0 - len(result.conflicts) * 0.3)
        else:
            result.consensus_reached = True
            result.score = 1.0

        return result

    def _are_conclusions_consistent(self, conclusion1: str, conclusion2: str) -> bool:
        """Check if two conclusions are consistent with each other."""
        c1_lower = conclusion1.lower()
        c2_lower = conclusion2.lower()

        # Direct contradictions
        contradictions = [
            (["fault", "down", "failed"], ["normal", "healthy", "ok"]),
            (["link", "broken"], ["link", "ok", "working"]),
            (["single"], ["multiple"]),
            (["dc1"], ["dc2"]),
        ]

        for positive, negative in contradictions:
            c1_has_pos = any(p in c1_lower for p in positive)
            c1_has_neg = any(n in c1_lower for n in negative)
            c2_has_pos = any(p in c2_lower for p in positive)
            c2_has_neg = any(n in c2_lower for n in negative)

            # If one says positive and other says negative
            if (c1_has_pos and c2_has_neg) or (c1_has_neg and c2_has_pos):
                if c1_has_pos != c1_has_neg and c2_has_pos != c2_has_neg:
                    return False

        return True

    def _identify_missing_steps(
        self,
        trace: List[Dict[str, Any]],
        ground_truth: Optional[FaultConfig]
    ) -> List[str]:
        """Identify missing reasoning steps."""
        missing = []

        actions = [s.get("action", "").lower() for s in trace]

        # Check for KPI analysis
        if not any("kpi" in a or "metric" in a or "success" in a for a in actions):
            missing.append("KPI/metric analysis")

        # Check for topology consultation
        if not any("topology" in a or "ne " in a or "node" in a for a in actions):
            missing.append("Topology consultation")

        # Check for fault type consideration
        if ground_truth:
            fault_type_actions = [
                ground_truth.fault_point_type.value.lower().replace("_", "-"),
                ground_truth.fault_point_type.value.lower().replace("_", " "),
            ]
            if not any(any(ft in a for ft in fault_type_actions) for a in actions):
                missing.append(f"Fault type analysis ({ground_truth.fault_point_type.value})")

        # Check for conclusion
        if not any("conclude" in a or "fault" in a for a in actions):
            missing.append("Final fault conclusion")

        return missing

    def _determine_quality(self, score: float) -> ReasoningQuality:
        """Determine reasoning quality from score."""
        if score >= 0.85:
            return ReasoningQuality.EXCELLENT
        elif score >= 0.70:
            return ReasoningQuality.GOOD
        elif score >= 0.50:
            return ReasoningQuality.FAIR
        elif score >= 0.25:
            return ReasoningQuality.POOR
        else:
            return ReasoningQuality.FAILED

    def _generate_recommendations(
        self,
        logic_checks: List[LogicCheck],
        topology_usage: TopologyUsageCheck,
        multi_agent: MultiAgentConsistencyCheck,
        missing_steps: List[str]
    ) -> List[str]:
        """Generate improvement recommendations."""
        recommendations = []

        # Based on failed logic checks
        for check in logic_checks:
            if not check.passed:
                recommendations.extend(check.suggestions)

        # Based on missing steps
        for step in missing_steps:
            recommendations.append(f"Add {step} step")

        # Based on topology usage
        if topology_usage.score < 0.5:
            recommendations.append("Improve topology utilization")
            if topology_usage.ne_types_missing:
                rec_types = [t.value for t in topology_usage.ne_types_missing]
                recommendations.append(f"Consider these NE types: {', '.join(rec_types)}")

        # Based on multi-agent consistency
        if not multi_agent.consensus_reached:
            recommendations.append("Resolve agent conflicts before concluding")
            for agent1, agent2 in multi_agent.conflicts:
                recommendations.append(f"Clarify discrepancy between {agent1} and {agent2}")

        # Prioritize recommendations
        recommendations = list(dict.fromkeys(recommendations))  # Remove duplicates
        
        return recommendations[:5]  # Return top 5 recommendations
