"""Exploration-mode orchestrator (Phase 2).

When a case routes to ``Route.EXPLORATION`` (ambiguous KPIs but CHR shows
concentrated failures), this orchestrates a multi-algorithm framework:

  1. Run each detector via ``sweep_runner`` (statistical + ML over KPI views)
     and the CHR-driven analysers directly.
  2. Fuse all detector findings into a ranked fault posterior
     (``bayesian_fusion``) — agreement across *independent* algorithms is
     rewarded multiplicatively.
  3. Synthesize a single ``DiagnosisResult``. The LLM refines fault_type /
     reasoning when an API key is configured; otherwise the deterministic
     posterior is used (so exploration works without an LLM).

The old LLM-only ``explore`` is replaced, but the class name and ``explore``
signature are kept so ``agent.py``'s instantiation is unchanged.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from agents.fault_perception.exploration_config import ExplorationConfig
from agents.shared.llm_client import LLMClient
from agents.shared.models import CaseData, DiagnosisResult, ReasoningStep, Route, SessionStatus

logger = logging.getLogger(__name__)

# Detectors run via sweep_runner over the KPI link view.
_KPI_DETECTORS = ("ewma_changepoint", "cusum_changepoint", "pca_residual", "isolation_forest")
# CHR-driven detectors (no param sweep; called directly).
_CHR_DETECTORS = ("ue_failure_concentration", "correlated_failure_graph")


class ParallelExplorer:
    """Orchestrates the multi-algorithm exploration framework on CHR-bearing cases."""

    def __init__(
        self, llm_client: LLMClient, max_paths: int = 3, config: ExplorationConfig | None = None
    ):
        self.llm = llm_client
        self.config = config or ExplorationConfig()
        # Repurpose the legacy max_paths knob as the parallelism cap.
        self.max_parallel_jobs = self.config.max_parallel_jobs or max_paths

    async def explore(
        self, case_data: CaseData, hypotheses: list[str], system_prompt: str, session_id: str
    ) -> DiagnosisResult:
        """Run the full exploration framework and return one synthesised result.

        ``hypotheses`` is unused — exploration is algorithm-driven, not
        hypothesis-driven (kept for signature compatibility).
        """
        findings, patterns = await self._run_algorithms(case_data)
        fused = await self._fuse(findings)
        ablation = await self._ablation(findings, fused)
        return await self._synthesize(
            fused, findings, patterns, ablation, case_data, system_prompt, session_id
        )

    # ------------------------------------------------------------------
    # Stage 1: run detectors
    # ------------------------------------------------------------------
    async def _run_algorithms(self, case_data: CaseData) -> tuple[list[dict], dict[str, str]]:
        from tools.registry import dispatch

        kpi_rows = case_data.kpi_rows
        chr_records = case_data.chr_records
        cfg = self.config
        sem = asyncio.Semaphore(self.max_parallel_jobs)
        # Focus the changepoint detectors on the most-implicated NE (appears in
        # the most anomalous link rows) so their evidence is informative for the
        # fusion rather than flagging every anomalous NE. PCA/IF ignore target.
        target = self._guess_target(kpi_rows)

        async def sweep_kpi(algo: str) -> dict:
            async with sem:
                try:
                    r = json.loads(
                        await dispatch(
                            "sweep_runner",
                            {
                                "algorithm": algo,
                                "data_view": "link_kpi",
                                "target": target,
                                "kpi_rows": kpi_rows,
                                "params": cfg.grid_for(algo),
                            },
                        )
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("sweep %s failed: %s", algo, e)
                    return {
                        "algorithm": algo,
                        "data_view": "link_kpi",
                        "evidence_elements": [],
                        "confidence": 0.0,
                    }
                bc = r.get("best_cell") or {}
                return {
                    "algorithm": algo,
                    "data_view": "link_kpi",
                    "evidence_elements": bc.get("evidence_elements", []),
                    "confidence": bc.get("confidence", 0.0),
                }

        async def run_chr(algo: str) -> tuple[dict, str]:
            async with sem:
                try:
                    r = json.loads(await dispatch(algo, {"chr_records": chr_records}))
                except Exception as e:  # noqa: BLE001
                    logger.warning("CHR detector %s failed: %s", algo, e)
                    return (
                        {
                            "algorithm": algo,
                            "data_view": "chr_attempt",
                            "evidence_elements": [],
                            "confidence": 0.0,
                        },
                        "none",
                    )
                return (
                    {
                        "algorithm": algo,
                        "data_view": "chr_attempt",
                        "evidence_elements": r.get("evidence_elements", []),
                        "confidence": r.get("confidence", 0.0),
                    },
                    r.get("pattern", "none"),
                )

        tasks = [sweep_kpi(a) for a in _KPI_DETECTORS]
        chr_tasks = [run_chr(a) for a in _CHR_DETECTORS] if chr_records else []

        # 均质化独占率 detector(通用):「全路径退化」的离群根因 —— 端到端流程
        # 归因下,网元故障会把前端路径染成普遍劣化,但真根因自身全部链路退化。
        # 作为独立 finding 进入贝叶斯融合(与统计/ML 检测器互证)。
        async def run_exclusivity() -> dict:
            from collections import Counter

            from tools.kpi_analyzer import degradation_exclusivity, isolated_by_policy

            _excluded = isolated_by_policy(case_data)
            link_rows = [r for r in kpi_rows if str(r.get("level", "")) == "link"]
            app: Counter = Counter()
            for r in link_rows:
                if float(r.get("success_rate", 1.0)) < 0.995:
                    app[str(r.get("src", ""))] += 1
                    app[str(r.get("dst", ""))] += 1
            candidates = [ne for ne, c in app.items()
                          if c >= 2 and not ne.startswith("UE") and ne not in _excluded]
            ranked = sorted(
                ((degradation_exclusivity(link_rows, ne)[0], ne) for ne in candidates),
                reverse=True,
            )
            if ranked and ranked[0][0] >= 0.6:
                # top-2 进证据(微损小样本下独占率有波动,交给贝叶斯融合定权)
                return {
                    "algorithm": "degradation_exclusivity",
                    "data_view": "link_kpi",
                    "evidence_elements": [ne for _, ne in ranked[:2]],
                    "confidence": round(ranked[0][0], 3),
                }
            return {
                "algorithm": "degradation_exclusivity",
                "data_view": "link_kpi",
                "evidence_elements": [],
                "confidence": 0.0,
            }

        tasks.append(run_exclusivity())
        results = await asyncio.gather(*tasks, *chr_tasks, return_exceptions=False)

        findings: list[dict] = list(results[: len(_KPI_DETECTORS) + 1])
        patterns: dict[str, str] = {}
        for res in results[len(_KPI_DETECTORS) + 1 :]:
            finding, pattern = res  # type: ignore[misc]
            findings.append(finding)
            patterns[finding["algorithm"]] = pattern
        return findings, patterns

    # ------------------------------------------------------------------
    # Stage 2: fuse
    # ------------------------------------------------------------------
    @staticmethod
    def _guess_target(kpi_rows: list[dict]) -> str:
        """Most-implicated NE: appears in the most anomalous link rows."""
        from collections import Counter

        cnt: Counter = Counter()
        for r in kpi_rows:
            if str(r.get("level", "")) == "link" and float(r.get("success_rate", 1.0)) < 0.995:
                cnt[str(r.get("src", ""))] += 1
                cnt[str(r.get("dst", ""))] += 1
        if not cnt:
            return ""
        return cnt.most_common(1)[0][0]

    async def _fuse(self, findings: list[dict]) -> dict:
        from tools.registry import dispatch

        out = json.loads(
            await dispatch(
                "bayesian_fusion",
                {
                    "findings": findings,
                    "base_rate": self.config.base_rate,
                },
            )
        )
        return out

    async def _ablation(self, findings: list[dict], base_fused: dict) -> dict:
        """Leave-one-out: does dropping any single algorithm flip the top candidate?

        A robust diagnosis survives dropping any one detector; a fragile one
        flips, and the synthesiser downgrades its confidence accordingly.
        """
        from tools.registry import dispatch

        base_top = base_fused.get("top_element")
        flipped_by: list[str] = []
        alternatives: list[dict] = []
        for i in range(len(findings)):
            subset = findings[:i] + findings[i + 1 :]
            if len(subset) < 2:
                continue
            try:
                r = json.loads(
                    await dispatch(
                        "bayesian_fusion",
                        {
                            "findings": subset,
                            "base_rate": self.config.base_rate,
                        },
                    )
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("ablation fusion failed: %s", e)
                continue
            alt_top = r.get("top_element")
            alternatives.append(
                {
                    "dropped": findings[i].get("algorithm"),
                    "top": alt_top,
                    "posterior": r.get("top_posterior"),
                }
            )
            if alt_top != base_top:
                flipped_by.append(findings[i].get("algorithm", "?"))
        return {
            "base_top": base_top,
            "flipped_by": flipped_by,
            "robust": not flipped_by,
            "alternatives": alternatives,
        }

    # ------------------------------------------------------------------
    # Stage 3: synthesise
    # ------------------------------------------------------------------
    def _derive_fault_type(self, patterns: dict[str, str]) -> str:
        graph = patterns.get("correlated_failure_graph", "none")
        if graph == "single_ne":
            return "single_ne"
        if graph == "cluster":
            return "resource_pool"  # dense interconnected cluster
        if graph == "scattered":
            return "multi_ne"
        ue = patterns.get("ue_failure_concentration", "none")
        if ue == "single_ne":
            return "single_ne"
        if ue == "multi_ne":
            return "multi_ne"
        return "single_ne"

    async def _synthesize(
        self,
        fused: dict,
        findings: list[dict],
        patterns: dict[str, str],
        ablation: dict,
        case_data: CaseData,
        system_prompt: str,
        session_id: str,
    ) -> DiagnosisResult:
        step = 0

        def next_step() -> int:
            nonlocal step
            step += 1
            return step

        top = fused.get("top_element")
        posterior = float(fused.get("top_posterior", 0.0))
        agreement = int(fused.get("top_agreement", 0))
        fault_type = self._derive_fault_type(patterns)
        fault_elements = [top] if top else []
        confidence = posterior

        reasoning = (
            f"Exploration fused {len(findings)} detector findings: "
            f"top={top} posterior={posterior:.3f} agreement={agreement}/{len(findings)}."
        )

        trace: list[ReasoningStep] = [
            ReasoningStep(
                step_number=next_step(),
                step_type="tool_result",
                content=reasoning,
                tool_name="bayesian_fusion",
                tool_result=json.dumps(fused, ensure_ascii=False)[:2000],
            )
        ]

        # Ablation fragility: if dropping any one algorithm flips the top
        # candidate, downgrade confidence and flag the uncertainty.
        if not ablation.get("robust", True):
            confidence = max(0.0, confidence - self.config.ablation_flip_penalty)
            trace.append(
                ReasoningStep(
                    step_number=next_step(),
                    step_type="thinking",
                    content=(
                        f"Ablation fragile — dropping {ablation.get('flipped_by')} flips the "
                        f"top candidate; confidence reduced by {self.config.ablation_flip_penalty}."
                    ),
                )
            )

        llm_model = ""
        if top and self._llm_enabled():
            try:
                refined = await self._llm_synthesize(
                    fused, findings, patterns, case_data, system_prompt
                )
                if refined:
                    fault_elements = refined.get("fault_elements") or fault_elements
                    fault_type = refined.get("fault_type") or fault_type
                    confidence = min(max(float(refined.get("confidence", confidence)), 0.0), 1.0)
                    reasoning = refined.get("reasoning", reasoning)
                    llm_model = self.llm.config.model
                    trace.append(
                        ReasoningStep(
                            step_number=next_step(),
                            step_type="thinking",
                            content=f"LLM synthesis: {reasoning}",
                        )
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning("LLM synthesis failed; using deterministic posterior: %s", e)

        # Full findings + ablation report for offline inspection.
        trace.append(
            ReasoningStep(
                step_number=next_step(),
                step_type="tool_result",
                content=(
                    f"FindingsReport: {len(findings)} detectors, "
                    f"ablation robust={ablation.get('robust')}."
                ),
                tool_name="exploration_findings",
                tool_result=json.dumps(
                    {"fused": fused, "ablation": ablation, "patterns": patterns}, ensure_ascii=False
                )[:2000],
            )
        )

        return DiagnosisResult(
            session_id=session_id,
            case_id=case_data.case_id,
            fault_elements=fault_elements,
            fault_type=fault_type,
            confidence=confidence,
            route_taken=Route.EXPLORATION,
            reasoning_trace=trace,
            llm_model=llm_model,
            status=SessionStatus.COMPLETED,
        )

    # ------------------------------------------------------------------
    # Optional LLM refinement
    # ------------------------------------------------------------------
    def _llm_enabled(self) -> bool:
        cfg = self.llm.config
        return bool(
            getattr(cfg, "api_key", "") or os.environ.get(getattr(cfg, "api_key_env", ""), "")
        )

    async def _llm_synthesize(
        self,
        fused: dict,
        findings: list[dict],
        patterns: dict[str, str],
        case_data: CaseData,
        system_prompt: str,
    ) -> dict | None:
        """Ask the LLM to turn the findings into a refined JSON diagnosis."""
        report = {
            "posterior": fused.get("posterior", []),
            "top_element": fused.get("top_element"),
            "top_posterior": fused.get("top_posterior"),
            "top_agreement": fused.get("top_agreement"),
            "detector_patterns": patterns,
            "findings_summary": [
                {
                    "algorithm": f["algorithm"],
                    "confidence": f["confidence"],
                    "evidence": f["evidence_elements"][:6],
                }
                for f in findings
            ],
        }
        user = (
            "You are diagnosing a 5GC fault in exploration mode (ambiguous KPIs, "
            "CHR-driven). A multi-algorithm framework produced the findings below. "
            "Produce the final diagnosis as JSON with keys fault_elements (list of "
            "NE ids), fault_type, confidence (0-1), reasoning.\n\n"
            f"{json.dumps(report, ensure_ascii=False, indent=2)}"
        )
        response = await self.llm.chat_simple(system=system_prompt, user=user, temperature=0.2)
        return self._parse_json_diagnosis(response)

    @staticmethod
    def _parse_json_diagnosis(response: str) -> dict | None:
        text = (response or "").strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        return data
