"""
Orchestrator - Main 3-loop orchestration engine.

This module implements the core orchestration loop that coordinates:
1. Data Generation Loop (self-loop within FaultDataGenAgent)
2. Perception Runtime Loop (FaultPerceptionAgent processes cases)
3. Evaluation Design Loop (EvaluatorAgent evaluates and triggers improvements)

The orchestrator manages iteration state, coordinates between agents,
and ensures proper feedback loops for continuous improvement.
"""

import sys
import os
import time
import logging
import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from dataclasses import dataclass

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from iteration_state.manager import IterationStateManager
from iteration_state.state import IterationState, DataGenStatus, PerceptionStatus, EvalStatus
from case_library.manager import CaseLibraryManager
from case_library.models import FaultCase, FaultType, KPIMetrics
from agents.fault_data_gen.agent import FaultDataGenAgent, GenerationStats
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluator.agent import EvaluatorAgent, EvaluationResult, AggregatedMetrics
from simulator.topology import TopologyGenerator
from simulator.models import Topology, FaultConfig, SimulationResult, KPIRecord

logger = logging.getLogger(__name__)


@dataclass
class OrchestratorConfig:
    """Configuration for the orchestrator."""
    project_root: str = PROJECT_ROOT
    case_library_dir: str = None
    iteration_state_path: str = None
    data_output_dir: str = None
    num_baseline_cases: int = 100
    num_hard_cases: int = 20
    perception_threshold_high: float = 0.85
    perception_threshold_medium: float = 0.5
    enable_self_optimization: bool = True
    optimization_interval: int = 10
    hard_case_accuracy_threshold: float = 0.5
    eval_batch_size: int = 10

    def __post_init__(self):
        if self.case_library_dir is None:
            self.case_library_dir = os.path.join(self.project_root, "case_library")
        if self.iteration_state_path is None:
            self.iteration_state_path = os.path.join(self.project_root, "iteration_state", "states.json")
        if self.data_output_dir is None:
            self.data_output_dir = os.path.join(self.project_root, "data", "generated")


@dataclass
class LoopResult:
    """Result of a single loop execution."""
    success: bool
    cases_processed: int
    cases_succeeded: int
    cases_failed: int
    metrics: Dict[str, Any]
    duration_seconds: float
    errors: List[str]


class Orchestrator:
    """
    Main orchestration engine coordinating the 3-loop system.

    The 3 loops are:
    1. Data Generation Self-Loop: FaultDataGenAgent generates, verifies,
       and writes cases to CaseLibrary. Hard cases are generated based on
       evaluation feedback.
    2. Perception Runtime Loop: FaultPerceptionAgent processes cases from
       CaseLibrary, producing perception outputs with confidence ratings.
    3. Evaluation Design Loop: EvaluatorAgent assesses perception accuracy,
       analyzes process quality, and triggers optimizations including hard
       case generation for weak areas.
    """

    def __init__(self, config: Optional[OrchestratorConfig] = None):
        """
        Initialize the orchestrator.

        Args:
            config: Optional configuration object
        """
        self.config = config or OrchestratorConfig()
        self._setup_logging()

        # Initialize managers
        self.iteration_manager = IterationStateManager(self.config.iteration_state_path)
        self.case_library = CaseLibraryManager(self.config.case_library_dir)

        # Initialize agents (lazy initialization)
        self._data_gen_agent: Optional[FaultDataGenAgent] = None
        self._perception_agent: Optional[FaultPerceptionAgent] = None
        self._evaluator_agent: Optional[EvaluatorAgent] = None
        self._topology: Optional[Topology] = None

        # State tracking
        self.current_iteration: int = 0
        self.total_iterations: int = 0
        self.loop_results: List[Dict[str, Any]] = []

        logger.info("[Orchestrator] Initialized")

    def _setup_logging(self) -> None:
        """Configure logging for the orchestrator."""
        log_dir = os.path.join(self.config.project_root, "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, f"orchestrator_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler(sys.stdout)
            ]
        )

    @property
    def data_gen_agent(self) -> FaultDataGenAgent:
        """Lazy initialization of data generation agent."""
        if self._data_gen_agent is None:
            self._data_gen_agent = FaultDataGenAgent(
                output_dir=self.config.data_output_dir,
                case_library_dir=self.config.case_library_dir,
                llm_provider="minimax"
            )
        return self._data_gen_agent

    @property
    def perception_agent(self) -> FaultPerceptionAgent:
        """Lazy initialization of perception agent."""
        if self._perception_agent is None:
            historical_cases = self.case_library.get_all_cases()
            self._perception_agent = FaultPerceptionAgent(config={
                "historical_cases": historical_cases,
                "confidence_threshold_high": self.config.perception_threshold_high,
                "confidence_threshold_medium": self.config.perception_threshold_medium,
                "enable_self_optimization": self.config.enable_self_optimization,
                "optimization_interval": self.config.optimization_interval
            })
        return self._perception_agent

    @property
    def evaluator_agent(self) -> EvaluatorAgent:
        """Lazy initialization of evaluator agent."""
        if self._evaluator_agent is None:
            if self._topology is None:
                topo_gen = TopologyGenerator()
                self._topology = topo_gen.generate(0, seed=42)
            self._evaluator_agent = EvaluatorAgent(topology=self._topology)
        return self._evaluator_agent

    def run_design_iteration(self, iteration: int, total_iterations: int = 1) -> Dict[str, Any]:
        """
        Run a complete design iteration with all 3 loops.

        This is the main entry point for running a single iteration that:
        1. Loop 1 (Data Gen): Generate cases and add to CaseLibrary
        2. Loop 2 (Perception): Process cases through perception agent
        3. Loop 3 (Eval): Evaluate perception results and update CaseLibrary

        Args:
            iteration: Current iteration number
            total_iterations: Total planned iterations

        Returns:
            Dict with iteration results and metrics
        """
        self.current_iteration = iteration
        self.total_iterations = total_iterations

        logger.info("=" * 60)
        logger.info(f"Starting Design Iteration {iteration}/{total_iterations}")
        logger.info("=" * 60)

        # Initialize iteration state
        state = self.iteration_manager.initialize_iteration(iteration, total_iterations)

        iteration_start = time.time()
        loop_results = {}

        try:
            # ========================================
            # LOOP 1: Data Generation Self-Loop
            # ========================================
            logger.info("[Loop 1] Starting Data Generation")
            data_gen_result = self._run_data_gen_loop(iteration)
            loop_results["data_gen"] = data_gen_result
            self.iteration_manager.update_data_gen_status(
                DataGenStatus.COMPLETED if data_gen_result.success else DataGenStatus.FAILED,
                metrics=data_gen_result.metrics
            )
            logger.info(f"[Loop 1] Data Generation complete: {data_gen_result.cases_processed} cases")

            # ========================================
            # LOOP 2: Perception Runtime Loop
            # ========================================
            logger.info("[Loop 2] Starting Perception")
            perception_result = self._run_perception_loop()
            loop_results["perception"] = perception_result
            self.iteration_manager.update_perception_status(
                PerceptionStatus.COMPLETED if perception_result.success else PerceptionStatus.FAILED,
                metrics=perception_result.metrics
            )
            logger.info(f"[Loop 2] Perception complete: {perception_result.cases_processed} cases")

            # ========================================
            # LOOP 3: Evaluation Design Loop
            # ========================================
            logger.info("[Loop 3] Starting Evaluation")
            eval_result = self._run_eval_loop()
            loop_results["evaluation"] = eval_result
            self.iteration_manager.update_eval_status(
                EvalStatus.COMPLETED if eval_result.success else EvalStatus.FAILED,
                metrics=eval_result.metrics
            )
            logger.info(f"[Loop 3] Evaluation complete: {eval_result.cases_processed} cases")

            # Compute overall iteration success
            all_success = all(r.success for r in loop_results.values())
            total_duration = time.time() - iteration_start

            # Aggregate metrics
            aggregated_metrics = {
                "iteration": iteration,
                "total_duration_seconds": total_duration,
                "data_gen_cases": loop_results["data_gen"].cases_processed,
                "perception_cases": loop_results["perception"].cases_processed,
                "eval_cases": loop_results["evaluation"].cases_processed,
                "overall_success": all_success,
                "timestamp": datetime.now().isoformat()
            }

            # Complete iteration
            summary = self._generate_iteration_summary(loop_results)
            self.iteration_manager.complete_iteration(aggregated_metrics, summary)

            self.loop_results.append({
                "iteration": iteration,
                "loops": loop_results,
                "metrics": aggregated_metrics,
                "summary": summary
            })

            logger.info(f"Iteration {iteration} complete: {summary}")
            return {
                "success": all_success,
                "iteration": iteration,
                "metrics": aggregated_metrics,
                "loop_results": {k: vars(v) for k, v in loop_results.items()},
                "summary": summary
            }

        except Exception as e:
            logger.error(f"Iteration {iteration} failed: {e}", exc_info=True)
            self.iteration_manager.add_note(f"Iteration failed: {str(e)}")
            return {
                "success": False,
                "iteration": iteration,
                "error": str(e)
            }

    def _run_data_gen_loop(self, iteration: int) -> LoopResult:
        """
        Execute Loop 1: Data Generation Self-Loop.

        This loop generates baseline and hard cases, verifies them,
        and writes them to the CaseLibrary.

        Returns:
            LoopResult with generation statistics
        """
        start_time = time.time()
        errors = []

        try:
            # Run data generation agent
            self.data_gen_agent.current_iteration = iteration

            stats = self.data_gen_agent.run(
                num_cases=self.config.num_baseline_cases,
                num_hard_cases=self.config.num_hard_cases,
                seed=42 + iteration,
                skip_verification=False,
                hard_case_only=False
            )

            # Add generated cases to CaseLibrary
            added_count = 0
            for case in self.data_gen_agent.generated_cases:
                try:
                    fault_type = self._infer_fault_type(case)
                    kpi_metrics = self._extract_kpi_metrics(case.result)

                    fault_case = FaultCase(
                        case_id=case.case_id,
                        fault_type=fault_type,
                        perception_mode="auto",
                        accuracy=0.0,
                        confidence=0.5,
                        tags=set(case.scenario.fault_config.hard_case_strategy) if case.is_hard_case else set(),
                        affected_ne_ids=case.scenario.fault_config.affected_ne_ids if case.scenario.fault_config else set(),
                        affected_link_count=len(case.scenario.fault_config.affected_links) if case.scenario.fault_config else 0,
                        kpi_metrics=kpi_metrics,
                        reasoning_trace=[],
                        recommendations=[],
                        iteration=iteration
                    )
                    if self.case_library.add_case(fault_case):
                        added_count += 1
                except Exception as e:
                    errors.append(f"Failed to add case {case.case_id}: {str(e)}")

            duration = time.time() - start_time

            return LoopResult(
                success=True,
                cases_processed=stats.total_generated,
                cases_succeeded=stats.passed_verification,
                cases_failed=stats.failed_verification,
                metrics={
                    "total_generated": stats.total_generated,
                    "passed_verification": stats.passed_verification,
                    "failed_verification": stats.failed_verification,
                    "hard_cases": stats.hard_cases_generated,
                    "normal_cases": stats.normal_cases,
                    "fault_cases": stats.fault_cases,
                    "duration_seconds": stats.duration_seconds,
                    "added_to_library": added_count
                },
                duration_seconds=duration,
                errors=errors
            )

        except Exception as e:
            logger.error(f"Data generation loop failed: {e}", exc_info=True)
            return LoopResult(
                success=False,
                cases_processed=0,
                cases_succeeded=0,
                cases_failed=0,
                metrics={},
                duration_seconds=time.time() - start_time,
                errors=[str(e)]
            )

    def _run_perception_loop(self) -> LoopResult:
        """
        Execute Loop 2: Perception Runtime Loop.

        This loop processes all cases in the CaseLibrary through
        the perception agent and records the outputs.

        Returns:
            LoopResult with perception statistics
        """
        start_time = time.time()
        errors = []

        try:
            cases = self.case_library.get_all_cases()
            processed = 0
            succeeded = 0
            failed = 0

            for case in cases:
                try:
                    # Load case data from disk
                    case_data = self._load_case_data(case.case_id)
                    if case_data is None:
                        errors.append(f"Could not load data for case {case.case_id}")
                        failed += 1
                        continue

                    # Prepare perception input
                    perception_input = {
                        "case_id": case.case_id,
                        "kpi_records": case_data.get("kpi_records", []),
                        "topology": case_data.get("topology"),
                        "business_flows": case_data.get("business_flows", []),
                        "fault_config": case_data.get("fault_config"),
                        "is_normal_scenario": case.fault_type == FaultType.NORMAL
                    }

                    # Run perception
                    result = self.perception_agent.run(perception_input)

                    if result.get("success", False):
                        succeeded += 1
                        # Update case with perception results
                        self._update_case_with_perception(case.case_id, result)
                    else:
                        failed += 1
                        errors.append(f"Perception failed for {case.case_id}: {result.get('error', 'unknown')}")

                    processed += 1

                except Exception as e:
                    errors.append(f"Error processing case {case.case_id}: {str(e)}")
                    failed += 1
                    processed += 1

            duration = time.time() - start_time

            return LoopResult(
                success=(failed == 0),
                cases_processed=processed,
                cases_succeeded=succeeded,
                cases_failed=failed,
                metrics={
                    "total_cases": len(cases),
                    "processed": processed,
                    "succeeded": succeeded,
                    "failed": failed,
                    "duration_seconds": duration
                },
                duration_seconds=duration,
                errors=errors[:10]  # Limit stored errors
            )

        except Exception as e:
            logger.error(f"Perception loop failed: {e}", exc_info=True)
            return LoopResult(
                success=False,
                cases_processed=0,
                cases_succeeded=0,
                cases_failed=0,
                metrics={},
                duration_seconds=time.time() - start_time,
                errors=[str(e)]
            )

    def _run_eval_loop(self) -> LoopResult:
        """
        Execute Loop 3: Evaluation Design Loop.

        This loop evaluates perception results, analyzes process quality,
        updates CaseLibrary with accuracy data, and triggers hard case
        generation for weak areas.

        Returns:
            LoopResult with evaluation statistics
        """
        start_time = time.time()
        errors = []

        try:
            cases = self.case_library.get_all_cases()
            evaluated = 0
            succeeded = 0
            failed = 0
            hard_case_triggers = []

            eval_batch = []
            for case in cases:
                # Load case data
                case_data = self._load_case_data(case.case_id)
                if case_data is None:
                    continue

                # Get perception output
                perception_output = case_data.get("perception_output")
                if perception_output is None:
                    continue

                # Prepare evaluation input
                predicted_faults = self._parse_perception_faults(perception_output)
                ground_truth = self._parse_fault_config(case_data.get("fault_config"))
                simulation_result = self._parse_simulation_result(case_data)
                reasoning_trace = perception_output.get("reasoning_trace", [])

                eval_batch.append({
                    "case_id": case.case_id,
                    "predicted_faults": predicted_faults,
                    "ground_truth": ground_truth,
                    "simulation_result": simulation_result,
                    "reasoning_trace": reasoning_trace
                })

            # Evaluate in batches
            for i in range(0, len(eval_batch), self.config.eval_batch_size):
                batch = eval_batch[i:i + self.config.eval_batch_size]
                results = self.evaluator_agent.evaluate_batch(batch)

                for result in results:
                    evaluated += 1
                    try:
                        # Update case library with evaluation results
                        self._update_case_with_evaluation(
                            result.case_id,
                            result
                        )
                        succeeded += 1

                        # Check if hard case generation is needed
                        if result.overall_score < self.config.hard_case_accuracy_threshold:
                            hard_case_triggers.append({
                                "case_id": result.case_id,
                                "score": result.overall_score,
                                "fault_pattern": result.case_analysis.fault_pattern
                            })

                    except Exception as e:
                        errors.append(f"Failed to update case {result.case_id}: {str(e)}")
                        failed += 1

            # Generate optimization report
            opt_report = self.evaluator_agent.generate_optimization_report(self.case_library)

            # Aggregate metrics
            agg_metrics = self.evaluator_agent.aggregate_metrics()

            duration = time.time() - start_time

            # Record skill updates
            for skill_name, update in opt_report.skill_updates.items():
                self.iteration_manager.record_skill_update(skill_name, update)

            return LoopResult(
                success=(failed == 0),
                cases_processed=evaluated,
                cases_succeeded=succeeded,
                cases_failed=failed,
                metrics={
                    "evaluated": evaluated,
                    "succeeded": succeeded,
                    "failed": failed,
                    "hard_case_triggers": len(hard_case_triggers),
                    "optimization_suggestions": len(opt_report.suggestions),
                    "skill_updates": len(opt_report.skill_updates),
                    "avg_f1_score": agg_metrics.accuracy_summary.get("f1_score", 0.0),
                    "duration_seconds": duration
                },
                duration_seconds=duration,
                errors=errors[:10]
            )

        except Exception as e:
            logger.error(f"Evaluation loop failed: {e}", exc_info=True)
            return LoopResult(
                success=False,
                cases_processed=0,
                cases_succeeded=0,
                cases_failed=0,
                metrics={},
                duration_seconds=time.time() - start_time,
                errors=[str(e)]
            )

    def run_single_case(self, case_id: str) -> Dict[str, Any]:
        """
        Test a single case through all 3 loops.

        Args:
            case_id: ID of the case to test

        Returns:
            Dict with perception and evaluation results
        """
        logger.info(f"[Orchestrator] Testing single case: {case_id}")

        # Load case from library
        case = self.case_library.get_case(case_id)
        if case is None:
            return {"success": False, "error": f"Case {case_id} not found"}

        # Load case data
        case_data = self._load_case_data(case_id)
        if case_data is None:
            return {"success": False, "error": f"Could not load data for {case_id}"}

        results = {}

        # Run perception
        try:
            perception_input = {
                "case_id": case_id,
                "kpi_records": case_data.get("kpi_records", []),
                "topology": case_data.get("topology"),
                "business_flows": case_data.get("business_flows", []),
                "fault_config": case_data.get("fault_config")
            }
            perception_result = self.perception_agent.run(perception_input)
            results["perception"] = perception_result
        except Exception as e:
            results["perception"] = {"success": False, "error": str(e)}

        # Run evaluation if perception succeeded
        if results["perception"].get("success", False):
            try:
                perception_output = perception_result.get("output", {})
                predicted_faults = self._parse_perception_faults(perception_output)
                ground_truth = self._parse_fault_config(case_data.get("fault_config"))
                simulation_result = self._parse_simulation_result(case_data)

                eval_result = self.evaluator_agent.evaluate_case(
                    case_id=case_id,
                    predicted_faults=predicted_faults,
                    ground_truth=ground_truth,
                    simulation_result=simulation_result,
                    reasoning_trace=perception_output.get("reasoning_trace", [])
                )
                results["evaluation"] = {
                    "success": True,
                    "overall_score": eval_result.overall_score,
                    "accuracy": {
                        "precision": eval_result.accuracy.precision,
                        "recall": eval_result.accuracy.recall,
                        "f1_score": eval_result.accuracy.f1_score
                    },
                    "recommendations": eval_result.recommendations
                }
            except Exception as e:
                results["evaluation"] = {"success": False, "error": str(e)}
        else:
            results["evaluation"] = {"success": False, "error": "Perception failed"}

        return results

    def run_full_iteration(self, n: int) -> List[Dict[str, Any]]:
        """
        Run n complete design iterations.

        Args:
            n: Number of iterations to run

        Returns:
            List of iteration results
        """
        logger.info(f"[Orchestrator] Starting full iteration run: {n} iterations")
        results = []

        for i in range(1, n + 1):
            logger.info(f"[Orchestrator] Iteration {i}/{n}")
            result = self.run_design_iteration(i, n)
            results.append(result)

            # Check if we should stop early
            if not result.get("success", False):
                logger.warning(f"[Orchestrator] Iteration {i} failed, continuing...")

        logger.info(f"[Orchestrator] Completed {n} iterations")
        return results

    def _load_case_data(self, case_id: str) -> Optional[Dict[str, Any]]:
        """Load case data from disk."""
        case_file = os.path.join(self.config.data_output_dir, f"case_{case_id}", "data.json")
        if os.path.exists(case_file):
            with open(case_file, 'r', encoding='utf-8') as f:
                return json.load(f)

        # Try alternative path for hard cases
        if case_id.startswith("hard_"):
            hard_dir = os.path.join(self.config.data_output_dir, case_id)
            data_file = os.path.join(hard_dir, "data.json")
            if os.path.exists(data_file):
                with open(data_file, 'r', encoding='utf-8') as f:
                    return json.load(f)

        return None

    def _update_case_with_perception(self, case_id: str, perception_result: Dict) -> None:
        """Update case in library with perception output."""
        case = self.case_library.get_case(case_id)
        if case is None:
            return

        output = perception_result.get("output", {})

        # Update perception-related fields
        case.perception_mode = output.get("mode", "auto")
        case.confidence = output.get("confidence", {}).get("overall", 0.5)

        # Extract perceived faults
        perceived_faults = output.get("faults", [])
        case.affected_ne_ids = set()
        for fault in perceived_faults:
            if "element_id" in fault:
                case.affected_ne_ids.add(fault["element_id"])

        # Store reasoning trace
        case.reasoning_trace = output.get("reasoning_trace", [])

        # Compute accuracy if we have ground truth
        # Accuracy will be completed in evaluation loop

        self.case_library.update_case(case)

    def _update_case_with_evaluation(self, case_id: str, eval_result: EvaluationResult) -> None:
        """Update case in library with evaluation results."""
        case = self.case_library.get_case(case_id)
        if case is None:
            return

        case.accuracy = eval_result.overall_score
        case.recommendations = eval_result.recommendations

        # Update tags based on evaluation
        if eval_result.overall_score < 0.5:
            case.tags.add("low_accuracy")
        elif eval_result.overall_score > 0.8:
            case.tags.add("high_accuracy")

        # Add fault pattern tag
        case.tags.add(f"pattern_{eval_result.case_analysis.fault_pattern}")

        self.case_library.update_case(case)

    def _infer_fault_type(self, case) -> FaultType:
        """Infer fault type from generated case."""
        if case.scenario.is_normal:
            return FaultType.NORMAL

        fc = case.scenario.fault_config
        if fc is None:
            return FaultType.UNKNOWN

        fpt = fc.fault_point_type
        if hasattr(fpt, 'value'):
            fpt = fpt.value

        try:
            return FaultType(fpt)
        except ValueError:
            return FaultType.UNKNOWN

    def _extract_kpi_metrics(self, result) -> KPIMetrics:
        """Extract KPI metrics from simulation result."""
        if result is None:
            return KPIMetrics()

        kpi_records = getattr(result, 'kpi_records', []) or []

        if not kpi_records:
            return KPIMetrics()

        success_rates = [r.success_rate for r in kpi_records if hasattr(r, 'success_rate')]

        return KPIMetrics(
            avg_success_rate=sum(success_rates) / len(success_rates) if success_rates else 1.0,
            min_success_rate=min(success_rates) if success_rates else 1.0,
            affected_flows=len([r for r in kpi_records if r.success_rate < 1.0]),
            total_flows=len(kpi_records)
        )

    def _parse_perception_faults(self, perception_output: Dict) -> List[FaultConfig]:
        """Parse perception output into FaultConfig list."""
        faults = []
        for fault in perception_output.get("faults", []):
            fc = FaultConfig(
                fault_point_type=fault.get("fault_point_type", "normal"),
                fault_mode=fault.get("fault_mode", "link"),
                loss_rate=fault.get("loss_rate", 0.0),
                fault_start=fault.get("fault_start", 0),
                fault_duration=fault.get("fault_duration", 0),
                affected_ne_ids=set(fault.get("affected_ne_ids", [])),
                affected_links=fault.get("affected_links", [])
            )
            faults.append(fc)
        return faults

    def _parse_fault_config(self, fc_dict: Optional[Dict]) -> Optional[FaultConfig]:
        """Parse fault config dictionary into FaultConfig object."""
        if fc_dict is None:
            return None

        from simulator.models import FaultPointType, FaultMode

        try:
            fpt = FaultPointType(fc_dict.get("fault_point_type", "normal"))
        except ValueError:
            fpt = FaultPointType.NORMAL

        try:
            fm = FaultMode(fc_dict.get("fault_mode", "link"))
        except ValueError:
            fm = FaultMode.LINK

        return FaultConfig(
            fault_point_type=fpt,
            fault_mode=fm,
            loss_rate=fc_dict.get("loss_rate", 0.0),
            fault_start=fc_dict.get("fault_start", 0),
            fault_duration=fc_dict.get("fault_duration", 0),
            affected_ne_ids=set(fc_dict.get("affected_ne_ids", [])),
            affected_links=[tuple(l) for l in fc_dict.get("affected_links", [])]
        )

    def _parse_simulation_result(self, case_data: Dict) -> SimulationResult:
        """Parse case data into SimulationResult object."""
        kpi_records = []
        for kpi_dict in case_data.get("kpi_records", []):
            kpi_records.append(KPIRecord(
                timestamp=kpi_dict.get("timestamp", 0),
                level=kpi_dict.get("level", "link"),
                ue_id=kpi_dict.get("ue_id", ""),
                src=kpi_dict.get("src", ""),
                dst=kpi_dict.get("dst", ""),
                success_rate=kpi_dict.get("success_rate", 1.0)
            ))

        return SimulationResult(
            case_id=case_data.get("case_id", ""),
            kpi_records=kpi_records,
            flows=case_data.get("business_flows", []),
            topology=case_data.get("topology"),
            ground_truth=self._parse_fault_config(case_data.get("fault_config"))
        )

    def _generate_iteration_summary(self, loop_results: Dict[str, LoopResult]) -> str:
        """Generate human-readable iteration summary."""
        parts = []

        if "data_gen" in loop_results:
            dg = loop_results["data_gen"]
            parts.append(
                f"DataGen: {dg.cases_processed} cases "
                f"({dg.cases_succeeded} passed, {dg.cases_failed} failed)"
            )

        if "perception" in loop_results:
            p = loop_results["perception"]
            parts.append(
                f"Perception: {p.cases_processed} cases "
                f"({p.cases_succeeded} succeeded, {p.cases_failed} failed)"
            )

        if "evaluation" in loop_results:
            e = loop_results["evaluation"]
            avg_f1 = e.metrics.get("avg_f1_score", 0.0)
            parts.append(
                f"Eval: {e.cases_processed} cases "
                f"(avg F1: {avg_f1:.2f}, {e.cases_failed} failed)"
            )

        return "; ".join(parts)

    def get_status(self) -> Dict[str, Any]:
        """Get current orchestrator status."""
        state = self.iteration_manager.get_current_state()

        return {
            "current_iteration": self.current_iteration,
            "total_iterations": self.total_iterations,
            "iteration_state": state.to_dict() if state else None,
            "case_library_size": self.case_library.get_case_count(),
            "case_library_stats": self.case_library.get_statistics(),
            "data_gen_status": self.data_gen_agent.status.value if self._data_gen_agent else "not_initialized",
            "perception_status": self.perception_agent.get_status() if self._perception_agent else {},
            "progress": self.iteration_manager.get_progress()
        }

    def reset(self) -> None:
        """Reset orchestrator state for a fresh run."""
        self.current_iteration = 0
        self.total_iterations = 0
        self.loop_results = []
        self._data_gen_agent = None
        self._perception_agent = None
        self._evaluator_agent = None
        self._topology = None
        logger.info("[Orchestrator] Reset complete")


def main():
    """Main entry point for standalone execution."""
    import argparse

    parser = argparse.ArgumentParser(description="Fault Perception Orchestrator")
    parser.add_argument("--iterations", type=int, default=1, help="Number of iterations to run")
    parser.add_argument("--baseline-cases", type=int, default=100, help="Baseline cases per iteration")
    parser.add_argument("--hard-cases", type=int, default=20, help="Hard cases per iteration")
    parser.add_argument("--single-case", type=str, help="Test single case by ID")
    parser.add_argument("--status", action="store_true", help="Show current status")

    args = parser.parse_args()

    orchestrator = Orchestrator()

    if args.status:
        import json
        print(json.dumps(orchestrator.get_status(), indent=2))
        return

    if args.single_case:
        result = orchestrator.run_single_case(args.single_case)
        import json
        print(json.dumps(result, indent=2))
        return

    if args.iterations > 0:
        results = orchestrator.run_full_iteration(args.iterations)
        import json
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
