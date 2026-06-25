import os
import json
from dataclasses import asdict
from .models import FaultPointType


class DataExporter:
    def __init__(self, base_dir="data"):
        self.base_dir = base_dir

    def export(self, scenario, result):
        case_dir = os.path.join(self.base_dir, f"case{scenario.case_id}")
        os.makedirs(case_dir, exist_ok=True)

        self._write_data_csv(case_dir, result)
        self._write_topo_txt(case_dir, scenario)
        self._write_process_txt(case_dir, result)
        self._write_result_txt(case_dir, scenario, result)
        self._write_chr_jsonl(case_dir, result)

    def _write_data_csv(self, case_dir, result):
        path = os.path.join(case_dir, "data.csv")
        with open(path, "w", encoding="utf-8") as f:
            f.write("timestamp,level,ue_id,src,dst,success_rate\n")
            for rec in result.kpi_records:
                f.write(
                    f"{rec.timestamp},{rec.level},{rec.ue_id},"
                    f"{rec.src},{rec.dst},{rec.success_rate}\n"
                )

    def _write_chr_jsonl(self, case_dir, result):
        """Write free5GC-faithful CHR records (one JSON object per line)."""
        path = os.path.join(case_dir, "chr.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for rec in result.chr_records:
                f.write(json.dumps(asdict(rec), ensure_ascii=False) + "\n")

    def _write_topo_txt(self, case_dir, scenario):
        path = os.path.join(case_dir, "topo.txt")
        topo = scenario.topology

        lines = []
        for dc in topo.dcs:
            lines.append(f"DC: {dc.id}")
            for pool in dc.pools:
                lines.append(f"  ResourcePool: {pool.id}")
                # Group NEs by type
                by_type = {}
                for ne in pool.elements:
                    t = ne.ne_type.value
                    if t not in by_type:
                        by_type[t] = []
                    by_type[t].append(ne)

                for ne_type in sorted(by_type.keys()):
                    ne_list = by_type[ne_type]
                    names = []
                    for ne in ne_list:
                        suffix = ""
                        if ne.role == "master":
                            suffix = "(master)"
                        elif ne.role == "standby":
                            suffix = "(standby)"
                        names.append(f"{ne.id}{suffix}")
                    lines.append(f"    {ne_type}: {', '.join(names)}")
            lines.append("")

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

    def _write_process_txt(self, case_dir, result):
        """Write business process with 3GPP protocol messages (NE types only, no instance IDs)."""
        from .process import PROCESS_DEFINITIONS

        path = os.path.join(case_dir, "process.txt")

        lines = []
        if result.flows:
            proc_name = result.flows[0].process_name
            proc_def = PROCESS_DEFINITIONS[proc_name]
            lines.append(f"Process: {proc_name}")
            lines.append(f"Description: {proc_def['description']}")
            lines.append("")

            # Message flow: src_type -> dst_type : message
            lines.append("Message Flow:")
            for i, ((src_type, dst_type), msg) in enumerate(
                zip(proc_def["hops"], proc_def["messages"]), 1
            ):
                lines.append(f"  {i}. {src_type} -> {dst_type}: {msg}")
            lines.append("")

            # Required NE types
            lines.append(f"Required NE types: {', '.join(proc_def['required_types'])}")
            lines.append("")

            # UE count
            lines.append(f"UE count: {len(result.flows)}")

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

    def _write_result_txt(self, case_dir, scenario, result):
        path = os.path.join(case_dir, "result.txt")
        fc = scenario.fault_config

        fault_elements = []
        fault_links = []

        if fc and not scenario.is_normal:
            fpt = fc.fault_point_type

            # NE-based faults → fault_elements
            if fpt in (
                FaultPointType.SINGLE_NE,
                FaultPointType.MULTI_NE,
                FaultPointType.ALL_TYPE_NE,
                FaultPointType.MULTI_TYPE_NE,
                FaultPointType.RESOURCE_POOL,
                FaultPointType.DC,
            ):
                fault_elements = sorted(fc.affected_ne_ids)
            elif fpt == FaultPointType.PATH_SESSION:
                # Session faults → fault_links with UE session identifiers
                for ue_id in sorted(fc.affected_sessions):
                    fault_links.append(f"{ue_id}-session")
            elif fpt == FaultPointType.PATH_TRACE:
                # Trace faults → fault_links with trace identifiers
                for s, d in fc.affected_links:
                    for ue_id in sorted(fc.affected_sessions):
                        fault_links.append(f"{ue_id}:{s}-{d}")
            else:
                # Link/switch faults → fault_links
                fault_links = sorted([f"{s}-{d}" for s, d in fc.affected_links])

        data = {
            "fault_elements": fault_elements,
            "fault_links": fault_links,
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def write_split_info(self, scenarios):
        """Write train/test split information."""
        path = os.path.join(self.base_dir, "split_info.json")
        train_cases = [s.case_id for s in scenarios if s.is_train]
        test_cases = [s.case_id for s in scenarios if not s.is_train]
        normal_cases = [s.case_id for s in scenarios if s.is_normal]

        data = {
            "train": train_cases,
            "test": test_cases,
            "normal": normal_cases,
            "total": len(scenarios),
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
