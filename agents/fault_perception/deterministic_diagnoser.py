"""确定性诊断器 —— LLM stub 模式(无 key / 展会兜底)下的诚实降级路径。

Agent Loop 需要 LLM;当 ``effective_mode == "stub"`` 时,GUIDED/AUTONOMOUS 路由
改走本模块:用**与 LLM 相同的工具链**(analyze_kpi_anomalies / find_common_ne /
ue_failure_concentration)+ 运行时遥测(CPU / 类别归因)做确定性综合,产出与
submit_diagnosis 同构的 ``DiagnosisResult``。规则通用,无场景分支:

  1. 核心网 NF 过载(多实例 CPU ≥ 80)→ 业务激增类诊断(path_session/business,
     traffic_filter=主导失败类别,elements=过载 NF);
  2. link KPI 清晰聚集 → single_ne / multi_ne(link/business 按 NE 类型);
  3. CHR 用户失败聚集 → 用户级根因(ue_failure_concentration);
  4. 均无信号 → normal。

每个工具调用都经 progress_callback 推流(LIVE 推理链与 LLM 模式同形)。
"""
from __future__ import annotations

import json
import logging
from typing import Callable, Optional

from agents.shared.models import (
    CaseData,
    ConfidenceAssessment,
    DiagnosisResult,
    ReasoningStep,
    Route,
    SessionStatus,
)

logger = logging.getLogger(__name__)

_CPU_OVERLOAD = 80.0
_ANOMALY_THRESHOLD = 0.995


def _degradation_exclusivity(link_rows: list[dict], ne_id: str,
                             threshold: float = _ANOMALY_THRESHOLD) -> tuple[float, int]:
    """候选 NE 的「全路径退化独占率」= 该 NE 涉及的退化链路 / 该 NE 涉及的全部链路。

    均质化比较原则的通用实现:真根因 NE 的**所有**路径都退化(独占率→1.0);
    而「共享链路的对端」(如唯一幸存 SMF/AMF)只有到根因的路径退化,到其它
    NF 的路径健康(独占率低)。用于在退化链路端点并列时区分根因与受害者。
    """
    involved = [r for r in link_rows
                if str(r.get("src", "")) == ne_id or str(r.get("dst", "")) == ne_id]
    if not involved:
        return 0.0, 0
    degraded = [r for r in involved if float(r.get("success_rate", 1.0)) < threshold]
    return len(degraded) / len(involved), len(involved)


async def diagnose_deterministic(
    case_data: CaseData,
    assessment: ConfidenceAssessment,
    session_id: str,
    route: Route,
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> DiagnosisResult:
    """确定性工具链诊断(stub 模式)。"""
    trace: list[ReasoningStep] = []
    step = 0

    def next_step() -> int:
        nonlocal step
        step += 1
        return step

    def emit_tool(tool: str, args: dict, result: str) -> None:
        trace.append(ReasoningStep(
            step_number=next_step(), step_type="tool_call",
            content=f"调用工具 {tool}", tool_name=tool, tool_args=args,
        ))
        trace.append(ReasoningStep(
            step_number=next_step(), step_type="tool_result",
            content=(result or "")[:400], tool_name=tool, tool_result=(result or "")[:2000],
        ))
        if progress_callback:
            preview = (result or "").replace("\n", " ")[:160]
            progress_callback({"type": "tool_call", "tool": tool, "result_preview": preview})

    from tools.registry import dispatch, import_all_tools

    import_all_tools()  # 幂等:确保工具已注册(直调本模块时 Agent 构造可能未发生)

    # ---- 1) 运行时遥测:过载判定(通用,仅当 LIVE 提供了 runtime_context)----
    rc = getattr(case_data, "runtime_context", None) or {}
    ne_cpu: dict[str, float] = rc.get("ne_cpu", {}) or {}
    class_stats = rc.get("traffic_class_stats", {}) or {}
    overloaded = sorted(
        ne for ne, c in ne_cpu.items()
        if c >= _CPU_OVERLOAD and not str(ne).startswith("gNB")
    )

    kpi_rows = case_data.kpi_rows
    chr_records = case_data.chr_records

    # ---- 2) KPI 异常工具链 ----
    top_ne = ""
    ne_frequency: list[dict] = []
    degraded: dict[str, dict] = {}
    try:
        raw = await dispatch("analyze_kpi_anomalies", {
            "kpi_rows": kpi_rows, "level": "link", "threshold": _ANOMALY_THRESHOLD,
        })
        emit_tool("analyze_kpi_anomalies", {"level": "link"}, raw)
        degraded = (json.loads(raw).get("link", {}) or {}).get("degraded_pairs", {}) or {}
        if degraded:
            raw2 = await dispatch("find_common_ne", {"degraded_pairs": list(degraded.keys())})
            emit_tool("find_common_ne", {"pairs": len(degraded)}, raw2)
            res = json.loads(raw2)
            top_ne = res.get("top_ne") or ""
            ne_frequency = res.get("ne_frequency", []) or []
    except Exception:  # noqa: BLE001
        logger.exception("deterministic diagnoser: KPI toolchain failed")

    # ---- 3) CHR 用户失败聚集 ----
    ue_pattern = ""
    try:
        if chr_records:
            raw3 = await dispatch("ue_failure_concentration", {"chr_records": chr_records})
            emit_tool("ue_failure_concentration", {"records": len(chr_records)}, raw3)
            ue_pattern = json.loads(raw3).get("pattern", "") or ""
    except Exception:  # noqa: BLE001
        logger.exception("deterministic diagnoser: CHR toolchain failed")

    # ---- 4) 综合(通用规则)----
    dom = class_stats.get("dominant")
    if overloaded:
        elements = [ne for ne in overloaded if ne.split("_")[0] in ("AMF", "SMF")] or overloaded
        flt = dict(dom["flt"]) if dom else None
        reason = (
            f"核心网 NF 过载({', '.join(f'{ne}={ne_cpu[ne]:.0f}%' for ne in elements)});"
            + (f"失败类别归因:{dom['key']} 占 {dom['fail_share']:.0%}(基线 {dom['base_share']:.0%},"
               f"放大 {dom['lift']}x)" if dom else "失败类别分散")
            + " → 判定为业务激增冲击,需入口准入控制(而非隔离网元)"
        )
        trace.append(ReasoningStep(step_number=next_step(), step_type="conclusion", content=reason))
        return DiagnosisResult(
            session_id=session_id, case_id=case_data.case_id,
            fault_elements=elements, fault_links=[],
            fault_type="path_session", fault_mode="business",
            confidence=min(0.9, 0.55 + 0.05 * len(overloaded)),
            route_taken=route, reasoning_trace=trace,
            llm_model="deterministic-stub", status=SessionStatus.COMPLETED,
            traffic_filter=flt,
        )

    if top_ne:
        # 聚集度:top NE 在退化链路端点中的占比
        freq = {f.get("ne_id"): f.get("count", 0) for f in ne_frequency}
        total_ep = sum(freq.values()) or 1
        dominance = freq.get(top_ne, 0) / total_ep
        # 均质化比较:退化链路端点并列时(如仅剩一个 SMF 承载全部退化路径,
        # 或微损故障各端点计数接近),用「全路径退化独占率」区分根因(自身全部
        # 路径退化)与受害者(仅与根因共享的路径退化)。候选 = 退化端点全集。
        candidates = [f.get("ne_id") for f in ne_frequency if f.get("ne_id")]
        link_rows = [r for r in kpi_rows if str(r.get("level", "")) == "link"]
        scored = [(ne, *_degradation_exclusivity(link_rows, ne)) for ne in candidates]
        scored.sort(key=lambda x: (-x[1], -freq.get(x[0], 0)))
        if (
            scored
            and scored[0][1] >= 0.5
            and (len(scored) < 2 or scored[0][1] - scored[1][1] >= 0.2)
        ):
            top_ne = scored[0][0]
        single = dominance >= 0.4 or (scored and scored[0][1] >= 0.5 and scored[0][0] == top_ne)
        elements = [top_ne] if single else [ne for ne, _, _ in scored[:3]]
        is_gnb = top_ne.startswith("gNB")
        fault_type = "single_ne" if single else "multi_ne"
        fault_mode = "business" if (is_gnb or ue_pattern in ("user_cluster", "concentrated")) else "link"
        flt = dict(dom["flt"]) if (fault_mode == "business" and dom) else None
        reason = (
            f"退化链路 {len(degraded)} 条聚合到 {top_ne}(端点占比 {dominance:.0%});"
            + ("接入侧/用户级根因 → 用户侧重选恢复" if fault_mode == "business"
               else "核心网链路根因 → 隔离+重选恢复")
        )
        trace.append(ReasoningStep(step_number=next_step(), step_type="conclusion", content=reason))
        return DiagnosisResult(
            session_id=session_id, case_id=case_data.case_id,
            fault_elements=elements,
            fault_links=[k for k in degraded if top_ne in k][:3],
            fault_type=fault_type, fault_mode=fault_mode,
            confidence=min(0.9, assessment.score + 0.2 if single else assessment.score),
            route_taken=route, reasoning_trace=trace,
            llm_model="deterministic-stub", status=SessionStatus.COMPLETED,
            traffic_filter=flt,
        )

    if ue_pattern and ue_pattern not in ("none", "scattered"):
        # CHR 聚集但 KPI 无清晰异常:用户级失败聚集(元素从 CHR 共因推导)
        from collections import Counter

        fails = [r for r in chr_records if r.get("outcome") == "failure"]
        ne_cnt = Counter()
        for r in fails:
            for key in ("nf_src", "nf_dst"):
                ne = str(r.get(key, ""))
                if ne and not ne.startswith("UE"):
                    ne_cnt[ne] += 1
        elements = [ne for ne, _ in ne_cnt.most_common(2)]
        flt = dict(dom["flt"]) if dom else None
        reason = f"CHR 用户失败聚集(pattern={ue_pattern}),共因 NE:{elements or '无'}"
        trace.append(ReasoningStep(step_number=next_step(), step_type="conclusion", content=reason))
        return DiagnosisResult(
            session_id=session_id, case_id=case_data.case_id,
            fault_elements=elements, fault_links=[],
            fault_type="multi_ne", fault_mode="business",
            confidence=max(0.3, assessment.score * 0.8),
            route_taken=route, reasoning_trace=trace,
            llm_model="deterministic-stub", status=SessionStatus.COMPLETED,
            traffic_filter=flt,
        )

    reason = "KPI 无异常、CHR 无失败聚集、无 NF 过载 → 网络正常"
    trace.append(ReasoningStep(step_number=next_step(), step_type="conclusion", content=reason))
    return DiagnosisResult(
        session_id=session_id, case_id=case_data.case_id,
        fault_elements=[], fault_links=[], fault_type="normal", fault_mode=None,
        confidence=0.8, route_taken=route, reasoning_trace=trace,
        llm_model="deterministic-stub", status=SessionStatus.COMPLETED,
    )
