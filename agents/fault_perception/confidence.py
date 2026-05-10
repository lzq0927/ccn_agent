"""
Confidence evaluation module for fault perception.
Evaluates input difficulty across 5 dimensions to determine processing strategy.
"""

from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass

from simulator.models import KPIRecord, Topology, BusinessFlow, FaultConfig


# Weights for the 5 confidence dimensions
DIMENSION_WEIGHTS = {
    "signal_strength": 0.30,      # Fault signal intensity
    "uniqueness": 0.25,          # Fault point uniqueness  
    "alarm_concentration": 0.20, # Alarm clustering
    "topology_complexity": 0.15, # Network complexity
    "historical_similarity": 0.10  # Similar past cases
}


@dataclass
class ConfidenceBreakdown:
    """Detailed breakdown of confidence score by dimension."""
    signal_strength_score: float
    uniqueness_score: float
    alarm_concentration_score: float
    topology_complexity_score: float
    historical_similarity_score: float
    
    weighted_score: float
    difficulty_hints: List[str]
    
    def to_dict(self) -> Dict:
        return {
            "signal_strength": self.signal_strength_score,
            "uniqueness": self.uniqueness_score,
            "alarm_concentration": self.alarm_concentration_score,
            "topology_complexity": self.topology_complexity_score,
            "historical_similarity": self.historical_similarity_score,
            "weighted_score": self.weighted_score,
            "difficulty_hints": self.difficulty_hints
        }


class ConfidenceEvaluator:
    """
    Evaluates the difficulty and confidence of perceiving faults from KPI data.
    
    Uses 5 dimensions:
    1. Signal Strength (30%): Gap between normal and faulty KPI values
    2. Uniqueness (25%): Whether fault can be uniquely mapped to a point
    3. Alarm Concentration (20%): Clustering of alarms in time/location
    4. Topology Complexity (15%): Network size and path complexity
    5. Historical Similarity (10%): Availability of similar past cases
    """
    
    def __init__(self, historical_cases: Optional[List[Dict]] = None):
        """
        Initialize confidence evaluator.
        
        Args:
            historical_cases: Optional list of past case dicts with 'input' and 'accuracy' keys
        """
        self.historical_cases = historical_cases or []
    
    def evaluate(
        self,
        kpi_records: List[KPIRecord],
        topology: Topology,
        business_flows: List[BusinessFlow],
        anomalies: List["Anomaly"]  # From data_types
    ) -> Tuple[float, ConfidenceBreakdown]:
        """
        Evaluate overall confidence score.
        
        Args:
            kpi_records: KPI time series data
            topology: Network topology
            business_flows: Business flow definitions
            anomalies: Detected anomalies from anomaly extraction
            
        Returns:
            Tuple of (confidence_score 0.0-1.0, ConfidenceBreakdown)
        """
        # Calculate each dimension
        signal_score = self._evaluate_signal_strength(kpi_records, anomalies)
        uniqueness_score = self._evaluate_uniqueness(anomalies, topology)
        alarm_score = self._evaluate_alarm_concentration(anomalies)
        topology_score = self._evaluate_topology_complexity(topology, business_flows)
        historical_score = self._evaluate_historical_similarity(kpi_records, topology)
        
        # Build breakdown
        breakdown = ConfidenceBreakdown(
            signal_strength_score=signal_score,
            uniqueness_score=uniqueness_score,
            alarm_concentration_score=alarm_score,
            topology_complexity_score=topology_score,
            historical_similarity_score=historical_score,
            weighted_score=0.0,  # Calculated below
            difficulty_hints=[]
        )
        
        # Calculate weighted score
        breakdown.weighted_score = (
            signal_score * DIMENSION_WEIGHTS["signal_strength"] +
            uniqueness_score * DIMENSION_WEIGHTS["uniqueness"] +
            alarm_score * DIMENSION_WEIGHTS["alarm_concentration"] +
            topology_score * DIMENSION_WEIGHTS["topology_complexity"] +
            historical_score * DIMENSION_WEIGHTS["historical_similarity"]
        )
        
        # Generate difficulty hints
        breakdown.difficulty_hints = self._generate_difficulty_hints(
            breakdown, anomalies, topology
        )
        
        return breakdown.weighted_score, breakdown
    
    def _evaluate_signal_strength(
        self,
        kpi_records: List[KPIRecord],
        anomalies: List["Anomaly"]
    ) -> float:
        """
        Evaluate fault signal strength.
        Higher score if clear gap between normal and faulty KPI values.
        """
        if not anomalies:
            return 0.0
        
        # Calculate average deviation from normal baseline
        total_deviation = sum(a.deviation for a in anomalies)
        avg_deviation = total_deviation / len(anomalies)
        
        # Also consider severity distribution
        max_severity = max(a.severity for a in anomalies) if anomalies else 0.0
        avg_severity = sum(a.severity for a in anomalies) / len(anomalies) if anomalies else 0.0
        
        # Score based on deviation and severity
        # Deviation of 0.5+ (50% drop) should give high score
        deviation_score = min(avg_deviation / 0.5, 1.0)
        
        # Severity score considers both max and average
        severity_score = 0.4 * max_severity + 0.6 * avg_severity
        
        # Combined score
        score = 0.5 * deviation_score + 0.5 * severity_score
        
        return min(score, 1.0)
    
    def _evaluate_uniqueness(
        self,
        anomalies: List["Anomaly"],
        topology: Topology
    ) -> float:
        """
        Evaluate how uniquely the fault can be mapped to a specific point.
        Higher score if anomalies point to a single clear root cause.
        """
        if not anomalies:
            return 0.0
        
        # Count unique (src, dst) pairs affected
        unique_endpoints = set()
        for a in anomalies:
            unique_endpoints.add((a.src, a.dst))
        
        # Count unique source elements
        unique_sources = set(a.src for a in anomalies)
        
        # Count unique destination elements  
        unique_destinations = set(a.dst for a in anomalies)
        
        # If anomalies are concentrated in few elements, high uniqueness
        total_anomalies = len(anomalies)
        
        # Concentration ratio - how many anomalies point to the top element
        if total_anomalies == 0:
            return 0.0
        
        src_counts = {}
        for a in anomalies:
            src_counts[a.src] = src_counts.get(a.src, 0) + 1
        
        max_src_count = max(src_counts.values()) if src_counts else 0
        concentration = max_src_count / total_anomalies
        
        # Score based on concentration and number of unique endpoints
        endpoint_score = 1.0 / (1.0 + len(unique_endpoints) / 10.0)  # More endpoints = harder
        concentration_score = concentration
        
        return 0.5 * endpoint_score + 0.5 * concentration_score
    
    def _evaluate_alarm_concentration(
        self,
        anomalies: List["Anomaly"]
    ) -> float:
        """
        Evaluate alarm concentration in time and location.
        Higher score if alarms are clustered (easier to identify).
        """
        if not anomalies or len(anomalies) < 2:
            return 0.5  # Single or no anomaly = moderate difficulty
        
        # Time-based clustering
        timestamps = sorted(a.timestamp for a in anomalies)
        time_span = timestamps[-1] - timestamps[0] if len(timestamps) > 1 else 1
        
        # Check if anomalies are within a tight time window
        # Assuming time is in seconds, a span of < 60s is highly concentrated
        time_concentration = 1.0 / (1.0 + time_span / 60.0)
        
        # Level-based clustering
        # If all anomalies are at the same level, easier
        levels = set(a.level for a in anomalies)
        level_score = 1.0 / (1.0 + len(levels) / 3.0)
        
        # UE-based clustering
        ues = set(a.ue_id for a in anomalies)
        ue_score = 1.0 / (1.0 + len(ues) / 10.0)
        
        # Combined
        score = (time_concentration + level_score + ue_score) / 3.0
        return score
    
    def _evaluate_topology_complexity(
        self,
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> float:
        """
        Evaluate topology complexity.
        Higher score = simpler topology (easier to localize fault).
        """
        num_elements = len(topology.elements)
        num_dcs = len(topology.dcs)
        num_pools = len(topology.get_pool_ids())
        
        # Average path length in business flows
        avg_hops = 0.0
        if business_flows:
            hop_counts = [len(f.hops) for f in business_flows]
            avg_hops = sum(hop_counts) / len(hop_counts)
        
        # More elements and hops = more complex = lower score
        # Normalize: 1 element = max score, 100+ elements = min score
        element_score = 1.0 / (1.0 + num_elements / 20.0)
        
        # Path score: fewer hops = easier
        path_score = 1.0 / (1.0 + avg_hops / 5.0)
        
        # DC/pool complexity
        structure_score = 1.0 / (1.0 + (num_dcs + num_pools) / 10.0)
        
        return (element_score * 0.4 + path_score * 0.4 + structure_score * 0.2)
    
    def _evaluate_historical_similarity(
        self,
        kpi_records: List[KPIRecord],
        topology: Topology
    ) -> float:
        """
        Evaluate similarity to historical cases.
        Higher score if similar cases exist in history (easier to reference).
        """
        if not self.historical_cases:
            return 0.5  # No history = moderate difficulty
        
        # Extract features for comparison
        current_features = self._extract_case_features(kpi_records, topology)
        
        # Find most similar historical case
        max_similarity = 0.0
        for historical_case in self.historical_cases:
            if "features" not in historical_case:
                continue
            similarity = self._calculate_feature_similarity(
                current_features, 
                historical_case["features"]
            )
            max_similarity = max(max_similarity, similarity)
        
        return max_similarity
    
    def _extract_case_features(self, kpi_records: List[KPIRecord], topology: Topology) -> Dict:
        """Extract feature vector from case for similarity comparison."""
        if not kpi_records:
            return {}
        
        # KPI statistics
        success_rates = [kpi.success_rate for kpi in kpi_records]
        avg_success = sum(success_rates) / len(success_rates)
        min_success = min(success_rates)
        
        # Topology features
        num_elements = len(topology.elements)
        
        # Anomaly pattern features
        anomaly_count = len([k for k in kpi_records if k.success_rate < 0.95])
        
        return {
            "avg_success_rate": avg_success,
            "min_success_rate": min_success,
            "num_elements": num_elements,
            "anomaly_ratio": anomaly_count / len(kpi_records) if kpi_records else 0.0
        }
    
    def _calculate_feature_similarity(self, f1: Dict, f2: Dict) -> float:
        """Calculate similarity between two feature vectors (0-1)."""
        if not f1 or not f2:
            return 0.5
        
        # Simple distance-based similarity
        total_diff = 0.0
        count = 0
        
        for key in f1:
            if key in f2:
                if key == "num_elements":
                    # Normalize by max
                    diff = abs(f1[key] - f2[key]) / max(f1[key], f2[key], 1)
                else:
                    diff = abs(f1[key] - f2[key])
                total_diff += diff
                count += 1
        
        if count == 0:
            return 0.5
        
        avg_diff = total_diff / count
        # Convert to similarity (0 diff = 1.0 similarity)
        return 1.0 / (1.0 + avg_diff)
    
    def _generate_difficulty_hints(
        self,
        breakdown: ConfidenceBreakdown,
        anomalies: List["Anomaly"],
        topology: Topology
    ) -> List[str]:
        """Generate human-readable hints about why this case is difficult."""
        hints = []
        
        if breakdown.signal_strength_score < 0.4:
            hints.append("Weak fault signal - small KPI deviation from normal")
        
        if breakdown.uniqueness_score < 0.4:
            hints.append("Ambiguous fault location - multiple candidates")
        
        if breakdown.alarm_concentration_score < 0.4:
            hints.append("Diffuse alarms - distributed across time/location")
        
        if breakdown.topology_complexity_score < 0.4:
            hints.append("Complex topology - large network with many paths")
        
        if breakdown.historical_similarity_score < 0.3:
            hints.append("Novel scenario - no similar historical cases")
        
        if not anomalies:
            hints.append("No anomalies detected in KPI data")
        
        if len(anomalies) > 50:
            hints.append("High anomaly volume - many KPIs affected")
        
        # Check for multi-DC scenarios
        affected_dcs = set()
        for a in anomalies:
            # Try to infer DC from element IDs or metadata
            pass  # Would need more context
        
        if len(affected_dcs) > 1:
            hints.append("Multi-DC fault - affects multiple data centers")
        
        return hints
    
    def get_processing_recommendation(self, confidence_score: float) -> str:
        """
        Get recommended processing mode based on confidence score.
        
        Returns:
            "skill" if >= 0.85, "llm_single" if >= 0.5, "llm_multi" otherwise
        """
        if confidence_score >= 0.85:
            return "skill"
        elif confidence_score >= 0.5:
            return "llm_single"
        else:
            return "llm_multi"


# Import Anomaly from data_types
from agents.fault_perception.data_types import Anomaly
