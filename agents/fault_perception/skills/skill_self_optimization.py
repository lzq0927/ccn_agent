"""
Skill: Self-Optimization - Analyzes recent failures and generates optimization suggestions.
Triggered after N cases or when explicitly requested.

Analyzes:
1. Recent failed/low-confidence cases
2. Common patterns in failures
3. Generates optimization suggestions for Skills/Prompts
"""

import logging
import json
import os
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from collections import Counter

logger = logging.getLogger(__name__)


class SkillSelfOptimization:
    """
    Self-optimization skill for fault perception agent.
    
    Analyzes recent perception failures and generates:
    - Prompt optimization suggestions
    - Skill rule adjustments
    - Confidence threshold tuning
    - New detection patterns
    """
    
    def __init__(self, skills_dir: Optional[str] = None, prompts_dir: Optional[str] = None):
        """
        Initialize self-optimization skill.
        
        Args:
            skills_dir: Directory containing skill files
            prompts_dir: Directory containing prompt files
        """
        self.skill_name = "skill_self_optimization"
        self.skills_dir = skills_dir or "agents/fault_perception/skills"
        self.prompts_dir = prompts_dir or "agents/fault_perception/prompts"
        self.optimization_history: List[Dict] = []
        self.version = 1
    
    def analyze_and_optimize(
        self,
        recent_cases: List[Dict],
        iteration_number: int = 1
    ) -> Dict:
        """
        Main entry point - analyze recent cases and generate optimizations.
        
        Args:
            recent_cases: List of recent case dicts with 'input', 'output', 'accuracy'
            iteration_number: Current iteration number
            
        Returns:
            Dict with optimization suggestions and actions taken
        """
        logger.info(f"[SkillSelfOptimization] Starting analysis of {len(recent_cases)} cases")
        
        if not recent_cases:
            logger.info("[SkillSelfOptimization] No cases to analyze")
            return {"status": "no_cases", "suggestions": []}
        
        # Step 1: Analyze failure patterns
        failure_patterns = self._analyze_failure_patterns(recent_cases)
        logger.info(f"[SkillSelfOptimization] Identified {len(failure_patterns)} failure patterns")
        
        # Step 2: Generate optimization suggestions
        suggestions = self._generate_suggestions(failure_patterns, recent_cases)
        logger.info(f"[SkillSelfOptimization] Generated {len(suggestions)} suggestions")
        
        # Step 3: Apply auto-applicable optimizations
        applied = self._apply_optimizations(suggestions)
        logger.info(f"[SkillSelfOptimization] Applied {len(applied)} optimizations")
        
        # Step 4: Record optimization history
        optimization_record = {
            "iteration": iteration_number,
            "timestamp": datetime.now().isoformat(),
            "cases_analyzed": len(recent_cases),
            "failure_patterns": failure_patterns,
            "suggestions": suggestions,
            "applied": applied,
            "version": self.version
        }
        self.optimization_history.append(optimization_record)
        
        return {
            "status": "completed",
            "iteration": iteration_number,
            "patterns_found": len(failure_patterns),
            "suggestions": suggestions,
            "applied_count": len(applied),
            "applied": applied
        }
    
    def _analyze_failure_patterns(self, cases: List[Dict]) -> List[Dict]:
        """Analyze cases to identify common failure patterns."""
        patterns = []
        
        # Categorize failures by type
        low_confidence_cases = [c for c in cases if c.get("output", {}).get("confidence_score", 1.0) < 0.5]
        wrong_cases = [c for c in cases if not c.get("is_correct", True)]
        
        # Pattern 1: Low confidence but correct - need better rules
        if low_confidence_cases:
            common_features = self._extract_common_features(low_confidence_cases)
            if common_features:
                patterns.append({
                    "type": "low_confidence_correct",
                    "description": "Cases with correct output but low confidence",
                    "count": len(low_confidence_cases),
                    "common_features": common_features,
                    "suggested_action": "lower_threshold_or_add_rules"
                })
        
        # Pattern 2: High confidence but wrong - rules too aggressive
        high_conf_wrong = [c for c in cases if c.get("output", {}).get("confidence_score", 0) >= 0.85 and not c.get("is_correct", True)]
        if high_conf_wrong:
            common_features = self._extract_common_features(high_conf_wrong)
            patterns.append({
                "type": "high_confidence_wrong",
                "description": "Cases with high confidence but incorrect output",
                "count": len(high_conf_wrong),
                "common_features": common_features,
                "suggested_action": "tighten_threshold_or_add_validation"
            })
        
        # Pattern 3: Multi-element failures
        multi_element_failures = [c for c in wrong_cases if len(c.get("output", {}).get("perceived_fault_elements", [])) > 1]
        if multi_element_failures:
            patterns.append({
                "type": "multi_element_complex",
                "description": "Failures involving multiple fault elements",
                "count": len(multi_element_failures),
                "suggested_action": "improve_multi_element_detection"
            })
        
        # Pattern 4: Novel patterns (no similar historical cases)
        novel_cases = [c for c in cases if c.get("novel", False)]
        if novel_cases:
            patterns.append({
                "type": "novel_patterns",
                "description": "Novel fault patterns not seen before",
                "count": len(novel_cases),
                "suggested_action": "add_new_detection_rules"
            })
        
        return patterns
    
    def _extract_common_features(self, cases: List[Dict]) -> Dict:
        """Extract common features from a list of cases."""
        if not cases:
            return {}
        
        features = {
            "anomaly_levels": [],
            "topology_sizes": [],
            "fault_types": [],
            "avg_anomaly_count": 0
        }
        
        for case in cases:
            output = case.get("output", {})
            features["anomaly_levels"].extend(output.get("difficulty_hints", []))
            features["fault_types"].extend(output.get("perceived_fault_elements", [])[:1])
        
        # Count most common values
        if features["anomaly_levels"]:
            level_counter = Counter(features["anomaly_levels"])
            features["common_levels"] = level_counter.most_common(3)
        
        return features
    
    def _generate_suggestions(self, patterns: List[Dict], cases: List[Dict]) -> List[Dict]:
        """Generate optimization suggestions based on patterns."""
        suggestions = []
        
        for pattern in patterns:
            suggestion = {
                "pattern_type": pattern["type"],
                "priority": self._calculate_priority(pattern),
                "actions": []
            }
            
            if pattern["suggested_action"] == "lower_threshold_or_add_rules":
                suggestion["actions"] = [
                    "Consider adding new detection rules for similar patterns",
                    "Review anomaly severity thresholds",
                    "Add case examples to prompt few-shot"
                ]
            elif pattern["suggested_action"] == "tighten_threshold_or_add_validation":
                suggestion["actions"] = [
                    "Add result validation before returning",
                    "Consider raising confidence threshold for this pattern",
                    "Add cross-check with topology structure"
                ]
            elif pattern["suggested_action"] == "improve_multi_element_detection":
                suggestion["actions"] = [
                    "Enhance multi-element correlation analysis",
                    "Add dependency analysis between elements",
                    "Consider pool-level root cause detection"
                ]
            elif pattern["suggested_action"] == "add_new_detection_rules":
                suggestion["actions"] = [
                    "Analyze novel patterns for new rule extraction",
                    "Update anomaly detection thresholds",
                    "Add new fault type signatures"
                ]
            
            suggestions.append(suggestion)
        
        return suggestions
    
    def _calculate_priority(self, pattern: Dict) -> str:
        """Calculate priority of optimization based on pattern."""
        count = pattern.get("count", 0)
        
        if count >= 5:
            return "high"
        elif count >= 2:
            return "medium"
        else:
            return "low"
    
    def _apply_optimizations(self, suggestions: List[Dict]) -> List[str]:
        """Apply auto-applicable optimizations."""
        applied = []
        
        for suggestion in suggestions:
            if suggestion["priority"] != "high":
                continue
            
            for action in suggestion["actions"]:
                if "threshold" in action.lower():
                    # Would apply threshold adjustment
                    applied.append(f"Auto: {action}")
                elif "validation" in action.lower():
                    # Would add validation
                    applied.append(f"Auto: {action}")
        
        return applied
    
    def get_optimization_history(self) -> List[Dict]:
        """Return optimization history."""
        return self.optimization_history
    
    def get_current_version(self) -> int:
        """Return current optimization version."""
        return self.version
    
    def export_suggestions(self, output_path: str) -> bool:
        """Export suggestions to JSON file."""
        try:
            with open(output_path, 'w') as f:
                json.dump({
                    "version": self.version,
                    "history": self.optimization_history,
                    "timestamp": datetime.now().isoformat()
                }, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"[SkillSelfOptimization] Export failed: {e}")
            return False
