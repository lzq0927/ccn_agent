"""Fixed workflow engine for deterministic fault diagnosis."""

from __future__ import annotations

import json
import logging
from typing import Callable

from agents.shared.models import CaseData, DiagnosisResult, Route, ReasoningStep, SessionStatus
from tools.kpi_analyzer import analyze_kpi_anomalies, find_common_ne
from tools.fault_isolator import check_temporal_pattern
from tools.topology_tools import check_ne_membership

logger = logging.getLogger(__name__)


class WorkflowEngine:
    """Executes fixed diagnostic workflows for high-confidence cases."""

    def __init__(self, progress_callback: Callable[[dict], None] | None = None):
        self.progress_callback = progress_callback

    async def run(self, workflow: str, case_data: CaseData, session_id: str) -> DiagnosisResult:
        workflows = {
            "link_fault_workflow": self._link_fault_workflow,
            "normal_detection_workflow": self._normal_detection_workflow,
            "overload_admission_workflow": self._overload_admission_workflow,
        }

        handler = workflows.get(workflow)
        if not handler:
            handler = self._link_fault_workflow  # default

        return await handler(case_data, session_id)

    async def _link_fault_workflow(self, case_data: CaseData, session_id: str) -> DiagnosisResult:
        """Deterministic workflow for link-mode single NE faults."""
        trace: list[ReasoningStep] = []
        step = 0

        # Step 1: Analyze KPI anomalies
        step += 1
        anomaly_result = await analyze_kpi_anomalies(
            case_data.kpi_rows, level="link", threshold=0.995
        )
        anomaly_data = json.loads(anomaly_result)
        trace.append(
            ReasoningStep(
                step_number=step,
                step_type="tool_call",
                content="analyze_kpi_anomalies",
                tool_name="analyze_kpi_anomalies",
                tool_result=anomaly_result[:500],
            )
        )

        link_data = anomaly_data.get("link", {})
        degraded_pairs = list(link_data.get("degraded_pairs", {}).keys())

        # Step 2: Find common NE
        step += 1
        if degraded_pairs:
            ne_result = await find_common_ne(degraded_pairs)
            ne_data = json.loads(ne_result)
        else:
            ne_data = {"top_ne": None, "top_ratio": 0}
        trace.append(
            ReasoningStep(
                step_number=step,
                step_type="tool_call",
                content="find_common_ne",
                tool_name="find_common_ne",
                tool_result=json.dumps(ne_data)[:500],
            )
        )

        # Step 3: Temporal pattern
        step += 1
        temporal_result = await check_temporal_pattern(
            case_data.kpi_rows, ne_id=ne_data.get("top_ne", "")
        )
        trace.append(
            ReasoningStep(
                step_number=step,
                step_type="tool_call",
                content="check_temporal_pattern",
                tool_name="check_temporal_pattern",
                tool_result=temporal_result[:500],
            )
        )

        # Step 4: NE membership (spatial analysis)
        step += 1
        affected_nes = []
        top_ne = ne_data.get("top_ne")
        if top_ne:
            membership_result = await check_ne_membership(case_data.topology_text, [top_ne])
            membership_data = json.loads(membership_result)
            trace.append(
                ReasoningStep(
                    step_number=step,
                    step_type="tool_call",
                    content="check_ne_membership",
                    tool_name="check_ne_membership",
                    tool_result=membership_result[:500],
                )
            )

            clustering = membership_data.get("clustering", {})
            # Determine fault type from clustering
            if clustering.get("single_ne") or ne_data.get("top_ratio", 0) > 0.4:
                affected_nes = [top_ne]
                fault_type = "single_ne"
            else:
                # Get all degraded NEs
                candidates = ne_data.get("ne_frequency", [])
                affected_nes = [c["ne_id"] for c in candidates[:5] if c.get("ratio", 0) > 0.1]
                fault_type = "multi_ne"
        else:
            fault_type = "normal"

        # Build result
        confidence = 0.85 if ne_data.get("top_ratio", 0) > 0.4 else 0.6
        if fault_type == "normal":
            confidence = 0.9

        step += 1
        trace.append(
            ReasoningStep(
                step_number=step,
                step_type="conclusion",
                content=f"Diagnosis: fault_type={fault_type}, elements={affected_nes}, confidence={confidence}",
            )
        )

        return DiagnosisResult(
            session_id=session_id,
            case_id=case_data.case_id,
            fault_elements=affected_nes,
            fault_links=degraded_pairs[:10] if fault_type != "normal" else [],
            fault_type=fault_type,
            confidence=confidence,
            route_taken=Route.WORKFLOW,
            reasoning_trace=trace,
            iterations_used=step,
            status=SessionStatus.COMPLETED,
        )

    async def _normal_detection_workflow(
        self, case_data: CaseData, session_id: str
    ) -> DiagnosisResult:
        """Deterministic workflow for normal case detection."""
        trace: list[ReasoningStep] = []

        # Check for anomalies
        anomaly_result = await analyze_kpi_anomalies(
            case_data.kpi_rows, level="all", threshold=0.995
        )
        anomaly_data = json.loads(anomaly_result)

        link_data = anomaly_data.get("link", {})
        has_anomaly = link_data.get("anomaly_count", 0) > 0

        trace.append(
            ReasoningStep(
                step_number=1,
                step_type="conclusion",
                content=f"Normal detection: anomaly_count={link_data.get('anomaly_count', 0)}, has_anomaly={has_anomaly}",
            )
        )

        confidence = 0.95 if not has_anomaly else 0.5

        return DiagnosisResult(
            session_id=session_id,
            case_id=case_data.case_id,
            fault_elements=[],
            fault_links=[],
            fault_type="normal" if not has_anomaly else "unknown",
            confidence=confidence,
            route_taken=Route.WORKFLOW,
            reasoning_trace=trace,
            iterations_used=1,
            status=SessionStatus.COMPLETED,
        )

    async def _overload_admission_workflow(
        self, case_data: CaseData, session_id: str
    ) -> DiagnosisResult:
        """确定性准入工作流:NF 过载(业务激增)→ 定位过载 NF + 激增类别。

        步骤:① KPI 异常(过载自环链路/拥塞拒绝可见)② 运行时遥测 CPU 过载判定
        ③ CHR 失败类别归因(runtime_context.traffic_class_stats)→ path_session 诊断。
        """
        trace: list[ReasoningStep] = []
        step = 0

        def emit(content: str, tool: str | None = None, result: str | None = None) -> None:
            nonlocal step
            step += 1
            trace.append(ReasoningStep(
                step_number=step,
                step_type="tool_call" if tool else "conclusion",
                content=content, tool_name=tool, tool_result=(result or "")[:500] if tool else None,
            ))

        # Step 1: KPI 异常(过载期 NF 自环 SR 下降 / 拥塞链路)
        anomaly_result = await analyze_kpi_anomalies(
            case_data.kpi_rows, level="link", threshold=0.995
        )
        anomaly_data = json.loads(anomaly_result)
        degraded_pairs = list((anomaly_data.get("link", {}) or {}).get("degraded_pairs", {}).keys())
        emit("analyze_kpi_anomalies", "analyze_kpi_anomalies", anomaly_result[:500])

        # Step 2: 运行时遥测过载判定
        rc = getattr(case_data, "runtime_context", None) or {}
        ne_cpu = rc.get("ne_cpu", {}) or {}
        overloaded = sorted(
            (ne, c) for ne, c in ne_cpu.items()
            if c >= 80.0 and not str(ne).startswith("gNB")
        )
        stats = rc.get("traffic_class_stats", {}) or {}
        dom = stats.get("dominant")
        emit(
            f"runtime telemetry: {len(overloaded)} NF overloaded "
            + (", ".join(f"{ne}={c:.0f}%" for ne, c in overloaded[:6]) if overloaded else ""),
        )

        if not overloaded:
            # 无过载 → 退化为链路工作流(不该走到这;防御性兜底)
            emit("no overload found; falling back to link fault workflow")
            result = await self._link_fault_workflow(case_data, session_id)
            result.reasoning_trace = trace + result.reasoning_trace
            return result

        # Step 3: 失败类别归因
        elements = [ne for ne, _ in overloaded if ne.split("_")[0] in ("AMF", "SMF")] or [
            ne for ne, _ in overloaded
        ]
        if dom:
            emit(
                f"failure attribution: dominant class {dom['key']} = {dom['fail_share']:.0%} "
                f"(baseline {dom.get('base_share', 0):.0%}, lift {dom.get('lift')})"
            )
        else:
            emit("failure attribution: no dominant traffic class (throttle all)")

        depth = min(1.0, (max(c for _, c in overloaded) - 78.0) / 15.0)
        confidence = round(0.6 + 0.3 * depth, 3)
        emit(
            f"Diagnosis: business surge (path_session) overloading "
            f"{elements}; admission control at ingress required, not NE isolation"
        )

        return DiagnosisResult(
            session_id=session_id,
            case_id=case_data.case_id,
            fault_elements=elements,
            fault_links=degraded_pairs[:10],
            fault_type="path_session",
            fault_mode="business",
            confidence=confidence,
            route_taken=Route.WORKFLOW,
            reasoning_trace=trace,
            iterations_used=step,
            status=SessionStatus.COMPLETED,
            traffic_filter=dict(dom["flt"]) if dom else None,
        )
