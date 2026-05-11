"""
Data types for fault perception agent.
Defines input/output structures and anomaly detection results.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from datetime import datetime
from enum import Enum


class ConfidenceLevel(Enum):
    HIGH = "high"      # >= 0.85, skill/workflow processing
    MEDIUM = "medium"  # 0.5 <= x < 0.85, LLM single agent exploration
    LOW = "low"        # < 0.5, multi-agent parallel exploration + voting


class PerceptionMode(Enum):
    SKILL = "skill"           # Rule-based deterministic processing
    LLM_EXPLORER = "llm_explorer"  # LLM-driven exploration
    HYBRID = "hybrid"         # Combination of skill and LLM


@dataclass
class Anomaly:
    """Represents a detected anomaly in KPI data."""
    anomaly_id: str
    timestamp: int
    level: str  # "link", "trace", "session"
    ue_id: str
    src: str
    dst: str
    success_rate: float
    normal_baseline: float
    deviation: float  # How far from normal (absolute difference)
    severity: float   # Normalized severity 0.0-1.0
    
    def to_dict(self) -> Dict:
        return {
            "anomaly_id": self.anomaly_id,
            "timestamp": self.timestamp,
            "level": self.level,
            "ue_id": self.ue_id,
            "src": self.src,
            "dst": self.dst,
            "success_rate": self.success_rate,
            "normal_baseline": self.normal_baseline,
            "deviation": self.deviation,
            "severity": self.severity
        }


@dataclass
class PerceptionInput:
    """Input to the perception workflow - KPI data, topology and business process."""
    case_id: str
    kpi_records: List["KPIRecord"]  # from simulator.models
    topology_data: "Topology"       # from simulator.models
    business_flows: List["BusinessFlow"]  # from simulator.models
    fault_config: Optional["FaultConfig"] = None  # Ground truth for evaluation
    timestamp_received: datetime = field(default_factory=datetime.now)
    
    # Additional context
    is_normal_scenario: bool = False  # True if this is a normal (no-fault) scenario
    metadata: Dict = field(default_factory=dict)
    
    def get_anomalous_kpis(self) -> List["KPIRecord"]:
        """Return KPI records with success rate below threshold."""
        threshold = 0.95  # Configurable
        return [kpi for kpi in self.kpi_records if kpi.success_rate < threshold]
    
    def get_time_range(self) -> Tuple[int, int]:
        """Return (start_time, end_time) from KPI records."""
        if not self.kpi_records:
            return (0, 0)
        timestamps = [kpi.timestamp for kpi in self.kpi_records]
        return (min(timestamps), max(timestamps))


@dataclass
class ExplorerResult:
    """Result from LLM explorer - multi-strategy analysis."""
    explorer_id: str
    strategy: str              # "single_deep" | "multi_parallel" | "hybrid"
    hypotheses: List[str]     # Fault hypothesis list
    evidence: List[str]       # Supporting evidence
    confidence: float         # 0.0-1.0
    reasoning_trace: List[str]  # Step-by-step reasoning
    concluded_fault_elements: List[str]  # Perceived faulty NEs
    concluded_fault_links: List[str]      # Perceived faulty links
    duration_ms: float
    error: Optional[str] = None
    
    def to_dict(self) -> Dict:
        return {
            "explorer_id": self.explorer_id,
            "strategy": self.strategy,
            "hypotheses": self.hypotheses,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "reasoning_trace": self.reasoning_trace,
            "concluded_fault_elements": self.concluded_fault_elements,
            "concluded_fault_links": self.concluded_fault_links,
            "duration_ms": self.duration_ms,
            "error": self.error
        }


@dataclass
class SkillResult:
    """Result from rule-based skill processing."""
    skill_name: str
    fault_elements: List[str]
    fault_links: List[str]
    inference_steps: List[str]  # Reasoning steps taken
    confidence: float
    is_deterministic: bool = True
    
    def to_dict(self) -> Dict:
        return {
            "skill_name": self.skill_name,
            "fault_elements": self.fault_elements,
            "fault_links": self.fault_links,
            "inference_steps": self.inference_steps,
            "confidence": self.confidence,
            "is_deterministic": self.is_deterministic
        }


@dataclass
class PerceptionOutput:
    """Final output from perception workflow."""
    case_id: str
    perception_mode: PerceptionMode
    
    # Detected faults
    perceived_fault_elements: List[str]   # Network elements identified as faulty
    perceived_fault_links: List[str]       # Links identified as faulty
    
    # Confidence assessment
    confidence_score: float                # Overall 0.0-1.0
    confidence_level: ConfidenceLevel
    difficulty_hints: List[str]            # Hints about why this case is hard
    
    # Reasoning and traceability
    reasoning_steps: List[str]             # Summary of reasoning process
    anomalies_detected: List[Anomaly]      # Raw anomaly list
    skill_result: Optional[SkillResult] = None
    explorer_result: Optional[ExplorerResult] = None
    
    # Metadata
    timestamp: datetime = field(default_factory=datetime.now)
    latency_ms: float = 0.0
    error: Optional[str] = None
    
    # For evaluation
    perception_reasoning: List[str] = field(default_factory=list)  # For eval agent analysis
    
    def to_dict(self) -> Dict:
        return {
            "case_id": self.case_id,
            "perception_mode": self.perception_mode.value,
            "perceived_fault_elements": self.perceived_fault_elements,
            "perceived_fault_links": self.perceived_fault_links,
            "confidence_score": self.confidence_score,
            "confidence_level": self.confidence_level.value,
            "difficulty_hints": self.difficulty_hints,
            "reasoning_steps": self.reasoning_steps,
            "skill_result": self.skill_result.to_dict() if self.skill_result else None,
            "explorer_result": self.explorer_result.to_dict() if self.explorer_result else None,
            "timestamp": self.timestamp.isoformat() if self.timestamp else datetime.now().isoformat(),
            "latency_ms": self.latency_ms,
            "error": self.error
        }
    
    def is_correct(self, ground_truth: "FaultConfig", topology: "Topology") -> Tuple[bool, float, float]:
        """
        Check if perception is correct against ground truth.
        Returns (is_correct, precision, recall)
        """
        # Determine true faulty elements from fault_config
        true_elements = set()
        for ne in topology.elements.values():
            if ne.id in ground_truth.affected_ne_ids:
                true_elements.add(ne.id)
        
        # Determine true faulty links
        true_links = set()
        for src, dst in ground_truth.affected_links:
            true_links.add(f"{src}->{dst}")
        
        perceived_elements = set(self.perceived_fault_elements)
        perceived_links = set(self.perceived_fault_links)
        
        # Calculate precision
        total_predicted = len(perceived_elements) + len(perceived_links)
        if total_predicted == 0:
            precision = 0.0
        else:
            true_positives = len(true_elements & perceived_elements) + len(true_links & perceived_links)
            precision = true_positives / total_predicted
        
        # Calculate recall
        total_true = len(true_elements) + len(true_links)
        if total_true == 0:
            recall = 1.0 if total_predicted == 0 else 0.0
        else:
            true_positives = len(true_elements & perceived_elements) + len(true_links & perceived_links)
            recall = true_positives / total_true
        
        is_correct = precision >= 0.8 and recall >= 0.8
        return is_correct, precision, recall


# Type imports for annotations (avoid circular import)
from simulator.models import KPIRecord, Topology, BusinessFlow, FaultConfig
