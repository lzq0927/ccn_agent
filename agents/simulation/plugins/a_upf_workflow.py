"""场景 A 占位 plugin(仍走 DEMO 前端)。

A 走确定性故事钟;此 plugin 提供拓扑常量供 LIVE-capable 后端查询,
但 capabilities="demo" 引导前端用 useStoryClock 分支。
"""
from __future__ import annotations

from typing import Any

from agents.shared.scenario_plugin import (
    DiagnosisContext,
    Event,
    RebatchSpec,
    RecoveryAction,
    RecoveryContext,
    TickContext,
)
from simulator.topology import TopologyGenerator


class _APlugin:
    id = "A"
    label_cn = "UPF 异常·确定性工作流"
    label_en = "UPF FAULT · DETERMINISTIC WORKFLOW"
    version = "1.0"
    short_intro = "均质化比较排除 AMF/SMF + 定位 UPF_1"
    route_expectation = "workflow"
    expected_round = 1
    capabilities = "demo"

    def build_topology(self) -> Any: return TopologyGenerator().generate(0, seed=101)
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return {}
    def on_tick(self, ctx: TickContext) -> list[Event]: return []
    def diagnosis_llm_stub(self, ctx: DiagnosisContext): return None
    def recovery_actions(self, plan) -> list[RecoveryAction]: return []
    def on_recovery_action(self, action, ctx: RecoveryContext) -> list[Event]: return []
    def request_rebatch_chr(self) -> RebatchSpec | None: return None
    def on_user_breakdown(self, breakdown) -> list[RecoveryAction]: return []


PLUGIN = _APlugin()
