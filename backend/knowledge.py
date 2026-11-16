"""CHR 知识图谱加载与查询。

图谱由产品代码分析得到：每个原因码在什么流程、哪个接口、哪些场景下产生，以及失败如何跨网元传导。
节点类型：CauseCode / Scenario / NFType / Interface / Procedure
关系：CAUSED_BY（原因码 -> 场景，带先验权重与触发条件）、PROPAGATES_TO（原因码 -> 上游网元原因码）等
"""
from __future__ import annotations

import json
from pathlib import Path


class KnowledgeGraph:
    def __init__(self, data: dict):
        self.meta = data.get("meta", {})
        self.nodes = {n["id"]: n for n in data["nodes"]}
        self.edges = data["edges"]
        self._out: dict[tuple[str, str], list[dict]] = {}
        self._in: dict[tuple[str, str], list[dict]] = {}
        for e in self.edges:
            self._out.setdefault((e["source"], e["relation"]), []).append(e)
            self._in.setdefault((e["target"], e["relation"]), []).append(e)

    @classmethod
    def load(cls, path: Path) -> "KnowledgeGraph":
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def cause(self, code: str) -> dict | None:
        return self.nodes.get(f"cause:{code}")

    def cause_name(self, code: str) -> str:
        node = self.cause(code)
        return node["name"] if node else code

    def cause_names(self) -> dict[str, str]:
        return {n["code"]: n["name"] for n in self.nodes.values() if n["type"] == "CauseCode"}

    def scenarios(self, code: str) -> list[dict]:
        """原因码可能的产生场景，按先验权重降序。"""
        out = []
        for e in self._out.get((f"cause:{code}", "CAUSED_BY"), []):
            out.append({**self.nodes[e["target"]], "weight": e.get("weight", 0.0), "condition": e.get("condition", "")})
        return sorted(out, key=lambda s: -s["weight"])

    def propagation_targets(self, code: str) -> list[str]:
        """该原因码会传导到的上游网元原因码。"""
        return [e["target"].split(":", 1)[1] for e in self._out.get((f"cause:{code}", "PROPAGATES_TO"), [])]

    def propagation_sources(self, code: str) -> list[str]:
        """可能传导出该原因码的下游网元原因码。"""
        return [e["source"].split(":", 1)[1] for e in self._in.get((f"cause:{code}", "PROPAGATES_TO"), [])]
