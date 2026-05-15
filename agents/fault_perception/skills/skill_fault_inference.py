"""
Skill: Fault Inference - Rule-based deterministic fault analysis.
Triggered when confidence >= 0.85 (high confidence scenarios).

Performs fault propagation analysis following priority order: link -> trace -> session.
Each level is tried in order; if a level yields no result, fallback to next level.

1. link: Direct analysis of link-level anomalies (src, dst, success_rate)
2. trace: Analyze trace-level anomalies, trace back to source element
3. session: Last resort, only if link and trace both failed
"""

import logging
from typing import List, Dict, Set, Tuple, Optional
from collections import defaultdict

from simulator.models import Topology, BusinessFlow, NEType
from agents.fault_perception.data_types import Anomaly, SkillResult

logger = logging.getLogger(__name__)


class SkillFaultInference:
    """
    Rule-based fault inference skill with link->trace->session priority.
    
    Key design principles:
    1. Deterministic: No LLM calls, pure rule-based
    2. Fallback: Try each level in order, don't give up on first failure
    3. No peer expansion: Don't add同池 peers (source of false positives)
    4. Severity threshold: Only report elements with significant deviation
    """
    
    # Severity threshold: deviation must exceed 5% to be considered a fault
    # (matching workflow's 0.05 threshold for anomaly extraction)
    SEVERITY_THRESHOLD = 0.05
    # Minimum number of anomalies to consider a level "有效"
    MIN_ANOMALY_COUNT = 3
    # Secondary threshold: if no element meets SEVERITY_THRESHOLD, 
    # accept elements with at least this deviation as fallback
    SECONDARY_THRESHOLD = 0.02
    
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
        
        Priority order: link -> trace -> session
        Each level is tried; if it fails or yields empty results, try next.
        
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
        
        fault_elements: Set[str] = set()
        fault_links: Set[str] = set()
        successful_level: Optional[str] = None
        
        # Priority order: link -> trace -> session
        level_order = ["link", "trace", "session"]
        
        for level in level_order:
            level_anomalies = anomalies_by_level.get(level, [])
            
            if level == "link":
                elems, links = self._analyze_link_level(level_anomalies, topology)
            elif level == "trace":
                elems, links = self._analyze_trace_level(level_anomalies, topology, business_flows)
            else:  # session
                elems, links = self._analyze_session_level(level_anomalies, business_flows)
            
            inference_steps.append(f"Level {level}: found {len(elems)} elements, {len(links)} links")
            
            # If this level yielded results, use them
            if elems or links:
                fault_elements = elems
                fault_links = links
                successful_level = level
                inference_steps.append(f"Level {level} produced results, accepting them")
                break
            else:
                inference_steps.append(f"Level {level} produced no results, trying next level")
        
        # Apply severity filtering (pass successful_level to handle session correctly)
        fault_elements = self._filter_by_severity_threshold(
            fault_elements, anomalies, level_hint=successful_level
        )
        
        # NO peer expansion - this was causing false positives
        # Remove any elements that appear only because of topology refinement
        
        inference_steps.append(f"Final fault elements: {sorted(fault_elements)}")
        inference_steps.append(f"Final fault links: {sorted(fault_links)}")
        
        confidence = self._calculate_confidence(anomalies, fault_elements, fault_links)
        inference_steps.append(f"Inference confidence: {confidence:.3f}")
        
        return SkillResult(
            skill_name=self.skill_name,
            fault_elements=sorted(list(fault_elements)),
            fault_links=sorted(list(fault_links)),
            inference_steps=inference_steps,
            confidence=confidence,
            is_deterministic=True
        )
    
    def _group_by_level(self, anomalies: List[Anomaly]) -> Dict[str, List[Anomaly]]:
        by_level = defaultdict(list)
        for a in anomalies:
            by_level[a.level].append(a)
        return by_level
    
    def _analyze_link_level(
        self,
        link_anomalies: List[Anomaly],
        topology: Topology
    ) -> Tuple[Set[str], Set[str]]:
        """
        Analyze link-level anomalies.

        Strategy: Collect ALL significant anomalous links.
        - For switch-type faults: return ALL anomalous links (not just one source)
        - For simple link faults: return anomalous links with their endpoints
        """
        fault_elements: Set[str] = set()
        fault_links: Set[str] = set()

        if not link_anomalies or len(link_anomalies) < self.MIN_ANOMALY_COUNT:
            return fault_elements, fault_links

        # Collect ALL anomalous links with significant deviation
        for a in link_anomalies:
            if a.deviation >= self.SEVERITY_THRESHOLD:
                fault_links.add(f"{a.src}->{a.dst}")
                # Add both src and dst as affected elements
                fault_elements.add(a.src)
                fault_elements.add(a.dst)

        # If no links meet threshold, use secondary threshold
        if not fault_links:
            for a in link_anomalies:
                if a.deviation >= self.SECONDARY_THRESHOLD:
                    fault_links.add(f"{a.src}->{a.dst}")
                    fault_elements.add(a.src)
                    fault_elements.add(a.dst)

        return fault_elements, fault_links
    
    def _analyze_trace_level(
        self,
        trace_anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> Tuple[Set[str], Set[str]]:
        """
        Analyze trace-level anomalies.

        Strategy: Collect ALL significant anomalous traces.
        - Return all affected elements and their links (not just the most affected)
        """
        fault_elements: Set[str] = set()
        fault_links: Set[str] = set()

        if not trace_anomalies or len(trace_anomalies) < self.MIN_ANOMALY_COUNT:
            return fault_elements, fault_links

        # Collect ALL significant anomalous traces
        for a in trace_anomalies:
            if a.deviation >= self.SEVERITY_THRESHOLD:
                fault_elements.add(a.src)
                fault_elements.add(a.dst)
                fault_links.add(f"{a.src}->{a.dst}")

        # If no traces meet threshold, use secondary threshold
        if not fault_links:
            for a in trace_anomalies:
                if a.deviation >= self.SECONDARY_THRESHOLD:
                    fault_elements.add(a.src)
                    fault_elements.add(a.dst)
                    fault_links.add(f"{a.src}->{a.dst}")

        return fault_elements, fault_links
    
    def _analyze_session_level(
        self,
        session_anomalies: List[Anomaly],
        business_flows: List[BusinessFlow]
    ) -> Tuple[Set[str], Set[str]]:
        """
        Analyze session-level anomalies (last resort).
        
        Strategy: Find UEs with anomalous sessions, then trace their business flow
        to identify the network element that is common across affected UEs.
        
        NOTE: session anomalies have empty src/dst, so we need to use ue_id
        to look up business flows.
        """
        fault_elements: Set[str] = set()
        fault_links: Set[str] = set()
        
        if not session_anomalies or len(session_anomalies) < self.MIN_ANOMALY_COUNT:
            return fault_elements, fault_links
        
        # Check severity threshold
        max_deviation = max(a.deviation for a in session_anomalies)
        if max_deviation < self.SEVERITY_THRESHOLD:
            return fault_elements, fault_links
        
        # Get affected UEs
        affected_ues = set(a.ue_id for a in session_anomalies)
        
        # Build UE -> hops mapping
        ue_hops = {}
        for flow in business_flows:
            if flow.ue_id in affected_ues:
                ue_hops[flow.ue_id] = flow.hops
        
        # Find the element that appears most frequently across affected UE paths
        elem_counts = defaultdict(int)
        for ue_id, hops in ue_hops.items():
            for src, dst in hops:
                if src not in ("UE", ""):
                    elem_counts[src] += 1
                if dst not in ("UE", ""):
                    elem_counts[dst] += 1
        
        if not elem_counts:
            return fault_elements, fault_links
        
        # Find the element with highest occurrence
        most_common_elem = max(elem_counts.items(), key=lambda x: x[1])[0]
        
        # Only report if it appears in multiple UEs (reduces false positives)
        if elem_counts[most_common_elem] >= 2:
            fault_elements.add(most_common_elem)
        
        return fault_elements, fault_links
    
    def _filter_by_severity_threshold(
        self,
        fault_elements: Set[str],
        anomalies: List[Anomaly],
        level_hint: Optional[str] = None
    ) -> Set[str]:
        """
        Filter fault elements to only those with significant severity.
        
        For link/trace level: filter based on anomaly.src/dst matching fault_elements
        For session level: filter based on the fault_elements' presence in business flows
        """
        if not fault_elements:
            return fault_elements
        
        if level_hint == "session":
            # Session anomalies don't have src/dst, so we can't filter by deviation
            # Keep all elements from session analysis (they're already filtered by >=2 UEs)
            return fault_elements
        
        # Calculate max severity per element
        elem_max_severity = defaultdict(float)
        for a in anomalies:
            if a.src in fault_elements:
                elem_max_severity[a.src] = max(elem_max_severity[a.src], a.deviation)
            if a.dst in fault_elements:
                elem_max_severity[a.dst] = max(elem_max_severity[a.dst], a.deviation)
        
        # Filter
        filtered = {e for e in fault_elements if elem_max_severity.get(e, 0) >= self.SEVERITY_THRESHOLD}
        
        return filtered
    
    def _calculate_confidence(
        self,
        anomalies: List[Anomaly],
        fault_elements: Set[str],
        fault_links: Set[str]
    ) -> float:
        """
        Calculate confidence based on how well the identified faults explain the anomalies.
        """
        if not anomalies:
            return 0.0
        
        if not fault_elements and not fault_links:
            return 0.0
        
        # Count how many anomalies are explained by our fault elements
        explained = 0
        for a in anomalies:
            if a.level == "link":
                # Link anomaly is explained if either endpoint is a fault element
                if a.src in fault_elements or a.dst in fault_elements:
                    explained += 1
            elif a.level == "trace":
                if a.src in fault_elements or a.dst in fault_elements:
                    explained += 1
            elif a.level == "session":
                # Session anomaly: check if any fault element is in the path
                # This is approximate since session anomalies don't have src/dst
                if fault_elements:
                    explained += 0.5  # Partial credit
        
        coverage = explained / len(anomalies)
        
        # Penalize if we have too many fault elements (diffuse)
        total_faults = len(fault_elements) + len(fault_links)
        concentration = 1.0 / (1.0 + 0.1 * (total_faults - 1))
        
        return min(0.8 * coverage + 0.2 * concentration, 1.0)
