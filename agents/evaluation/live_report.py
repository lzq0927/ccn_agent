"""LIVE 实时评估(Agent 3 实时形态):真值比对 + 恢复效果 + 优化建议回流。

复用设计态 ``Evaluator``(P/R/F1/exact_match)做真值比对,叠加 LIVE 特有的
恢复效果维度(是否恢复 / 轮数 / 恢复前后 SR/CPU / 流控代价),并产出规则式
``OptimizationSuggestion`` 与 Skill 沉淀事件(与设计态 ``optimization.*`` 通道
同构)。全部由「诊断结果 + 引擎遥测 + 真值」通用推导,无场景分支。
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from agents.evaluation.evaluator import Evaluator
from agents.shared.models import DiagnosisResult

logger = logging.getLogger(__name__)


def build_live_evaluation(
    diagnosis: Optional[DiagnosisResult],
    ground_truth: dict,
    engine: Any,
    recovered: bool,
    rounds_used: int,
    sr_timeline: Optional[list[dict]] = None,
    scenario_id: str = "",
) -> dict:
    """组装 evaluation_report 事件 payload(兼容旧形状的超集)。

    sr_timeline: [{round, reg_sr, pdu_sr, max_cpu}, ...] 每轮策略后的引擎快照。
    """
    evaluator = Evaluator()
    metrics = evaluator.compare(diagnosis, ground_truth) if diagnosis else None
    if metrics is not None:
        # LIVE 真值只定义 fault_elements(引擎故障无链路级真值),exact_match
        # 按**元素集合**判定;设计态 Evaluator 的链路级 exact 不适用于 LIVE。
        pred_set = set(diagnosis.fault_elements or [])  # type: ignore[union-attr]
        truth_set = set(ground_truth.get("fault_elements", []))
        metrics.exact_match = pred_set == truth_set

    reg_sr, pdu_sr = engine._success_rates()  # noqa: SLF001
    cpu = getattr(engine, "ne_cpu", {}) or {}
    max_cpu = max((c for ne, c in cpu.items() if not str(ne).startswith("gNB")), default=0.0)

    # 业务类故障:类别命中(诊断 traffic_filter vs 真值 fault_classes)
    truth_classes = [set(fc.items()) for fc in ground_truth.get("fault_classes", [])]
    pred_filter = set((getattr(diagnosis, "traffic_filter", None) or {}).items())
    class_match: Optional[bool] = None
    if truth_classes:
        class_match = pred_filter in truth_classes if pred_filter else False

    report: dict[str, Any] = {
        "metrics": {
            "precision": metrics.precision, "recall": metrics.recall, "f1": metrics.f1,
            "exact_match": metrics.exact_match,
        } if metrics else {"precision": 0.0, "recall": 0.0, "f1": 0.0, "exact_match": False},
        "recovered": recovered,
        "rounds": rounds_used,
        "amf_success_rate": round(reg_sr, 4),
        "smf_success_rate": round(pdu_sr, 4),
        "max_core_cpu": round(max_cpu, 1),
        "class_match": class_match,
        "trace_axes": {"overall": (0.9 if recovered else 0.6)},
        "sr_timeline": sr_timeline or [],
        "truth": sorted(ground_truth.get("fault_elements", [])),
        "predicted": list(getattr(diagnosis, "fault_elements", []) or []),
        "case_entry": {
            "scenario": scenario_id, "round": rounds_used,
            "predicted": list(getattr(diagnosis, "fault_elements", []) or []),
            "truth": sorted(ground_truth.get("fault_elements", [])),
        },
        "suggestions": _build_suggestions(diagnosis, ground_truth, recovered, rounds_used, metrics),
    }
    return report


def build_skill_evolution(diagnosis: Optional[DiagnosisResult], report: dict) -> dict:
    """Skill 沉淀事件 payload(通用规则:按路由 + 结果生成沉淀内容)。"""
    route = getattr(getattr(diagnosis, "route_taken", None), "value", "unknown")
    recovered = bool(report.get("recovered"))
    exact = bool((report.get("metrics") or {}).get("exact_match"))
    if exact and recovered:
        kind, insight = "CONFIRM", "该诊断路径(路由/工具组合)已验证有效,强化现有 Skill 权重"
    elif recovered and not exact:
        kind, insight = "UPDATE", "恢复成功但根因定位有偏差,补充「症状相似故障」的区分性证据维度"
    elif not recovered:
        kind, insight = "NEW", "本轮未能恢复:把失败模式(策略不足/定位偏差)沉淀为难例,回流数据生成"
    else:
        kind, insight = "UPDATE", "经验更新"
    return {
        "kind": kind,
        "route": route,
        "skill_id": f"skills/learned/route_{route}",
        "insight": insight,
        "rounds": report.get("rounds"),
        "f1": (report.get("metrics") or {}).get("f1"),
    }


def _build_suggestions(
    diagnosis: Optional[DiagnosisResult],
    ground_truth: dict,
    recovered: bool,
    rounds_used: int,
    metrics: Any,
) -> list[dict]:
    """规则式优化建议(设计态 optimization_advisor 的 LLM 可选增强在 LIVE 用规则版)。"""
    out: list[dict] = []
    pred = set(getattr(diagnosis, "fault_elements", []) or [])
    truth = set(ground_truth.get("fault_elements", []))
    if truth and pred and not (pred <= truth):
        out.append({
            "suggestion_type": "skill_update",
            "target": "fault_perception",
            "content": "诊断存在误报元素:加强排除性证据(均质化比较/健康对照)后再提交",
            "evidence": [f"误报元素:{sorted(pred - truth)}"],
            "priority": "high",
        })
    if truth and (truth - pred):
        out.append({
            "suggestion_type": "skill_update",
            "target": "fault_perception",
            "content": "诊断存在漏报:补充聚合定位/用户分群维度,覆盖多元素故障",
            "evidence": [f"漏报元素:{sorted(truth - pred)}"],
            "priority": "high",
        })
    if not recovered:
        out.append({
            "suggestion_type": "new_case",
            "target": "data_generation",
            "content": "未恢复场景回流为难例:生成同故障类型更高难度用例,检验策略反馈轮",
            "evidence": [f"rounds={rounds_used} 未恢复"],
            "priority": "medium",
        })
    if rounds_used > 1 and recovered:
        out.append({
            "suggestion_type": "workflow_update",
            "target": "fault_perception",
            "content": f"首轮策略不足、{rounds_used} 轮收敛:把首轮 ratio 推导的保守系数纳入 Skill",
            "evidence": [f"rounds={rounds_used}"],
            "priority": "low",
        })
    return out
