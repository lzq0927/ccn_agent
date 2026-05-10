"""
Case analysis skill: analyzes fault cases to extract patterns and insights.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from simulator.models import FaultConfig, FaultPointType, FaultMode, Topology


@dataclass
class CaseAnalysisResult:
    """Result of case analysis."""
    case_id: str
    fault_pattern: str
    key_features: List[str] = None
    difficulty_score: float = 0.5
    similar_cases: List[str] = None
    insights: List[str] = None
    recommended_approaches: List[str] = None


class SkillCaseAnalysis:
    """
    Skill for analyzing fault cases to extract patterns and insights.
    Used by the evaluator to understand case characteristics.
    """

    def __init__(self, topology: Topology):
        self.topology = topology
        self.pattern_library = self._init_pattern_library()

    def _init_pattern_library(self) -> Dict[str, Dict]:
        """Initialize known fault patterns."""
        return {
            "single_ne_link": {
                "fault_point_types": [FaultPointType.SINGLE_NE],
                "fault_modes": [FaultMode.LINK],
                "key_indicators": ["single link degradation", "isolated NE failure"],
                "difficulty": 0.3
            },
            "multi_ne_link": {
                "fault_point_types": [FaultPointType.MULTI_NE],
                "fault_modes": [FaultMode.LINK],
                "key_indicators": ["multiple links affected", "correlated failures"],
                "difficulty": 0.5
            },
            "path_fault": {
                "fault_point_types": [
                    FaultPointType.PATH_LINK,
                    FaultPointType.PATH_TRACE,
                    FaultPointType.PATH_SESSION
                ],
                "fault_modes": [FaultMode.LINK, FaultMode.BUSINESS],
                "key_indicators": ["path-level degradation", "session failures"],
                "difficulty": 0.7
            },
            "dc_fault": {
                "fault_point_types": [FaultPointType.DC, FaultPointType.RESOURCE_POOL],
                "fault_modes": [FaultMode.BUSINESS],
                "key_indicators": ["entire DC affected", "pool-level failure"],
                "difficulty": 0.6
            },
            "normal_case": {
                "fault_point_types": [FaultPointType.NORMAL],
                "fault_modes": [],
                "key_indicators": ["all KPIs normal", "no anomalies"],
                "difficulty": 0.1
            }
        }

    def analyze(
        self,
        case_id: str,
        fault_config: Optional[FaultConfig],
        kpi_records: List[Any],
        flows: List[Any]
    ) -> CaseAnalysisResult:
        """
        Analyze a single fault case.
        
        Args:
            case_id: Unique case identifier
            fault_config: Fault configuration (None for normal cases)
            kpi_records: KPI records from simulation
            flows: Business flows from simulation
            
        Returns:
            CaseAnalysisResult with insights and patterns
        """
        if fault_config is None or fault_config.fault_point_type == FaultPointType.NORMAL:
            return self._analyze_normal_case(case_id, kpi_records, flows)

        # Identify the pattern
        pattern_name, pattern_info = self._identify_pattern(fault_config)

        # Extract key features
        key_features = self._extract_key_features(fault_config, kpi_records, flows)

        # Calculate difficulty
        difficulty = self._calculate_difficulty(fault_config, pattern_info)

        # Find similar cases
        similar = self._find_similar_cases(fault_config)

        # Generate insights
        insights = self._generate_insights(fault_config, pattern_info, kpi_records, flows)

        # Recommend approaches
        approaches = self._recommend_approaches(pattern_name, fault_config)

        return CaseAnalysisResult(
            case_id=case_id,
            fault_pattern=pattern_name,
            key_features=key_features,
            difficulty_score=difficulty,
            similar_cases=similar,
            insights=insights,
            recommended_approaches=approaches
        )

    def _analyze_normal_case(
        self,
        case_id: str,
        kpi_records: List[Any],
        flows: List[Any]
    ) -> CaseAnalysisResult:
        """Analyze a normal (no-fault) case."""
        return CaseAnalysisResult(
            case_id=case_id,
            fault_pattern="normal_case",
            key_features=["No fault present", "All KPIs nominal"],
            difficulty_score=0.1,
            similar_cases=[],
            insights=["Verify system baseline", "Ensure monitoring accuracy"],
            recommended_approaches=[
                "Confirm normal operation",
                "Check for subtle anomalies"
            ]
        )

    def _identify_pattern(
        self,
        fault_config: FaultConfig
    ) -> tuple[str, Dict]:
        """Identify the fault pattern from configuration."""
        for pattern_name, pattern_info in self.pattern_library.items():
            if fault_config.fault_point_type in pattern_info["fault_point_types"]:
                if fault_config.fault_mode in pattern_info["fault_modes"]:
                    return pattern_name, pattern_info

        # Default pattern
        return "unknown_pattern", {
            "key_indicators": ["custom fault pattern"],
            "difficulty": 0.5
        }

    def _extract_key_features(
        self,
        fault_config: FaultConfig,
        kpi_records: List[Any],
        flows: List[Any]
    ) -> List[str]:
        """Extract key features from the case."""
        features = []

        # Fault type feature
        features.append(f"fault_type={fault_config.fault_point_type.value}")

        # Fault mode feature
        features.append(f"fault_mode={fault_config.fault_mode.value}")

        # Affected NEs
        if fault_config.affected_ne_ids:
            features.append(f"affected_ne_count={len(fault_config.affected_ne_ids)}")

        # Affected links
        if fault_config.affected_links:
            features.append(f"affected_link_count={len(fault_config.affected_links)}")

        # Fault duration
        if fault_config.fault_duration > 0:
            features.append(f"duration={fault_config.fault_duration}")

        # Loss rate severity
        if fault_config.loss_rate > 0:
            severity = "high" if fault_config.loss_rate > 0.5 else "medium" if fault_config.loss_rate > 0.2 else "low"
            features.append(f"loss_rate={severity}")

        return features

    def _calculate_difficulty(
        self,
        fault_config: FaultConfig,
        pattern_info: Dict
    ) -> float:
        """Calculate case difficulty score."""
        base_difficulty = pattern_info.get("difficulty", 0.5)

        # Increase difficulty based on case characteristics
        difficulty = base_difficulty

        # Multi-NE faults are harder
        if fault_config.affected_ne_ids and len(fault_config.affected_ne_ids) > 2:
            difficulty += 0.1

        # Path faults are harder
        if fault_config.fault_point_type in [
            FaultPointType.PATH_LINK,
            FaultPointType.PATH_TRACE,
            FaultPointType.PATH_SESSION
        ]:
            difficulty += 0.15

        # Short duration faults are harder
        if fault_config.fault_duration < 10:
            difficulty += 0.1

        # Low loss rate faults are harder to detect
        if fault_config.loss_rate < 0.2:
            difficulty += 0.1

        return min(1.0, difficulty)

    def _find_similar_cases(self, fault_config: FaultConfig) -> List[str]:
        """Find similar cases in the pattern library."""
        similar = []

        for pattern_name, pattern_info in self.pattern_library.items():
            if pattern_name == "normal_case":
                continue

            # Check if same fault point type
            if fault_config.fault_point_type in pattern_info["fault_point_types"]:
                similar.append(pattern_name)

            # Check if same fault mode
            if fault_config.fault_mode in pattern_info["fault_modes"]:
                if pattern_name not in similar:
                    similar.append(pattern_name)

        return similar[:3]  # Return top 3 similar patterns

    def _generate_insights(
        self,
        fault_config: FaultConfig,
        pattern_info: Dict,
        kpi_records: List[Any],
        flows: List[Any]
    ) -> List[str]:
        """Generate insights for the case."""
        insights = []

        # Pattern-based insight
        for indicator in pattern_info.get("key_indicators", []):
            insights.append(f"Look for: {indicator}")

        # NE-based insight
        if fault_config.affected_ne_ids:
            ne_ids = list(fault_config.affected_ne_ids)
            if len(ne_ids) == 1:
                insights.append(f"Single NE {ne_ids[0]} affected - check NE health")
            else:
                insights.append(f"Multiple NEs affected - investigate common causes")

        # Link-based insight
        if fault_config.affected_links:
            insights.append(f"Link-level fault detected - check physical connections")

        # Path-based insight
        if fault_config.fault_point_type in [
            FaultPointType.PATH_LINK,
            FaultPointType.PATH_TRACE,
            FaultPointType.PATH_SESSION
        ]:
            insights.append("Path-level fault - analyze route and session data")

        return insights

    def _recommend_approaches(
        self,
        pattern_name: str,
        fault_config: FaultConfig
    ) -> List[str]:
        """Recommend approaches for handling this type of fault."""
        approaches = {
            "single_ne_link": [
                "Check NE operational status",
                "Verify physical link connections",
                "Review NE error logs"
            ],
            "multi_ne_link": [
                "Identify common infrastructure",
                "Check shared resources",
                "Review correlated failures"
            ],
            "path_fault": [
                "Trace the affected path",
                "Check intermediate nodes",
                "Verify session state"
            ],
            "dc_fault": [
                "Check DC-level indicators",
                "Review DC resource utilization",
                "Verify DC connectivity"
            ],
            "unknown_pattern": [
                "Gather comprehensive evidence",
                "Correlate multiple data sources",
                "Consider rare fault types"
            ]
        }

        return approaches.get(pattern_name, approaches["unknown_pattern"])
