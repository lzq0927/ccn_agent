"""Versioned local knowledge base and explicit knowledge-model relationships."""

import json
from dataclasses import asdict
from importlib.resources import files

from agents.simulation.demo_topology import build_demo_topology
from agents.simulation.live_scenarios import SCENARIOS
from reliability import MODULE_ID, VERSION


def knowledge(query: str = "") -> dict:
    data = json.loads(files("reliability").joinpath("knowledge/catalog.json").read_text())
    if query.strip():
        words = query.casefold().split()
        data["entities"] = [
            node for node in data["entities"]
            if all(word in json.dumps(node, ensure_ascii=False).casefold() for word in words)
        ]
        ids = {node["id"] for node in data["entities"]}
        data["relations"] = [
            edge for edge in data["relations"]
            if edge["source"] in ids or edge["target"] in ids
        ]
    return data


def boundaries() -> str:
    return files("reliability").joinpath("knowledge/boundaries.md").read_text()


def capabilities() -> dict:
    return {
        "module_id": MODULE_ID, "version": VERSION,
        "placement": ["ReMAP", "AI 系统", "可靠性机制设计与仿真"],
        "agent": {"runtime": "opencode", "name": "remap-ai-reliability"},
        "skills": ["ai-system-modeling", "reliability-mechanism-design", "reliability-verification"],
        "transport": "mcp-stdio", "api_prefix": "/api/v1/reliability",
        "simulators": [{"id": "5gc-des", "status": "implemented", "scenarios": list(SCENARIOS)}],
        "knowledge_version": knowledge()["version"],
        "limits": boundaries(),
    }


def scenarios() -> list[dict]:
    return [
        {"id": s.id, "name": s.label_cn, "description": s.short_intro,
         "domain": "5gc-service-assurance", "evidence_level": "synthetic",
         "fault_id": "fault:traffic-surge" if s.fault_config.surge_multiplier > 1 else "fault:ne-loss"}
        for s in SCENARIOS.values()
    ]


def topology() -> list[dict]:
    return [asdict(ne) for ne in build_demo_topology().elements.values()]
