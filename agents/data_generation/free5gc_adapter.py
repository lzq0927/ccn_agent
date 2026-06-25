"""free5GC-faithful data generator.

This adapter is the entry point for cases whose subscriber / session / CHR layer
mirrors free5GC's real data structures: SUPI subscriber identities, PDU-session
lifecycle, NRF-registered topology, and 5GMM / 5GSM / SBI failure cause codes.
It produces them deterministically via the simulator's CHR pipeline — no real
network functions, no Docker — and tags cases ``CaseSource.FREE5GC`` so
downstream consumers know the identity / cause layer is free5GC-faithful.

Design note: a future *real*-free5GC backend (Docker + UERANSIM, NF fault
injection, live KPI / signaling-log scraping) would plug in behind the same
``generate_case`` / ``generate_batch`` interface, swapping the synthetic CHR
pipeline for captured free5GC data without changing consumers.
"""

from __future__ import annotations

import logging

from agents.data_generation.simulator_wrapper import SimulatorWrapper
from agents.shared.models import CaseDifficulty, CasePackage, CaseParams, CaseSource
from simulator.models import FaultMode, FaultPointType

logger = logging.getLogger(__name__)


class Free5GCAdapter:
    """Generate free5GC-faithful fault cases (data-model mode, no real NFs)."""

    def __init__(self, default_ue_count: int = 50):
        self.wrapper = SimulatorWrapper()
        self.default_ue_count = default_ue_count

    def generate_case(self, fault_spec: dict, case_id: int) -> CasePackage:
        """Generate one free5GC-faithful case from a fault spec.

        ``fault_spec`` keys (all optional except where a fault is desired):
            fault_type (str), fault_mode ("link"|"business"), loss_rate (float),
            process_name (str), topo_config_index (int), ue_count (int),
            seed (int), difficulty ("easy"|"medium"|"hard"|"edge").
        """
        params = CaseParams(
            topo_config_index=fault_spec.get("topo_config_index", 0),
            seed=fault_spec.get("seed"),
            fault_type=_opt_enum(fault_spec.get("fault_type"), FaultPointType),
            fault_mode=_opt_enum(fault_spec.get("fault_mode"), FaultMode),
            process_name=fault_spec.get("process_name"),
            ue_count=fault_spec.get("ue_count", self.default_ue_count),
            loss_rate=fault_spec.get("loss_rate"),
            difficulty=CaseDifficulty(fault_spec.get("difficulty", "medium")),
        )
        package = self.wrapper.generate(params, case_id=case_id)
        return self._stamp(package)

    def generate_batch(self, count: int, seed: int = 42) -> list[CasePackage]:
        """Generate a batch of free5GC-faithful cases (standard fault mix)."""
        packages = self.wrapper.generate_batch(count, seed=seed)
        return [self._stamp(p) for p in packages]

    @staticmethod
    def _stamp(package: CasePackage) -> CasePackage:
        """Tag a package as free5GC-faithful (source + tag)."""
        package.metadata.source = CaseSource.FREE5GC
        if "free5gc" not in package.metadata.tags:
            package.metadata.tags.append("free5gc")
        return package


def _opt_enum(value, enum_cls):
    """Coerce a string/enum value into the given enum, or None."""
    if value is None:
        return None
    if isinstance(value, enum_cls):
        return value
    return enum_cls(value)
