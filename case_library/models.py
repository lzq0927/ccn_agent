"""
Fault case data models.
"""

from dataclasses import dataclass, field
from typing import List, Set, Dict, Optional, Any
from datetime import datetime
from enum import Enum
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


class FaultType(Enum):
    """Fault type categories."""
    SINGLE_NE_LINK = "single_ne_link"
    MULTI_NE_LINK = "multi_ne_link"
    PATH_LINK = "path_link"
    PATH_TRACE = "path_trace"
    PATH_SESSION = "path_session"
    RESOURCE_POOL = "resource_pool"
    DC = "dc"
    SWITCH = "switch"
    NORMAL = "normal"
    UNKNOWN = "unknown"


@dataclass
class KPIMetrics:
    """KPI metrics for a fault case."""
    avg_success_rate: float = 1.0
    min_success_rate: float = 1.0
    affected_flows: int = 0
    total_flows: int = 0


@dataclass
class FaultCase:
    """
    Represents a fault case in the case library.
    
    Attributes:
        case_id: Unique case identifier
        fault_type: Type of fault
        perception_mode: Perception mode used
        accuracy: Accuracy score (0-1)
        confidence: Confidence score (0-1)
        tags: Set of tags for categorization
        affected_ne_ids: Set of affected NE IDs
        affected_link_count: Number of affected links
        kpi_metrics: KPI metrics for this case
        reasoning_trace: Reasoning steps taken
        recommendations: Recommendations from evaluation
        created_at: Creation timestamp
        iteration: Iteration when case was created
    """
    case_id: str
    fault_type: FaultType = FaultType.UNKNOWN
    perception_mode: str = "auto"
    accuracy: float = 0.0
    confidence: float = 0.5
    tags: Set[str] = field(default_factory=set)
    affected_ne_ids: Set[str] = field(default_factory=set)
    affected_link_count: int = 0
    kpi_metrics: KPIMetrics = field(default_factory=KPIMetrics)
    reasoning_trace: List[Dict[str, Any]] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    iteration: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "case_id": self.case_id,
            "fault_type": self.fault_type.value,
            "perception_mode": self.perception_mode,
            "accuracy": self.accuracy,
            "confidence": self.confidence,
            "tags": list(self.tags),
            "affected_ne_ids": list(self.affected_ne_ids),
            "affected_link_count": self.affected_link_count,
            "kpi_metrics": {
                "avg_success_rate": self.kpi_metrics.avg_success_rate,
                "min_success_rate": self.kpi_metrics.min_success_rate,
                "affected_flows": self.kpi_metrics.affected_flows,
                "total_flows": self.kpi_metrics.total_flows
            },
            "reasoning_trace": self.reasoning_trace,
            "recommendations": self.recommendations,
            "created_at": self.created_at,
            "iteration": self.iteration
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FaultCase":
        """Create from dictionary."""
        kpi_data = data.get("kpi_metrics", {})
        kpi_metrics = KPIMetrics(
            avg_success_rate=kpi_data.get("avg_success_rate", 1.0),
            min_success_rate=kpi_data.get("min_success_rate", 1.0),
            affected_flows=kpi_data.get("affected_flows", 0),
            total_flows=kpi_data.get("total_flows", 0)
        )
        
        return cls(
            case_id=data["case_id"],
            fault_type=FaultType(data.get("fault_type", "unknown")),
            perception_mode=data.get("perception_mode", "auto"),
            accuracy=data.get("accuracy", 0.0),
            confidence=data.get("confidence", 0.5),
            tags=set(data.get("tags", [])),
            affected_ne_ids=set(data.get("affected_ne_ids", [])),
            affected_link_count=data.get("affected_link_count", 0),
            kpi_metrics=kpi_metrics,
            reasoning_trace=data.get("reasoning_trace", []),
            recommendations=data.get("recommendations", []),
            created_at=data.get("created_at", datetime.now().isoformat()),
            iteration=data.get("iteration", 0)
        )

    def matches_filter(
        self,
        fault_type: Optional[FaultType] = None,
        perception_mode: Optional[str] = None,
        min_accuracy: Optional[float] = None,
        max_accuracy: Optional[float] = None,
        min_confidence: Optional[float] = None,
        max_confidence: Optional[float] = None,
        tags: Optional[Set[str]] = None
    ) -> bool:
        """Check if case matches given filters."""
        if fault_type is not None and self.fault_type != fault_type:
            return False
        if perception_mode is not None and self.perception_mode != perception_mode:
            return False
        if min_accuracy is not None and self.accuracy < min_accuracy:
            return False
        if max_accuracy is not None and self.accuracy > max_accuracy:
            return False
        if min_confidence is not None and self.confidence < min_confidence:
            return False
        if max_confidence is not None and self.confidence > max_confidence:
            return False
        if tags and not self.tags.intersection(tags):
            return False
        return True
