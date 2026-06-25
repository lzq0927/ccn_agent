"""Context manager for maintaining conversation history within token limits."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from agents.shared.models import CaseData, Route, ConfidenceAssessment, ReasoningStep

logger = logging.getLogger(__name__)

MAX_CONTEXT_MESSAGES = 50


@dataclass
class AgentContext:
    """Maintains the state of a single diagnosis session."""

    case_id: int
    case_data: CaseData
    assessment: ConfidenceAssessment
    route: Route
    mode: str  # "workflow", "guided", "autonomous"
    messages: list[dict] = field(default_factory=list)
    reasoning_trace: list[ReasoningStep] = field(default_factory=list)
    iteration: int = 0
    max_iterations: int = 30
    tokens_used: int = 0
    step_counter: int = 0

    def add_assistant_message(self, content: str, tool_calls: list | None = None) -> None:
        msg = {"role": "assistant", "content": content}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        self.messages.append(msg)

    def add_tool_result(self, tool_call_id: str, content: str) -> None:
        self.messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": content,
            }
        )

    def add_thinking_step(self, content: str) -> int:
        self.step_counter += 1
        step = ReasoningStep(
            step_number=self.step_counter,
            step_type="thinking",
            content=content,
        )
        self.reasoning_trace.append(step)
        return self.step_counter

    def add_tool_step(self, tool_name: str, args: dict, result: str) -> int:
        self.step_counter += 1
        step = ReasoningStep(
            step_number=self.step_counter,
            step_type="tool_call",
            content=f"Called {tool_name}",
            tool_name=tool_name,
            tool_args=args,
            tool_result=result[:500] if result else "",  # Truncate for storage
        )
        self.reasoning_trace.append(step)
        return self.step_counter

    def trim_history(self) -> None:
        """Keep conversation history within limits by removing oldest messages."""
        if len(self.messages) > MAX_CONTEXT_MESSAGES:
            # Keep system message + recent messages
            self.messages = self.messages[-(MAX_CONTEXT_MESSAGES - 1) :]


class ContextManager:
    """Manages agent context for each diagnosis session."""

    def initialize(
        self,
        case_data: CaseData,
        assessment: ConfidenceAssessment,
        route: Route,
        max_iterations: int,
    ) -> AgentContext:
        mode = route.value
        return AgentContext(
            case_id=case_data.case_id,
            case_data=case_data,
            assessment=assessment,
            route=route,
            mode=mode,
            max_iterations=max_iterations,
        )

    def get_history(self, context: AgentContext) -> list[dict]:
        return context.messages

    def build_user_message(self, case_data: CaseData) -> str:
        """Build the initial user message with case data for the agent."""
        link_rows = [r for r in case_data.kpi_rows if str(r.get("level", "")) == "link"]

        # Sample KPI data: first few + around fault window + last few
        if len(link_rows) > 100:
            sample = (
                link_rows[:20]
                + link_rows[len(link_rows) // 2 - 10 : len(link_rows) // 2 + 10]
                + link_rows[-20:]
            )
        else:
            sample = link_rows[:50]

        kpi_str = "\n".join(
            f"  ts={r.get('timestamp', 0)}, {r.get('src', '')}->{r.get('dst', '')}, "
            f"sr={float(r.get('success_rate', 1.0)):.4f}"
            for r in sample
        )
        if len(link_rows) > 100:
            kpi_str += f"\n  ... ({len(link_rows)} total link entries)"

        chr_block = self._chr_failure_block(case_data.chr_records)

        return f"""Please diagnose the fault in this 5GC case (ID: {case_data.case_id}).

## KPI Data (link level, sample):
{kpi_str}

## Topology:
{case_data.topology_text[:1000]}

## Process:
{case_data.process_text[:500]}
{chr_block}Analyze the data using the available tools and provide your diagnosis. Start by checking for KPI anomalies, then use the user-level CHR to confirm or rule out faults."""

    @staticmethod
    def _chr_failure_block(chr_records: list[dict], max_chars: int = 600) -> str:
        """Render a compact CHR failure summary for the diagnosis prompt.

        CHR (per-subscriber signaling history with 5G cause codes) is the signal
        that disambiguates real network faults from terminal / fluctuation noise
        when KPI drops are subtle. Empty when no CHR is available.
        """
        if not chr_records:
            return ""
        from collections import Counter

        failures = [r for r in chr_records if r.get("outcome") == "failure"]
        total = len(chr_records)
        cause_counts = Counter(r.get("cause5gsm") or r.get("cause5gmm") or "?" for r in failures)
        lines = [
            f"\n## User-level CHR (free5GC, {len(failures)} failures / {total} attempts):",
            "Cause distribution: " + ", ".join(f"{c}({n})" for c, n in cause_counts.most_common(5)),
        ]
        for r in failures[:10]:
            supi = str(r.get("supi", ""))[:20]
            lines.append(
                f"  ts={r.get('timestamp')} supi={supi} {r.get('nf_src', '')}->"
                f"{r.get('nf_dst', '')} sbi={r.get('sbi_status')} "
                f"5gsm={r.get('cause5gsm')} 5gmm={r.get('cause5gmm')}"
            )
        block = "\n".join(lines)
        return block[:max_chars] + "\n"
