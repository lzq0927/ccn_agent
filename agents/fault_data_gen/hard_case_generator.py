"""
Hard Case Generator for Fault Data Generation Agent

Generates challenging fault scenarios including:
- Multi-point faults (multiple independent fault locations)
- Propagation chains (fault A triggers fault B symptoms)
- Noise injection (mixing normal fluctuations with fault signals)
- Boundary conditions (edge cases with extreme parameters)
"""

import random
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from simulator.models import (
    FaultConfig, FaultMode, FaultPointType, Scenario, Topology,
    NEType, NetworkElement
)
from simulator.topology import TopologyGenerator
from simulator.engine import SimulationEngine
from simulator.scenario import ScenarioGenerator, PROCESS_NAMES


class HardCaseStrategy(Enum):
    """Strategies for generating hard cases."""
    MULTI_POINT_FAULT = "multi_point_fault"
    PROPAGATION_CHAIN = "propagation_chain"
    NOISE_INJECTION = "noise_injection"
    BOUNDARY_CONDITION = "boundary_condition"
    AMBIGUOUS_FAULT = "ambiguous_fault"
    RARE_COMBINATION = "rare_combination"


@dataclass
class HardCaseConfig:
    """Configuration for a hard case."""
    strategy: HardCaseStrategy
    fault_point_type: FaultPointType
    fault_mode: FaultMode
    # Multi-point fault settings
    num_fault_points: int = 2
    # Propagation chain settings
    propagation_depth: int = 2
    # Noise injection settings
    noise_level: float = 0.005
    noise_duration: int = 10
    # Boundary condition settings
    boundary_type: str = "short_duration"  # "short_duration", "low_loss", "late_start"
    # Common settings
    loss_rate: float = 0.05
    fault_start: int = 25
    fault_duration: int = 10


class HardCaseGenerator:
    """
    Generator for hard-to-diagnose fault cases.
    
    Hard cases are designed to challenge fault perception agents by:
    1. Multi-point faults: Multiple simultaneous faults obscure primary cause
    2. Propagation chains: Cascading effects make root cause unclear
    3. Noise injection: Normal fluctuations mask fault signals
    4. Boundary conditions: Edge case parameters tested
    """
    
    def __init__(
        self,
        topology_generator: TopologyGenerator = None,
        simulation_engine: SimulationEngine = None
    ):
        self.topology_generator = topology_generator or TopologyGenerator()
        self.simulation_engine = simulation_engine or SimulationEngine()
        self._topologies: Dict[int, Topology] = {}
    
    def generate_hard_cases(
        self,
        num_cases: int = 20,
        seed: int = 42,
        topologies: Dict[int, Topology] = None
    ) -> List[Scenario]:
        """
        Generate hard cases with various challenging strategies.
        
        Args:
            num_cases: Number of hard cases to generate
            seed: Random seed
            topologies: Pre-existing topologies to use
            
        Returns:
            List of challenging Scenario objects
        """
        random.seed(seed)
        
        # Ensure topologies exist
        if topologies:
            self._topologies = topologies
        elif not self._topologies:
            self._topologies = self._generate_default_topologies(seed)
        
        scenarios = []
        strategies = list(HardCaseStrategy)
        
        for i in range(num_cases):
            strategy = strategies[i % len(strategies)]
            scenario = self._generate_single_hard_case(
                case_id=1000 + i,  # Offset to avoid collision with baseline
                strategy=strategy,
                seed=seed + i
            )
            scenarios.append(scenario)
        
        return scenarios
    
    def _generate_single_hard_case(
        self,
        case_id: int,
        strategy: HardCaseStrategy,
        seed: int
    ) -> Scenario:
        """Generate a single hard case based on the strategy."""
        random.seed(seed)
        
        topo_idx = case_id % len(self._topologies)
        topology = self._topologies[topo_idx]
        process_name = PROCESS_NAMES[case_id % len(PROCESS_NAMES)]
        is_train = random.random() < 0.4
        
        if strategy == HardCaseStrategy.MULTI_POINT_FAULT:
            return self._generate_multi_point_fault(
                case_id, topology, process_name, is_train, seed
            )
        elif strategy == HardCaseStrategy.PROPAGATION_CHAIN:
            return self._generate_propagation_chain(
                case_id, topology, process_name, is_train, seed
            )
        elif strategy == HardCaseStrategy.NOISE_INJECTION:
            return self._generate_noise_injection(
                case_id, topology, process_name, is_train, seed
            )
        elif strategy == HardCaseStrategy.BOUNDARY_CONDITION:
            return self._generate_boundary_condition(
                case_id, topology, process_name, is_train, seed
            )
        elif strategy == HardCaseStrategy.AMBIGUOUS_FAULT:
            return self._generate_ambiguous_fault(
                case_id, topology, process_name, is_train, seed
            )
        elif strategy == HardCaseStrategy.RARE_COMBINATION:
            return self._generate_rare_combination(
                case_id, topology, process_name, is_train, seed
            )
        else:
            return self._generate_boundary_condition(
                case_id, topology, process_name, is_train, seed
            )
    
    def _generate_multi_point_fault(
        self,
        case_id: int,
        topology: Topology,
        process_name: str,
        is_train: bool,
        seed: int
    ) -> Scenario:
        """
        Generate a multi-point fault scenario.
        
        Multiple independent faults occur simultaneously, making it hard
        to determine which is the primary/original fault.
        """
        all_ne_ids = list(topology.elements.keys())
        num_points = random.randint(2, 3)
        
        # Select fault points from different types/locations
        selected_ne_ids = random.sample(all_ne_ids, min(num_points, len(all_ne_ids)))
        
        # Create fault config with multiple affected NEs
        fc = FaultConfig(
            fault_point_type=FaultPointType.MULTI_NE,
            fault_mode=random.choice([FaultMode.LINK, FaultMode.BUSINESS]),
            loss_rate=round(random.uniform(0.04, 0.07), 4),
            fault_start=random.randint(20, 35),
            fault_duration=random.randint(8, 15),
            affected_ne_ids=set(selected_ne_ids),
            affected_links=[],
            hard_case_strategy="multi_point_fault"
        )
        
        return Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=random.randint(60, 100),
            fault_config=fc,
            is_normal=False,
            is_train=is_train
        )
    
    def _generate_propagation_chain(
        self,
        case_id: int,
        topology: Topology,
        process_name: str,
        is_train: bool,
        seed: int
    ) -> Scenario:
        """
        Generate a propagation chain scenario.
        
        A fault in one NE causes cascading effects that manifest as faults
        in other NEs, obscuring the true root cause.
        """
        all_ne_ids = list(topology.elements.keys())
        
        # Primary fault location
        primary_ne = random.choice(all_ne_ids)
        
        # For propagation chain, we simulate indirect effects through
        # the fault_mode being LINK but with smaller loss rate
        # The secondary effects will be captured in the simulation
        
        fc = FaultConfig(
            fault_point_type=FaultPointType.SINGLE_NE,
            fault_mode=FaultMode.LINK,  # LINK mode causes propagation effects
            loss_rate=round(random.uniform(0.05, 0.08), 4),
            fault_start=random.randint(22, 30),
            fault_duration=random.randint(10, 18),
            affected_ne_ids={primary_ne},
            affected_links=[],
            hard_case_strategy="propagation_chain"
        )
        
        return Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=random.randint(70, 100),
            fault_config=fc,
            is_normal=False,
            is_train=is_train
        )
    
    def _generate_noise_injection(
        self,
        case_id: int,
        topology: Topology,
        process_name: str,
        is_train: bool,
        seed: int
    ) -> Scenario:
        """
        Generate a noise injection scenario.
        
        Normal fluctuations are injected into the KPI data, potentially
        masking or mimicking fault signals.
        """
        all_ne_ids = list(topology.elements.keys())
        fault_ne = random.choice(all_ne_ids)
        
        fc = FaultConfig(
            fault_point_type=FaultPointType.SINGLE_NE,
            fault_mode=random.choice([FaultMode.LINK, FaultMode.BUSINESS]),
            loss_rate=round(random.uniform(0.03, 0.05), 4),  # Lower loss rate
            fault_start=random.randint(25, 35),  # Later start
            fault_duration=random.randint(5, 10),  # Shorter duration
            affected_ne_ids={fault_ne},
            affected_links=[],
            hard_case_strategy="noise_injection"
        )
        
        return Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=random.randint(80, 100),
            fault_config=fc,
            is_normal=False,
            is_train=is_train
        )
    
    def _generate_boundary_condition(
        self,
        case_id: int,
        topology: Topology,
        process_name: str,
        is_train: bool,
        seed: int
    ) -> Scenario:
        """
        Generate a boundary condition scenario.
        
        Edge case parameters that test the limits of detection:
        - Very short fault duration (3-5 seconds)
        - Very low loss rate (1-3%)
        - Fault starts very late (40+ seconds)
        """
        all_ne_ids = list(topology.elements.keys())
        fault_ne = random.choice(all_ne_ids)
        
        boundary_type = random.choice(["short_duration", "low_loss", "late_start"])
        
        if boundary_type == "short_duration":
            loss_rate = round(random.uniform(0.05, 0.08), 4)
            fault_start = random.randint(25, 35)
            fault_duration = random.randint(3, 5)
        elif boundary_type == "low_loss":
            loss_rate = round(random.uniform(0.01, 0.03), 4)
            fault_start = random.randint(25, 35)
            fault_duration = random.randint(8, 15)
        else:  # late_start
            loss_rate = round(random.uniform(0.05, 0.08), 4)
            fault_start = random.randint(40, 50)
            fault_duration = random.randint(8, 15)
        
        fc = FaultConfig(
            fault_point_type=FaultPointType.SINGLE_NE,
            fault_mode=random.choice([FaultMode.LINK, FaultMode.BUSINESS]),
            loss_rate=loss_rate,
            fault_start=fault_start,
            fault_duration=fault_duration,
            affected_ne_ids={fault_ne},
            affected_links=[],
            hard_case_strategy=f"boundary_{boundary_type}"
        )
        
        return Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=random.randint(50, 100),
            fault_config=fc,
            is_normal=False,
            is_train=is_train
        )
    
    def _generate_ambiguous_fault(
        self,
        case_id: int,
        topology: Topology,
        process_name: str,
        is_train: bool,
        seed: int
    ) -> Scenario:
        """
        Generate an ambiguous fault scenario.
        
        Fault effects could be attributed to multiple possible root causes,
        making definitive diagnosis difficult.
        """
        # Use PATH_TRACE or PATH_SESSION to make it ambiguous
        fault_types = [FaultPointType.PATH_TRACE, FaultPointType.PATH_SESSION]
        fault_type = random.choice(fault_types)
        
        fc = FaultConfig(
            fault_point_type=fault_type,
            fault_mode=FaultMode.BUSINESS,
            loss_rate=round(random.uniform(0.04, 0.06), 4),
            fault_start=random.randint(25, 35),
            fault_duration=random.randint(8, 15),
            affected_ne_ids=set(),
            affected_links=[],
            num_affected_paths=random.randint(1, 2),
            hard_case_strategy="ambiguous_fault"
        )
        
        return Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=random.randint(60, 100),
            fault_config=fc,
            is_normal=False,
            is_train=is_train
        )
    
    def _generate_rare_combination(
        self,
        case_id: int,
        topology: Topology,
        process_name: str,
        is_train: bool,
        seed: int
    ) -> Scenario:
        """
        Generate a rare combination scenario.
        
        Uncommon combinations of fault types, network elements, or
        process types that rarely appear in training data.
        """
        # Use a rare fault type
        rare_types = [
            FaultPointType.ALL_TYPE_NE,
            FaultPointType.MULTI_TYPE_NE,
            FaultPointType.DC
        ]
        fault_type = random.choice(rare_types)
        
        # For ALL_TYPE_NE, pick a specific NE type
        if fault_type == FaultPointType.ALL_TYPE_NE:
            ne_type = random.choice(list(NEType))
            affected = {ne.id for ne in topology.get_elements_by_type(ne_type)}
        elif fault_type == FaultPointType.MULTI_TYPE_NE:
            types = random.sample(list(NEType), 2)
            affected = set()
            for t in types:
                affected.update(ne.id for ne in topology.get_elements_by_type(t))
        elif fault_type == FaultPointType.DC:
            dc_ids = topology.get_dc_ids()
            dc_id = random.choice(dc_ids)
            affected = {ne.id for ne in topology.get_elements_by_dc(dc_id)}
        else:
            all_ne = list(topology.elements.keys())
            affected = {random.choice(all_ne)}
        
        fc = FaultConfig(
            fault_point_type=fault_type,
            fault_mode=random.choice([FaultMode.LINK, FaultMode.BUSINESS]),
            loss_rate=round(random.uniform(0.05, 0.08), 4),
            fault_start=random.randint(22, 35),
            fault_duration=random.randint(10, 18),
            affected_ne_ids=affected,
            affected_links=[],
            hard_case_strategy="rare_combination"
        )
        
        return Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=random.randint(60, 90),
            fault_config=fc,
            is_normal=False,
            is_train=is_train
        )
    
    def _generate_default_topologies(self, seed: int) -> Dict[int, Topology]:
        """Generate default topologies for hard case generation."""
        topologies = {}
        for i in range(5):
            topologies[i] = self.topology_generator.generate(i, seed=100 + i + seed)
        return topologies
    
    def generate_from_failure_analysis(
        self,
        failed_cases: List[Dict],
        num_new_cases: int = 10,
        seed: int = 42
    ) -> List[Scenario]:
        """
        Generate new hard cases based on analysis of failed cases.
        
        Analyzes patterns in previously failed verification cases and
        generates new cases that address those weaknesses.
        
        Args:
            failed_cases: List of cases that failed verification
            num_new_cases: Number of new cases to generate
            seed: Random seed
            
        Returns:
            List of new hard case scenarios
        """
        random.seed(seed)
        
        if not failed_cases:
            # No failures, generate random hard cases
            return self.generate_hard_cases(num_cases=num_new_cases, seed=seed)
        
        # Analyze failure patterns
        failure_patterns = self._analyze_failure_patterns(failed_cases)
        
        # Generate cases targeting the identified weaknesses
        scenarios = []
        strategies = list(HardCaseStrategy)
        
        for i in range(num_new_cases):
            # Choose strategy based on most common failure pattern
            if failure_patterns and random.random() < 0.7:
                strategy = failure_patterns[i % len(failure_patterns)]
            else:
                strategy = random.choice(strategies)
            
            scenario = self._generate_single_hard_case(
                case_id=2000 + i,  # Offset for analysis-based cases
                strategy=strategy,
                seed=seed + i + 1000
            )
            scenarios.append(scenario)
        
        return scenarios
    
    def _analyze_failure_patterns(
        self,
        failed_cases: List[Dict]
    ) -> List[HardCaseStrategy]:
        """Analyze failed cases to identify common weakness patterns."""
        patterns = []
        
        for case in failed_cases:
            verification = case.get("verification", {})
            issues = verification.get("issues", [])
            
            # Classify issues into patterns
            for issue in issues:
                issue_lower = issue.lower()
                if "propagation" in issue_lower or "cascade" in issue_lower:
                    patterns.append(HardCaseStrategy.PROPAGATION_CHAIN)
                elif "noise" in issue_lower or "fluctuation" in issue_lower:
                    patterns.append(HardCaseStrategy.NOISE_INJECTION)
                elif "boundary" in issue_lower or "edge" in issue_lower:
                    patterns.append(HardCaseStrategy.BOUNDARY_CONDITION)
                elif "multi" in issue_lower or "multiple" in issue_lower:
                    patterns.append(HardCaseStrategy.MULTI_POINT_FAULT)
                elif "ambiguous" in issue_lower or "unclear" in issue_lower:
                    patterns.append(HardCaseStrategy.AMBIGUOUS_FAULT)
        
        # Return most common patterns
        from collections import Counter
        pattern_counts = Counter(patterns)
        most_common = pattern_counts.most_common(3)
        return [p[0] for p in most_common]
