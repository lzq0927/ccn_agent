"""
Iteration state storage: JSON file persistence for iteration states.
"""

import json
import os
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime

from iteration_state.state import IterationState, DataGenStatus, PerceptionStatus, EvalStatus


class IterationStateStorage:
    """
    Handles persistence of iteration states to JSON files.
    """

    def __init__(self, storage_path: str = "iteration_state/states.json"):
        self.storage_path = Path(storage_path)
        self._ensure_storage_dir()

    def _ensure_storage_dir(self) -> None:
        """Ensure the storage directory exists."""
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)

    def save(self, state: IterationState) -> None:
        """
        Save a single iteration state.
        
        Args:
            state: The iteration state to save
        """
        states = self.load_all()
        
        # Update or append
        found = False
        for i, existing in enumerate(states):
            if existing.iteration == state.iteration:
                states[i] = state
                found = True
                break
        
        if not found:
            states.append(state)
        
        self._write_states(states)

    def load(self, iteration: int) -> Optional[IterationState]:
        """
        Load a specific iteration state.
        
        Args:
            iteration: Iteration number to load
            
        Returns:
            IterationState or None if not found
        """
        states = self.load_all()
        for state in states:
            if state.iteration == iteration:
                return state
        return None

    def load_all(self) -> List[IterationState]:
        """
        Load all iteration states.
        
        Returns:
            List of IterationState objects
        """
        if not self.storage_path.exists():
            return []
        
        try:
            with open(self.storage_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            return [self._deserialize_state(s) for s in data]
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Failed to load iteration states: {e}")
            return []

    def delete(self, iteration: int) -> bool:
        """
        Delete a specific iteration state.
        
        Args:
            iteration: Iteration number to delete
            
        Returns:
            True if deleted, False if not found
        """
        states = self.load_all()
        original_count = len(states)
        states = [s for s in states if s.iteration != iteration]
        
        if len(states) < original_count:
            self._write_states(states)
            return True
        return False

    def clear(self) -> None:
        """Clear all stored states."""
        self._write_states([])

    def _write_states(self, states: List[IterationState]) -> None:
        """Write states to the JSON file."""
        data = [self._serialize_state(s) for s in states]
        
        with open(self.storage_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _serialize_state(self, state: IterationState) -> Dict[str, Any]:
        """Serialize IterationState to dict."""
        return {
            "iteration": state.iteration,
            "total_iterations": state.total_iterations,
            "data_gen_status": state.data_gen_status.value,
            "perception_status": state.perception_status.value,
            "eval_status": state.eval_status.value,
            "metrics": state.metrics,
            "skill_updates": state.skill_updates,
            "notes": state.notes,
            "summary": state.summary,
            "completed": state.completed,
            "completed_at": state.completed_at,
            "data_gen_updated_at": state.data_gen_updated_at,
            "perception_updated_at": state.perception_updated_at,
            "eval_updated_at": state.eval_updated_at,
            "created_at": state.created_at
        }

    def _deserialize_state(self, data: Dict[str, Any]) -> IterationState:
        """Deserialize dict to IterationState."""
        return IterationState(
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
            data_gen_updated_at=data.get("data_gen_updated_at"),
            perception_updated_at=data.get("perception_updated_at"),
            eval_updated_at=data.get("eval_updated_at"),
            created_at=data.get("created_at", datetime.now().isoformat())
        )

    def get_storage_info(self) -> Dict[str, Any]:
        """Get information about the storage."""
        if not self.storage_path.exists():
            return {
                "exists": False,
                "path": str(self.storage_path),
                "size_bytes": 0,
                "state_count": 0
            }
        
        return {
            "exists": True,
            "path": str(self.storage_path),
            "size_bytes": self.storage_path.stat().st_size,
            "state_count": len(self.load_all())
        }

    def backup(self, backup_path: Optional[str] = None) -> str:
        """
        Create a backup of the current states.
        
        Args:
            backup_path: Optional custom backup path
            
        Returns:
            Path to the backup file
        """
        if backup_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = str(self.storage_path.parent / f"states_backup_{timestamp}.json")
        
        states = self.load_all()
        data = [self._serialize_state(s) for s in states]
        
        with open(backup_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        return backup_path

    def restore(self, backup_path: str) -> bool:
        """
        Restore states from a backup.
        
        Args:
            backup_path: Path to the backup file
            
        Returns:
            True if restored successfully
        """
        try:
            with open(backup_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            states = [self._deserialize_state(s) for s in data]
            self._write_states(states)
            return True
        except (json.JSONDecodeError, IOError) as e:
            print(f"Failed to restore from backup: {e}")
            return False
