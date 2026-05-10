"""
Skill: Fault Inference - Rule-based deterministic fault analysis.
Triggered when confidence >= 0.85 (high confidence scenarios).

Performs fault propagation analysis:
1. Identify KPI drop timestamps
2. Propagate upward: session -> trace -> link -> element
3. Locate lowest abnormal layer (root cause)
4. Output fault element/link list with reasoning
"""

import logging
from typing import List, Dict, Set, Tuple
from collections import defaultdict

from simulator.models import Topology, BusinessFlow, NEType
from agents.fault_perception.data_types import Anomaly, SkillResult

logger = logging.getLogger(__name__)


class SkillFaultInference:
    """
    Rule-based fault inference skill.
    
    Uses deterministic propagation analysis to identify root cause.
    Assumes anomalies have already been extracted from KPI data.
    """
    
    def __init__(self):
        self.skill_name = "skill_fault_inference"
    
    def execute(
        self,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> SkillResult:
        """
        Execute fault inference on detected anomalies.
        
        Args:
            anomalies: List of detected anomalies from KPI data
            topology: Network topology
            business_flows: Business flow definitions
            
        Returns:
            SkillResult with identified faults and inference steps
        """
        logger.info(f"[SkillFaultInference] Processing {len(anomalies)} anomalies")
        
        inference_steps = []
        inference_steps.append(f"Starting fault inference with {len(anomalies)} anomalies")
        
        anomalies_by_level = self._group_by_level(anomalies)
        inference_steps.append(f"Anomaly distribution: {dict((k, len(v)) for k, v in anomalies_by_level.items())}")
        
        primary_level = self._identify_primary_level(anomalies_by_level)
        inference_steps.append(f"Primary fault level: {primary_level}")
        
        if primary_level == "session":
            fault_elements, fault_links = self._propagate_upward_session(
                anomalies_by_level.get("session", []), topology, business_flows
            )
        elif primary_level == "trace":
            fault_elements, fault_links = self._propagate_upward_trace(
                anomalies_by_level.get("trace", []), topology, business_flows
            )
        else:
            fault_elements, fault_links = self._analyze_link_level(
                anomalies_by_level.get("link", []), topology
            )
        
        inference_steps.append(f"Identified {len(fault_elements)} elements, {len(fault_links)} links")
        
        refined_elements, refined_links = self._refine_with_topology(
            fault_elements, fault_links, topology
        )
        confidence = self._calculate_confidence(anomalies, refined_elements, refined_links)
        inference_steps.append(f"Inference confidence: {confidence:.3f}")
        
        return SkillResult(
            skill_name=self.skill_name,
            fault_elements=list(refined_elements),
            fault_links=list(refined_links),
            inference_steps=inference_steps,
            confidence=confidence,
            is_deterministic=True
        )
    
    def _group_by_level(self, anomalies: List[Anomaly]) -> Dict[str, List[Anomaly]]:
        by_level = defaultdict(list)
        for a in anomalies:
            by_level[a.level].append(a)
        return by_level
    
    def _identify_primary_level(self, anomalies_by_level: Dict[str, List[Anomaly]]) -> str:
        if not anomalies_by_level:
            return "link"
        for level in ["session", "trace", "link"]:
            if level in anomalies_by_level and len(anomalies_by_level[level]) > 0:
                return level
        return "link"
    
    def _propagate_upward_session(
        self,
        session_anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> Tuple[Set[str], Set[str]]:
        fault_elements, fault_links = set(), set()
        session_pairs = set((a.src, a.dst) for a in session_anomalies)
        affected_hops = set()
        for flow in business_flows:
            for src, dst in flow.hops:
                if (src, dst) in session_pairs or src == "UE" or dst == "UE":
                    affected_hops.update(flow.get_ne_hops())
        hop_anomalies = self._analyze_hop_impact(affected_hops, session_anomalies)
        if hop_anomalies:
            worst = max(hop_anomalies.items(), key=lambda x: x[1])
            src, dst = worst[0]
            fault_links.add(f"{src}->{dst}")
            fault_elements.update([src, dst])
        return fault_elements, fault_links
    
    def _propagate_upward_trace(
        self,
        trace_anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> Tuple[Set[str], Set[str]]:
        fault_elements, fault_links = set(), set()
        src_anomalies = defaultdict(list)
        for a in trace_anomalies:
            src_anomalies[a.src].append(a)
        if src_anomalies:
            worst_src = max(src_anomalies.items(), key=lambda x: sum(a.severity for a in x[1]))
            fault_elements.add(worst_src[0])
            for a in worst_src[1]:
                fault_links.add(f"{a.src}->{a.dst}")
                fault_elements.add(a.dst)
        return fault_elements, fault_links
    
    def _analyze_link_level(
        self,
        link_anomalies: List[Anomaly],
        topology: Topology
    ) -> Tuple[Set[str], Set[str]]:
        fault_elements, fault_links = set(), set()
        src_anomalies = defaultdict(list)
        for a in link_anomalies:
            src_anomalies[a.src].append(a)
        severity_scores = {src: sum(a.severity for a in anoms) for src, anoms in src_anomalies.items()}
        sorted_sources = sorted(severity_scores.items(), key=lambda x: x[1], reverse=True)
        for src, _ in sorted_sources[:2]:
            fault_elements.add(src)
            for a in src_anomalies[src]:
                fault_links.add(f"{a.src}->{a.dst}")
                fault_elements.add(a.dst)
        return fault_elements, fault_links
    
    def _analyze_hop_impact(
        self,
        affected_hops: Set[Tuple[str, str]],
        anomalies: List[Anomaly]
    ) -> Dict[Tuple[str, str], float]:
        hop_severity = defaultdict(float)
        for a in anomalies:
            if (a.src, a.dst) in affected_hops:
                hop_severity[(a.src, a.dst)] += a.severity
        return dict(hop_severity)
    
    def _refine_with_topology(
        self,
        fault_elements: Set[str],
        fault_links: Set[str],
        topology: Topology
    ) -> Tuple[Set[str], Set[str]]:
        refined_elements, refined_links = set(), set()
        valid_elements = set(topology.elements.keys())
        for elem in fault_elements:
            if elem in valid_elements:
                refined_elements.add(elem)
                ne = topology.elements.get(elem)
                if ne:
                    peers = [e.id for e in topology.elements.values() if e.pool_id == ne.pool_id and e.id != elem]
                    refined_elements.update(peers[:1])
        for link in fault_links:
            src, dst = link.split("->")
            if src in valid_elements or dst in valid_elements:
                refined_links.add(link)
        for elem in refined_elements:
            if elem in topology.switches:
                for neighbor in topology.switches[elem]:
                    if neighbor in refined_elements:
                        refined_links.add(f"{elem}->{neighbor}")
        return refined_elements, refined_links
    
    def _calculate_confidence(
        self,
        anomalies: List[Anomaly],
        fault_elements: Set[str],
        fault_links: Set[str]
    ) -> float:
        if not anomalies:
            return 0.0
        explained = sum(1 for a in anomalies if a.src in fault_elements or a.dst in fault_elements)
        explained += sum(1 for link in fault_links if any(a.src + "->" + a.dst == link for a in anomalies))
        coverage = explained / len(anomalies)
        total_faults = len(fault_elements) + len(fault_links)
        concentration = min(explained / (total_faults * 2), 1.0) if total_faults > 0 else 0.0
        return min(0.7 * coverage + 0.3 * concentration, 1.0)
