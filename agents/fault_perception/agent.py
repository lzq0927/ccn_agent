"""Fault Perception Agent - Hermes-style agent loop with confidence-based routing.

Agent 2 is the core of the system. It receives fault case data and diagnoses
the root cause using a combination of fixed workflows, guided skills, and
autonomous LLM exploration based on confidence assessment.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Callable

from agents.shared.llm_client import LLMClient, LLMConfig, LLMResponse
from agents.shared.llm_config import load_llm_config
from agents.shared.models import (
    CaseData,
    DiagnosisResult,
    ConfidenceAssessment,
    Route,
    ReasoningStep,
    SessionStatus,
)
from agents.shared.storage import Storage
from agents.shared.message_bus import MessageBus
from agents.fault_perception.confidence import ConfidenceAssessor
from agents.fault_perception.exploration_config import ExplorationConfig
from agents.fault_perception.router import Router
from agents.fault_perception.workflow_engine import WorkflowEngine
from agents.fault_perception.parallel_explorer import ParallelExplorer
from agents.fault_perception.prompt_builder import PromptBuilder
from agents.fault_perception.context_manager import ContextManager

logger = logging.getLogger(__name__)


@dataclass
class PerceptionConfig:
    max_iterations: int = 30
    guided_max_iterations: int = 15
    confidence_threshold_high: float = 0.7
    confidence_threshold_low: float = 0.3
    skill_dir: str = "./skills"
    memory_dir: str = "./memory"
    llm_config: LLMConfig | None = None


# The submit_diagnosis tool schema injected into every agent loop
SUBMIT_DIAGNOSIS_SCHEMA = {
    "name": "submit_diagnosis",
    "description": "Submit your final fault diagnosis. Call this when you have identified the root cause with sufficient confidence.",
    "parameters": {
        "type": "object",
        "properties": {
            "fault_elements": {
                "type": "array",
                "description": "List of faulty network element IDs",
                "items": {"type": "string"},
            },
            "fault_links": {
                "type": "array",
                "description": "List of faulty link pairs (src->dst)",
                "items": {"type": "string"},
            },
            "fault_type": {
                "type": "string",
                "description": "Fault type: single_ne, multi_ne, all_type_ne, resource_pool, dc, path_link, path_trace, path_session, switch, normal",
            },
            "fault_mode": {
                "type": "string",
                "description": "Fault mode: 'link' or 'business'",
            },
            "traffic_filter": {
                "type": "object",
                "description": (
                    "For business/surge faults only: the traffic class driving the anomaly, "
                    "e.g. {\"sst\": 3} or {\"dnn\": \"iot\"}. Omit for NE faults."
                ),
            },
            "confidence": {
                "type": "number",
                "description": "Your confidence in this diagnosis (0.0-1.0)",
            },
            "reasoning": {
                "type": "string",
                "description": "Brief explanation of your diagnosis",
            },
        },
        "required": ["fault_elements", "fault_type", "confidence"],
    },
}


class FaultPerceptionAgent:
    """Agent 2: Fault Perception with confidence-based routing.

    Flow:
        1. Assess confidence from case data features
        2. Route to WORKFLOW / GUIDED / AUTONOMOUS
        3. Execute diagnosis
        4. Return DiagnosisResult with reasoning trace
    """

    def __init__(
        self,
        config: PerceptionConfig | None = None,
        storage: Storage | None = None,
        message_bus: MessageBus | None = None,
        progress_callback: Callable[[dict], None] | None = None,
    ):
        self.config = config or PerceptionConfig()
        self.storage = storage or Storage()
        self.bus = message_bus
        self.progress_callback = progress_callback

        self.llm = LLMClient(self.config.llm_config or load_llm_config())
        self.assessor = ConfidenceAssessor()
        self.router = Router()
        self.workflow_engine = WorkflowEngine(progress_callback)
        self.parallel_explorer = ParallelExplorer(self.llm, config=ExplorationConfig())
        self.prompt_builder = PromptBuilder(self.config.skill_dir, self.config.memory_dir)
        self.context_manager = ContextManager()

        # Import tools
        from tools.registry import import_all_tools

        import_all_tools()

    async def diagnose(self, case_data: CaseData) -> DiagnosisResult:
        """Main entry point for fault diagnosis."""
        session_id = uuid.uuid4().hex[:12]

        # Step 1: Assess confidence
        assessment = self.assessor.assess(case_data)
        logger.info(
            "Case %d: confidence=%.3f, route=%s, patterns=%s",
            case_data.case_id,
            assessment.score,
            assessment.route.value,
            assessment.matched_patterns,
        )

        # Emit progress
        self._emit_progress(
            "confidence_assessment",
            {
                "session_id": session_id,
                "score": assessment.score,
                "route": assessment.route.value,
                "patterns": assessment.matched_patterns,
            },
        )

        # Step 2: Create session in storage
        self.storage.create_session(
            session_id=session_id,
            case_id=case_data.case_id,
            route_taken=assessment.route.value,
            initial_confidence=assessment.score,
            llm_model=self.llm.config.model,
        )

        # Step 3: Route to appropriate processing path
        routing = self.router.route(assessment)

        try:
            if assessment.route == Route.WORKFLOW:
                result = await self._run_workflow(case_data, assessment, session_id)
            elif assessment.route == Route.GUIDED:
                result = await self._run_agent_loop(
                    case_data, assessment, session_id, max_iterations=routing["max_iterations"]
                )
            elif assessment.route == Route.EXPLORATION:
                result = await self._run_exploration(
                    case_data, assessment, session_id, max_iterations=routing["max_iterations"]
                )
            else:  # AUTONOMOUS
                result = await self._run_agent_loop(
                    case_data, assessment, session_id, max_iterations=routing["max_iterations"]
                )
        except Exception as e:
            logger.exception("Diagnosis failed for case %d", case_data.case_id)
            result = DiagnosisResult(
                session_id=session_id,
                case_id=case_data.case_id,
                fault_type="error",
                confidence=0.0,
                route_taken=assessment.route,
                status=SessionStatus.FAILED,
            )
            # Add error step
            result.reasoning_trace.append(
                ReasoningStep(
                    step_number=1,
                    step_type="thinking",
                    content=f"Diagnosis failed: {e}",
                )
            )

        # Step 4: Save results
        self.storage.complete_session(
            session_id=session_id,
            fault_elements=result.fault_elements,
            fault_links=result.fault_links,
            fault_type=result.fault_type,
            fault_mode=result.fault_mode,
            final_confidence=result.confidence,
            iterations_used=result.iterations_used,
            tokens_used=result.tokens_used,
            status=result.status.value,
        )

        # Save reasoning trace
        for step in result.reasoning_trace:
            self.storage.save_reasoning_step(
                session_id=session_id,
                step_number=step.step_number,
                step_type=step.step_type,
                content=step.content,
                tool_name=step.tool_name,
                tool_args=json.dumps(step.tool_args) if step.tool_args else None,
                tool_result=step.tool_result[:500] if step.tool_result else None,
            )

        # Emit completion
        self._emit_progress(
            "diagnosis_complete",
            {
                "session_id": session_id,
                "result": {
                    "fault_elements": result.fault_elements,
                    "fault_type": result.fault_type,
                    "confidence": result.confidence,
                    "route": result.route_taken.value,
                },
            },
        )

        # Publish event
        if self.bus:
            await self.bus.publish(
                "perception.result",
                {
                    "session_id": session_id,
                    "case_id": case_data.case_id,
                    "diagnosis": {
                        "fault_elements": result.fault_elements,
                        "fault_links": result.fault_links,
                        "fault_type": result.fault_type,
                        "confidence": result.confidence,
                    },
                },
                sender="agent_2",
            )

        return result

    async def _run_workflow(
        self, case_data: CaseData, assessment: ConfidenceAssessment, session_id: str
    ) -> DiagnosisResult:
        """Run fixed workflow for high-confidence cases."""
        workflow = assessment.suggested_workflow or "link_fault_workflow"
        self._emit_progress("workflow_start", {"workflow": workflow, "session_id": session_id})

        result = await self.workflow_engine.run(workflow, case_data, session_id)
        result.session_id = session_id
        return result

    async def _run_exploration(
        self,
        case_data: CaseData,
        assessment: ConfidenceAssessment,
        session_id: str,
        max_iterations: int = 40,
    ) -> DiagnosisResult:
        """Phase 2 exploration mode: Agent + LLM + multi-algorithm framework on CHR.

        Triggered when KPIs are ambiguous (micro-loss) but user-level CHR shows
        concentrated failures or layer inconsistency. The ParallelExplorer runs
        the statistical + ML detectors with param sweeps, fuses them into a
        Bayesian posterior, and synthesises a diagnosis (LLM refines when a key
        is configured; otherwise the deterministic posterior is used).
        """
        self._emit_progress("exploration_start", {"session_id": session_id})
        system_prompt = self.prompt_builder.build_system_prompt(
            case_id=case_data.case_id,
            kpi_summary=self._summarize_kpi(case_data),
            topology_summary=case_data.topology_text[:500],
            assessment=assessment,
            mode=Route.EXPLORATION,
            max_iterations=max_iterations,
        )
        result = await self.parallel_explorer.explore(
            case_data=case_data,
            hypotheses=[],  # algorithm-driven, not hypothesis-driven
            system_prompt=system_prompt,
            session_id=session_id,
        )
        result.route_taken = Route.EXPLORATION
        result.session_id = session_id
        return result

    async def _run_agent_loop(
        self,
        case_data: CaseData,
        assessment: ConfidenceAssessment,
        session_id: str,
        max_iterations: int = 30,
    ) -> DiagnosisResult:
        """Hermes-style agent loop: prompt -> LLM -> tools -> repeat."""
        from tools.registry import schemas_as_tool_objects, dispatch as tool_dispatch

        # stub 模式(无 key / CC_LIVE_LLM_MODE=stub):LLM loop 不可用 →
        # 走确定性工具链降级(与 LLM 同构的诊断,诚实且可离线复现)
        from agents.shared.llm_client import effective_mode

        if effective_mode(self.llm.config) == "stub":
            from agents.fault_perception.deterministic_diagnoser import diagnose_deterministic

            self._emit_progress("deterministic_mode", {"session_id": session_id})
            result = await diagnose_deterministic(
                case_data, assessment, session_id, assessment.route, self.progress_callback
            )
            result.route_taken = assessment.route
            result.session_id = session_id
            return result

        # Initialize context
        ctx = self.context_manager.initialize(
            case_data, assessment, assessment.route, max_iterations
        )

        # Build system prompt
        kpi_summary = self._summarize_kpi(case_data)
        topo_summary = case_data.topology_text[:500]

        system_prompt = self.prompt_builder.build_system_prompt(
            case_id=case_data.case_id,
            kpi_summary=kpi_summary,
            topology_summary=topo_summary,
            assessment=assessment,
            mode=assessment.route,
            max_iterations=max_iterations,
        )

        # Initial user message
        user_msg = self.context_manager.build_user_message(case_data)
        ctx.messages.append({"role": "user", "content": user_msg})

        # Get tool schemas
        tool_schemas = schemas_as_tool_objects()
        # Add submit_diagnosis as a special tool
        tool_schemas.append(
            type(
                "ToolSchema",
                (),
                {
                    "name": "submit_diagnosis",
                    "description": SUBMIT_DIAGNOSIS_SCHEMA["description"],
                    "parameters": SUBMIT_DIAGNOSIS_SCHEMA["parameters"],
                },
            )()
        )

        iteration = 0
        while iteration < max_iterations:
            iteration += 1
            ctx.iteration = iteration

            self._emit_progress(
                "agent_step",
                {
                    "session_id": session_id,
                    "iteration": iteration,
                    "max": max_iterations,
                },
            )

            # Build messages for API call
            api_messages = [{"role": "system", "content": system_prompt}] + ctx.messages[-20:]

            try:
                response = await self.llm.chat(api_messages, tools=tool_schemas)
                ctx.tokens_used += response.usage.get("total_tokens", 0)
            except Exception as e:
                logger.error("LLM call failed at iteration %d: %s", iteration, e)
                break

            # Check for submit_diagnosis
            diagnosis = self._check_submit_diagnosis(response, case_data.case_id, session_id)
            if diagnosis:
                diagnosis.reasoning_trace = ctx.reasoning_trace
                diagnosis.iterations_used = iteration
                diagnosis.tokens_used = ctx.tokens_used
                diagnosis.llm_model = self.llm.config.model
                diagnosis.route_taken = assessment.route
                return diagnosis

            # Check for text-only response (no tool calls)
            if not response.has_tool_calls:
                # LLM finished without calling submit_diagnosis
                ctx.add_thinking_step(response.content or "No tool calls, no diagnosis submitted")

                # On last iteration, force a partial diagnosis
                if iteration >= max_iterations - 1:
                    return self._create_timeout_diagnosis(
                        ctx, case_data.case_id, session_id, assessment
                    )

                # Add assistant response and ask for diagnosis
                ctx.add_assistant_message(response.content or "")
                ctx.messages.append(
                    {
                        "role": "user",
                        "content": "Please analyze the data using your tools and submit your diagnosis using submit_diagnosis.",
                    }
                )
                continue

            # Process tool calls
            ctx.add_assistant_message(
                response.content or "",
                [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": tc.arguments},
                    }
                    for tc in response.tool_calls
                ],
            )

            for tc in response.tool_calls:
                try:
                    args = json.loads(tc.arguments)
                except json.JSONDecodeError:
                    args = {}

                self._emit_progress(
                    "tool_call",
                    {
                        "session_id": session_id,
                        "tool": tc.name,
                        "iteration": iteration,
                    },
                )

                # Execute tool
                if tc.name == "submit_diagnosis":
                    diag = self._parse_diagnosis_from_args(args, case_data.case_id, session_id)
                    if diag:
                        diag.reasoning_trace = ctx.reasoning_trace
                        diag.iterations_used = iteration
                        diag.tokens_used = ctx.tokens_used
                        diag.llm_model = self.llm.config.model
                        diag.route_taken = assessment.route
                        return diag
                    ctx.add_tool_result(
                        tc.id,
                        "Invalid diagnosis format. Please provide fault_elements, fault_type, and confidence.",
                    )
                else:
                    # Dispatch to tool registry
                    result_str = await tool_dispatch(tc.name, args)
                    ctx.add_tool_step(tc.name, args, result_str)
                    ctx.add_tool_result(tc.id, result_str)

                    # Save to DB
                    self.storage.save_reasoning_step(
                        session_id=session_id,
                        step_number=ctx.step_counter,
                        step_type="tool_call",
                        content=f"Called {tc.name}",
                        tool_name=tc.name,
                        tool_args=json.dumps(args)[:200],
                        tool_result=result_str[:500],
                    )

            # Trim context if needed
            ctx.trim_history()

        # Timeout
        return self._create_timeout_diagnosis(ctx, case_data.case_id, session_id, assessment)

    def _check_submit_diagnosis(
        self, response: LLMResponse, case_id: int, session_id: str
    ) -> DiagnosisResult | None:
        """Check if LLM called submit_diagnosis."""
        for tc in response.tool_calls:
            if tc.name == "submit_diagnosis":
                try:
                    args = json.loads(tc.arguments)
                    return self._parse_diagnosis_from_args(args, case_id, session_id)
                except (json.JSONDecodeError, ValueError):
                    return None
        return None

    def _parse_diagnosis_from_args(
        self, args: dict, case_id: int, session_id: str
    ) -> DiagnosisResult | None:
        """Parse diagnosis from submit_diagnosis tool arguments."""
        try:
            traffic_filter = args.get("traffic_filter")
            if not isinstance(traffic_filter, dict):
                traffic_filter = None
            return DiagnosisResult(
                session_id=session_id,
                case_id=case_id,
                fault_elements=args.get("fault_elements", []),
                fault_links=args.get("fault_links", []),
                fault_type=args.get("fault_type", "unknown"),
                fault_mode=args.get("fault_mode"),
                confidence=float(args.get("confidence", 0.5)),
                route_taken=Route.AUTONOMOUS,  # Will be overridden
                status=SessionStatus.COMPLETED,
                traffic_filter=traffic_filter,
            )
        except (ValueError, TypeError):
            return None

    def _create_timeout_diagnosis(
        self, ctx, case_id: int, session_id: str, assessment: ConfidenceAssessment
    ) -> DiagnosisResult:
        """Create a diagnosis for timeout cases."""
        ctx.reasoning_trace.append(
            ReasoningStep(
                step_number=ctx.step_counter + 1,
                step_type="conclusion",
                content="Diagnosis timed out. Returning partial result.",
            )
        )
        return DiagnosisResult(
            session_id=session_id,
            case_id=case_id,
            fault_type="timeout",
            confidence=0.0,
            route_taken=assessment.route,
            reasoning_trace=ctx.reasoning_trace,
            iterations_used=ctx.iteration,
            tokens_used=ctx.tokens_used,
            status=SessionStatus.TIMEOUT,
        )

    def _summarize_kpi(self, case_data: CaseData) -> str:
        """Create a brief KPI summary for the prompt."""
        link_rows = [r for r in case_data.kpi_rows if str(r.get("level", "")) == "link"]
        if not link_rows:
            return "No link-level KPI data available."

        rates = [float(r.get("success_rate", 1.0)) for r in link_rows]
        min_sr = min(rates)
        avg_sr = sum(rates) / len(rates)
        below_99 = sum(1 for r in rates if r < 0.99)

        return (
            f"Link KPI: {len(link_rows)} entries, min={min_sr:.4f}, avg={avg_sr:.4f}, "
            f"below_0.99={below_99}"
        )

    def _emit_progress(self, event_type: str, data: dict) -> None:
        if self.progress_callback:
            self.progress_callback({"type": event_type, **data})


async def main():
    """CLI entry point for fault perception agent."""
    import argparse
    import csv

    parser = argparse.ArgumentParser(description="5GC Fault Perception Agent")
    parser.add_argument("--case-id", type=int, required=True, help="Case ID to diagnose")
    parser.add_argument("--data-dir", default="./data", help="Data directory")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )

    agent = FaultPerceptionAgent()

    # Load case data
    case_dir = Path(args.data_dir) / f"case_{args.case_id:03d}"
    if not case_dir.exists():
        print(f"Case directory not found: {case_dir}")
        return

    # Parse data.csv
    kpi_rows = []
    with open(case_dir / "data.csv", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            kpi_rows.append(row)

    # Parse topology
    topo_text = (case_dir / "topo.txt").read_text(encoding="utf-8")

    # Parse process
    process_text = (case_dir / "process.txt").read_text(encoding="utf-8")

    # Parse result (ground truth)
    result_text = (case_dir / "result.txt").read_text(encoding="utf-8")
    ground_truth = json.loads(result_text)

    case_data = CaseData(
        case_id=args.case_id,
        kpi_rows=kpi_rows,
        topology_text=topo_text,
        process_text=process_text,
        ground_truth=ground_truth,
    )

    # Run diagnosis
    result = await agent.diagnose(case_data)

    print("\n=== Diagnosis Result ===")
    print(f"Session: {result.session_id}")
    print(f"Fault type: {result.fault_type}")
    print(f"Fault elements: {result.fault_elements}")
    print(f"Fault links: {result.fault_links}")
    print(f"Confidence: {result.confidence}")
    print(f"Route: {result.route_taken.value}")
    print(f"Iterations: {result.iterations_used}")

    print("\n=== Ground Truth ===")
    print(f"Fault elements: {ground_truth.get('fault_elements', [])}")
    print(f"Fault links: {ground_truth.get('fault_links', [])}")

    # Compare
    pred = set(result.fault_elements)
    truth = set(ground_truth.get("fault_elements", []))
    if pred == truth:
        print("\n✓ EXACT MATCH")
    elif pred & truth:
        print(f"\n~ PARTIAL MATCH (TP={pred & truth}, FP={pred - truth}, FN={truth - pred})")
    else:
        print("\n✗ NO MATCH")


if __name__ == "__main__":
    from pathlib import Path

    asyncio.run(main())
