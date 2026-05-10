"""
Case library indexer: indexing and search by fault_type, perception_mode, accuracy, confidence, tags.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from typing import List, Dict, Set, Optional, Tuple
from collections import defaultdict

from case_library.models import FaultCase, FaultType


class CaseIndexer:
    """
    Provides fast indexing and search capabilities for the case library.
    Maintains multiple indexes for efficient querying.
    """

    def __init__(self):
        # Primary indexes
        self._by_fault_type: Dict[FaultType, Set[str]] = defaultdict(set)
        self._by_perception_mode: Dict[str, Set[str]] = defaultdict(set)
        self._by_tags: Dict[str, Set[str]] = defaultdict(set)
        
        # Accuracy buckets for fast range queries
        self._accuracy_buckets: Dict[str, Set[str]] = {
            "0.0-0.2": set(),
            "0.2-0.4": set(),
            "0.4-0.6": set(),
            "0.6-0.8": set(),
            "0.8-1.0": set()
        }
        
        # Confidence buckets
        self._confidence_buckets: Dict[str, Set[str]] = {
            "0.0-0.2": set(),
            "0.2-0.4": set(),
            "0.4-0.6": set(),
            "0.6-0.8": set(),
            "0.8-1.0": set()
        }
        
        # Case ID to case mapping for quick access
        self._case_index: Dict[str, FaultCase] = {}

    def add_case(self, case: FaultCase) -> None:
        """Add a case to the indexes."""
        self._case_index[case.case_id] = case
        
        # Index by fault type
        self._by_fault_type[case.fault_type].add(case.case_id)
        
        # Index by perception mode
        self._by_perception_mode[case.perception_mode].add(case.case_id)
        
        # Index by tags
        for tag in case.tags:
            self._by_tags[tag].add(case.case_id)
        
        # Index into accuracy bucket
        acc_bucket = self._get_accuracy_bucket(case.accuracy)
        self._accuracy_buckets[acc_bucket].add(case.case_id)
        
        # Index into confidence bucket
        conf_bucket = self._get_confidence_bucket(case.confidence)
        self._confidence_buckets[conf_bucket].add(case.case_id)

    def remove_case(self, case_id: str) -> None:
        """Remove a case from the indexes."""
        if case_id not in self._case_index:
            return
        
        case = self._case_index[case_id]
        
        # Remove from fault type index
        self._by_fault_type[case.fault_type].discard(case_id)
        
        # Remove from perception mode index
        self._by_perception_mode[case.perception_mode].discard(case_id)
        
        # Remove from tags index
        for tag in case.tags:
            self._by_tags[tag].discard(case_id)
        
        # Remove from accuracy buckets
        acc_bucket = self._get_accuracy_bucket(case.accuracy)
        self._accuracy_buckets[acc_bucket].discard(case_id)
        
        # Remove from confidence buckets
        conf_bucket = self._get_confidence_bucket(case.confidence)
        self._confidence_buckets[conf_bucket].discard(case_id)
        
        del self._case_index[case_id]

    def reindex(self, cases: List[FaultCase]) -> None:
        """Rebuild all indexes from scratch."""
        # Clear all indexes
        self._by_fault_type.clear()
        self._by_perception_mode.clear()
        self._by_tags.clear()
        for bucket in self._accuracy_buckets.values():
            bucket.clear()
        for bucket in self._confidence_buckets.values():
            bucket.clear()
        self._case_index.clear()
        
        # Rebuild
        for case in cases:
            self.add_case(case)

    def search_by_fault_type(self, fault_type: FaultType) -> Set[str]:
        """Get case IDs matching fault type."""
        return self._by_fault_type.get(fault_type, set())

    def search_by_perception_mode(self, mode: str) -> Set[str]:
        """Get case IDs matching perception mode."""
        return self._by_perception_mode.get(mode, set())

    def search_by_tags(self, tags: Set[str]) -> Set[str]:
        """Get case IDs matching any of the tags."""
        result: Set[str] = set()
        for tag in tags:
            result.update(self._by_tags.get(tag, set()))
        return result

    def search_by_accuracy_range(
        self,
        min_acc: Optional[float] = None,
        max_acc: Optional[float] = None
    ) -> Set[str]:
        """Get case IDs within accuracy range."""
        if min_acc is None and max_acc is None:
            return set(self._case_index.keys())
        
        result: Set[str] = set()
        
        for case_id, case in self._case_index.items():
            if min_acc is not None and case.accuracy < min_acc:
                continue
            if max_acc is not None and case.accuracy > max_acc:
                continue
            result.add(case_id)
        
        return result

    def search_by_confidence_range(
        self,
        min_conf: Optional[float] = None,
        max_conf: Optional[float] = None
    ) -> Set[str]:
        """Get case IDs within confidence range."""
        if min_conf is None and max_conf is None:
            return set(self._case_index.keys())
        
        result: Set[str] = set()
        
        for case_id, case in self._case_index.items():
            if min_conf is not None and case.confidence < min_conf:
                continue
            if max_conf is not None and case.confidence > max_conf:
                continue
            result.add(case_id)
        
        return result

    def search_combined(
        self,
        fault_type: Optional[FaultType] = None,
        perception_mode: Optional[str] = None,
        tags: Optional[Set[str]] = None,
        min_accuracy: Optional[float] = None,
        max_accuracy: Optional[float] = None,
        min_confidence: Optional[float] = None,
        max_confidence: Optional[float] = None
    ) -> Set[str]:
        """
        Combined search with multiple criteria.
        Returns intersection of all matching criteria.
        """
        result: Optional[Set[str]] = None
        
        # Apply fault type filter
        if fault_type is not None:
            ft_result = self.search_by_fault_type(fault_type)
            result = ft_result if result is None else result.intersection(ft_result)
        
        # Apply perception mode filter
        if perception_mode is not None:
            pm_result = self.search_by_perception_mode(perception_mode)
            result = pm_result if result is None else result.intersection(pm_result)
        
        # Apply tags filter
        if tags:
            tags_result = self.search_by_tags(tags)
            result = tags_result if result is None else result.intersection(tags_result)
        
        # Apply accuracy range filter
        if min_accuracy is not None or max_accuracy is not None:
            acc_result = self.search_by_accuracy_range(min_accuracy, max_accuracy)
            result = acc_result if result is None else result.intersection(acc_result)
        
        # Apply confidence range filter
        if min_confidence is not None or max_confidence is not None:
            conf_result = self.search_by_confidence_range(min_confidence, max_confidence)
            result = conf_result if result is None else result.intersection(conf_result)
        
        return result if result is not None else set(self._case_index.keys())

    def find_similar_cases(
        self,
        case: FaultCase,
        max_results: int = 5
    ) -> List[Tuple[str, float]]:
        """
        Find cases similar to the given case.
        
        Args:
            case: The case to find similar cases for
            max_results: Maximum number of results
            
        Returns:
            List of (case_id, similarity_score) tuples
        """
        similarities: List[Tuple[str, float]] = []
        
        for other_id, other in self._case_index.items():
            if other_id == case.case_id:
                continue
            
            similarity = self._calculate_similarity(case, other)
            similarities.append((other_id, similarity))
        
        similarities.sort(key=lambda x: x[1], reverse=True)
        return similarities[:max_results]

    def _calculate_similarity(self, case1: FaultCase, case2: FaultCase) -> float:
        """Calculate similarity score between two cases."""
        score = 0.0
        
        # Fault type match (40% weight)
        if case1.fault_type == case2.fault_type:
            score += 0.4
        
        # Perception mode match (20% weight)
        if case1.perception_mode == case2.perception_mode:
            score += 0.2
        
        # Tag overlap (20% weight)
        if case1.tags and case2.tags:
            tag_overlap = len(case1.tags.intersection(case2.tags))
            tag_union = len(case1.tags.union(case2.tags))
            if tag_union > 0:
                score += 0.2 * (tag_overlap / tag_union)
        
        # Affected NE overlap (20% weight)
        if case1.affected_ne_ids and case2.affected_ne_ids:
            ne_overlap = len(case1.affected_ne_ids.intersection(case2.affected_ne_ids))
            ne_union = len(case1.affected_ne_ids.union(case2.affected_ne_ids))
            if ne_union > 0:
                score += 0.2 * (ne_overlap / ne_union)
        
        return score

    def _get_accuracy_bucket(self, accuracy: float) -> str:
        """Get the accuracy bucket for a value."""
        if accuracy < 0.2:
            return "0.0-0.2"
        elif accuracy < 0.4:
            return "0.2-0.4"
        elif accuracy < 0.6:
            return "0.4-0.6"
        elif accuracy < 0.8:
            return "0.6-0.8"
        else:
            return "0.8-1.0"

    def _get_confidence_bucket(self, confidence: float) -> str:
        """Get the confidence bucket for a value."""
        if confidence < 0.2:
            return "0.0-0.2"
        elif confidence < 0.4:
            return "0.2-0.4"
        elif confidence < 0.6:
            return "0.4-0.6"
        elif confidence < 0.8:
            return "0.6-0.8"
        else:
            return "0.8-1.0"

    def get_fault_type_distribution(self) -> Dict[str, int]:
        """Get distribution of cases by fault type."""
        return {
            ft.value: len(case_ids) 
            for ft, case_ids in self._by_fault_type.items()
        }

    def get_perception_mode_distribution(self) -> Dict[str, int]:
        """Get distribution of cases by perception mode."""
        return {
            mode: len(case_ids)
            for mode, case_ids in self._by_perception_mode.items()
        }

    def get_tag_frequency(self) -> Dict[str, int]:
        """Get frequency of each tag."""
        return {
            tag: len(case_ids)
            for tag, case_ids in self._by_tags.items()
        }

    def get_accuracy_distribution(self) -> Dict[str, int]:
        """Get distribution of cases by accuracy bucket."""
        return {
            bucket: len(case_ids)
            for bucket, case_ids in self._accuracy_buckets.items()
        }

    def get_confidence_distribution(self) -> Dict[str, int]:
        """Get distribution of cases by confidence bucket."""
        return {
            bucket: len(case_ids)
            for bucket, case_ids in self._confidence_buckets.items()
        }

    def get_index_stats(self) -> Dict[str, int]:
        """Get statistics about the indexes."""
        return {
            "total_cases": len(self._case_index),
            "fault_types": len(self._by_fault_type),
            "perception_modes": len(self._by_perception_mode),
            "unique_tags": len(self._by_tags),
            "accuracy_buckets": 5,
            "confidence_buckets": 5
        }
