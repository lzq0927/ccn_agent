"""Business flow tracing tools for fault diagnosis."""

from __future__ import annotations

import json
from collections import defaultdict

from tools.registry import register


@register(
    name="parse_ue_flows",
    description="Parse process text to extract per-UE routing flows. Returns flow details for each UE.",
    parameters={
        "type": "object",
        "properties": {
            "process_text": {
                "type": "string",
                "description": "Process text content (process.txt format)",
            },
        },
        "required": ["process_text"],
    },
)
async def parse_ue_flows(process_text: str) -> str:
    lines = process_text.strip().split("\n")
    process_name = ""
    flow_template = ""
    ue_flows: dict[str, list[str]] = {}

    for line in lines:
        line = line.strip()
        if line.startswith("Process:"):
            process_name = line.split(":", 1)[1].strip()
        elif line.startswith("Flow:"):
            flow_template = line.split(":", 1)[1].strip()
        elif "->" in line and ":" in line:
            # UE routing line: "UE_1: UE_1->gNB_2 -> gNB_2->AMF_3 -> ..."
            parts = line.split(":", 1)
            if len(parts) == 2:
                ue_id = parts[0].strip()
                hops = [h.strip() for h in parts[1].strip().split("->")]
                ue_flows[ue_id] = hops

    # Extract NE IDs used in flows
    all_ne_ids: set[str] = set()
    for hops in ue_flows.values():
        for hop in hops:
            all_ne_ids.update(hop.split("->"))

    result = {
        "process_name": process_name,
        "flow_template": flow_template,
        "ue_count": len(ue_flows),
        "all_ne_ids": sorted(all_ne_ids),
        "flows": ue_flows,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


@register(
    name="trace_ue_impact",
    description="Check which UEs are impacted by a specific NE. Returns UEs whose flows pass through the given NE.",
    parameters={
        "type": "object",
        "properties": {
            "process_text": {
                "type": "string",
                "description": "Process text content",
            },
            "ne_id": {
                "type": "string",
                "description": "Network element ID to check impact for",
            },
        },
        "required": ["process_text", "ne_id"],
    },
)
async def trace_ue_impact(process_text: str, ne_id: str) -> str:
    flows_result = await parse_ue_flows(process_text)
    flows_data = json.loads(flows_result)

    impacted_ues = []
    unimpacted_ues = []

    for ue_id, hops in flows_data["flows"].items():
        # Check if any hop involves the target NE
        involved = any(ne_id in hop for hop in hops)
        if involved:
            impacted_ues.append(ue_id)
        else:
            unimpacted_ues.append(ue_id)

    result = {
        "ne_id": ne_id,
        "total_ues": len(flows_data["flows"]),
        "impacted_count": len(impacted_ues),
        "unimpacted_count": len(unimpacted_ues),
        "impact_ratio": round(len(impacted_ues) / max(len(flows_data["flows"]), 1), 4),
        "impacted_ues": impacted_ues,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


@register(
    name="find_ue_ne_mapping",
    description="Find which NEs each UE's flow passes through. Returns a mapping of UE to NE set.",
    parameters={
        "type": "object",
        "properties": {
            "process_text": {
                "type": "string",
                "description": "Process text content",
            },
        },
        "required": ["process_text"],
    },
)
async def find_ue_ne_mapping(process_text: str) -> str:
    flows_result = await parse_ue_flows(process_text)
    flows_data = json.loads(flows_result)

    ue_to_nes: dict[str, list[str]] = {}
    ne_to_ues: dict[str, list[str]] = defaultdict(list)

    for ue_id, hops in flows_data["flows"].items():
        nes: set[str] = set()
        for hop in hops:
            parts = hop.split("->")
            for p in parts:
                p = p.strip()
                if p and not p.startswith("UE_"):
                    nes.add(p)
        ue_to_nes[ue_id] = sorted(nes)
        for ne in nes:
            ne_to_ues[ne].append(ue_id)

    result = {
        "ue_count": len(ue_to_nes),
        "ue_to_nes": ue_to_nes,
        "ne_to_ues": {k: v for k, v in sorted(ne_to_ues.items())},
    }
    return json.dumps(result, ensure_ascii=False, indent=2)
