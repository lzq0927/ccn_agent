import os
import json
from .models import FaultPointType


class DataExporter:
    def __init__(self, base_dir="data"):
        self.base_dir = base_dir

    def export(self, scenario, result):
        case_dir = os.path.join(self.base_dir, f"case_{scenario.case_id:03d}")
        os.makedirs(case_dir, exist_ok=True)

        self._write_data_csv(case_dir, result)
        self._write_topo_txt(case_dir, scenario)
        self._write_process_txt(case_dir, result)
        self._write_result_txt(case_dir, scenario, result)

    def _write_data_csv(self, case_dir, result):
        path = os.path.join(case_dir, "data.csv")
        with open(path, "w", encoding="utf-8") as f:
            f.write("timestamp,level,ue_id,src,dst,success_rate\n")
            for rec in result.kpi_records:
                f.write(f"{rec.timestamp},{rec.level},{rec.ue_id},"
                        f"{rec.src},{rec.dst},{rec.success_rate}\n")

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
        """Write business process template with NE types and 3GPP messages.

        format:
        Process: <name>
        Description: <desc>

        Flow:
          1. <src_type> -> <dst_type>: <message_name>
          2. <src_type> -> <dst_type>: <message_name>
          ...

        Required NE types: <type>, <type>, ...
        UE count: <N>
        """
        from .process import PROCESS_DEFINITIONS

        path = os.path.join(case_dir, "process.txt")

        lines = []
        if result.flows:
            proc_name = result.flows[0].process_name
            proc_def = PROCESS_DEFINITIONS[proc_name]
            lines.append(f"Process: {proc_name}")
            lines.append(f"Description: {proc_def['description']}")
            lines.append("")
            lines.append("Flow:")

            for i, hop in enumerate(proc_def["hops"], 1):
                src_type, dst_type, msg_name = hop
                lines.append(f"  {i}. {src_type} -> {dst_type}: {msg_name}")

            lines.append("")
            # Required NE types
            lines.append(f"Required NE types: {', '.join(proc_def['required_types'])}")
            lines.append("")
            # UE count
            lines.append(f"UE count: {len(result.flows)}")

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

    def _write_result_txt(self, case_dir, scenario, result):
        """Write expected fault result.

        format:
        {
          "fault_elements": [...],   # NE故障时填写具体网元ID列表
          "fault_links": [...]       # 链路故障时填写具体链路列表
        }
        两个字段互斥，只填一个，另一字段为空列表。
        """
        path = os.path.join(case_dir, "result.txt")
        fc = scenario.fault_config

        fault_elements = []
        fault_links = []

        if fc and not scenario.is_normal:
            fpt = fc.fault_point_type

            # NE-based faults → fault_elements
            if fpt in (FaultPointType.SINGLE_NE, FaultPointType.MULTI_NE,
                       FaultPointType.ALL_TYPE_NE, FaultPointType.MULTI_TYPE_NE,
                       FaultPointType.RESOURCE_POOL, FaultPointType.DC):
                fault_elements = sorted(fc.affected_ne_ids)
            # PATH_SESSION: affected sessions → fault_elements (session identifiers)
            elif fpt == FaultPointType.PATH_SESSION:
                fault_elements = sorted(fc.affected_sessions)
            # PATH_TRACE: affected links → fault_links (format: "{s}->{d}")
            elif fpt == FaultPointType.PATH_TRACE:
                fault_links = sorted([f"{s}->{d}" for s, d in fc.affected_links])
            # Link/switch faults → fault_links (format: "{s}->{d}")
            elif fpt in (FaultPointType.PATH_LINK, FaultPointType.SWITCH):
                fault_links = sorted([f"{s}->{d}" for s, d in fc.affected_links])

        data = {
            "fault_type": fc.fault_point_type.value if fc and not scenario.is_normal else None,
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
