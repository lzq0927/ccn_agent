"""
Iteration state dataclass definition.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime
from enum import Enum


class DataGenStatus(Enum):
    """Status of data generation phase."""
    NOT_STARTED = "not_started"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class PerceptionStatus(Enum):
    """Status of perception phase."""
    NOT_STARTED = "not_started"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class EvalStatus(Enum):
    """Status of evaluation phase."""
    NOT_STARTED = "not_started"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class IterationState:
    """
    Represents the state of a single iteration in the training loop.
    
    Attributes:
        iteration: Current iteration number
        total_iterations: Total number of planned iterations
        data_gen_status: Status of data generation phase
        perception_status: Status of perception phase
        eval_status: Status of evaluation phase
        metrics: Dict of metrics collected during iteration
        skill_updates: Dict of skill updates applied
        notes: List of notes about this iteration
        summary: Summary of iteration results
        completed: Whether iteration is complete
        completed_at: ISO timestamp of completion
        data_gen_updated_at: ISO timestamp of last data gen update
        perception_updated_at: ISO timestamp of last perception update
        eval_updated_at: ISO timestamp of last eval update
        created_at: ISO timestamp of state creation
    """
    iteration: int
    total_iterations: int = 1
    data_gen_status: DataGenStatus = DataGenStatus.NOT_STARTED
    perception_status: PerceptionStatus = PerceptionStatus.NOT_STARTED
    eval_status: EvalStatus = EvalStatus.NOT_STARTED
    metrics: Dict[str, Any] = field(default_factory=dict)
    skill_updates: Dict[str, Any] = field(default_factory=dict)
    notes: List[Dict[str, str]] = field(default_factory=list)
    summary: str = ""
    completed: bool = False
    completed_at: Optional[str] = None
    data_gen_updated_at: Optional[str] = None
    perception_updated_at: Optional[str] = None
    eval_updated_at: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def is_active(self) -> bool:
        """Check if this iteration is currently active."""
        return (
            not self.completed and
            self.data_gen_status != DataGenStatus.FAILED and
            self.perception_status != PerceptionStatus.FAILED and
            self.eval_status != EvalStatus.FAILED
        )

    def get_current_phase(self) -> str:
        """Get the currently active phase."""
        if self.data_gen_status not in (DataGenStatus.COMPLETED, DataGenStatus.FAILED):
            return "data_generation"
        if self.perception_status not in (PerceptionStatus.COMPLETED, PerceptionStatus.FAILED):
            return "perception"
        if self.eval_status not in (EvalStatus.COMPLETED, EvalStatus.FAILED):
            return "evaluation"
        return "completed"

    def get_progress_percentage(self) -> float:
        """Get overall progress as percentage."""
        phases = {
            DataGenStatus: self.data_gen_status,
            PerceptionStatus: self.perception_status,
            EvalStatus: self.eval_status
        }
        
        weights = {
            DataGenStatus: 0.3,
            PerceptionStatus: 0.3,
            EvalStatus: 0.4
        }
        
        progress = 0.0
        for status_class, status in phases.items():
            if status == status_class.COMPLETED:
                progress += weights[status_class] * 100
        
        return progress

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "iteration": self.iteration,
            "total_iterations": self.total_iterations,
            "data_gen_status": self.data_gen_status.value,
            "perception_status": self.perception_status.value,
            "eval_status": self.eval_status.value,
            "metrics": self.metrics,
            "skill_updates": self.skill_updates,
            "notes": self.notes,
            "summary": self.summary,
            "completed": self.completed,
            "completed_at": self.completed_at,
            "progress_percentage": self.get_progress_percentage()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "IterationState":
        """Create from dictionary representation."""
        return cls(
            iteration=data["iteration"],
            total_iterations=data.get("total_iterations", 1),
            data_gen_status=DataGenStatus(data.get("data_gen_status", "not_started")),
            perception_status=PerceptionStatus(data.get("perception_status", "not_started")),
            eval_status=EvalStatus(data.get("eval_status", "not_started")),
            metrics=data.get("metrics", {}),
            skill_updates=data.get("skill_updates", {}),
            notes=data.get("notes", []),
            summary=data.get("summary", ""),
            completed=data.get("completed", False),
            completed_at=data.get("completed_at"),
            created_at=data.get("created_at", datetime.now().isoformat())
        )
