"""Topology query tools for fault diagnosis."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from tools.registry import register


@register(
    name="parse_topology",
    description="Parse topology text into structured network element inventory grouped by DC and resource pool.",
    parameters={
        "type": "object",
        "properties": {
            "topology_text": {
                "type": "string",
                "description": "Topology text content (topo.txt format)",
            },
        },
        "required": ["topology_text"],
    },
)
async def parse_topology(topology_text: str) -> str:
    dcs = []
    current_dc = None
    current_pool = None

    for line in topology_text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("DC:"):
            current_dc = {"id": line.split(":", 1)[1].strip(), "pools": []}
            dcs.append(current_dc)
        elif line.startswith("ResourcePool:"):
            current_pool = {"id": line.split(":", 1)[1].strip(), "elements": []}
            if current_dc:
                current_dc["pools"].append(current_pool)
        elif ":" in line and current_pool:
            parts = line.strip().split(":")
            ne_type = parts[0].strip()
            ne_info = parts[1].strip() if len(parts) > 1 else ""
            # Handle multiple NEs on one line (e.g. "UDM: UDM_1(master), UDM_2(standby)")
            for ne_item in ne_info.split(","):
                ne_item = ne_item.strip()
                if ne_item:
                    ne_id = ne_item.split("(")[0].strip()
                    role = "lb"
                    if "(master)" in ne_item:
                        role = "master"
                    elif "(standby)" in ne_item:
                        role = "standby"
                    current_pool["elements"].append({
                        "id": ne_id,
                        "type": ne_type,
                        "role": role,
                        "pool_id": current_pool["id"],
                        "dc_id": current_dc["id"] if current_dc else "",
                    })

    total_nes = sum(len(p["elements"]) for dc in dcs for p in dc["pools"])
    type_counts: dict[str, int] = defaultdict(int)
    for dc in dcs:
        for pool in dc["pools"]:
            for ne in pool["elements"]:
                type_counts[ne["type"]] += 1

    result = {
        "dc_count": len(dcs),
        "total_nes": total_nes,
        "type_counts": dict(type_counts),
        "dcs": dcs,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


@register(
    name="check_ne_membership",
    description="Check which DC, pool, and type a set of NE IDs belong to. Useful for spatial clustering analysis.",
    parameters={
        "type": "object",
        "properties": {
            "topology_text": {
                "type": "string",
                "description": "Topology text content",
            },
            "ne_ids": {
                "type": "array",
                "description": "List of NE IDs to check",
                "items": {"type": "string"},
            },
        },
        "required": ["topology_text", "ne_ids"],
    },
)
async def check_ne_membership(topology_text: str, ne_ids: list[str]) -> str:
    # Parse topology to get NE info
    ne_map: dict[str, dict] = {}
    for line in topology_text.strip().split("\n"):
        line = line.strip()
        if line.startswith("DC:"):
            dc_id = line.split(":", 1)[1].strip()
        elif line.startswith("ResourcePool:"):
            pool_id = line.split(":", 1)[1].strip()
        elif ":" in line:
            parts = line.strip().split(":")
            ne_type = parts[0].strip()
            ne_info = parts[1].strip() if len(parts) > 1 else ""
            for ne_item in ne_info.split(","):
                ne_item = ne_item.strip()
                if ne_item:
                    nid = ne_item.split("(")[0].strip()
                    ne_map[nid] = {"type": ne_type, "pool_id": pool_id, "dc_id": dc_id}

    memberships = []
    dc_set: set[str] = set()
    pool_set: set[str] = set()
    type_set: set[str] = set()

    for nid in ne_ids:
        info = ne_map.get(nid, {"type": "unknown", "pool_id": "unknown", "dc_id": "unknown"})
        memberships.append({"ne_id": nid, **info})
        if info["dc_id"] != "unknown":
            dc_set.add(info["dc_id"])
        pool_set.add(info["pool_id"])
        type_set.add(info["type"])

    clustering = {
        "single_dc": len(dc_set) <= 1,
        "single_pool": len(pool_set) <= 1,
        "single_type": len(type_set) <= 1,
    }

    result = {
        "ne_ids": ne_ids,
        "memberships": memberships,
        "unique_dcs": list(dc_set),
        "unique_pools": list(pool_set),
        "unique_types": list(type_set),
        "clustering": clustering,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


@register(
    name="get_topology_connections",
    description="Derive network connections from KPI link-level data. Returns all unique src-dst NE pairs.",
    parameters={
        "type": "object",
        "properties": {
            "kpi_rows": {
                "type": "array",
                "description": "Array of KPI data rows",
                "items": {"type": "object"},
            },
        },
        "required": ["kpi_rows"],
    },
)
async def get_topology_connections(kpi_rows: list[dict]) -> str:
    pairs: set[str] = set()
    for r in kpi_rows:
        if str(r.get("level", "")) == "link":
            src, dst = str(r.get("src", "")), str(r.get("dst", ""))
            if src and dst:
                pairs.add(f"{src}->{dst}")

    # Build adjacency
    adjacency: dict[str, list[str]] = defaultdict(list)
    for p in pairs:
        src, dst = p.split("->")
        if dst not in adjacency[src]:
            adjacency[src].append(dst)

    result = {
        "total_unique_links": len(pairs),
        "links": sorted(pairs),
        "adjacency": dict(adjacency),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)
