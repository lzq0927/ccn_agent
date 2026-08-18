"""Correlated-failure graph detector (CHR-driven).

Builds a co-occurrence graph over network elements from CHR failures: two NEs
are linked when they appear together in failed signaling hops. The graph's
structure fingerprints the fault class — a star (one high-degree hub) suggests
a single-NE fault; a dense interconnected cluster suggests a resource-pool / DC
fault; several small scattered components suggest multi-NE faults.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict

from tools.exploration._series import connected_components, gini
from tools.registry import register


@register(
    name="correlated_failure_graph",
    description=(
        "Build a NE co-occurrence graph from CHR failures and analyse its "
        "structure (connected components, degree concentration). Returns the "
        "largest failure cluster and a topology-signature pattern "
        "(single_ne/star vs cluster/resource_pool vs scattered/multi_ne)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "chr_records": {
                "type": "array",
                "description": "CHR records",
                "items": {"type": "object"},
            },
            "top_k": {"type": "integer", "description": "Max NEs to return", "default": 15},
        },
        "required": ["chr_records"],
    },
)
async def correlated_failure_graph(chr_records: list[dict], top_k: int = 15) -> str:
    fails = [r for r in chr_records if r.get("outcome") == "failure"]

    adjacency: dict[str, set] = defaultdict(set)
    degree: Counter = Counter()
    edge_weight: Counter = Counter()
    nodes: set[str] = set()

    for r in fails:
        pair = [str(r.get("nf_src", "")), str(r.get("nf_dst", ""))]
        pair = [n for n in pair if n and not n.startswith("UE")]
        if not pair:
            continue
        nodes.update(pair)
        for a in pair:
            degree[a] += 1
        for i in range(len(pair)):
            for j in range(i + 1, len(pair)):
                a, b = pair[i], pair[j]
                adjacency[a].add(b)
                adjacency[b].add(a)
                edge_weight[tuple(sorted((a, b)))] += 1

    if not nodes:
        return json.dumps(
            {
                "algorithm": "correlated_failure_graph",
                "nodes": 0,
                "edges": 0,
                "components": [],
                "largest_component": [],
                "pattern": "none",
                "evidence_elements": [],
                "confidence": 0.0,
            }
        )

    components = connected_components(nodes, adjacency)
    components.sort(key=len, reverse=True)
    largest = components[0]

    total_degree = sum(degree.values()) or 1
    hub_ne, hub_deg = degree.most_common(1)[0]
    hub_share = hub_deg / total_degree
    degree_gini = gini(list(degree.values()))

    # Topology signature.
    if hub_share > 0.4:
        pattern = "single_ne"  # one hub dominates → star
    elif len(largest) >= 4 and degree_gini < 0.4:
        pattern = "cluster"  # dense, multi-hub → resource_pool / dc
    elif len(components) > 2:
        pattern = "scattered"  # many small components → multi_ne
    else:
        pattern = "concentrated"

    # evidence:hub 显著(星型)时以 hub 为主(噪声组件混入 largest 会稀释融合)
    evidence = [hub_ne] if hub_share >= 0.4 else largest[:top_k]
    confidence = round(min(max(hub_share, degree_gini), 1.0), 4)

    return json.dumps(
        {
            "algorithm": "correlated_failure_graph",
            "nodes": len(nodes),
            "edges": len(edge_weight),
            "components": [len(c) for c in components],
            "num_components": len(components),
            "largest_component_size": len(largest),
            "largest_component": largest[:top_k],
            "hub_ne": hub_ne,
            "hub_degree_share": round(hub_share, 4),
            "degree_gini": round(degree_gini, 4),
            "top_edges": [
                {"edge": f"{a}-{b}", "weight": w} for (a, b), w in edge_weight.most_common(top_k)
            ],
            "pattern": pattern,
            "evidence_elements": evidence,
            "confidence": confidence,
        },
        ensure_ascii=False,
        indent=2,
    )
