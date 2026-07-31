"""与 frontend-flow-demo 的 COMMON_TOPO 对齐的演示拓扑(单 DC,21 NE)。

这是后端仿真的单点真相:实例 ID 必须与
``frontend-flow-demo/src/data/constructed.ts::COMMON_TOPO`` 完全一致,
否则场景故障规格里的 ``affected_ne_ids``(如 UPF_1)对不上。

拓扑文本(与前端逐字对齐)::

    DC: DC1
      ResourcePool: RP_DC1_1
        gNB: gNB_3
        AMF: AMF_3
        SMF: SMF_1
        UPF: UPF_1
        UPF: UPF_2
        PCF: PCF_2
        UDM: UDM_1(master)
        AUSF: AUSF_2(standby)
        NSSF: NSSF_2
      ResourcePool: RP_DC1_2
        gNB: gNB_1
        gNB: gNB_2
        AMF: AMF_1
        AMF: AMF_2
        SMF: SMF_2
        UPF: UPF_3
        PCF: PCF_1
        UDM: UDM_2(standby)
        AUSF: AUSF_1(master)
        NRF: NRF_1
        NRF: NRF_2
        NSSF: NSSF_1
"""
from __future__ import annotations

from simulator.models import DC, NetworkElement, NEType, ResourcePool, Topology
from simulator.nrf_view import enrich_topology

# (pool_id, ne_type, ne_id, role) —— role "lb" 为默认负载均衡,省略
_DEMO_SPEC: list[tuple[str, str, str, str]] = [
    # RP_DC1_1
    ("RP_DC1_1", "gNB", "gNB_3", "lb"),
    ("RP_DC1_1", "AMF", "AMF_3", "lb"),
    ("RP_DC1_1", "SMF", "SMF_1", "lb"),
    ("RP_DC1_1", "UPF", "UPF_1", "lb"),
    ("RP_DC1_1", "UPF", "UPF_2", "lb"),
    ("RP_DC1_1", "PCF", "PCF_2", "lb"),
    ("RP_DC1_1", "UDM", "UDM_1", "master"),
    ("RP_DC1_1", "AUSF", "AUSF_2", "standby"),
    ("RP_DC1_1", "NSSF", "NSSF_2", "lb"),
    # RP_DC1_2
    ("RP_DC1_2", "gNB", "gNB_1", "lb"),
    ("RP_DC1_2", "gNB", "gNB_2", "lb"),
    ("RP_DC1_2", "AMF", "AMF_1", "lb"),
    ("RP_DC1_2", "AMF", "AMF_2", "lb"),
    ("RP_DC1_2", "SMF", "SMF_2", "lb"),
    ("RP_DC1_2", "UPF", "UPF_3", "lb"),
    ("RP_DC1_2", "PCF", "PCF_1", "lb"),
    ("RP_DC1_2", "UDM", "UDM_2", "standby"),
    ("RP_DC1_2", "AUSF", "AUSF_1", "master"),
    ("RP_DC1_2", "NRF", "NRF_1", "lb"),
    ("RP_DC1_2", "NRF", "NRF_2", "lb"),
    ("RP_DC1_2", "NSSF", "NSSF_1", "lb"),
]

_DEMO_TOPOLOGY: Topology | None = None


def build_demo_topology() -> Topology:
    """构造与前端 COMMON_TOPO 对齐的 21 NE 拓扑(单例,带 NRF 视图)。"""
    global _DEMO_TOPOLOGY
    if _DEMO_TOPOLOGY is not None:
        return _DEMO_TOPOLOGY

    dc = DC(id="DC1")
    pools: dict[str, ResourcePool] = {}
    for pool_id, ne_type_str, ne_id, role in _DEMO_SPEC:
        pool = pools.get(pool_id)
        if pool is None:
            pool = ResourcePool(id=pool_id, dc_id="DC1")
            pools[pool_id] = pool
            dc.pools.append(pool)
        pool.elements.append(
            NetworkElement(
                id=ne_id,
                ne_type=NEType[ne_type_str],
                pool_id=pool_id,
                dc_id="DC1",
                role=role,
            )
        )

    topo = Topology(dcs=[dc])
    for pool in dc.pools:
        for ne in pool.elements:
            topo.elements[ne.id] = ne
    enrich_topology(topo, case_id=0)
    _DEMO_TOPOLOGY = topo
    return topo


def render_topo_text(topology: Topology | None = None) -> str:
    """渲染为 topo.txt 文本(与 simulator.exporter 同格式,供 Agent CaseData 用)。"""
    topology = topology or build_demo_topology()
    lines: list[str] = []
    for dc in topology.dcs:
        lines.append(f"DC: {dc.id}")
        for pool in dc.pools:
            lines.append(f"  ResourcePool: {pool.id}")
            for ne in pool.elements:
                role_str = f"({ne.role})" if ne.role != "lb" else ""
                lines.append(f"    {ne.ne_type.value}: {ne.id}{role_str}")
    return "\n".join(lines)
