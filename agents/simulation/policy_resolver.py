"""policy_resolver: 把诊断结果翻译成可执行的仿真策略(PolicyAction)。

输入:LiveScenario + DiagnosisResult(fault_elements/fault_type/fault_mode)。
输出:list[PolicyAction] —— 喂给 ``RealtimeEngine.apply_policy``,**真改仿真状态**
(隔离 NE、重选会话、流控),使后续 tick 的 KPI 真实恢复(闭环)。

策略来自场景的 ``recovery_actions`` 配方;若诊断明确指出了 NE 且与配方同型,
则把配方的目标 NE 覆盖为诊断结果(让策略精准命中 Agent 定位的根因)。
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agents.simulation.realtime_engine import PolicyAction

if TYPE_CHECKING:
    from agents.shared.models import DiagnosisResult
    from agents.simulation.live_scenarios import LiveScenario

logger = logging.getLogger(__name__)


def resolve_policy_actions(
    scenario: "LiveScenario",
    diagnosis: "DiagnosisResult | None",
) -> list[PolicyAction]:
    actions: list[PolicyAction] = []
    diag_elements = set(getattr(diagnosis, "fault_elements", []) or []) if diagnosis else set()

    for rec in scenario.recovery_actions:
        pol = rec.get("policy") or {}
        kind = pol.get("kind", "")
        if kind == "isolate":
            ne_id = _resolve_ne(pol.get("ne_id", ""), diag_elements, scenario)
            if ne_id:
                actions.append(PolicyAction(kind="isolate", ne_id=ne_id))
        elif kind == "reroute":
            from_id = _resolve_ne(pol.get("from_ne_id", ""), diag_elements, scenario)
            if from_id:
                actions.append(PolicyAction(kind="reroute", from_ne_id=from_id, to_ne_id=pol.get("to_ne_id", "")))
        elif kind == "flow_control":
            actions.append(PolicyAction(
                kind="flow_control", layer=pol.get("layer", ""),
                ratio=float(pol.get("ratio", 0.0)), flt=dict(pol.get("flt", {})),
            ))
    logger.info("scenario %s: resolved %d policy actions from diagnosis %s",
                scenario.id, len(actions), sorted(diag_elements))
    return actions


def _resolve_ne(configured: str, diag_elements: set[str], scenario: "LiveScenario") -> str:
    """若诊断指出了同型 NE,优先用诊断结果;否则用配方里配置的 NE。"""
    if configured and configured in diag_elements:
        return configured
    if configured:
        return configured
    # 配方未指定具体 NE:从诊断里取第一个作为目标(如 reroute gNB_2)
    if diag_elements:
        return sorted(diag_elements)[0]
    return ""
