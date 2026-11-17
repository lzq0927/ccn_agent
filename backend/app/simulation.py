"""Reproducible CHR fixtures. Ground truth is never passed into analysis."""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .config import ROOT

TYPES = ("AMF", "SMF", "AUSF", "UDM", "PCF", "UPF")
COMMON = ["Timestamp", "Inner Cauce", "Procedure", "IMSI", "NF_ID", "RAN_ID",
          "CELL_ID", "REGION_ID", "POD_ID", "TRACE_ID", "PEER_NF_ID"]
AMF_FIELDS = ["Last_AMF_id", "Last_UDM_id", "Last_PCF_id", "Last_SMF_id"]
SMF_FIELDS = ["Serving_AMF_ID", "Serving_UDM_ID", "Serving PCF ID"]
PROCEDURES = {"AMF": ["InitialRegistration", "PduSessionEstablishment", "ServiceRequest"],
              "SMF": ["PduSessionEstablishment", "ServiceRequest"],
              "AUSF": ["InitialRegistration"], "UDM": ["InitialRegistration", "PduSessionEstablishment"],
              "PCF": ["PduSessionEstablishment"], "UPF": ["PduSessionEstablishment", "ServiceRequest"]}
CAUSES = {"AMF": ["5GMM:22", "5GMM:7", "5GMM:90"], "SMF": ["5GSM:27", "5GSM:29", "5GSM:26"],
          "AUSF": ["SIM_AUTH_REJECT"], "UDM": ["SIM_SUBSCRIPTION_NOT_FOUND"],
          "PCF": ["SIM_POLICY_REJECT"], "UPF": ["SIM_PFCP_TIMEOUT"]}


def generate(seed: int = 42, scenario: str = "packet_loss", fault_instance: str = "SMF:smf_2"):
    if scenario not in {"packet_loss", "normal", "transient"}:
        raise ValueError("Unknown scenario")
    if fault_instance not in {"SMF:smf_1", "SMF:smf_2"}:
        raise ValueError("Fault instance must be a simulated SMF")
    rng, fault_rng = np.random.default_rng(seed), np.random.default_rng(seed + 10001)
    start = datetime(2026, 11, 16, 9, 0, tzinfo=timezone.utc)
    rows: list[dict] = []
    serial = 0

    def record(random, minute, nf, procedure, cause, user=None, pod=None, trace=None, sec=None, peer=""):
        nonlocal serial
        serial += 1
        user = int(random.integers(1, 601)) if user is None else user
        ran = user % 24 + 1
        amf = f"AMF:amf_{1 + user % 2}"
        udm = f"UDM:udm_{1 + user % 2}"
        pcf = f"PCF:pcf_{1 + (user // 2) % 2}"
        timestamp = start + timedelta(minutes=minute, seconds=int(random.integers(0, 60)) if sec is None else sec)
        row = {"Timestamp": timestamp.isoformat(timespec="seconds"), "Inner Cauce": cause,
               "Procedure": procedure, "IMSI": f"00101{user:010d}", "NF_ID": nf,
               "RAN_ID": f"ran_{ran:02}", "CELL_ID": f"cell_{ran:02}_{user % 3 + 1}",
               "REGION_ID": f"region_{(ran - 1) // 6 + 1}",
               "POD_ID": pod or f"{nf.split(':')[1]}-pod-{int(random.integers(1, 3))}",
               "TRACE_ID": trace or f"trace-{seed}-{serial:07}", "PEER_NF_ID": peer}
        if nf.startswith("AMF:"):
            row.update(dict.fromkeys(AMF_FIELDS, ""))
            if procedure == "InitialRegistration":
                row["Last_UDM_id"] = udm
            elif procedure == "PduSessionEstablishment":
                row.update(Last_AMF_id=nf, Last_UDM_id=udm, Last_PCF_id=pcf,
                           Last_SMF_id=f"SMF:smf_{1 + (user // 3) % 2}")
        if nf.startswith("SMF:"):
            row.update({"Serving_AMF_ID": amf, "Serving_UDM_ID": udm, "Serving PCF ID": pcf})
        return row

    for minute in range(40):
        for kind in TYPES:
            for instance in (1, 2):
                nf = f"{kind}:{kind.lower()}_{instance}"
                for procedure in PROCEDURES[kind]:
                    # Stable, even high-volume, subscription/configuration noise is normal.
                    n = int(rng.poisson(20 if nf == "SMF:smf_1" and procedure == "PduSessionEstablishment" else 3.5))
                    for _ in range(n):
                        cause = str(rng.choice(CAUSES[kind], p=[.72, .18, .10] if len(CAUSES[kind]) == 3 else None))
                        rows.append(record(rng, minute, nf, procedure, cause))
        # Low-rate transport errors are present before the experiment as realistic background.
        for instance in (1, 2):
            for _ in range(int(rng.poisson(2))):
                rows.append(record(rng, minute, f"SMF:smf_{instance}", "PduSessionEstablishment",
                                   "SIM_SBI_TIMEOUT", peer=str(rng.choice(["UDM:udm_1", "PCF:pcf_1", "PCF:pcf_2", "UDM:udm_2"]))))
        active = (scenario == "packet_loss" and minute >= 20) or (scenario == "transient" and minute in (20, 21))
        if active:
            for j in range(int(fault_rng.poisson(85))):
                user = int(fault_rng.integers(1, 601))
                procedure = str(fault_rng.choice(["PduSessionEstablishment", "ServiceRequest"], p=[.68, .32]))
                cause = str(fault_rng.choice(["SIM_SBI_TIMEOUT", "SIM_TRANSPORT_RETRANS_EXHAUSTED"], p=[.64, .36]))
                peer = str(fault_rng.choice(["UDM:udm_1", "PCF:pcf_1"]))
                sec = int(fault_rng.integers(0, 56))
                trace = f"flow-{seed}-{minute}-{j}"
                row = record(fault_rng, minute, fault_instance, procedure, cause, user,
                             f"{fault_instance.split(':')[1]}-pod-1", trace, sec, peer)
                # The invoked backend instance is measured context, not a fault label.
                row["Serving_UDM_ID" if peer.startswith("UDM:") else "Serving PCF ID"] = peer
                rows.append(row)
                if fault_rng.random() < .86:
                    upstream = record(fault_rng, minute, row["Serving_AMF_ID"], procedure,
                                      "SIM_AMF_UPSTREAM_FAILURE", user, trace=trace, sec=sec + 2)
                    if procedure == "PduSessionEstablishment":
                        upstream.update(Last_SMF_id=fault_instance, Last_UDM_id=row["Serving_UDM_ID"],
                                        Last_PCF_id=row["Serving PCF ID"])
                    rows.append(upstream)
    rows.sort(key=lambda r: (r["Timestamp"], r["TRACE_ID"], r["NF_ID"]))
    truth = {"synthetic": True, "seed": seed, "scenario": scenario, "duration_minutes": 40,
             "start": start.isoformat(), "injection_offset_minutes": 20 if scenario != "normal" else None,
             "fault_instance": fault_instance if scenario != "normal" else None,
             "note": "Experiment annotation only. Inference must not read this file."}
    return rows, truth


def write_dataset(directory: Path, rows: list[dict]):
    directory.mkdir(parents=True, exist_ok=True)
    for kind in TYPES:
        fields = COMMON + (AMF_FIELDS if kind == "AMF" else SMF_FIELDS if kind == "SMF" else [])
        # The requested data/data.csv is the SMF file. Other types have their own file.
        filename = "data.csv" if kind == "SMF" else f"{kind.lower()}.csv"
        with (directory / filename).open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fields)
            writer.writeheader()
            writer.writerows(r for r in rows if r["NF_ID"].startswith(kind + ":"))


def write_topology(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, ["source", "target"])
        writer.writeheader()
        for i, source in enumerate(TYPES):
            for target in TYPES[i + 1:]:
                for a in (1, 2):
                    for b in (1, 2):
                        writer.writerow({"source": f"{source}:{source.lower()}_{a}",
                                         "target": f"{target}:{target.lower()}_{b}"})


def main():
    parser = argparse.ArgumentParser(description="Generate a 40-minute CHR experiment")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--scenario", choices=["packet_loss", "normal", "transient"], default="packet_loss")
    parser.add_argument("--fault-instance", default="SMF:smf_2")
    parser.add_argument("--output", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    rows, truth = generate(args.seed, args.scenario, args.fault_instance)
    write_dataset(args.output, rows)
    (args.output / "experiment.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    if not (ROOT / "topo/topo.csv").exists():
        write_topology(ROOT / "topo/topo.csv")
    print(f"Generated {len(rows)} CHRs across 6 files at {args.output}")


if __name__ == "__main__":
    main()
