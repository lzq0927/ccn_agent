"""Confidence assessment module for routing diagnosis requests.

Three-tier routing:
  score > 0.7  -> WORKFLOW (fixed steps, minimal/no LLM)
  0.3 < score <= 0.7 -> GUIDED (agent loop with skill constraints)
  score <= 0.3 -> AUTONOMOUS (full agent loop, parallel exploration)
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from dataclasses import dataclass

from agents.shared.models import CaseData, ConfidenceAssessment, Route

logger = logging.getLogger(__name__)

THRESHOLD_HIGH = 0.7
THRESHOLD_LOW = 0.3

# SBI status codes that indicate a real NF/transport failure (not just radio).
_SBI_FAILURE_STATUSES = {408, 429, 500, 502, 503, 504}


def _gini(values: list[int]) -> float:
    """Gini coefficient in [0, 1]; 0 = evenly spread, 1 = all mass in one bucket."""
    n = len(values)
    if n == 0:
        return 0.0
    total = sum(values)
    if total == 0:
        return 0.0
    ordered = sorted(values)
    weighted = sum((i + 1) * v for i, v in enumerate(ordered))
    return (2 * weighted) / (n * total) - (n + 1) / n


@dataclass
class FeatureSet:
    """Extracted features from case data."""

    total_link_entries: int = 0
    anomaly_count: int = 0
    anomaly_ratio: float = 0.0
    anomaly_severity: float = 0.0
    affected_ne_count: int = 0
    total_ne_count: int = 0
    top_ne_dominance: float = 0.0
    spatial_clarity: float = 0.0
    temporal_clarity: float = 0.0
    pattern_match: str = ""
    pattern_strength: float = 0.0
    ambiguity: float = 0.0
    # free5GC-faithful CHR features (Phase 2 exploration triggers)
    chr_total: int = 0
    chr_failure_count: int = 0
    chr_sbi_5xx_count: int = 0
    failed_supi_ratio: float = 0.0
    chr_failure_concentration: float = 0.0  # Gini of per-SUPI failure counts
    exploration_trigger: bool = False


# Fault signature patterns for matching
FAULT_SIGNATURES = {
    "single_ne": {"min_dominance": 0.35, "max_affected_ratio": 0.25, "cluster": "none"},
    "multi_ne": {"min_dominance": 0.0, "max_affected_ratio": 0.4, "cluster": "scattered"},
    "all_type_ne": {"min_dominance": 0.0, "max_affected_ratio": 0.3, "cluster": "by_type"},
    "resource_pool": {"min_dominance": 0.0, "max_affected_ratio": 0.5, "cluster": "by_pool"},
    "dc": {"min_dominance": 0.0, "max_affected_ratio": 0.7, "cluster": "by_dc"},
    "path_link": {"min_dominance": 0.0, "max_affected_ratio": 0.1, "cluster": "none"},
    "switch": {"min_dominance": 0.0, "max_affected_ratio": 0.4, "cluster": "intra_pool"},
    "normal": {"min_dominance": 0.0, "max_affected_ratio": 0.0, "cluster": "none"},
}


class ConfidenceAssessor:
    """Assesses confidence level based on KPI feature extraction."""

    def assess(self, case_data: CaseData) -> ConfidenceAssessment:
        features = self._extract_features(case_data)
        score = self._compute_score(features)
        route = self._determine_route(score, features)
        workflow, skills = self._suggest_actions(route, features)

        return ConfidenceAssessment(
            score=round(score, 4),
            route=route,
            suggested_workflow=workflow,
            suggested_skills=skills,
            matched_patterns=[features.pattern_match] if features.pattern_match else [],
            anomaly_severity=round(features.anomaly_severity, 4),
            affected_ne_count=features.affected_ne_count,
            temporal_clarity=round(features.temporal_clarity, 4),
        )

    def _extract_features(self, case_data: CaseData) -> FeatureSet:
        features = FeatureSet()

        # Parse topology to count NEs
        topo_lines = case_data.topology_text.strip().split("\n")
        ne_count = 0
        ne_by_dc: dict[str, list[str]] = defaultdict(list)
        ne_by_pool: dict[str, list[str]] = defaultdict(list)
        ne_by_type: dict[str, list[str]] = defaultdict(list)
        current_dc = ""
        current_pool = ""

        for line in topo_lines:
            line = line.strip()
            if line.startswith("DC:"):
                current_dc = line.split(":", 1)[1].strip()
            elif line.startswith("ResourcePool:"):
                current_pool = line.split(":", 1)[1].strip()
            elif ":" in line:
                parts = line.strip().split(":")
                ne_type = parts[0].strip()
                ne_info = parts[1].strip() if len(parts) > 1 else ""
                for ne_item in ne_info.split(","):
                    nid = ne_item.strip().split("(")[0].strip()
                    if nid:
                        ne_count += 1
                        ne_by_dc[current_dc].append(nid)
                        ne_by_pool[current_pool].append(nid)
                        ne_by_type[ne_type].append(nid)

        features.total_ne_count = ne_count

        # Analyze KPI data - link level anomalies
        link_rows = [r for r in case_data.kpi_rows if str(r.get("level", "")) == "link"]
        features.total_link_entries = len(link_rows)

        anomaly_threshold = 0.995
        anomalies = [r for r in link_rows if float(r.get("success_rate", 1.0)) < anomaly_threshold]
        features.anomaly_count = len(anomalies)
        features.anomaly_ratio = len(anomalies) / max(len(link_rows), 1)

        if anomalies:
            rates = [float(r.get("success_rate", 1.0)) for r in anomalies]
            features.anomaly_severity = 1.0 - min(rates)

        # Find affected NEs from anomalies
        ne_appearances: dict[str, int] = defaultdict(int)
        for a in anomalies:
            src, dst = str(a.get("src", "")), str(a.get("dst", ""))
            ne_appearances[src] += 1
            ne_appearances[dst] += 1

        affected_nes = [ne for ne, cnt in ne_appearances.items() if cnt > 1]
        features.affected_ne_count = len(affected_nes)

        if ne_appearances:
            top_ne = max(ne_appearances.items(), key=lambda x: x[1])
            features.top_ne_dominance = top_ne[1] / max(len(anomalies) * 2, 1)

        # Spatial clustering analysis
        affected_set = set(affected_nes)
        if not affected_set:
            features.spatial_clarity = 1.0
            features.pattern_match = "normal"
            features.pattern_strength = 1.0
        else:
            # Check clustering by DC, pool, type
            dc_overlap = []
            pool_overlap = []
            type_overlap = []

            for dc, nes in ne_by_dc.items():
                overlap = len(set(nes) & affected_set)
                if overlap > 0:
                    dc_overlap.append(overlap / len(set(nes)))

            for pool, nes in ne_by_pool.items():
                overlap = len(set(nes) & affected_set)
                if overlap > 0:
                    pool_overlap.append(overlap / len(set(nes)))

            for ntype, nes in ne_by_type.items():
                overlap = len(set(nes) & affected_set)
                if overlap > 0:
                    type_overlap.append(overlap / len(set(nes)))

            # Determine pattern
            max_dc_overlap = max(dc_overlap) if dc_overlap else 0
            max_pool_overlap = max(pool_overlap) if pool_overlap else 0
            max_type_overlap = max(type_overlap) if type_overlap else 0

            affected_ratio = len(affected_set) / max(ne_count, 1)

            if features.top_ne_dominance > 0.35 and affected_ratio < 0.25:
                features.pattern_match = "single_ne"
                features.pattern_strength = features.top_ne_dominance
                features.spatial_clarity = 0.8
            elif max_dc_overlap > 0.8 and len(dc_overlap) > 1:
                features.pattern_match = "dc"
                features.pattern_strength = max_dc_overlap
                features.spatial_clarity = max_dc_overlap
            elif max_pool_overlap > 0.8 and len(pool_overlap) > 1:
                features.pattern_match = "resource_pool"
                features.pattern_strength = max_pool_overlap
                features.spatial_clarity = max_pool_overlap
            elif max_type_overlap > 0.8:
                features.pattern_match = "all_type_ne"
                features.pattern_strength = max_type_overlap
                features.spatial_clarity = max_type_overlap
            elif len(affected_set) > 1 and features.top_ne_dominance < 0.3:
                features.pattern_match = "multi_ne"
                features.pattern_strength = 0.5
                features.spatial_clarity = 0.3
            else:
                features.pattern_match = "path_level"
                features.pattern_strength = 0.3
                features.spatial_clarity = 0.2

        # Temporal clarity: how sharp is the anomaly onset
        ts_rates: dict[int, list[float]] = defaultdict(list)
        for r in link_rows:
            ts_rates[int(r.get("timestamp", 0))].append(float(r.get("success_rate", 1.0)))

        ts_sorted = sorted(ts_rates.keys())
        if len(ts_sorted) > 2 and anomalies:
            ts_avg = {ts: sum(rates) / len(rates) for ts, rates in ts_rates.items()}
            # Find max drop between consecutive timestamps
            max_drop = 0.0
            for i in range(1, len(ts_sorted)):
                diff = ts_avg[ts_sorted[i - 1]] - ts_avg[ts_sorted[i]]
                max_drop = max(max_drop, diff)
            features.temporal_clarity = min(max_drop / 0.05, 1.0)  # Normalize

        # Ambiguity: signals that conflict
        if features.pattern_match in ("multi_ne", "path_level"):
            features.ambiguity = 0.3
        if features.anomaly_severity < 0.03:
            features.ambiguity += 0.2

        # free5GC-faithful CHR features → Phase 2 exploration trigger (§2.1)
        chr_recs = case_data.chr_records
        if chr_recs:
            fails = [r for r in chr_recs if r.get("outcome") == "failure"]
            features.chr_total = len(chr_recs)
            features.chr_failure_count = len(fails)
            if fails:
                features.chr_sbi_5xx_count = sum(
                    1 for r in fails if int(r.get("sbi_status", 0) or 0) in _SBI_FAILURE_STATUSES
                )
                all_supis = {r.get("supi") for r in chr_recs if r.get("supi")}
                failed_supis = {r.get("supi") for r in fails if r.get("supi")}
                features.failed_supi_ratio = len(failed_supis) / max(len(all_supis), 1)
                per_supi = Counter(r.get("supi") for r in fails if r.get("supi"))
                features.chr_failure_concentration = _gini(list(per_supi.values()))

            chr_fail_rate = features.chr_failure_count / max(features.chr_total, 1)
            # Require CHR signal meaningfully above the ~0.1% background-noise floor.
            signal_present = chr_fail_rate > 0.003
            micro_loss = features.anomaly_count > 0 and features.anomaly_severity < 0.03
            user_concentration = (
                0.02 <= features.failed_supi_ratio < 0.30
                or features.chr_failure_concentration > 0.6
            )
            layer_inconsistency = features.anomaly_ratio < 0.02 and chr_fail_rate > 0.005
            # KPI 已是清晰的单网元故障( severity ≥ 3% )时,无需走 CHR 探索——探索是给
            # 微损/信号模糊场景的。避免把清晰的 single_ne 误导入 exploration(过度召回)。
            clear_single_ne = (
                features.pattern_match == "single_ne" and features.anomaly_severity >= 0.03
            )
            features.exploration_trigger = bool(
                signal_present
                and (micro_loss or user_concentration or layer_inconsistency)
                and not clear_single_ne
            )

        return features

    def _compute_score(self, f: FeatureSet) -> float:
        score = 0.0
        score += f.pattern_strength * 0.4
        score += min(f.anomaly_severity / 0.08, 1.0) * 0.2
        score += f.temporal_clarity * 0.15
        score += f.spatial_clarity * 0.15
        score -= f.ambiguity * 0.1
        return max(0.0, min(1.0, score))

    def _determine_route(self, score: float, features: FeatureSet) -> Route:
        # Phase 2: CHR-driven exploration takes priority over the KPI score when
        # KPIs are ambiguous (micro-loss) but CHR shows real concentrated failures.
        if features.exploration_trigger:
            return Route.EXPLORATION
        if score > THRESHOLD_HIGH:
            return Route.WORKFLOW
        elif score > THRESHOLD_LOW:
            return Route.GUIDED
        return Route.AUTONOMOUS

    def _suggest_actions(self, route: Route, features: FeatureSet) -> tuple[str | None, list[str]]:
        pattern = features.pattern_match

        if route == Route.EXPLORATION:
            return None, ["exploration_mode"]

        skill_map = {
            "single_ne": ["single_ne_fault"],
            "multi_ne": ["multi_ne_fault"],
            "all_type_ne": ["all_type_ne_fault", "multi_ne_fault"],
            "resource_pool": ["resource_pool_fault"],
            "dc": ["dc_fault"],
            "path_level": ["path_fault"],
            "switch": ["switch_fault"],
            "normal": ["normal_detection"],
        }

        workflow_map = {
            "single_ne": "link_fault_workflow",
            "normal": "normal_detection_workflow",
        }

        workflow = workflow_map.get(pattern) if route == Route.WORKFLOW else None
        skills = skill_map.get(pattern, ["single_ne_fault", "normal_detection"])

        return workflow, skills
