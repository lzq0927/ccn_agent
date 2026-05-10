"""
Case library storage: JSON file persistence for fault cases.
"""

import json
import os
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime

from case_library.models import FaultCase


class CaseLibraryStorage:
    """
    Handles persistence of fault cases to JSON files.
    """

    def __init__(self, storage_path: str = "case_library/cases.json"):
        self.storage_path = Path(storage_path)
        self._ensure_storage_dir()

    def _ensure_storage_dir(self) -> None:
        """Ensure the storage directory exists."""
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)

    def save(self, cases: List[FaultCase]) -> None:
        """
        Save all cases to storage.
        
        Args:
            cases: List of FaultCase objects to save
        """
        data = [self._serialize_case(c) for c in cases]
        
        with open(self.storage_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def load(self, case_id: str) -> Optional[FaultCase]:
        """
        Load a specific case by ID.
        
        Args:
            case_id: ID of case to load
            
        Returns:
            FaultCase or None if not found
        """
        all_cases = self.load_all()
        for case in all_cases:
            if case.case_id == case_id:
                return case
        return None

    def load_all(self) -> List[FaultCase]:
        """
        Load all cases from storage.
        
        Returns:
            List of FaultCase objects
        """
        if not self.storage_path.exists():
            return []
        
        try:
            with open(self.storage_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            return [self._deserialize_case(c) for c in data]
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Failed to load cases: {e}")
            return []

    def delete(self, case_id: str) -> bool:
        """
        Delete a specific case.
        
        Args:
            case_id: ID of case to delete
            
        Returns:
            True if deleted, False if not found
        """
        cases = self.load_all()
        original_count = len(cases)
        cases = [c for c in cases if c.case_id != case_id]
        
        if len(cases) < original_count:
            self.save(cases)
            return True
        return False

    def clear(self) -> None:
        """Clear all stored cases."""
        self.save([])

    def _serialize_case(self, case: FaultCase) -> Dict[str, Any]:
        """Serialize a FaultCase to dict."""
        return {
            "case_id": case.case_id,
            "fault_type": case.fault_type.value,
            "perception_mode": case.perception_mode,
            "accuracy": case.accuracy,
            "confidence": case.confidence,
            "tags": list(case.tags),
            "affected_ne_ids": list(case.affected_ne_ids),
            "affected_link_count": case.affected_link_count,
            "kpi_metrics": {
                "avg_success_rate": case.kpi_metrics.avg_success_rate,
                "min_success_rate": case.kpi_metrics.min_success_rate,
                "affected_flows": case.kpi_metrics.affected_flows,
                "total_flows": case.kpi_metrics.total_flows
            },
            "reasoning_trace": case.reasoning_trace,
            "recommendations": case.recommendations,
            "created_at": case.created_at,
            "iteration": case.iteration
        }

    def _deserialize_case(self, data: Dict[str, Any]) -> FaultCase:
        """Deserialize dict to FaultCase."""
        from case_library.models import KPIMetrics
        
        kpi_data = data.get("kpi_metrics", {})
        kpi_metrics = KPIMetrics(
            avg_success_rate=kpi_data.get("avg_success_rate", 1.0),
            min_success_rate=kpi_data.get("min_success_rate", 1.0),
            affected_flows=kpi_data.get("affected_flows", 0),
            total_flows=kpi_data.get("total_flows", 0)
        )
        
        return FaultCase(
            case_id=data["case_id"],
            fault_type=data.get("fault_type", "unknown"),
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

    def get_storage_info(self) -> Dict[str, Any]:
        """Get information about the storage."""
        if not self.storage_path.exists():
            return {
                "exists": False,
                "path": str(self.storage_path),
                "size_bytes": 0,
                "case_count": 0
            }
        
        return {
            "exists": True,
            "path": str(self.storage_path),
            "size_bytes": self.storage_path.stat().st_size,
            "case_count": len(self.load_all())
        }

    def backup(self, backup_path: Optional[str] = None) -> str:
        """
        Create a backup of the current cases.
        
        Args:
            backup_path: Optional custom backup path
            
        Returns:
            Path to the backup file
        """
        if backup_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = str(self.storage_path.parent / f"cases_backup_{timestamp}.json")
        
        cases = self.load_all()
        data = [self._serialize_case(c) for c in cases]
        
        with open(backup_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        return backup_path

    def restore(self, backup_path: str) -> bool:
        """
        Restore cases from a backup.
        
        Args:
            backup_path: Path to the backup file
            
        Returns:
            True if restored successfully
        """
        try:
            with open(backup_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            cases = [self._deserialize_case(c) for c in data]
            self.save(cases)
            return True
        except (json.JSONDecodeError, IOError) as e:
            print(f"Failed to restore from backup: {e}")
            return False
