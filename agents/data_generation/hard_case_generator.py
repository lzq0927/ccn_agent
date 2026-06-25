"""Hard case generator: creates edge cases, multi-fault, low-signal scenarios."""

from __future__ import annotations

import logging
import random

from simulator.models import FaultPointType, FaultMode
from agents.shared.models import (
    CaseParams,
    CaseDifficulty,
    CaseSource,
    CasePackage,
    ValidationStatus,
)
from agents.data_generation.simulator_wrapper import SimulatorWrapper

logger = logging.getLogger(__name__)


class HardCaseGenerator:
    """Generates difficult edge cases for stress-testing the fault perception agent."""

    def __init__(self, simulator: SimulatorWrapper):
        self.simulator = simulator

    def generate_multi_fault(self, topo_config_index: int = 2, seed: int = 0) -> CaseParams:
        """Generate a case with multiple simultaneous fault types."""
        return CaseParams(
            topo_config_index=topo_config_index,
            seed=seed,
            fault_type=FaultPointType.MULTI_NE,
            fault_mode=FaultMode.LINK,
            difficulty=CaseDifficulty.HARD,
        )

    def generate_low_signal(self, seed: int = 0) -> CaseParams:
        """Generate a case with very low loss rate (hard to detect)."""
        return CaseParams(
            topo_config_index=random.randint(0, 4),
            seed=seed,
            fault_type=FaultPointType.SINGLE_NE,
            fault_mode=FaultMode.BUSINESS,
            loss_rate=0.03,  # Minimum loss rate - very subtle
            difficulty=CaseDifficulty.EDGE,
        )

    def generate_cascading(self, seed: int = 0) -> CaseParams:
        """Generate a case that mimics cascading fault behavior."""
        return CaseParams(
            topo_config_index=random.randint(1, 4),
            seed=seed,
            fault_type=FaultPointType.RESOURCE_POOL,
            fault_mode=FaultMode.LINK,
            difficulty=CaseDifficulty.HARD,
        )

    def generate_switch_fault(self, seed: int = 0) -> CaseParams:
        """Generate a switch fault (hard to distinguish from pool fault)."""
        return CaseParams(
            topo_config_index=random.randint(1, 4),
            seed=seed,
            fault_type=FaultPointType.SWITCH,
            fault_mode=FaultMode.LINK,
            difficulty=CaseDifficulty.HARD,
        )

    def generate_path_fault(self, seed: int = 0) -> CaseParams:
        """Generate a path-level fault (no clear NE root cause)."""
        return CaseParams(
            topo_config_index=random.randint(0, 4),
            seed=seed,
            fault_type=FaultPointType.PATH_LINK,
            fault_mode=FaultMode.LINK,
            difficulty=CaseDifficulty.EDGE,
        )

    def generate_batch(self, count: int = 10, start_id: int = 1000) -> list[tuple[CaseParams, int]]:
        """Generate a batch of hard cases with varied types."""
        generators = [
            self.generate_multi_fault,
            self.generate_low_signal,
            self.generate_cascading,
            self.generate_switch_fault,
            self.generate_path_fault,
        ]

        cases = []
        for i in range(count):
            gen = generators[i % len(generators)]
            params = gen(seed=start_id + i * 100)
            cases.append((params, start_id + i))

        return cases

    async def generate_validated_batch(
        self,
        count: int = 10,
        start_id: int = 1000,
        validator=None,
    ) -> list[CasePackage]:
        """Generate and validate a batch of hard cases."""
        param_list = self.generate_batch(count, start_id)
        packages = []

        for params, case_id in param_list:
            case = self.simulator.generate(params, case_id=case_id)
            case.metadata.source = CaseSource.HARD_GENERATOR

            if validator:
                validation = await validator.validate(case)
                case.metadata.validation_status = (
                    ValidationStatus.PASSED if validation.passed else ValidationStatus.FAILED
                )
                case.metadata.validation_notes = validation.overall_note
            else:
                case.metadata.validation_status = ValidationStatus.PASSED

            packages.append(case)

        return packages
