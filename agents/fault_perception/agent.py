"""
Fault Perception Agent - AIAgent implementation.
Main entry point for the fault perception system.
"""

import logging
import time
import uuid
from typing import Dict, List, Optional, Any

from agents.fault_perception.data_types import (
    PerceptionInput, PerceptionOutput, PerceptionMode, ConfidenceLevel,
    SkillResult, ExplorerResult, Anomaly
)
from agents.fault_perception.workflow import PerceptionWorkflow
from agents.fault_perception.confidence import ConfidenceEvaluator

logger = logging.getLogger(__name__)


class AIAgent:
    """
    Base AIAgent interface (abstract class).
    All agents in the system should inherit from this base class.
    """
    
    def run(self, input_data: Dict) -> Dict:
        """
        Execute the agent with given input.
        
        Args:
            input_data: Dictionary containing input parameters
            
        Returns:
            Dictionary containing execution results
        """
        raise NotImplementedError("Subclasses must implement run()")
    
    def get_status(self) -> str:
        """Return current agent status."""
        return "idle"


class FaultPerceptionAgent(AIAgent):
    """
    Fault Perception Agent - Online production component.
    
    Receives real-time KPI time series, topology, and business flows.
    Outputs fault localization results with confidence ratings.
    
    Processing flow:
    1. Receive perception input (KPIs, topology, flows)
    2. Run PerceptionWorkflow:
       - Extract anomalies from KPIs
       - Evaluate confidence (5 dimensions)
       - Route to skill or LLM explorer based on confidence
       - Package and return results
    3. Record reasoning trace for evaluation
    
    Confidence thresholds:
    - >= 0.85: High -> Skill/Workflow (deterministic)
    - 0.5-0.85: Medium -> LLM single agent exploration
    - < 0.5: Low -> Multi-agent parallel exploration
    """
    
    def __init__(self, config: Optional[Dict] = None):
        """
        Initialize FaultPerceptionAgent.
        
        Args:
            config: Optional configuration dict with keys:
                - historical_cases: List of past cases for similarity
                - confidence_threshold_high: High confidence threshold (default 0.85)
                - confidence_threshold_medium: Medium confidence threshold (default 0.5)
                - enable_self_optimization: Enable self-optimization skill (default True)
        """
        self.config = config or {}
        
        # Configuration
        self.confidence_threshold_high = self.config.get("confidence_threshold_high", 0.85)
        self.confidence_threshold_medium = self.config.get("confidence_threshold_medium", 0.5)
        self.enable_self_optimization = self.config.get("enable_self_optimization", True)
        
        # Initialize components
        historical_cases = self.config.get("historical_cases", [])
        self.workflow = PerceptionWorkflow(historical_cases=historical_cases)
        self.confidence_evaluator = ConfidenceEvaluator(historical_cases=historical_cases)
        
        # State
        self.status = "idle"
        self.current_case_id: Optional[str] = None
        self.execution_count = 0
        self.total_latency_ms = 0.0
        
        # Self-optimization state
        self._optimization_skill = None
        self._cases_since_optimization = 0
        self._optimization_interval = self.config.get("optimization_interval", 10)
        
        logger.info("[FaultPerceptionAgent] Initialized")
    
    def run(self, input_data: Dict) -> Dict:
        """
        Execute fault perception on input data.
        
        Args:
            input_data: Dict with keys:
                - case_id: Case identifier
                - kpi_records: List of KPIRecord dicts
                - topology: Topology object or dict
                - business_flows: List of BusinessFlow dicts
                - fault_config: Optional ground truth for evaluation
                
        Returns:
            Dict with perception output and metadata
        """
        self.status = "running"
        self.execution_count += 1
        start_time = time.time()
        
        try:
            # Parse input
            perception_input = self._parse_input(input_data)
            self.current_case_id = perception_input.case_id
            
            logger.info(f"[FaultPerceptionAgent] Processing case {perception_input.case_id}")
            
            # Run perception workflow
            output = self.workflow.perceive(perception_input)
            
            # Check if self-optimization should run
            if self.enable_self_optimization:
                self._cases_since_optimization += 1
                if self._cases_since_optimization >= self._optimization_interval:
                    self._trigger_self_optimization()
            
            # Record metrics
            self.total_latency_ms += output.latency_ms
            self.status = "done"
            
            # Return serialized output
            return {
                "success": True,
                "output": output.to_dict(),
                "metrics": {
                    "latency_ms": output.latency_ms,
                    "execution_count": self.execution_count,
                    "avg_latency_ms": self.total_latency_ms / self.execution_count
                }
            }
            
        except Exception as e:
            logger.error(f"[FaultPerceptionAgent] Error: {e}", exc_info=True)
            self.status = "error"
            return {
                "success": False,
                "error": str(e),
                "case_id": input_data.get("case_id", "unknown")
            }
    
    def _parse_input(self, input_data: Dict) -> PerceptionInput:
        """
        Parse input dictionary into PerceptionInput object.
        
        Args:
            input_data: Raw input dictionary
            
        Returns:
            PerceptionInput object
        """
        from simulator.models import KPIRecord, Topology, BusinessFlow, FaultConfig
        
        case_id = input_data.get("case_id", f"case_{uuid.uuid4().hex[:8]}")
        
        # Parse KPI records
        kpi_dicts = input_data.get("kpi_records", [])
        kpi_records = []
        for kpi_dict in kpi_dicts:
            kpi_records.append(KPIRecord(
                timestamp=kpi_dict.get("timestamp", 0),
                level=kpi_dict.get("level", "link"),
                ue_id=kpi_dict.get("ue_id", ""),
                src=kpi_dict.get("src", ""),
                dst=kpi_dict.get("dst", ""),
                success_rate=kpi_dict.get("success_rate", 1.0)
            ))
        
        # Parse topology
        topo_data = input_data.get("topology")
        if isinstance(topo_data, dict):
            topology = self._dict_to_topology(topo_data)
        else:
            topology = topo_data or Topology(dcs=[], elements={}, switches={})
        
        # Parse business flows
        flow_dicts = input_data.get("business_flows", [])
        business_flows = []
        for flow_dict in flow_dicts:
            business_flows.append(BusinessFlow(
                process_name=flow_dict.get("process_name", ""),
                ue_id=flow_dict.get("ue_id", ""),
                hops=flow_dict.get("hops", [])
            ))
        
        # Parse fault config (optional, for evaluation)
        fault_config = None
        fc_dict = input_data.get("fault_config")
        if fc_dict:
            fault_config = FaultConfig(
                fault_point_type=fc_dict.get("fault_point_type", "normal"),
                fault_mode=fc_dict.get("fault_mode", "link"),
                loss_rate=fc_dict.get("loss_rate", 0.0),
                fault_start=fc_dict.get("fault_start", 0),
                fault_duration=fc_dict.get("fault_duration", 0),
                affected_ne_ids=set(fc_dict.get("affected_ne_ids", [])),
                affected_links=fc_dict.get("affected_links", [])
            )
        
        return PerceptionInput(
            case_id=case_id,
            kpi_records=kpi_records,
            topology_data=topology,
            business_flows=business_flows,
            fault_config=fault_config,
            is_normal_scenario=input_data.get("is_normal_scenario", False),
            metadata=input_data.get("metadata", {})
        )
    
    def _dict_to_topology(self, topo_dict: Dict) -> Topology:
        """Convert topology dict to Topology object."""
        from simulator.models import DC, ResourcePool, NetworkElement, NEType
        
        dcs = []
        elements = {}
        
        for dc_dict in topo_dict.get("dcs", []):
            pools = []
            for pool_dict in dc_dict.get("pools", []):
                pool_elements = []
                for ne_dict in pool_dict.get("elements", []):
                    ne = NetworkElement(
                        id=ne_dict["id"],
                        ne_type=NEType[ne_dict.get("ne_type", "UPF")],
                        pool_id=pool_dict["id"],
                        dc_id=dc_dict["id"],
                        role=ne_dict.get("role", "lb")
                    )
                    elements[ne.id] = ne
                    pool_elements.append(ne)
                
                pools.append(ResourcePool(
                    id=pool_dict["id"],
                    dc_id=dc_dict["id"],
                    elements=pool_elements
                ))
            
            dcs.append(DC(
                id=dc_dict["id"],
                pools=pools
            ))
        
        return Topology(
            dcs=dcs,
            elements=elements,
            switches=topo_dict.get("switches", {})
        )
    
    def run_skill_only(self, perception_input: PerceptionInput) -> SkillResult:
        """
        Run skill-based perception only (bypasses confidence routing).
        
        Useful for testing or forced skill mode.
        """
        anomalies = self.workflow.extract_anomalies(
            perception_input.kpi_records,
            perception_input.business_flows
        ).anomalies
        
        return self.workflow.run_skill_fault_inference(
            anomalies,
            perception_input.topology_data,
            perception_input.business_flows
        )
    
    def run_llm_explorer_only(
        self,
        perception_input: PerceptionInput,
        mode: str = "single_deep"
    ) -> ExplorerResult:
        """
        Run LLM explorer only (bypasses confidence routing).
        
        Args:
            perception_input: Input data
            mode: "single_deep", "multi_parallel", or "hybrid"
        """
        anomalies = self.workflow.extract_anomalies(
            perception_input.kpi_records,
            perception_input.business_flows
        ).anomalies
        
        return self.workflow.run_llm_explorer(
            anomalies,
            perception_input.topology_data,
            perception_input.business_flows,
            mode=mode
        )
    
    def get_confidence_breakdown(
        self,
        kpi_records: List[Dict],
        topology: Dict,
        business_flows: List[Dict]
    ) -> Dict:
        """
        Get detailed confidence breakdown for given input.
        
        Useful for analysis without full perception.
        """
        from simulator.models import KPIRecord, Topology, BusinessFlow
        
        # Convert to proper objects
        kpi_objs = [KPIRecord(**kpi) for kpi in kpi_records]
        topo_obj = self._dict_to_topology(topology)
        flow_objs = [BusinessFlow(**f) for f in business_flows]
        
        # Extract anomalies
        anomaly_result = self.workflow.extract_anomalies(kpi_objs, flow_objs)
        
        # Evaluate confidence
        score, breakdown = self.confidence_evaluator.evaluate(
            kpi_objs, topo_obj, flow_objs, anomaly_result.anomalies
        )
        
        return {
            "confidence_score": score,
            "breakdown": breakdown.to_dict(),
            "anomaly_count": len(anomaly_result.anomalies),
            "difficulty_hints": breakdown.difficulty_hints
        }
    
    def _trigger_self_optimization(self):
        """
        Trigger self-optimization skill.
        
        Called after N cases or when explicitly requested.
        """
        logger.info("[FaultPerceptionAgent] Triggering self-optimization")
        
        if self._optimization_skill is None:
            from agents.fault_perception.skills.skill_self_optimization import SkillSelfOptimization
            self._optimization_skill = SkillSelfOptimization()
        
        try:
            # Note: In production, would pass actual failed cases
            self._optimization_skill.analyze_and_optimize(
                recent_cases=[],  # Would pass actual cases
                iteration_number=self.execution_count // self._optimization_interval
            )
            self._cases_since_optimization = 0
            logger.info("[FaultPerceptionAgent] Self-optimization completed")
        except Exception as e:
            logger.error(f"[FaultPerceptionAgent] Self-optimization failed: {e}")
    
    def get_status(self) -> Dict:
        """Return current agent status and metrics."""
        return {
            "status": self.status,
            "case_id": self.current_case_id,
            "execution_count": self.execution_count,
            "avg_latency_ms": self.total_latency_ms / self.execution_count if self.execution_count > 0 else 0,
            "enable_self_optimization": self.enable_self_optimization,
            "optimization_interval": self._optimization_interval,
            "cases_since_optimization": self._cases_since_optimization
        }
    
    def update_config(self, config: Dict):
        """
        Update agent configuration.
        
        Args:
            config: New configuration values
        """
        if "confidence_threshold_high" in config:
            self.confidence_threshold_high = config["confidence_threshold_high"]
        if "confidence_threshold_medium" in config:
            self.confidence_threshold_medium = config["confidence_threshold_medium"]
        if "enable_self_optimization" in config:
            self.enable_self_optimization = config["enable_self_optimization"]
        if "optimization_interval" in config:
            self._optimization_interval = config["optimization_interval"]
        
        logger.info(f"[FaultPerceptionAgent] Config updated: {config}")
