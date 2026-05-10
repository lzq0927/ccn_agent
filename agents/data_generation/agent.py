"""Fault Data Generation Agent - orchestrates case generation with self-validation."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Callable, Optional

from agents.shared.llm_client import LLMClient, LLMConfig
from agents.shared.models import (
    CasePackage, CaseParams, CaseSource, CaseDifficulty, ValidationStatus,
)
from agents.shared.storage import Storage
from agents.shared.message_bus import MessageBus
from agents.data_generation.simulator_wrapper import SimulatorWrapper
from agents.data_generation.validator import LLMValidator, ValidationResult

logger = logging.getLogger(__name__)


@dataclass
class DataGenConfig:
    max_validation_retries: int = 3
    default_case_count: int = 100
    validation_model: str = "gpt-4o-mini"
    hard_case_ratio: float = 0.2
    llm_config: LLMConfig | None = None


class FaultDataGenerationAgent:
    """Agent 1: Generates fault data with self-validation loop.

    Loop 1 (Design-time):
        Generate → Validate → Pass/Fail → Adjust → Retry
    """

    def __init__(
        self,
        config: DataGenConfig | None = None,
        storage: Storage | None = None,
        message_bus: MessageBus | None = None,
        progress_callback: Callable[[dict], None] | None = None,
    ):
        self.config = config or DataGenConfig()
        self.storage = storage or Storage()
        self.bus = message_bus
        self.progress_callback = progress_callback
        self.simulator = SimulatorWrapper()

        # LLM for validation
        llm_config = self.config.llm_config or LLMConfig(model=self.config.validation_model)
        self.validator = LLMValidator(llm_config=llm_config)

    async def generate_case(self, params: CaseParams, case_id: int = 0) -> CasePackage:
        """Generate a single validated case with self-validation loop."""
        last_validation = None

        for attempt in range(self.config.max_validation_retries):
            logger.info("Generating case %d (attempt %d/%d)", case_id, attempt + 1, self.config.max_validation_retries)

            # Step 1: Generate
            case = self.simulator.generate(params, case_id=case_id)

            # Step 2: Validate with LLM
            validation = await self.validator.validate(case)
            last_validation = validation

            if validation.passed:
                logger.info("Case %d passed validation on attempt %d", case_id, attempt + 1)
                case.metadata.validation_status = ValidationStatus.PASSED
                case.metadata.validation_notes = validation.overall_note

                # Save to storage
                file_path = self.storage.save_case_files(case_id, case)
                self.storage.save_case(
                    case_id=case_id,
                    source=case.metadata.source.value,
                    file_path=file_path,
                    fault_type=case.metadata.fault_type,
                    fault_mode=case.metadata.fault_mode,
                    difficulty=case.metadata.difficulty.value,
                    is_normal=case.metadata.fault_type == "normal",
                    is_train=case_id % 10 < 4,
                    metadata_json=case.metadata.to_json(),
                )
                self.storage.update_case_validation(case_id, "passed", validation.overall_note)

                # Publish event
                if self.bus:
                    await self.bus.publish("data.generated", {
                        "case_id": case_id,
                        "case_dir": file_path,
                    }, sender="agent_1")

                return case

            # Step 3: Failed - adjust params and retry
            logger.warning("Case %d failed validation (attempt %d): %s",
                           case_id, attempt + 1, validation.overall_note)
            params = self._adjust_from_feedback(params, validation)

        # All retries exhausted
        logger.error("Case %d failed validation after %d attempts", case_id, self.config.max_validation_retries)
        case.metadata.validation_status = ValidationStatus.FAILED
        case.metadata.validation_notes = last_validation.feedback if last_validation else "Max retries exceeded"

        # Save failed case for analysis
        file_path = self.storage.save_case_files(case_id, case)
        self.storage.save_case(
            case_id=case_id,
            source=case.metadata.source.value,
            file_path=file_path,
            fault_type=case.metadata.fault_type,
            fault_mode=case.metadata.fault_mode,
            difficulty=case.metadata.difficulty.value,
            is_normal=case.metadata.fault_type == "normal",
            is_train=case_id % 10 < 4,
            metadata_json=case.metadata.to_json(),
        )
        self.storage.update_case_validation(case_id, "failed", case.metadata.validation_notes)

        if self.bus:
            await self.bus.publish("data.validation_failed", {
                "case_id": case_id,
                "feedback": last_validation.feedback if last_validation else "",
            }, sender="agent_1")

        return case

    async def generate_batch(self, count: int | None = None, seed: int = 42) -> list[CasePackage]:
        """Generate a batch of cases with mixed fault types."""
        count = count or self.config.default_case_count
        logger.info("Starting batch generation: %d cases", count)

        # Use standard distribution for the batch
        packages = self.simulator.generate_batch(count, seed=seed)

        validated = []
        passed = 0
        failed = 0

        for i, case in enumerate(packages):
            # Report progress
            if self.progress_callback:
                self.progress_callback({
                    "type": "generation_progress",
                    "completed": i,
                    "total": count,
                    "current_case": case.case_id,
                })

            # Validate each case
            validation = await self.validator.validate(case)

            if validation.passed:
                case.metadata.validation_status = ValidationStatus.PASSED
                case.metadata.validation_notes = validation.overall_note
                passed += 1
            else:
                case.metadata.validation_status = ValidationStatus.FAILED
                case.metadata.validation_notes = validation.overall_note
                failed += 1

            # Save regardless
            file_path = self.storage.save_case_files(case.case_id, case)
            self.storage.save_case(
                case_id=case.case_id,
                source=case.metadata.source.value,
                file_path=file_path,
                fault_type=case.metadata.fault_type,
                fault_mode=case.metadata.fault_mode,
                difficulty=case.metadata.difficulty.value,
                is_normal=case.metadata.fault_type == "normal",
                is_train=case.case_id % 10 < 4,
                metadata_json=case.metadata.to_json(),
            )
            self.storage.update_case_validation(case.case_id, case.metadata.validation_status.value,
                                                 case.metadata.validation_notes)

            validated.append(case)

        logger.info("Batch generation complete: %d passed, %d failed out of %d", passed, failed, count)

        if self.bus:
            await self.bus.publish("data.generated", {
                "case_ids": [c.case_id for c in validated],
                "passed": passed,
                "failed": failed,
            }, sender="agent_1")

        return validated

    def _adjust_from_feedback(self, params: CaseParams, validation: ValidationResult) -> CaseParams:
        """Adjust generation parameters based on validation feedback."""
        # If validation found issues, try adjusting:
        # - Increase loss rate if fault manifestation was weak
        # - Change topology if coherence issues
        # - Adjust seed for variety
        import copy
        adjusted = copy.deepcopy(params)

        for check_name, check in validation.checks.items():
            if not check.get("passed", True):
                if "fault_manifestation" in check_name or "kpi_consistency" in check_name:
                    # Increase loss rate for stronger signal
                    if adjusted.loss_rate is None or adjusted.loss_rate < 0.05:
                        adjusted.loss_rate = 0.06
                if "topology" in check_name:
                    # Try a different topology
                    adjusted.topo_config_index = (adjusted.topo_config_index + 1) % 5

        # Change seed for variety
        if params.seed is not None:
            adjusted.seed = params.seed + 1

        return adjusted


async def main():
    """CLI entry point for data generation."""
    import argparse

    parser = argparse.ArgumentParser(description="5GC Fault Data Generation Agent")
    parser.add_argument("--count", type=int, default=10, help="Number of cases to generate")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    agent = FaultDataGenerationAgent()
    packages = await agent.generate_batch(count=args.count, seed=args.seed)

    passed = sum(1 for p in packages if p.metadata.validation_status == ValidationStatus.PASSED)
    print(f"\nGenerated {len(packages)} cases: {passed} passed, {len(packages) - passed} failed")


if __name__ == "__main__":
    asyncio.run(main())
