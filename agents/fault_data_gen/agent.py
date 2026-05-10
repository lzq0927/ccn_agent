"""
Fault Data Generation Agent

Main agent that orchestrates fault data generation, self-verification, and
hard case generation. Wraps the existing simulator and integrates with
the CaseLibrary for iterative enhancement.
"""

import os
import sys
import json
import time
import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime
from enum import Enum

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from simulator.topology import TopologyGenerator
from simulator.scenario import ScenarioGenerator
from simulator.engine import SimulationEngine
from simulator.exporter import DataExporter
from simulator.models import (
    Scenario, SimulationResult, FaultConfig, FaultPointType,
    FaultMode, NEType, KPIRecord, Topology
)

from .hard_case_generator import HardCaseGenerator
from .verifier import DataVerifier


class GenerationStatus(Enum):
    IDLE = "idle"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


@dataclass
class GenerationStats:
    """Statistics for a generation run."""
    total_generated: int = 0
    passed_verification: int = 0
    failed_verification: int = 0
    hard_cases_generated: int = 0
    normal_cases: int = 0
    fault_cases: int = 0
    train_cases: int = 0
    test_cases: int = 0
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    
    @property
    def duration_seconds(self) -> float:
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return 0.0
    
    @property
    def pass_rate(self) -> float:
        if self.total_generated == 0:
            return 0.0
        return self.passed_verification / self.total_generated


@dataclass
class GeneratedCase:
    """A generated and verified fault case ready for CaseLibrary."""
    case_id: str
    iteration: int
    scenario: Scenario
    result: SimulationResult
    verification_result: Dict[str, Any]
    is_hard_case: bool = False
    hard_case_strategy: str = ""
    created_at: datetime = field(default_factory=datetime.now)


class FaultDataGenAgent:
    """
    Fault Data Generation Agent.
    
    Responsibilities:
    1. Generate baseline fault cases using the simulator
    2. Self-verify generated cases via LLM
    3. Generate hard cases based on failure patterns
    4. Write verified cases to CaseLibrary
    """
    
    def __init__(
        self,
        output_dir: str = None,
        case_library_dir: str = None,
        data_dir: str = None,
        llm_provider: str = "minimax",
        verification_llm_model: str = None
    ):
        """
        Initialize the Fault Data Generation Agent.
        
        Args:
            output_dir: Directory to store generated case files
            case_library_dir: Directory of the CaseLibrary
            data_dir: Directory for simulator output data
            llm_provider: LLM provider for verification
            verification_llm_model: Specific LLM model to use for verification
        """
        self.project_root = PROJECT_ROOT
        self.output_dir = output_dir or os.path.join(self.project_root, "data", "generated")
        self.case_library_dir = case_library_dir or os.path.join(self.project_root, "case_library")
        self.data_dir = data_dir or os.path.join(self.project_root, "data")
        
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(self.case_library_dir, exist_ok=True)
        
        # Initialize components
        self.topology_generator = TopologyGenerator()
        self.scenario_generator = None  # Initialized after topologies
        self.simulation_engine = SimulationEngine()
        self.data_exporter = DataExporter(self.data_dir)
        
        # Initialize hard case generator
        self.hard_case_generator = HardCaseGenerator(
            topology_generator=self.topology_generator,
            simulation_engine=self.simulation_engine
        )
        
        # Initialize verifier
        self.verifier = DataVerifier(
            llm_provider=llm_provider,
            model=verification_llm_model
        )
        
        # State
        self.status = GenerationStatus.IDLE
        self.stats = GenerationStats()
        self.generated_cases: List[GeneratedCase] = []
        self.failed_cases: List[Dict] = []
        self.current_iteration = 0
        
    def run(
        self,
        num_cases: int = 100,
        num_hard_cases: int = 20,
        seed: int = 42,
        skip_verification: bool = False,
        hard_case_only: bool = False,
        base_topologies: Dict[int, Topology] = None
    ) -> GenerationStats:
        """
        Run the fault data generation pipeline.
        
        Args:
            num_cases: Number of baseline cases to generate
            num_hard_cases: Number of hard cases to generate
            seed: Random seed for reproducibility
            skip_verification: Skip LLM verification step
            hard_case_only: Only generate hard cases
            base_topologies: Pre-existing topologies to use
            
        Returns:
            GenerationStats with generation statistics
        """
        self.status = GenerationStatus.RUNNING
        self.stats = GenerationStats()
        self.stats.start_time = time.time()
        self.generated_cases = []
        self.failed_cases = []
        
        print("=" * 60)
        print("Fault Data Generation Agent")
        print("=" * 60)
        
        try:
            # Step 1: Generate or use existing topologies
            topologies = base_topologies or self._generate_topologies(seed)
            
            # Step 2: Initialize scenario generator
            self.scenario_generator = ScenarioGenerator(topologies)
            
            # Step 3: Generate baseline cases
            if not hard_case_only:
                self._generate_baseline_cases(num_cases, seed, skip_verification)
            
            # Step 4: Generate hard cases
            self._generate_hard_cases(num_hard_cases, seed, skip_verification)
            
            # Step 5: Write cases to CaseLibrary
            self._write_to_case_library()
            
            self.status = GenerationStatus.DONE
            
        except Exception as e:
            self.status = GenerationStatus.ERROR
            print(f"ERROR during generation: {e}")
            raise
        
        finally:
            self.stats.end_time = time.time()
        
        self._print_summary()
        return self.stats
    
    def _generate_topologies(self, seed: int) -> Dict[int, Topology]:
        """Generate base topologies for case generation."""
        print("\n[Stage 1] Generating topologies...")
        topologies = {}
        for i in range(5):
            topologies[i] = self.topology_generator.generate(i, seed=100 + i + seed)
            ne_count = len(topologies[i].elements)
            pool_count = len(topologies[i].get_pool_ids())
            dc_count = len(topologies[i].get_dc_ids())
            print(f"  Topology {i}: {dc_count} DC, {pool_count} pools, {ne_count} NEs")
        return topologies
    
    def _generate_baseline_cases(
        self,
        num_cases: int,
        seed: int,
        skip_verification: bool
    ):
        """Generate baseline fault cases using the simulator."""
        print(f"\n[Stage 2] Generating {num_cases} baseline cases...")
        
        scenarios = self.scenario_generator.generate(num_cases=num_cases, seed=seed)
        
        for idx, scenario in enumerate(scenarios):
            case_start = time.time()
            
            # Simulate
            result = self.simulation_engine.simulate(scenario)
            
            # Export data
            case_dir = os.path.join(self.output_dir, f"case_{scenario.case_id:03d}")
            os.makedirs(case_dir, exist_ok=True)
            self.data_exporter.export(scenario, result, output_dir=case_dir)
            
            # Verify via LLM
            verification_result = {"passed": True, "issues": [], "warnings": []}
            if not skip_verification:
                verification_result = self._verify_case(scenario, result)
            
            # Record stats
            self.stats.total_generated += 1
            if scenario.is_normal:
                self.stats.normal_cases += 1
            else:
                self.stats.fault_cases += 1
            if scenario.is_train:
                self.stats.train_cases += 1
            else:
                self.stats.test_cases += 1
            
            if verification_result.get("passed", True):
                self.stats.passed_verification += 1
                self.generated_cases.append(GeneratedCase(
                    case_id=f"C{self.current_iteration:04d}_{scenario.case_id:04d}",
                    iteration=self.current_iteration,
                    scenario=scenario,
                    result=result,
                    verification_result=verification_result,
                    is_hard_case=False
                ))
            else:
                self.stats.failed_verification += 1
                self.failed_cases.append({
                    "case_id": scenario.case_id,
                    "scenario": scenario,
                    "result": result,
                    "verification": verification_result,
                    "generation_time": time.time() - case_start
                })
            
            if (idx + 1) % 20 == 0:
                print(f"  Progress: {idx + 1}/{len(scenarios)} cases "
                      f"({self.stats.passed_verification} passed, "
                      f"{self.stats.failed_verification} failed)")
    
    def _generate_hard_cases(
        self,
        num_hard_cases: int,
        seed: int,
        skip_verification: bool
    ):
        """Generate hard cases with challenging scenarios."""
        print(f"\n[Stage 3] Generating {num_hard_cases} hard cases...")
        
        hard_scenarios = self.hard_case_generator.generate_hard_cases(
            num_cases=num_hard_cases,
            seed=seed
        )
        
        for idx, scenario in enumerate(hard_scenarios):
            case_start = time.time()
            
            # Simulate
            result = self.simulation_engine.simulate(scenario)
            
            # Export data
            hard_case_id = f"hard_{scenario.case_id:03d}"
            case_dir = os.path.join(self.output_dir, hard_case_id)
            os.makedirs(case_dir, exist_ok=True)
            self.data_exporter.export(scenario, result, output_dir=case_dir)
            
            # Verify via LLM
            verification_result = {"passed": True, "issues": [], "warnings": []}
            if not skip_verification:
                verification_result = self._verify_case(scenario, result)
            
            # Record stats
            self.stats.total_generated += 1
            self.stats.hard_cases_generated += 1
            if scenario.is_normal:
                self.stats.normal_cases += 1
            else:
                self.stats.fault_cases += 1
            if scenario.is_train:
                self.stats.train_cases += 1
            else:
                self.stats.test_cases += 1
            
            if verification_result.get("passed", True):
                self.stats.passed_verification += 1
                self.generated_cases.append(GeneratedCase(
                    case_id=f"C{self.current_iteration:04d}_{hard_case_id}",
                    iteration=self.current_iteration,
                    scenario=scenario,
                    result=result,
                    verification_result=verification_result,
                    is_hard_case=True,
                    hard_case_strategy=scenario.fault_config.hard_case_strategy if scenario.fault_config else "normal"
                ))
            else:
                self.stats.failed_verification += 1
                self.failed_cases.append({
                    "case_id": hard_case_id,
                    "scenario": scenario,
                    "result": result,
                    "verification": verification_result,
                    "generation_time": time.time() - case_start
                })
            
            if (idx + 1) % 5 == 0:
                print(f"  Progress: {idx + 1}/{len(hard_scenarios)} hard cases")
    
    def _verify_case(
        self,
        scenario: Scenario,
        result: SimulationResult
    ) -> Dict[str, Any]:
        """Verify a generated case using LLM."""
        try:
            return self.verifier.verify(scenario, result)
        except Exception as e:
            return {
                "passed": False,
                "issues": [f"Verification error: {str(e)}"],
                "warnings": []
            }
    
    def _write_to_case_library(self):
        """Write verified cases to the CaseLibrary."""
        print(f"\n[Stage 4] Writing {len(self.generated_cases)} cases to CaseLibrary...")
        
        for case in self.generated_cases:
            case_data = {
                "case_id": case.case_id,
                "iteration": case.iteration,
                "source": "simulator" if not case.is_hard_case else "hard_case_generator",
                "is_hard_case": case.is_hard_case,
                "hard_case_strategy": case.hard_case_strategy,
                "is_normal": case.scenario.is_normal,
                "is_train": case.scenario.is_train,
                "process_name": case.scenario.process_name,
                "ue_count": case.scenario.ue_count,
                "fault_config": self._serialize_fault_config(case.scenario.fault_config),
                "verification_result": case.verification_result,
                "created_at": case.created_at.isoformat(),
                "data_path": os.path.join(self.output_dir, f"case_{case.scenario.case_id:03d}"),
                "perceived_fault_elements": [],
                "perceived_fault_links": [],
                "perception_confidence": None,
                "perception_mode": None,
                "perception_reasoning": [],
                "accuracy": None,
                "is_correct": None,
                "eval_feedback": None,
                "optimization_suggestions": [],
                "lessons_learned": None,
                "tags": self._generate_tags(case)
            }
            
            case_file = os.path.join(
                self.case_library_dir,
                f"{case.case_id}.json"
            )
            with open(case_file, 'w', encoding='utf-8') as f:
                json.dump(case_data, f, indent=2, ensure_ascii=False)
        
        # Write failed cases to failure log
        if self.failed_cases:
            failure_log = os.path.join(self.case_library_dir, "failures.json")
            with open(failure_log, 'w', encoding='utf-8') as f:
                json.dump(self.failed_cases, f, indent=2, ensure_ascii=False, default=str)
        
        print(f"  Wrote {len(self.generated_cases)} cases to CaseLibrary")
        if self.failed_cases:
            print(f"  Logged {len(self.failed_cases)} failed cases")
    
    def _serialize_fault_config(self, fc: Optional[FaultConfig]) -> Optional[Dict]:
        """Serialize FaultConfig to dictionary."""
        if fc is None:
            return None
        return {
            "fault_point_type": fc.fault_point_type.value if fc.fault_point_type else None,
            "fault_mode": fc.fault_mode.value if fc.fault_mode else None,
            "loss_rate": fc.loss_rate,
            "fault_start": fc.fault_start,
            "fault_duration": fc.fault_duration,
            "affected_ne_ids": list(fc.affected_ne_ids),
            "affected_links": [list(link) for link in fc.affected_links],
            "num_affected_paths": fc.num_affected_paths,
            "affected_switch": fc.affected_switch,
            "affected_sessions": list(fc.affected_sessions),
            "hard_case_strategy": getattr(fc, 'hard_case_strategy', '')
        }
    
    def _generate_tags(self, case: GeneratedCase) -> List[str]:
        """Generate tags for a case based on its characteristics."""
        tags = []
        
        if case.is_hard_case:
            tags.append("hard_case")
            if case.hard_case_strategy:
                tags.append(f"hard_{case.hard_case_strategy}")
        
        if case.scenario.is_normal:
            tags.append("normal")
        else:
            if case.scenario.fault_config:
                fpt = case.scenario.fault_config.fault_point_type
                tags.append(f"fault_{fpt.value}")
                
                if len(case.scenario.fault_config.affected_ne_ids) > 1:
                    tags.append("multi_ne")
                
                if case.scenario.fault_config.fault_point_type in [
                    FaultPointType.PATH_LINK,
                    FaultPointType.PATH_TRACE,
                    FaultPointType.PATH_SESSION
                ]:
                    tags.append("path_fault")
        
        return tags
    
    def _print_summary(self):
        """Print generation summary."""
        print("\n" + "=" * 60)
        print("Generation Summary")
        print("=" * 60)
        print(f"  Status:           {self.status.value}")
        print(f"  Duration:         {self.stats.duration_seconds:.1f}s")
        print(f"  Total Generated:  {self.stats.total_generated}")
        print(f"  Passed:           {self.stats.passed_verification}")
        print(f"  Failed:           {self.stats.failed_verification}")
        print(f"  Pass Rate:        {self.stats.pass_rate:.1%}")
        print(f"  Hard Cases:       {self.stats.hard_cases_generated}")
        print(f"  Normal Cases:     {self.stats.normal_cases}")
        print(f"  Fault Cases:      {self.stats.fault_cases}")
        print(f"  Train Cases:      {self.stats.train_cases}")
        print(f"  Test Cases:       {self.stats.test_cases}")
        print("=" * 60)
    
    def get_case_by_id(self, case_id: str) -> Optional[GeneratedCase]:
        """Retrieve a generated case by ID."""
        for case in self.generated_cases:
            if case.case_id == case_id:
                return case
        return None
    
    def get_cases_by_iteration(self, iteration: int) -> List[GeneratedCase]:
        """Retrieve all cases from a specific iteration."""
        return [case for case in self.generated_cases if case.iteration == iteration]
    
    def get_hard_cases(self) -> List[GeneratedCase]:
        """Retrieve all hard cases."""
        return [case for case in self.generated_cases if case.is_hard_case]
    
    def get_failed_verification_cases(self) -> List[Dict]:
        """Retrieve cases that failed verification."""
        return self.failed_cases


def main():
    """Main entry point for standalone execution."""
    agent = FaultDataGenAgent()
    stats = agent.run(num_cases=100, num_hard_cases=20)
    return stats


if __name__ == "__main__":
    main()
