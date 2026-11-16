"""拓扑：topo.csv（source,target）。实例形如 AMF:amf_1。"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

# 网元类型对 -> 接口名。topo.csv 只有 source/target，接口由类型对推导。
INTERFACE_BY_PAIR = {
    frozenset(("AMF", "SMF")): "N11", frozenset(("AMF", "AUSF")): "N12", frozenset(("AMF", "UDM")): "N8",
    frozenset(("AMF", "PCF")): "N15", frozenset(("SMF", "UDM")): "N10", frozenset(("SMF", "PCF")): "N7",
    frozenset(("SMF", "UPF")): "N4", frozenset(("AUSF", "UDM")): "N13",
}


def nf_type(instance: str) -> str:
    return instance.split(":", 1)[0]


class Topology:
    def __init__(self, edges: list[tuple[str, str]]):
        self.edges = edges
        self.nodes = sorted({n for e in edges for n in e})
        self.by_type: dict[str, list[str]] = {}
        for n in self.nodes:
            self.by_type.setdefault(nf_type(n), []).append(n)
        self._adj = {n: set() for n in self.nodes}
        for s, t in edges:
            self._adj[s].add(t)
            self._adj[t].add(s)
        self._short = {n.split(":", 1)[1].lower(): n for n in self.nodes}

    @classmethod
    def load(cls, path: Path) -> "Topology":
        df = pd.read_csv(path, dtype=str).dropna()
        return cls([(s.strip(), t.strip()) for s, t in zip(df["source"], df["target"])])

    def normalize(self, value: str) -> str:
        """把 'smf_2' / 'smf:smf_2 ' 等写法归一成拓扑中的实例名；未知则原样返回。"""
        v = value.strip()
        if v in self._adj or not v:
            return v
        return self._short.get(v.split(":")[-1].lower(), v)

    def has(self, instance: str) -> bool:
        return instance in self._adj

    def connected(self, a: str, b: str) -> bool:
        return b in self._adj.get(a, ())

    def neighbors(self, instance: str, of_type: str | None = None) -> list[str]:
        return sorted(n for n in self._adj.get(instance, ()) if of_type is None or nf_type(n) == of_type)

    def interface(self, a: str, b: str) -> str:
        return INTERFACE_BY_PAIR.get(frozenset((nf_type(a), nf_type(b))), "")

    def to_dict(self) -> dict:
        return {
            "nodes": [{"id": n, "type": nf_type(n), "name": n.split(":", 1)[1]} for n in self.nodes],
            "edges": [{"source": s, "target": t, "interface": self.interface(s, t)} for s, t in self.edges],
        }
