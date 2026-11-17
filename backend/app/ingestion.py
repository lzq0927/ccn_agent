from __future__ import annotations

import csv
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path


ALIASES = {
    "timestamp": ["Timestamp", "时间戳", "timestamp", "time"],
    "cause": ["Inner Cauce", "Inner Cause", "inner_cause", "原因码", "cause"],
    "procedure": ["Procedure", "流程标记", "流程", "procedure"],
    "imsi": ["IMSI", "用户ID", "用户标识", "imsi"],
    "nf": ["NF_ID", "网元实例", "网元ID", "nf"],
    "ran": ["RAN_ID", "基站ID", "ran"], "cell": ["CELL_ID", "小区ID", "cell"],
    "region": ["REGION_ID", "区域", "region"], "pod": ["POD_ID", "pod"],
    "trace": ["TRACE_ID", "trace_id", "trace"], "peer": ["PEER_NF_ID", "peer"],
}
REQUIRED = {"timestamp", "cause", "procedure", "imsi", "nf", "ran", "pod"}
PROCEDURE_ALIASES = {"PDU会话建立": "PduSessionEstablishment", "PDU会话建立流程": "PduSessionEstablishment",
                     "AMF初始注册": "InitialRegistration", "初始注册": "InitialRegistration",
                     "ServiceRequest": "ServiceRequest"}


@dataclass(frozen=True)
class Record:
    timestamp: datetime
    cause: str
    procedure: str
    imsi: str
    nf: str
    ran: str
    cell: str
    region: str
    pod: str
    trace: str
    peer: str
    paths: dict[str, str]
    source: str

    @property
    def key(self):
        return (self.nf, self.procedure, self.cause)


def normalize_nf(value: str, kind: str | None = None):
    value = value.strip()
    if not value:
        return ""
    if ":" in value:
        prefix, instance = value.split(":", 1)
        return f"{prefix.upper()}:{instance.lower()}"
    prefix = kind or value.split("_")[0].upper()
    return f"{prefix}:{value.lower()}"


def normalize_rows(rows: list[dict], source="simulation"):
    normalized, seen = [], set()
    quality = {"input_rows": len(rows), "valid_rows": 0, "duplicates": 0, "invalid_rows": 0,
               "missing_optional": {"cell": 0, "region": 0, "trace": 0, "peer": 0}, "issues": []}
    for number, row in enumerate(rows, 2):
        values = {field: next((str(row[a]).strip() for a in aliases if a in row and row[a] is not None), "")
                  for field, aliases in ALIASES.items()}
        try:
            missing = sorted(field for field in REQUIRED if not values[field])
            if missing:
                raise ValueError("Missing required fields: " + ", ".join(missing))
            ts = datetime.fromisoformat(values["timestamp"].replace("Z", "+00:00"))
            ts = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)
            if not re.fullmatch(r"\d{5,16}", values["imsi"]):
                raise ValueError("IMSI must remain a digit string (5–16 digits)")
            values["timestamp"] = ts
            values["procedure"] = PROCEDURE_ALIASES.get(values["procedure"], values["procedure"])
            values["nf"] = normalize_nf(values["nf"])
            if not re.fullmatch(r"[A-Z0-9]+:[\w.-]+", values["nf"]):
                raise ValueError("Invalid NF identifier")
            values["peer"] = normalize_nf(values["peer"]) if values["peer"] else ""
            paths = {}
            # Extendable to Last_AUSF_id, Serving_UPF_ID, etc. No three-column limit.
            for key, value in row.items():
                compact = key.replace(" ", "_").lower()
                match = re.fullmatch(r"(?:last|serving)_([a-z0-9]+)_id", compact)
                if match and value:
                    kind = match.group(1).upper()
                    paths[kind] = normalize_nf(str(value), kind)
            signature = tuple(str(values[k]) for k in sorted(values)) + tuple(sorted(paths.items()))
            if signature in seen:
                quality["duplicates"] += 1
                continue
            seen.add(signature)
            for field in quality["missing_optional"]:
                quality["missing_optional"][field] += not bool(values[field])
            normalized.append(Record(**values, paths=paths, source=source))
        except (ValueError, TypeError) as exc:
            quality["invalid_rows"] += 1
            if len(quality["issues"]) < 20:
                quality["issues"].append({"source": source, "line": number, "error": str(exc)})
    normalized.sort(key=lambda r: r.timestamp)
    quality["valid_rows"] = len(normalized)
    return normalized, quality


def load_data(directory: Path):
    records, qualities, global_seen = [], [], set()
    files = sorted(directory.glob("*.csv"))
    if not files:
        raise ValueError(f"No CHR CSV files in {directory}; run the simulation command first")
    for path in files:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            columns = reader.fieldnames or []
            missing = [k for k in REQUIRED if not any(a in columns for a in ALIASES[k])]
            if missing:
                raise ValueError(f"{path.name}: missing columns {missing}")
            rows = list(reader)
        normalized, quality = normalize_rows(rows, path.name)
        for record in normalized:
            signature = tuple(str(getattr(record, field)) for field in ALIASES) + tuple(sorted(record.paths.items()))
            if signature in global_seen:
                quality["duplicates"] += 1
                quality["valid_rows"] -= 1
                for field in quality["missing_optional"]:
                    quality["missing_optional"][field] -= not bool(getattr(record, field))
            else:
                global_seen.add(signature)
                records.append(record)
        qualities.append({"file": path.name, **quality})
    records.sort(key=lambda r: r.timestamp)
    if not records:
        raise ValueError("CSV contains no valid CHR records (possibly headers only)")
    quality = {key: sum(q[key] for q in qualities) for key in ("input_rows", "valid_rows", "duplicates", "invalid_rows")}
    quality["files"] = qualities
    quality["missing_optional"] = {k: sum(q["missing_optional"][k] for q in qualities) for k in ("cell", "region", "trace", "peer")}
    quality["issues"] = [issue for q in qualities for issue in q["issues"]][:20]
    return records, quality


def load_topology(path: Path):
    edges, nodes, seen = [], set(), set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"source", "target"}.issubset(reader.fieldnames or []):
            raise ValueError("Topology requires source and target columns")
        for row in reader:
            source, target = normalize_nf(row["source"]), normalize_nf(row["target"])
            if not source or not target or source == target:
                continue
            pair = tuple(sorted((source, target)))
            if pair in seen:
                continue
            seen.add(pair)
            nodes.update(pair)
            edges.append({"source": source, "target": target})
    if not nodes:
        raise ValueError("Topology has no valid connections")
    return {"nodes": [{"id": nf, "type": nf.split(":")[0], "label": nf.split(":")[1]} for nf in sorted(nodes)], "edges": edges}
