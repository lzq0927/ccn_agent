"""Wrapper around the existing simulator to produce CasePackage objects."""

from __future__ import annotations

import io
import json
import logging
from dataclasses import asdict

from simulator.models import FaultPointType, FaultMode, Scenario
from simulator.topology import TopologyGenerator
from simulator.scenario import ScenarioGenerator
from simulator.engine import SimulationEngine

from agents.shared.models import CasePackage, CaseMetadata, CaseParams, CaseSource, CaseDifficulty, ValidationStatus

logger = logging.getLogger(__name__)


class SimulatorWrapper:
    """Wraps the existing simulator pipeline to generate in-memory CasePackage objects."""

    def __init__(self):
        self.topo_gen = TopologyGenerator()
        self.engine = SimulationEngine()
        self._topologies: dict[int, object] = {}

    def _get_topology(self, config_index: int, seed: int = 100):
        key = (config_index, seed)
        if key not in self._topologies:
            self._topologies[key] = self.topo_gen.generate(config_index, seed=seed)
        return self._topologies[key]

    def generate(self, params: CaseParams, case_id: int = 0) -> CasePackage:
        """Run the simulator pipeline for a single case and return a CasePackage."""
        seed = params.seed if params.seed is not None else case_id * 1000 + 42

        # Generate or reuse topology
        topology = self._get_topology(params.topo_config_index, seed=100 + params.topo_config_index)

        # Build fault config if specified
        fault_config = None
        is_normal = True
        if params.fault_type and params.fault_type != FaultPointType.NORMAL:
            is_normal = False
            fault_config = self._build_fault_config(
                params.fault_type, params.fault_mode or FaultMode.LINK,
                topology, seed, params.loss_rate,
            )

        # Build scenario
        process_name = params.process_name or "PDU_Session_Establishment"
        ue_count = params.ue_count or 50
        scenario = Scenario(
            case_id=case_id,
            topology=topology,
            process_name=process_name,
            ue_count=ue_count,
            fault_config=fault_config,
            is_normal=is_normal,
            is_train=(case_id % 10 < 4),
        )

        # Run simulation
        result = self.engine.simulate(scenario)

        # Export to in-memory strings
        kpi_csv = self._export_kpi_csv(result.kpi_records)
        topo_text = self._export_topo(scenario)
        process_text = self._export_process(scenario, result)
        result_text = self._export_result(scenario)
        chr_jsonl = self._export_chr_jsonl(result)

        # Build metadata
        fc = scenario.fault_config
        metadata = CaseMetadata(
            case_id=case_id,
            source=CaseSource.SIMULATOR,
            difficulty=params.difficulty,
            fault_type=fc.fault_point_type.value if fc else "normal",
            fault_mode=fc.fault_mode.value if fc else None,
            topo_config_index=params.topo_config_index,
            seed=seed,
            ue_count=ue_count,
            loss_rate=fc.loss_rate if fc else 0.0,
            fault_start=fc.fault_start if fc else 0,
            fault_duration=fc.fault_duration if fc else 0,
            tags=self._build_tags(scenario),
            validation_status=ValidationStatus.PENDING,
        )

        return CasePackage(
            case_id=case_id,
            kpi_data=kpi_csv,
            topology_text=topo_text,
            process_text=process_text,
            result_text=result_text,
            metadata=metadata,
            chr_data=chr_jsonl,
        )

    def generate_batch(self, count: int, seed: int = 42) -> list[CasePackage]:
        """Generate a batch of standard cases (mix of fault types and normal)."""
        # Use the existing ScenarioGenerator for standard distribution
        topologies = {i: self.topo_gen.generate(i, seed=100 + i) for i in range(5)}
        scenario_gen = ScenarioGenerator(topologies)
        scenarios = scenario_gen.generate(num_cases=count, seed=seed)

        packages = []
        for scenario in scenarios:
            result = self.engine.simulate(scenario)

            kpi_csv = self._export_kpi_csv(result.kpi_records)
            topo_text = self._export_topo(scenario)
            process_text = self._export_process(scenario, result)
            result_text = self._export_result(scenario)
            chr_jsonl = self._export_chr_jsonl(result)

            fc = scenario.fault_config
            metadata = CaseMetadata(
                case_id=scenario.case_id,
                source=CaseSource.SIMULATOR,
                difficulty=CaseDifficulty.MEDIUM,
                fault_type=fc.fault_point_type.value if fc else "normal",
                fault_mode=fc.fault_mode.value if fc else None,
                topo_config_index=0,
                seed=seed,
                ue_count=scenario.ue_count,
                loss_rate=fc.loss_rate if fc else 0.0,
                fault_start=fc.fault_start if fc else 0,
                fault_duration=fc.fault_duration if fc else 0,
                tags=self._build_tags(scenario),
            )

            packages.append(CasePackage(
                case_id=scenario.case_id,
                kpi_data=kpi_csv,
                topology_text=topo_text,
                process_text=process_text,
                result_text=result_text,
                metadata=metadata,
                chr_data=chr_jsonl,
            ))

        return packages

    def _build_fault_config(self, fault_type: FaultPointType, fault_mode: FaultMode,
                            topology, seed: int, loss_rate: float | None = None):
        """Build a FaultConfig for a specific fault type."""
        # Delegate to the scenario generator's internal builder.
        gen = ScenarioGenerator({0: topology})
        return gen._build_fault_config(fault_type, fault_mode, topology)

    def _export_kpi_csv(self, kpi_records) -> str:
        buf = io.StringIO()
        buf.write("timestamp,level,ue_id,src,dst,success_rate\n")
        for rec in kpi_records:
            buf.write(f"{rec.timestamp},{rec.level},{rec.ue_id},{rec.src},{rec.dst},{rec.success_rate:.4f}\n")
        return buf.getvalue()

    def _export_chr_jsonl(self, result) -> str:
        """Serialize free5GC-faithful CHR records to a JSONL string."""
        buf = io.StringIO()
        for rec in result.chr_records:
            buf.write(json.dumps(asdict(rec), ensure_ascii=False) + "\n")
        return buf.getvalue()

    def _export_topo(self, scenario: Scenario) -> str:
        lines = []
        for dc in scenario.topology.dcs:
            lines.append(f"DC: {dc.id}")
            for pool in dc.pools:
                lines.append(f"  ResourcePool: {pool.id}")
                for ne in pool.elements:
                    role_str = f"({ne.role})" if ne.role != "lb" else ""
                    lines.append(f"    {ne.ne_type.value}: {ne.id}{role_str}")
        return "\n".join(lines)

    def _export_process(self, scenario: Scenario, result) -> str:
        lines = []
        lines.append(f"Process: {scenario.process_name}")

        # Process flow template
        process_defs = {
            "PDU_Session_Establishment": "UE -> gNB -> AMF -> SMF -> UDM -> SMF -> PCF -> SMF -> UPF -> SMF -> AMF -> gNB -> UE",
            "Registration": "UE -> gNB -> AMF -> AUSF -> UDM -> AUSF -> AMF -> gNB -> UE",
            "Handover": "UE -> gNB_src -> AMF -> SMF -> UPF -> SMF -> AMF -> gNB_tgt -> UE",
            "PDU_Session_Release": "UE -> gNB -> AMF -> SMF -> UPF -> SMF -> PCF -> SMF -> AMF -> gNB -> UE",
            "Service_Request": "UE -> gNB -> AMF -> SMF -> UPF -> SMF -> AMF -> gNB -> UE",
        }
        if scenario.process_name in process_defs:
            lines.append(f"Flow: {process_defs[scenario.process_name]}")

        lines.append(f"UE count: {scenario.ue_count}")
        lines.append("# Per-UE routing (simulation resolved):")

        for flow in result.flows:
            hop_str = " -> ".join(f"{s}->{d}" for s, d in flow.hops)
            lines.append(f"{flow.ue_id}: {hop_str}")

        return "\n".join(lines)

    def _export_result(self, scenario: Scenario) -> str:
        fc = scenario.fault_config
        if fc is None:
            return json.dumps({"fault_elements": [], "fault_links": []}, indent=2)

        result = {
            "fault_elements": sorted(list(fc.affected_ne_ids)),
            "fault_links": [f"{s}->{d}" for s, d in fc.affected_links],
        }
        return json.dumps(result, indent=2)

    def _build_tags(self, scenario: Scenario) -> list[str]:
        tags = []
        if scenario.is_normal:
            tags.append("normal")
            return tags
        fc = scenario.fault_config
        if fc:
            tags.append(fc.fault_point_type.value)
            tags.append(fc.fault_mode.value + "_mode")
            # Add NE type tags
            for ne_id in fc.affected_ne_ids:
                ne = scenario.topology.elements.get(ne_id)
                if ne:
                    tags.append(ne.ne_type.value.lower())
        return list(set(tags))
