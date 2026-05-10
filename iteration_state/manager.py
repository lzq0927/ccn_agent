"""
Iteration state manager: tracks overall iteration progress.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime
from enum import Enum

from iteration_state.storage import IterationStateStorage
from iteration_state.state import IterationState, DataGenStatus, PerceptionStatus, EvalStatus


class IterationStateManager:
    """
    Manages iteration state across the training loop.
    Tracks progress of data generation, perception, and evaluation phases.
    """

    def __init__(self, storage_path: str = "iteration_state/states.json"):
        self.storage = IterationStateStorage(storage_path)
        self._current_state: Optional[IterationState] = None

    def initialize_iteration(
        self,
        iteration: int,
        total_iterations: int
    ) -> IterationState:
        """
        Initialize state for a new iteration.
        
        Args:
            iteration: Current iteration number
            total_iterations: Total planned iterations
            
        Returns:
            New IterationState
        """
        self._current_state = IterationState(
            iteration=iteration,
            total_iterations=total_iterations,
            data_gen_status=DataGenStatus.NOT_STARTED,
            perception_status=PerceptionStatus.NOT_STARTED,
            eval_status=EvalStatus.NOT_STARTED,
            metrics={},
            skill_updates={},
            notes=[]
        )
        self.save_state()
        return self._current_state

    def get_current_state(self) -> Optional[IterationState]:
        """Get the current iteration state."""
        if self._current_state is None:
            states = self.storage.load_all()
            if states:
                self._current_state = states[-1]
        return self._current_state

    def get_iteration(self, iteration: int) -> Optional[IterationState]:
        """Get state for a specific iteration."""
        states = self.storage.load_all()
        for state in states:
            if state.iteration == iteration:
                return state
        return None

    def save_state(self) -> None:
        """Save current state to storage."""
        if self._current_state:
            self.storage.save(self._current_state)

    def update_data_gen_status(
        self,
        status: DataGenStatus,
        metrics: Optional[Dict[str, Any]] = None
    ) -> None:
        """Update data generation status."""
        if self._current_state:
            self._current_state.data_gen_status = status
            if metrics:
                self._current_state.metrics.update(metrics)
            self._current_state.data_gen_updated_at = datetime.now().isoformat()
            self.save_state()

    def update_perception_status(
        self,
        status: PerceptionStatus,
        metrics: Optional[Dict[str, Any]] = None
    ) -> None:
        """Update perception status."""
        if self._current_state:
            self._current_state.perception_status = status
            if metrics:
                self._current_state.metrics.update(metrics)
            self._current_state.perception_updated_at = datetime.now().isoformat()
            self.save_state()

    def update_eval_status(
        self,
        status: EvalStatus,
        metrics: Optional[Dict[str, Any]] = None
    ) -> None:
        """Update evaluation status."""
        if self._current_state:
            self._current_state.eval_status = status
            if metrics:
                self._current_state.metrics.update(metrics)
            self._current_state.eval_updated_at = datetime.now().isoformat()
            self.save_state()

    def record_skill_update(
        self,
        skill_name: str,
        update_description: str
    ) -> None:
        """Record a skill update that was applied."""
        if self._current_state:
            self._current_state.skill_updates[skill_name] = {
                "description": update_description,
                "timestamp": datetime.now().isoformat(),
                "iteration": self._current_state.iteration
            }
            self.save_state()

    def add_note(self, note: str) -> None:
        """Add a note to the current iteration."""
        if self._current_state:
            self._current_state.notes.append({
                "timestamp": datetime.now().isoformat(),
                "note": note
            })
            self.save_state()

    def complete_iteration(
        self,
        final_metrics: Dict[str, Any],
        summary: str
    ) -> None:
        """Mark iteration as complete."""
        if self._current_state:
            self._current_state.metrics.update(final_metrics)
            self._current_state.summary = summary
            self._current_state.completed = True
            self._current_state.completed_at = datetime.now().isoformat()
            self.save_state()

    def get_progress(self) -> Dict[str, Any]:
        """Get progress summary for all iterations."""
        states = self.storage.load_all()
        
        total = len(states)
        completed = sum(1 for s in states if s.completed)
        
        in_progress_data_gen = sum(
            1 for s in states 
            if s.data_gen_status in (DataGenStatus.IN_PROGRESS, DataGenStatus.GENERATING)
        )
        in_progress_perception = sum(
            1 for s in states 
            if s.perception_status in (PerceptionStatus.IN_PROGRESS, PerceptionStatus.RUNNING)
        )
        in_progress_eval = sum(
            1 for s in states 
            if s.eval_status in (EvalStatus.IN_PROGRESS, EvalStatus.RUNNING)
        )

        return {
            "total_iterations": total,
            "completed_iterations": completed,
            "in_progress": {
                "data_generation": in_progress_data_gen,
                "perception": in_progress_perception,
                "evaluation": in_progress_eval
            },
            "completion_rate": completed / total if total > 0 else 0.0
        }

    def get_all_iterations(self) -> List[IterationState]:
        """Get all iteration states."""
        return self.storage.load_all()

    def get_latest_metrics(self) -> Dict[str, Any]:
        """Get metrics from the most recent iteration."""
        state = self.get_current_state()
        return state.metrics if state else {}

    def is_iteration_complete(self, iteration: int) -> bool:
        """Check if a specific iteration is complete."""
        state = self.get_iteration(iteration)
        return state.completed if state else False

    def get_avg_improvement_per_iteration(self) -> float:
        """Calculate average improvement per completed iteration."""
        states = [s for s in self.storage.load_all() if s.completed]
        
        if len(states) < 2:
            return 0.0

        # Look for metric improvements
        improvements = []
        for i in range(1, len(states)):
            prev_metrics = states[i-1].metrics
            curr_metrics = states[i].metrics
            
            # Example: track f1_score improvement
            prev_f1 = prev_metrics.get("f1_score", 0)
            curr_f1 = curr_metrics.get("f1_score", 0)
            if prev_f1 > 0:
                improvements.append(curr_f1 - prev_f1)

        return sum(improvements) / len(improvements) if improvements else 0.0

    def suggest_next_action(self) -> str:
        """Suggest the next action based on current state."""
        state = self.get_current_state()
        
        if not state:
            return "Initialize first iteration"
        
        if not state.completed:
            # Determine which phase is active
            if state.data_gen_status != DataGenStatus.COMPLETED:
                return f"Continue data generation ({state.data_gen_status.value})"
            elif state.perception_status != PerceptionStatus.COMPLETED:
                return f"Continue perception ({state.perception_status.value})"
            elif state.eval_status != EvalStatus.COMPLETED:
                return f"Continue evaluation ({state.eval_status.value})"
        
        # All complete - check if we should start new iteration
        if state.iteration < state.total_iterations:
            return f"Start iteration {state.iteration + 1}"
        
        return "All iterations complete"
