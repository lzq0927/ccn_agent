"""
Case library manager: CRUD operations on fault cases.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from typing import List, Optional, Set, Dict, Any
from case_library.models import FaultCase, FaultType, KPIMetrics
from case_library.indexer import CaseIndexer
from case_library.storage import CaseLibraryStorage


class CaseLibraryManager:
    """
    Manages the fault case library with CRUD operations.
    """

    def __init__(self, storage_path: str = "case_library/cases.json"):
        self.storage = CaseLibraryStorage(storage_path)
        self.indexer = CaseIndexer()
        self._cases: Dict[str, FaultCase] = {}
        self._load_cases()

    def _load_cases(self) -> None:
        """Load cases from storage."""
        cases = self.storage.load_all()
        self._cases = {c.case_id: c for c in cases}
        self.indexer.reindex(list(self._cases.values()))

    def add_case(self, case: FaultCase) -> bool:
        """
        Add a new fault case.
        
        Args:
            case: FaultCase to add
            
        Returns:
            True if added, False if case_id already exists
        """
        if case.case_id in self._cases:
            return False
        
        self._cases[case.case_id] = case
        self.indexer.add_case(case)
        self.storage.save(list(self._cases.values()))
        return True

    def update_case(self, case: FaultCase) -> bool:
        """
        Update an existing fault case.
        
        Args:
            case: FaultCase with updated data
            
        Returns:
            True if updated, False if case_id not found
        """
        if case.case_id not in self._cases:
            return False
        
        self._cases[case.case_id] = case
        self.indexer.reindex(list(self._cases.values()))
        self.storage.save(list(self._cases.values()))
        return True

    def delete_case(self, case_id: str) -> bool:
        """
        Delete a fault case.
        
        Args:
            case_id: ID of case to delete
            
        Returns:
            True if deleted, False if not found
        """
        if case_id not in self._cases:
            return False
        
        del self._cases[case_id]
        self.indexer.reindex(list(self._cases.values()))
        self.storage.save(list(self._cases.values()))
        return True

    def get_case(self, case_id: str) -> Optional[FaultCase]:
        """
        Get a fault case by ID.
        
        Args:
            case_id: ID of case to retrieve
            
        Returns:
            FaultCase or None if not found
        """
        return self._cases.get(case_id)

    def get_all_cases(self) -> List[FaultCase]:
        """Get all fault cases."""
        return list(self._cases.values())

    def search_cases(
        self,
        fault_type: Optional[FaultType] = None,
        perception_mode: Optional[str] = None,
        min_accuracy: Optional[float] = None,
        max_accuracy: Optional[float] = None,
        min_confidence: Optional[float] = None,
        max_confidence: Optional[float] = None,
        tags: Optional[Set[str]] = None,
        limit: int = 100
    ) -> List[FaultCase]:
        """
        Search cases with filters.
        
        Args:
            fault_type: Filter by fault type
            perception_mode: Filter by perception mode
            min_accuracy: Minimum accuracy threshold
            max_accuracy: Maximum accuracy threshold
            min_confidence: Minimum confidence threshold
            max_confidence: Maximum confidence threshold
            tags: Filter by tags (case must have at least one)
            limit: Maximum number of results
            
        Returns:
            List of matching FaultCase objects
        """
        results = []
        for case in self._cases.values():
            if case.matches_filter(
                fault_type=fault_type,
                perception_mode=perception_mode,
                min_accuracy=min_accuracy,
                max_accuracy=max_accuracy,
                min_confidence=min_confidence,
                max_confidence=max_confidence,
                tags=tags
            ):
                results.append(case)
        
        return results[:limit]

    def get_cases_by_fault_type(self, fault_type: FaultType) -> List[FaultCase]:
        """Get all cases of a specific fault type."""
        return self.search_cases(fault_type=fault_type)

    def get_cases_by_tags(self, tags: Set[str]) -> List[FaultCase]:
        """Get cases matching any of the given tags."""
        return self.search_cases(tags=tags)

    def get_low_accuracy_cases(self, threshold: float = 0.5) -> List[FaultCase]:
        """Get cases with accuracy below threshold."""
        return self.search_cases(max_accuracy=threshold)

    def get_high_confidence_cases(self, threshold: float = 0.8) -> List[FaultCase]:
        """Get cases with confidence above threshold."""
        return self.search_cases(min_confidence=threshold)

    def get_all_fault_types(self) -> Set[FaultType]:
        """Get all unique fault types in the library."""
        return set(c.fault_type for c in self._cases.values())

    def get_all_tags(self) -> Set[str]:
        """Get all unique tags in the library."""
        tags = set()
        for case in self._cases.values():
            tags.update(case.tags)
        return tags

    def get_case_count(self) -> int:
        """Get total number of cases."""
        return len(self._cases)

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about the case library."""
        if not self._cases:
            return {
                "total_cases": 0,
                "by_fault_type": {},
                "avg_accuracy": 0.0,
                "avg_confidence": 0.0
            }
        
        by_fault_type: Dict[str, int] = {}
        total_accuracy = 0.0
        total_confidence = 0.0
        
        for case in self._cases.values():
            ft_value = case.fault_type.value
            by_fault_type[ft_value] = by_fault_type.get(ft_value, 0) + 1
            total_accuracy += case.accuracy
            total_confidence += case.confidence
        
        n = len(self._cases)
        return {
            "total_cases": n,
            "by_fault_type": by_fault_type,
            "avg_accuracy": total_accuracy / n,
            "avg_confidence": total_confidence / n
        }

    def create_case_from_evaluation(
        self,
        case_id: str,
        fault_type: FaultType,
        perception_mode: str,
        accuracy: float,
        confidence: float,
        affected_ne_ids: Set[str],
        affected_link_count: int,
        kpi_metrics: KPIMetrics,
        reasoning_trace: List[Dict[str, Any]],
        recommendations: List[str],
        iteration: int,
        tags: Optional[Set[str]] = None
    ) -> FaultCase:
        """
        Create a new fault case from evaluation results.
        
        Args:
            case_id: Unique case ID
            fault_type: Type of fault
            perception_mode: Perception mode used
            accuracy: Accuracy score
            confidence: Confidence score
            affected_ne_ids: Affected NE IDs
            affected_link_count: Number of affected links
            kpi_metrics: KPI metrics
            reasoning_trace: Reasoning trace
            recommendations: Recommendations
            iteration: Current iteration
            tags: Optional tags
            
        Returns:
            Created FaultCase
        """
        case = FaultCase(
            case_id=case_id,
            fault_type=fault_type,
            perception_mode=perception_mode,
            accuracy=accuracy,
            confidence=confidence,
            tags=tags or set(),
            affected_ne_ids=affected_ne_ids,
            affected_link_count=affected_link_count,
            kpi_metrics=kpi_metrics,
            reasoning_trace=reasoning_trace,
            recommendations=recommendations,
            iteration=iteration
        )
        
        self.add_case(case)
        return case

    def export_cases(self, format: str = "dict") -> Any:
        """
        Export all cases in specified format.
        
        Args:
            format: Export format ("dict", "json")
            
        Returns:
            Exported data
        """
        cases_list = list(self._cases.values())
        
        if format == "dict":
            return [c.to_dict() for c in cases_list]
        elif format == "json":
            import json
            return json.dumps([c.to_dict() for c in cases_list], indent=2)
        else:
            raise ValueError(f"Unknown format: {format}")

    def import_cases(self, data: List[Dict]) -> int:
        """
        Import cases from data.
        
        Args:
            data: List of case dictionaries
            
        Returns:
            Number of cases imported
        """
        imported = 0
        for case_data in data:
            try:
                case = FaultCase.from_dict(case_data)
                if self.add_case(case):
                    imported += 1
            except Exception:
                continue
        
        return imported
