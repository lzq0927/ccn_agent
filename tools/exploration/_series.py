"""Shared helpers for exploration detector tools."""

from __future__ import annotations

import math
from collections import defaultdict


def per_timestamp_series(
    kpi_rows: list[dict], target: str = "", level: str = "link"
) -> tuple[list[int], list[float]]:
    """Per-timestamp average success rate for rows touching ``target`` (or all).

    Returns (timestamps, values) sorted by timestamp. Higher success rate is
    better, so a fault shows as a drop in the series.
    """
    by_ts: dict[int, list[float]] = defaultdict(list)
    for r in kpi_rows:
        if str(r.get("level", "")) != level:
            continue
        if target:
            src, dst = str(r.get("src", "")), str(r.get("dst", ""))
            if target not in src and target not in dst:
                continue
        by_ts[int(r.get("timestamp", 0))].append(float(r.get("success_rate", 1.0)))
    ts_sorted = sorted(by_ts)
    series = [sum(by_ts[t]) / len(by_ts[t]) for t in ts_sorted]
    return ts_sorted, series


def mean_std(values: list[float]) -> tuple[float, float]:
    n = len(values)
    if n == 0:
        return 0.0, 0.0
    mean = sum(values) / n
    var = sum((x - mean) ** 2 for x in values) / n
    return mean, math.sqrt(var)


def normalize_confidence(sigma: float, threshold: float) -> float:
    """Map a detector's signal strength (in sigma units) to [0, 1]."""
    if threshold <= 0:
        return 0.0
    return max(0.0, min(1.0, sigma / (threshold * 2.0)))


def affected_nes_from_anomalies(kpi_rows: list[dict], threshold: float = 0.995) -> list[str]:
    """NEs appearing in degraded link rows (touched >1 anomalous link)."""
    appearances: dict[str, int] = defaultdict(int)
    for r in kpi_rows:
        if str(r.get("level", "")) != "link":
            continue
        if float(r.get("success_rate", 1.0)) < threshold:
            appearances[str(r.get("src", ""))] += 1
            appearances[str(r.get("dst", ""))] += 1
    return [ne for ne, cnt in appearances.items() if cnt > 1]


def link_feature_matrix(
    kpi_rows: list[dict], level: str = "link", threshold: float = 0.995
) -> tuple[list[str], list[list[float]]]:
    """Per-link summary feature matrix.

    Returns (link_ids, matrix) where each row is a link ``src->dst`` and the
    columns are [mean, std, min, max, anomaly_ratio] of its success-rate series.
    Used by the multivariate detectors (PCA residual, Isolation Forest).
    """
    by_link: dict[str, list[float]] = defaultdict(list)
    for r in kpi_rows:
        if str(r.get("level", "")) != level:
            continue
        key = f"{r.get('src', '')}->{r.get('dst', '')}"
        by_link[key].append(float(r.get("success_rate", 1.0)))

    link_ids = sorted(by_link)
    matrix: list[list[float]] = []
    for lid in link_ids:
        rates = by_link[lid]
        n = len(rates)
        mean = sum(rates) / n
        var = sum((x - mean) ** 2 for x in rates) / n
        std = math.sqrt(var)
        anom = sum(1 for x in rates if x < threshold) / n
        matrix.append([mean, std, min(rates), max(rates), anom])
    return link_ids, matrix


def ne_ids_in_link(link_id: str) -> list[str]:
    """Parse a 'src->dst' link id into its NE ids (non-empty)."""
    parts = link_id.split("->")
    return [p for p in (x.strip() for x in parts) if p]


def gini(values: list[int] | list[float]) -> float:
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


def connected_components(nodes: set, adjacency: dict) -> list[list[str]]:
    """Connected components of an undirected graph (BFS)."""
    seen: set = set()
    components: list[list[str]] = []
    for start in nodes:
        if start in seen:
            continue
        stack = [start]
        comp: list[str] = []
        seen.add(start)
        while stack:
            n = stack.pop()
            comp.append(n)
            for nb in adjacency.get(n, ()):
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        components.append(comp)
    return components
