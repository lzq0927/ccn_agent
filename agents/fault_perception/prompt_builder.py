"""System prompt builder with progressive skill disclosure."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from agents.shared.models import Route

if TYPE_CHECKING:
    from agents.shared.models import ConfidenceAssessment

logger = logging.getLogger(__name__)

AGENT_IDENTITY = """You are a 5G Core Network fault diagnosis agent. Your task is to analyze KPI data, topology, and business flow information to identify the root cause of network faults.

You have access to diagnostic tools for KPI analysis, topology queries, flow tracing, and fault isolation. Use them systematically to build evidence for your diagnosis.

When you have identified the fault with sufficient confidence, provide your final diagnosis using the `submit_diagnosis` function."""

SKILLS_GUIDANCE = """
## Available Skills (Level 0 Index)
{skill_index}

When you need detailed diagnostic procedures for a specific fault type, use `view_skill` to load the full skill content.
After solving a difficult case, you may create a new skill with `manage_skill` to remember the approach.
"""

TOOL_USE_RULES = """
## Tool Use Rules
1. Always start by analyzing KPI anomalies before jumping to conclusions
2. Use topology tools to understand the network structure
3. Cross-reference degraded links with topology for spatial analysis
4. Check temporal patterns to confirm fault window
5. Verify your hypothesis by checking UE impact
6. Call `submit_diagnosis` when you have a confident answer
7. Do NOT make more than {max_iterations} tool call iterations
"""

MEMORY_TEMPLATE = """
## Agent Memory
{memory_content}
"""

CASE_CONTEXT_TEMPLATE = """
## Current Case Data
- Case ID: {case_id}
- Topology:
{topology_summary}
- KPI Summary: {kpi_summary}
- Fault Assessment: confidence={confidence}, route={route}, suggested patterns={patterns}
"""


class PromptBuilder:
    """Builds system prompts with progressive skill disclosure."""

    def __init__(self, skill_dir: str = "./skills", memory_dir: str = "./memory"):
        self.skill_dir = Path(skill_dir)
        self.memory_dir = Path(memory_dir)
        self._skill_index: str | None = None

    def build_system_prompt(
        self,
        case_id: int,
        kpi_summary: str,
        topology_summary: str,
        assessment: "ConfidenceAssessment",
        mode: Route,
        max_iterations: int = 30,
    ) -> str:
        parts = [AGENT_IDENTITY]

        # Load skill index (L0)
        parts.append(SKILLS_GUIDANCE.format(skill_index=self._load_skill_index()))

        # For WORKFLOW mode, include the specific workflow skill
        if mode == Route.WORKFLOW and assessment.suggested_workflow:
            workflow_content = self._load_skill_l1(assessment.suggested_workflow)
            if workflow_content:
                parts.append(f"## Active Workflow\n{workflow_content}")

        # For GUIDED mode, include L1 for suggested skills
        elif mode == Route.GUIDED:
            for skill_name in assessment.suggested_skills[:2]:
                skill_content = self._load_skill_l1(skill_name)
                if skill_content:
                    parts.append(f"## Skill: {skill_name}\n{skill_content}")

        # For EXPLORATION mode, load the exploration-mode skill (micro-loss / CHR)
        elif mode == Route.EXPLORATION:
            exploration_content = self._load_skill_l1("exploration_mode")
            if exploration_content:
                parts.append(f"## Exploration Mode\n{exploration_content}")

        # Memory
        memory_content = self._load_memory()
        if memory_content:
            parts.append(MEMORY_TEMPLATE.format(memory_content=memory_content))

        # Tool use rules
        parts.append(TOOL_USE_RULES.format(max_iterations=max_iterations))

        # Case context
        parts.append(CASE_CONTEXT_TEMPLATE.format(
            case_id=case_id,
            kpi_summary=kpi_summary,
            topology_summary=topology_summary,
            confidence=assessment.score,
            route=assessment.route.value,
            patterns=", ".join(assessment.matched_patterns),
        ))

        return "\n\n".join(parts)

    def _load_skill_index(self) -> str:
        if self._skill_index is None:
            index_file = self.skill_dir / "index.md"
            if index_file.exists():
                self._skill_index = index_file.read_text(encoding="utf-8")
            else:
                self._skill_index = "No skills loaded."
        return self._skill_index

    def _load_skill_l1(self, skill_name: str) -> str | None:
        # Search in core/, workflows/, learned/, exploration/
        for subdir in ["core", "workflows", "learned", "exploration"]:
            skill_file = self.skill_dir / subdir / f"{skill_name}.md"
            if skill_file.exists():
                return skill_file.read_text(encoding="utf-8")
        return None

    def _load_memory(self) -> str:
        mem_file = self.memory_dir / "MEMORY.md"
        if mem_file.exists():
            content = mem_file.read_text(encoding="utf-8")
            # Truncate to keep prompt manageable
            if len(content) > 2000:
                return content[:2000] + "\n... (truncated)"
            return content
        return ""
