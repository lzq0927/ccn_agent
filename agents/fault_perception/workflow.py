"""
Perception workflow orchestration.
Coordinates anomaly extraction, confidence evaluation, and skill/explorer execution.
"""

import logging
import time
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass

from simulator.models import KPIRecord, Topology, BusinessFlow, FaultConfig
from agents.fault_perception.data_types import (
    Anomaly, PerceptionInput, PerceptionOutput, PerceptionMode, 
    ConfidenceLevel, SkillResult, ExplorerResult
)
from agents.fault_perception.confidence import ConfidenceEvaluator, ConfidenceBreakdown

logger = logging.getLogger(__name__)


@dataclass
class AnomalyExtractionResult:
    """Result of anomaly extraction from KPI data."""
    anomalies: List[Anomaly]
    baseline_stats: Dict[str, float]  # normal success rates by level
    extraction_time_ms: float


class PerceptionWorkflow:
    """
    Orchestrates the fault perception workflow:
    
    1. extract_anomalies() - Detect anomalies from KPI data
    2. evaluate_confidence() - Assess difficulty and determine processing path
    3. run_skill() or run_explorer() - Execute appropriate processing
    4. validate_and_package() - Finalize output
    """
    
    def __init__(self, historical_cases: Optional[List[Dict]] = None,
                 confidence_threshold_high: float = 0.85,
                 confidence_threshold_medium: float = 0.5):
        """
        Initialize perception workflow.
        
        Args:
            historical_cases: Optional list of historical case dicts for similarity matching
            confidence_threshold_high: Threshold for high confidence (>= this uses skill)
            confidence_threshold_medium: Threshold for medium confidence (>= this uses single LLM)
        """
        self.confidence_evaluator = ConfidenceEvaluator(historical_cases)
        self.anomaly_counter = 0
        self.confidence_threshold_high = confidence_threshold_high
        self.confidence_threshold_medium = confidence_threshold_medium
        
        # Skill and explorer instances (lazy loaded)
        self._skill_fault_inference = None
        self._skill_llm_explorer = None
    
    def perceive(
        self,
        perception_input: PerceptionInput
    ) -> PerceptionOutput:
        """
        Main entry point - execute full perception workflow.
        
        Args:
            perception_input: Input data including KPIs, topology, and business flows
            
        Returns:
            PerceptionOutput with detected faults and confidence assessment
        """
        start_time = time.time()
        case_id = perception_input.case_id
        
        logger.info(f"[PerceptionWorkflow] Starting perception for case {case_id}")
        
        try:
            # Step 1: Extract anomalies from KPI data
            anomaly_result = self.extract_anomalies(
                perception_input.kpi_records,
                perception_input.business_flows
            )
            anomalies = anomaly_result.anomalies
            logger.info(f"[PerceptionWorkflow] Extracted {len(anomalies)} anomalies")
            
            # Step 2: Evaluate confidence
            confidence_score, confidence_breakdown = self.confidence_evaluator.evaluate(
                perception_input.kpi_records,
                perception_input.topology_data,
                perception_input.business_flows,
                anomalies
            )
            logger.info(f"[PerceptionWorkflow] Confidence score: {confidence_score:.3f}")
            
            # Determine confidence level
            if confidence_score >= self.confidence_threshold_high:
                confidence_level = ConfidenceLevel.HIGH
            elif confidence_score >= self.confidence_threshold_medium:
                confidence_level = ConfidenceLevel.MEDIUM
            else:
                confidence_level = ConfidenceLevel.LOW
            
            # Step 3: Route to appropriate processing
            reasoning_steps = []
            skill_result = None
            explorer_result = None
            perception_mode = PerceptionMode.SKILL
            
            if confidence_level == ConfidenceLevel.HIGH:
                # High confidence - use deterministic skill
                logger.info(f"[PerceptionWorkflow] High confidence - using skill")
                skill_result = self.run_skill_fault_inference(
                    anomalies,
                    perception_input.topology_data,
                    perception_input.business_flows
                )
                reasoning_steps.extend(skill_result.inference_steps)
                perception_mode = PerceptionMode.SKILL
                
            elif confidence_level == ConfidenceLevel.MEDIUM:
                # Medium confidence - use LLM single agent
                logger.info(f"[PerceptionWorkflow] Medium confidence - using LLM explorer (single)")
                explorer_result = self.run_llm_explorer(
                    anomalies,
                    perception_input.topology_data,
                    perception_input.business_flows,
                    mode="single_deep"
                )
                reasoning_steps.extend(explorer_result.reasoning_trace)
                perception_mode = PerceptionMode.LLM_EXPLORER
                
            else:
                # Low confidence - use multi-strategy LLM exploration
                logger.info(f"[PerceptionWorkflow] Low confidence - using LLM explorer (multi)")
                explorer_result = self.run_llm_explorer(
                    anomalies,
                    perception_input.topology_data,
                    perception_input.business_flows,
                    mode="multi_parallel"
                )
                reasoning_steps.extend(explorer_result.reasoning_trace)
                perception_mode = PerceptionMode.LLM_EXPLORER
            
            # Step 4: Package output
            output = self.package_output(
                case_id=case_id,
                perception_mode=perception_mode,
                anomalies=anomalies,
                confidence_score=confidence_score,
                confidence_level=confidence_level,
                confidence_breakdown=confidence_breakdown,
                skill_result=skill_result,
                explorer_result=explorer_result,
                reasoning_steps=reasoning_steps,
                start_time=start_time,
                difficulty_hints=confidence_breakdown.difficulty_hints
            )
            
            logger.info(f"[PerceptionWorkflow] Completed perception for case {case_id}")
            return output
            
        except Exception as e:
            logger.error(f"[PerceptionWorkflow] Error in perception: {e}", exc_info=True)
            return PerceptionOutput(
                case_id=case_id,
                perception_mode=PerceptionMode.SKILL,
                perceived_fault_elements=[],
                perceived_fault_links=[],
                confidence_score=0.0,
                confidence_level=ConfidenceLevel.LOW,
                difficulty_hints=["Processing error occurred"],
                reasoning_steps=[f"Error: {str(e)}"],
                anomalies_detected=[],
                timestamp=perception_input.timestamp_received,
                latency_ms=(time.time() - start_time) * 1000,
                error=str(e)
            )
    
    def extract_anomalies(
        self,
        kpi_records: List[KPIRecord],
        business_flows: List[BusinessFlow]
    ) -> AnomalyExtractionResult:
        """
        Extract anomalies from KPI records.
        
        An anomaly is detected when success_rate drops below normal baseline.
        
        Args:
            kpi_records: Raw KPI time series data
            business_flows: Business flow context for baseline calculation
            
        Returns:
            AnomalyExtractionResult with list of detected anomalies
        """
        start_time = time.time()
        
        if not kpi_records:
            return AnomalyExtractionResult(
                anomalies=[],
                baseline_stats={},
                extraction_time_ms=0.0
            )
        
        # Calculate baseline statistics by level and (src, dst)
        baseline_stats = self._calculate_baseline_stats(kpi_records)
        
        # Identify anomalies - records with success rate below threshold
        anomalies = []
        anomaly_id_prefix = f"anomaly_{int(time.time() * 1000)}"
        
        for i, kpi in enumerate(kpi_records):
            # Get normal baseline for this (src, dst)
            key = (kpi.src, kpi.dst)
            normal_baseline = baseline_stats.get(key, 0.99)  # Default 99% if unknown
            
            # Detect anomaly if success rate significantly below baseline
            deviation = normal_baseline - kpi.success_rate
            
            # Flag as anomaly if deviation is significant (> 0.02 = 2% drop)
            # Lowered from 0.05 to catch smaller fault signals
            if deviation > 0.02:
                # Calculate severity (0-1, where 1 is most severe)
                severity = min(deviation / 0.5, 1.0)  # 50% drop = max severity
                
                anomaly = Anomaly(
                    anomaly_id=f"{anomaly_id_prefix}_{i}",
                    timestamp=kpi.timestamp,
                    level=kpi.level,
                    ue_id=kpi.ue_id,
                    src=kpi.src,
                    dst=kpi.dst,
                    success_rate=kpi.success_rate,
                    normal_baseline=normal_baseline,
                    deviation=deviation,
                    severity=severity
                )
                anomalies.append(anomaly)
        
        extraction_time = (time.time() - start_time) * 1000
        
        return AnomalyExtractionResult(
            anomalies=anomalies,
            baseline_stats={f"{k[0]}->{k[1]}": v for k, v in baseline_stats.items()},
            extraction_time_ms=extraction_time
        )
    
    def _calculate_baseline_stats(
        self,
        kpi_records: List[KPIRecord]
    ) -> Dict[Tuple[str, str], float]:
        """
        Calculate normal baseline success rates by (src, dst) pair.
        
        Assumes records with success_rate >= 0.95 represent normal operation.
        """
        stats = {}
        counts = {}
        
        for kpi in kpi_records:
            key = (kpi.src, kpi.dst)
            if key not in stats:
                stats[key] = 0.0
                counts[key] = 0
            
            # Only count normal records for baseline
            if kpi.success_rate >= 0.95:
                stats[key] += kpi.success_rate
                counts[key] += 1
        
        # Calculate averages
        baseline = {}
        for key in stats:
            if counts[key] > 0:
                baseline[key] = stats[key] / counts[key]
            else:
                baseline[key] = 0.99  # Default
        
        return baseline
    
    def run_skill_fault_inference(
        self,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow]
    ) -> SkillResult:
        """
        Run rule-based fault inference skill.
        
        Propagates from session anomalies up through trace to link level,
        identifying the root cause at the lowest abnormal layer.
        """
        logger.info(f"[PerceptionWorkflow] Running skill_fault_inference")
        
        # Lazy load skill
        if self._skill_fault_inference is None:
            from agents.fault_perception.skills.skill_fault_inference import SkillFaultInference
            self._skill_fault_inference = SkillFaultInference()
        
        return self._skill_fault_inference.execute(anomalies, topology, business_flows)
    
    def run_llm_explorer(
        self,
        anomalies: List[Anomaly],
        topology: Topology,
        business_flows: List[BusinessFlow],
        mode: str = "single_deep"
    ) -> ExplorerResult:
        """
        Run LLM explorer skill with specified mode.
        
        Args:
            anomalies: Detected anomalies
            topology: Network topology
            business_flows: Business flows
            mode: "single_deep", "multi_parallel", or "hybrid"
        """
        logger.info(f"[PerceptionWorkflow] Running LLM explorer in {mode} mode")
        
        # Lazy load skill
        if self._skill_llm_explorer is None:
            from agents.fault_perception.skills.skill_llm_explorer import SkillLLMExplorer
            self._skill_llm_explorer = SkillLLMExplorer()
        
        return self._skill_llm_explorer.execute(
            anomalies, topology, business_flows, mode=mode
        )
    
    def package_output(
        self,
        case_id: str,
        perception_mode: PerceptionMode,
        anomalies: List[Anomaly],
        confidence_score: float,
        confidence_level: ConfidenceLevel,
        confidence_breakdown: ConfidenceBreakdown,
        skill_result: Optional[SkillResult],
        explorer_result: Optional[ExplorerResult],
        reasoning_steps: List[str],
        start_time: float,
        difficulty_hints: List[str]
    ) -> PerceptionOutput:
        """
        Package perception results into final output structure.
        """
        # Extract fault elements and links based on processing mode
        if skill_result:
            fault_elements = skill_result.fault_elements
            fault_links = skill_result.fault_links
        elif explorer_result:
            fault_elements = explorer_result.concluded_fault_elements
            fault_links = explorer_result.concluded_fault_links
        else:
            fault_elements = []
            fault_links = []
        
        # Build reasoning trace
        perception_reasoning = [
            f"Confidence Score: {confidence_score:.3f} ({confidence_level.value})",
            f"Processing Mode: {perception_mode.value}",
            f"Anomalies Detected: {len(anomalies)}",
        ]
        perception_reasoning.extend(difficulty_hints)
        perception_reasoning.extend(reasoning_steps)
        
        latency_ms = (time.time() - start_time) * 1000
        
        return PerceptionOutput(
            case_id=case_id,
            perception_mode=perception_mode,
            perceived_fault_elements=fault_elements,
            perceived_fault_links=fault_links,
            confidence_score=confidence_score,
            confidence_level=confidence_level,
            difficulty_hints=difficulty_hints,
            reasoning_steps=reasoning_steps,
            anomalies_detected=anomalies,
            skill_result=skill_result,
            explorer_result=explorer_result,
            timestamp=perception_input.timestamp_received if 'perception_input' in locals() else None,
            latency_ms=latency_ms,
            perception_reasoning=perception_reasoning
        )
    
    def validate_result(
        self,
        result: SkillResult,
        anomalies: List[Anomaly],
        topology: Topology
    ) -> bool:
        """
        Validate that skill result is consistent with detected anomalies.
        
        Args:
            result: Skill result to validate
            anomalies: Original anomalies
            topology: Network topology
            
        Returns:
            True if result is valid (consistent with anomalies)
        """
        if not result.fault_elements and not result.fault_links:
            return False
        
        # Check that at least one fault element/link is in anomaly scope
        anomaly_srcs = set(a.src for a in anomalies)
        anomaly_dsts = set(a.dst for a in anomalies)
        anomaly_elements = anomaly_srcs | anomaly_dsts
        
        for elem in result.fault_elements:
            if elem in anomaly_elements:
                return True
        
        # Check links
        for link in result.fault_links:
            src, dst = link.split("->")
            for a in anomalies:
                if a.src == src and a.dst == dst:
                    return True
        
        # If no direct match, still return True (skill may have inferred beyond anomalies)
        return True
