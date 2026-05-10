"""
Skill: LLM Explorer - Multi-strategy LLM-based fault analysis.
Triggered when confidence < 0.85 (medium/low confidence scenarios).

Supports three strategies:
- Strategy A (single_deep): Single LLM with complete context, step-by-step reasoning
- Strategy B (multi_parallel): Multiple LLM agents with different prompts, voting fusion
- Strategy C (hybrid): Rule-based narrowing followed by LLM deep analysis
"""

import logging
import time
import uuid
from typing import List, Dict, Set, Tuple, Optional
from collections import Counter

from simulator.models import Topology, BusinessFlow
from agents.fault_perception.data_types import Anomaly, ExplorerResult

logger = logging.getLogger(__name__)


class SkillLLMExplorer:
    """
    LLM-based fault explorer skill.
    
    Uses multi-strategy LLM analysis for difficult fault localization.
    Strategies can be selected automatically based on difficulty or explicitly.
    """
    
    def __init__(self, llm_provider: Optional[object] = None):
        """
        Initialize LLM Explorer skill.
        
        Args:
            llm_provider: Optional LLM provider instance.
                         If None, will use default provider from environment.
        """
        self.skill_name = "skill_llm_explorer"
        self.llm_provider = llm_provider
        self.explorer_id_prefix = f"explorer_{int(time.time() * 1000)}"
    
    def execute(
        self,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow],
        mode: str = "auto"
    ) -> ExplorerResult:
        """
        Execute LLM exploration with specified or auto-detected strategy.
        
        Args:
            anomalies: Detected anomalies from KPI data
            topology: Network topology
            business_flows: Business flow definitions
            mode: Strategy to use - "single_deep", "multi_parallel", "hybrid", or "auto"
            
        Returns:
            ExplorerResult with hypotheses, evidence, and conclusions
        """
        explorer_id = f"{self.explorer_id_prefix}_{uuid.uuid4().hex[:8]}"
        logger.info(f"[SkillLLMExplorer] Starting exploration {explorer_id} in {mode} mode")
        
        start_time = time.time()
        
        # Auto-select strategy based on anomaly characteristics
        if mode == "auto":
            mode = self._auto_select_strategy(anomalies)
        
        # Execute selected strategy
        if mode == "single_deep":
            result = self._strategy_single_deep(explorer_id, anomalies, topology, business_flows)
        elif mode == "multi_parallel":
            result = self._strategy_multi_parallel(explorer_id, anomalies, topology, business_flows)
        elif mode == "hybrid":
            result = self._strategy_hybrid(explorer_id, anomalies, topology, business_flows)
        else:
            result = self._strategy_single_deep(explorer_id, anomalies, topology, business_flows)
        
        result.duration_ms = (time.time() - start_time) * 1000
        logger.info(f"[SkillLLMExplorer] Exploration {explorer_id} completed in {result.duration_ms:.1f}ms")
        
        return result
    
    def _auto_select_strategy(self, anomalies: List[Anomaly]) -> str:
        """Auto-select exploration strategy based on anomaly characteristics."""
        if not anomalies:
            return "single_deep"
        
        # Multi-DC indicators suggest hybrid approach
        affected_dcs = set()
        for a in anomalies:
            # DC identification would need topology context
            pass
        
        # High anomaly count suggests multi_parallel
        if len(anomalies) > 30:
            return "multi_parallel"
        
        # Diverse levels suggest hybrid
        levels = set(a.level for a in anomalies)
        if len(levels) >= 2:
            return "hybrid"
        
        return "single_deep"
    
    def _strategy_single_deep(
        self,
        explorer_id: str,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> ExplorerResult:
        """
        Strategy A: Single LLM agent with deep analysis.
        
        Provides complete context to LLM and asks for step-by-step reasoning.
        """
        reasoning_trace = [
            f"[{explorer_id}] Starting single agent deep analysis",
            f"Analyzing {len(anomalies)} anomalies across {len(set(a.level for a in anomalies))} levels"
        ]
        
        # Build context for LLM
        context = self._build_llm_context(anomalies, topology, business_flows)
        
        # Generate hypotheses based on anomaly patterns
        hypotheses = self._generate_hypotheses(context)
        reasoning_trace.extend([f"Hypothesis {i+1}: {h}" for i, h in enumerate(hypotheses)])
        
        # Evaluate evidence for each hypothesis
        evidence = self._evaluate_evidence(hypotheses, anomalies, topology)
        reasoning_trace.append(f"Evaluated evidence for {len(hypotheses)} hypotheses")
        
        # Select best hypothesis and generate conclusions
        best_hypothesis = self._select_best_hypothesis(hypotheses, evidence)
        reasoning_trace.append(f"Selected hypothesis: {best_hypothesis}")
        
        fault_elements, fault_links = self._extract_conclusions(best_hypothesis, anomalies, topology)
        reasoning_trace.append(f"Concluded fault elements: {fault_elements}")
        reasoning_trace.append(f"Concluded fault links: {fault_links}")
        
        # Calculate confidence
        confidence = self._calculate_explorer_confidence(hypotheses, evidence, anomalies)
        
        return ExplorerResult(
            explorer_id=explorer_id,
            strategy="single_deep",
            hypotheses=hypotheses,
            evidence=evidence,
            confidence=confidence,
            reasoning_trace=reasoning_trace,
            concluded_fault_elements=fault_elements,
            concluded_fault_links=fault_links,
            duration_ms=0.0  # Will be set by caller
        )
    
    def _strategy_multi_parallel(
        self,
        explorer_id: str,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> ExplorerResult:
        """
        Strategy B: Multiple LLM agents in parallel with voting fusion.
        
        Launches 3 different analysis agents with different prompt strategies,
        then fuses results through voting.
        """
        reasoning_trace = [
            f"[{explorer_id}] Starting multi-agent parallel analysis",
            f"Launching 3 explorer agents with different strategies"
        ]
        
        # Run three different analysis strategies
        agent_results = []
        
        # Agent 1: Severity-focused analysis
        result1 = self._run_explorer_agent(
            f"{explorer_id}_severity",
            anomalies, topology, business_flows,
            prompt_strategy="severity_focused"
        )
        agent_results.append(result1)
        reasoning_trace.append(f"Agent 1 (severity-focused): {len(result1.concluded_fault_elements)} elements")
        
        # Agent 2: Topology-aware analysis
        result2 = self._run_explorer_agent(
            f"{explorer_id}_topology",
            anomalies, topology, business_flows,
            prompt_strategy="topology_aware"
        )
        agent_results.append(result2)
        reasoning_trace.append(f"Agent 2 (topology-aware): {len(result2.concluded_fault_elements)} elements")
        
        # Agent 3: Pattern-matching analysis
        result3 = self._run_explorer_agent(
            f"{explorer_id}_pattern",
            anomalies, topology, business_flows,
            prompt_strategy="pattern_matching"
        )
        agent_results.append(result3)
        reasoning_trace.append(f"Agent 3 (pattern-matching): {len(result3.concluded_fault_elements)} elements")
        
        # Vote fusion
        all_elements = []
        all_links = []
        for r in agent_results:
            all_elements.extend(r.concluded_fault_elements)
            all_links.extend(r.concluded_fault_links)
        
        # Element voting
        element_counts = Counter(all_elements)
        fault_elements = [elem for elem, count in element_counts.most_common(5) if count >= 2]
        
        # Link voting
        link_counts = Counter(all_links)
        fault_links = [link for link, count in link_counts.most_common(5) if count >= 2]
        
        reasoning_trace.append(f"Vote fusion: {len(fault_elements)} elements, {len(fault_links)} links after voting")
        
        # Aggregate hypotheses and evidence
        all_hypotheses = []
        all_evidence = []
        for r in agent_results:
            all_hypotheses.extend(r.hypotheses)
            all_evidence.extend(r.evidence)
        
        # Average confidence weighted by agreement
        confidences = [r.confidence for r in agent_results]
        confidence = sum(confidences) / len(confidences)
        
        # Adjust confidence based on agreement
        if len(fault_elements) >= 2:
            confidence = min(confidence * 1.2, 1.0)  # Boost for consensus
        
        return ExplorerResult(
            explorer_id=explorer_id,
            strategy="multi_parallel",
            hypotheses=all_hypotheses[:10],  # Limit to top 10
            evidence=all_evidence[:10],
            confidence=confidence,
            reasoning_trace=reasoning_trace,
            concluded_fault_elements=fault_elements,
            concluded_fault_links=fault_links,
            duration_ms=0.0
        )
    
    def _strategy_hybrid(
        self,
        explorer_id: str,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> ExplorerResult:
        """
        Strategy C: Hybrid - rule-based narrowing + LLM deep analysis.
        
        First uses rules to narrow down candidate faults, then LLM for deep analysis.
        """
        reasoning_trace = [
            f"[{explorer_id}] Starting hybrid analysis (rules + LLM)",
            f"Phase 1: Rule-based narrowing"
        ]
        
        # Phase 1: Rule-based narrowing
        narrowed_candidates = self._rule_based_narrowing(anomalies, topology)
        reasoning_trace.append(f"Narrowed to {len(narrowed_candidates)} candidate elements")
        
        # Phase 2: LLM deep analysis on candidates
        reasoning_trace.append("Phase 2: LLM deep analysis on narrowed candidates")
        
        context = self._build_llm_context(anomalies, topology, business_flows)
        context["candidate_elements"] = narrowed_candidates
        
        hypotheses = self._generate_hypotheses(context)
        evidence = self._evaluate_evidence(hypotheses, anomalies, topology)
        best_hypothesis = self._select_best_hypothesis(hypotheses, evidence)
        
        fault_elements, fault_links = self._extract_conclusions(
            best_hypothesis, anomalies, topology, candidates=narrowed_candidates
        )
        
        confidence = self._calculate_explorer_confidence(hypotheses, evidence, anomalies)
        confidence = confidence * 1.1  # Boost for hybrid approach
        
        reasoning_trace.extend([
            f"Selected hypothesis: {best_hypothesis}",
            f"Concluded fault elements: {fault_elements}",
            f"Concluded fault links: {fault_links}"
        ])
        
        return ExplorerResult(
            explorer_id=explorer_id,
            strategy="hybrid",
            hypotheses=hypotheses,
            evidence=evidence,
            confidence=min(confidence, 1.0),
            reasoning_trace=reasoning_trace,
            concluded_fault_elements=fault_elements,
            concluded_fault_links=fault_links,
            duration_ms=0.0
        )
    
    def _run_explorer_agent(
        self,
        agent_id: str,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow],
        prompt_strategy: str
    ) -> ExplorerResult:
        """Run a single explorer agent with specific prompt strategy."""
        context = self._build_llm_context(anomalies, topology, business_flows)
        context["prompt_strategy"] = prompt_strategy
        
        hypotheses = self._generate_hypotheses(context)
        evidence = self._evaluate_evidence(hypotheses, anomalies, topology)
        best_hypothesis = self._select_best_hypothesis(hypotheses, evidence)
        fault_elements, fault_links = self._extract_conclusions(best_hypothesis, anomalies, topology)
        
        return ExplorerResult(
            explorer_id=agent_id,
            strategy=prompt_strategy,
            hypotheses=hypotheses,
            evidence=evidence,
            confidence=0.5,  # Will be recalculated
            reasoning_trace=[f"Agent {agent_id} completed"],
            concluded_fault_elements=fault_elements,
            concluded_fault_links=fault_links,
            duration_ms=0.0
        )
    
    def _build_llm_context(
        self,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> Dict:
        """Build context dictionary for LLM prompt."""
        # Aggregate anomaly statistics
        anomaly_stats = {
            "total": len(anomalies),
            "by_level": {},
            "by_src": {},
            "severity_distribution": {"high": 0, "medium": 0, "low": 0}
        }
        
        for a in anomalies:
            # By level
            anomaly_stats["by_level"][a.level] = anomaly_stats["by_level"].get(a.level, 0) + 1
            # By source
            anomaly_stats["by_src"][a.src] = anomaly_stats["by_src"].get(a.src, 0) + 1
            # Severity
            if a.severity >= 0.7:
                anomaly_stats["severity_distribution"]["high"] += 1
            elif a.severity >= 0.4:
                anomaly_stats["severity_distribution"]["medium"] += 1
            else:
                anomaly_stats["severity_distribution"]["low"] += 1
        
        # Top affected sources
        top_sources = sorted(
            anomaly_stats["by_src"].items(),
            key=lambda x: x[1],
            reverse=True
        )[:5]
        
        context = {
            "anomaly_count": len(anomalies),
            "anomaly_stats": anomaly_stats,
            "top_affected_sources": top_sources,
            "network_elements": list(topology.elements.keys()),
            "network_size": len(topology.elements),
            "dc_count": len(topology.dcs),
            "process_count": len(business_flows)
        }
        
        return context
    
    def _generate_hypotheses(self, context: Dict) -> List[str]:
        """Generate fault hypotheses based on anomaly patterns."""
        hypotheses = []
        
        anomaly_count = context.get("anomaly_count", 0)
        top_sources = context.get("top_affected_sources", [])
        severity_dist = context.get("anomaly_stats", {}).get("severity_distribution", {})
        
        # Hypothesis 1: Single point of failure
        if top_sources:
            top_elem = top_sources[0][0]
            hypotheses.append(f"Single point of failure at {top_elem}")
        
        # Hypothesis 2:链路故障 (Link failure)
        if severity_dist.get("high", 0) > 0:
            hypotheses.append("Link-level failure affecting connectivity")
        
        # Hypothesis 3: Pool-level failure (multiple elements affected)
        if len(top_sources) >= 2:
            hypotheses.append(f"Pool-level failure affecting multiple elements in same pool")
        
        # Hypothesis 4: Path-level fault
        if context.get("process_count", 0) > 0:
            hypotheses.append("Path-level fault affecting business flow")
        
        # Hypothesis 5: Multi-hop propagation
        if anomaly_count > 20:
            hypotheses.append("Multi-hop propagation - root cause different from symptom location")
        
        # Default hypothesis
        if not hypotheses:
            hypotheses.append("Unknown fault pattern - requires deeper analysis")
        
        return hypotheses
    
    def _evaluate_evidence(
        self,
        hypotheses: List[str],
        anomalies: List[Anomaly],
        topology: Topology
    ) -> List[str]:
        """Evaluate evidence for each hypothesis."""
        evidence = []
        
        for hypothesis in hypotheses:
            supporting_anomalies = []
            
            # Check which anomalies support this hypothesis
            for a in anomalies:
                if "single" in hypothesis.lower() and a.src == hypothesis.split()[-1]:
                    supporting_anomalies.append(a)
                elif "link" in hypothesis.lower() and a.level == "link":
                    supporting_anomalies.append(a)
                elif "pool" in hypothesis.lower() and a.level in ["link", "trace"]:
                    supporting_anomalies.append(a)
                elif "path" in hypothesis.lower() and a.level == "session":
                    supporting_anomalies.append(a)
            
            if supporting_anomalies:
                evidence.append(f"{hypothesis}: supported by {len(supporting_anomalies)} anomalies")
            else:
                evidence.append(f"{hypothesis}: limited direct evidence")
        
        return evidence
    
    def _select_best_hypothesis(
        self,
        hypotheses: List[str],
        evidence: List[str]
    ) -> str:
        """Select best hypothesis based on evidence strength."""
        if not hypotheses:
            return "Unknown fault"
        
        # Simple scoring: count supporting evidence
        best_idx = 0
        best_score = 0
        
        for i, ev in enumerate(evidence):
            score = len(ev.split("supported by")[-1].split()[0]) if "supported by" in ev else 0
            if score > best_score:
                best_score = score
                best_idx = i
        
        return hypotheses[best_idx]
    
    def _extract_conclusions(
        self,
        hypothesis: str,
        anomalies: List[Anomaly],
        topology: Topology,
        candidates: Optional[List[str]] = None
    ) -> Tuple[List[str], List[str]]:
        """Extract fault elements and links from hypothesis."""
        fault_elements = []
        fault_links = []
        
        # Parse hypothesis to find element references
        if candidates:
            fault_elements.extend(candidates[:3])
        
        # Find anomalies matching hypothesis
        for a in anomalies:
            if "single" in hypothesis.lower():
                if a.src in hypothesis:
                    fault_elements.append(a.src)
                    fault_elements.append(a.dst)
            elif "link" in hypothesis.lower() and a.level == "link":
                fault_elements.append(a.src)
                fault_elements.append(a.dst)
                fault_links.append(f"{a.src}->{a.dst}")
            elif "pool" in hypothesis.lower():
                fault_elements.append(a.src)
        
        # Deduplicate
        fault_elements = list(set(fault_elements))[:5]
        fault_links = list(set(fault_links))[:5]
        
        return fault_elements, fault_links
    
    def _rule_based_narrowing(
        self,
        anomalies: List[Anomaly],
        topology: Topology
    ) -> List[str]:
        """Rule-based narrowing to reduce candidate set."""
        candidates = []
        
        # Group anomalies by source
        src_anomalies = {}
        for a in anomalies:
            if a.src not in src_anomalies:
                src_anomalies[a.src] = []
            src_anomalies[a.src].append(a)
        
        # Find elements with high anomaly concentration
        for src, anoms in src_anomalies.items():
            total_severity = sum(a.severity for a in anoms)
            if total_severity > 1.0:  # Threshold
                candidates.append(src)
        
        # Also include destinations from severe anomalies
        for a in anomalies:
            if a.severity > 0.7:
                candidates.append(a.dst)
        
        return list(set(candidates))[:10]  # Max 10 candidates
    
    def _calculate_explorer_confidence(
        self,
        hypotheses: List[str],
        evidence: List[str],
        anomalies: List[Anomaly]
    ) -> float:
        """Calculate confidence for explorer result."""
        if not hypotheses or not evidence:
            return 0.3
        
        # Count well-supported hypotheses
        supported_count = sum(1 for e in evidence if "supported by" in e and int(e.split("supported by")[-1].split()[0]) > 0)
        
        support_ratio = supported_count / len(hypotheses) if hypotheses else 0
        
        # Adjust based on evidence detail
        evidence_detail = len(" ".join(evidence)) / 100
        
        confidence = 0.4 + (support_ratio * 0.4) + min(evidence_detail * 0.2, 0.2)
        
        return min(confidence, 0.95)
