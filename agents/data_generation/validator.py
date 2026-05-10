"""LLM-based data validation for generated fault cases."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from agents.shared.llm_client import LLMClient, LLMConfig
from agents.shared.models import CasePackage, ValidationStatus

logger = logging.getLogger(__name__)

VALIDATION_SYSTEM_PROMPT = """You are a data quality validator for 5G core network fault simulation data.
Your job is to verify that generated fault cases are correct, consistent, and suitable for training/testing fault diagnosis systems.

Check the following aspects:
1. **KPI Consistency**: Do the KPI values show clear anomalies during the fault window? Are normal periods clean (>99% success rate)?
2. **Fault Manifestation**: Does the fault affect the correct network elements? Are the degraded links/traces consistent with the fault type?
3. **Topology Coherence**: Is the topology information consistent with the KPI data? Do the NE IDs in KPI data exist in the topology?
4. **Process Validity**: Are the UE routing paths valid given the topology? Do they follow proper business process flows?
5. **Label Correctness**: Do the fault labels (fault_elements/fault_links) match what the KPI data actually shows?

Respond in JSON format:
{
  "passed": true/false,
  "checks": {
    "kpi_consistency": {"passed": bool, "note": "..."},
    "fault_manifestation": {"passed": bool, "note": "..."},
    "topology_coherence": {"passed": bool, "note": "..."},
    "process_validity": {"passed": bool, "note": "..."},
    "label_correctness": {"passed": bool, "note": "..."}
  },
  "overall_note": "brief summary of quality assessment",
  "suggestions": ["list of improvements if any"]
}
"""

MAX_CSV_ROWS_FOR_VALIDATION = 200


@dataclass
class ValidationResult:
    passed: bool
    checks: dict
    overall_note: str
    suggestions: list[str]

    @property
    def feedback(self) -> str:
        parts = [self.overall_note]
        for name, check in self.checks.items():
            if not check.get("passed", True):
                parts.append(f"- {name}: {check.get('note', '')}")
        return "\n".join(parts)


class LLMValidator:
    """Validates generated fault cases using LLM analysis."""

    def __init__(self, llm_client: LLMClient | None = None, llm_config: LLMConfig | None = None):
        if llm_client:
            self.llm = llm_client
        elif llm_config:
            self.llm = LLMClient(llm_config)
        else:
            self.llm = LLMClient(LLMConfig(model="gpt-4o-mini"))

    async def validate(self, case: CasePackage) -> ValidationResult:
        """Validate a single case using LLM analysis."""
        # Prepare a compact representation for the LLM
        user_prompt = self._build_validation_prompt(case)

        try:
            response = await self.llm.chat_simple(
                system=VALIDATION_SYSTEM_PROMPT,
                user=user_prompt,
                temperature=0.1,
            )
            return self._parse_response(response)
        except Exception as e:
            logger.error("Validation LLM call failed for case %d: %s", case.case_id, e)
            return ValidationResult(
                passed=False,
                checks={"llm_error": {"passed": False, "note": str(e)}},
                overall_note=f"LLM validation failed: {e}",
                suggestions=[],
            )

    def _build_validation_prompt(self, case: CasePackage) -> str:
        """Build a compact validation prompt from case data."""
        # Truncate CSV for token efficiency
        csv_lines = case.kpi_data.strip().split("\n")
        header = csv_lines[0]
        if len(csv_lines) > MAX_CSV_ROWS_FOR_VALIDATION:
            # Sample: header + first rows + rows around fault window + last rows
            sampled = [header]
            sampled.extend(csv_lines[1:20])
            sampled.extend(csv_lines[len(csv_lines)//2-10:len(csv_lines)//2+10])
            sampled.extend(csv_lines[-20:])
            csv_sample = "\n".join(sampled) + f"\n... (truncated, total {len(csv_lines)} rows)"
        else:
            csv_sample = case.kpi_data

        # Truncate process text
        process_lines = case.process_text.split("\n")
        if len(process_lines) > 30:
            process_sample = "\n".join(process_lines[:10]) + f"\n... ({len(process_lines)-20} UE routes omitted)\n" + "\n".join(process_lines[-10:])
        else:
            process_sample = case.process_text

        return f"""Please validate this 5GC fault simulation case (ID: {case.case_id}):

## Fault Metadata
{case.metadata.to_json()}

## KPI Data (sample)
{csv_sample}

## Topology
{case.topology_text}

## Business Process
{process_sample}

## Expected Fault Labels (result.txt)
{case.result_text}

Validate this case and respond in JSON format as instructed."""

    def _parse_response(self, response: str) -> ValidationResult:
        """Parse LLM response into ValidationResult."""
        # Extract JSON from response (handle markdown code blocks)
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("Failed to parse validation response as JSON: %s", response[:200])
            return ValidationResult(
                passed=False,
                checks={"parse_error": {"passed": False, "note": "Failed to parse LLM response"}},
                overall_note="Validation response could not be parsed",
                suggestions=[],
            )

        return ValidationResult(
            passed=data.get("passed", False),
            checks=data.get("checks", {}),
            overall_note=data.get("overall_note", ""),
            suggestions=data.get("suggestions", []),
        )
