"""Sweep runner: a meta-tool that runs a detector across a parameter grid.

The EXPLORATION agent calls this to explore one (algorithm, data_view) with
multiple parameter combinations. It fans out via asyncio.gather over the
registry-dispatched detector calls, then summarises per-element agreement
(param concordance). The ParallelExplorer (M2.6) calls sweep_runner for each
algorithm/view, then merges + fuses across them.
"""

from __future__ import annotations

import asyncio
import itertools
import json

from tools.registry import dispatch, get_tool, register


def _expand_grid(params: dict) -> list[dict]:
    """Expand {'a': [1, 2], 'b': [3]} into [{'a': 1, 'b': 3}, {'a': 2, 'b': 3}]."""
    keys = list(params.keys())
    if not keys:
        return [{}]
    return [dict(zip(keys, vals)) for vals in itertools.product(*(params[k] for k in keys))]


def _base_args(data_view: str, kpi_rows, chr_records, target: str) -> dict:
    args: dict = {"target": target}
    if data_view in ("link_kpi", "trace_kpi"):
        args["kpi_rows"] = kpi_rows or []
        args["level"] = "link" if data_view == "link_kpi" else "trace"
    elif data_view in ("chr_attempt", "per_supi_ts"):
        args["chr_records"] = chr_records or []
    else:  # pass whatever data is available
        if kpi_rows:
            args["kpi_rows"] = kpi_rows
        if chr_records:
            args["chr_records"] = chr_records
    return args


@register(
    name="sweep_runner",
    description=(
        "Run a named detector across a parameter grid over one data view and "
        "return per-combo findings with param concordance. algorithm: 'ewma_changepoint', "
        "'cusum_changepoint', 'pca_residual', 'isolation_forest', 'ue_failure_concentration', "
        "'correlated_failure_graph'. data_view: 'link_kpi', 'trace_kpi', 'chr_attempt', 'per_supi_ts'. "
        "params: object mapping each detector param name to a list of values to sweep."
    ),
    parameters={
        "type": "object",
        "properties": {
            "algorithm": {"type": "string", "description": "Detector tool name to sweep"},
            "data_view": {
                "type": "string",
                "description": "Data view: link_kpi/trace_kpi/chr_attempt/per_supi_ts",
            },
            "params": {
                "type": "object",
                "description": "Param grid: {param_name: [values]}",
                "additionalProperties": {"type": "array"},
            },
            "kpi_rows": {
                "type": "array",
                "description": "KPI data rows (for *_kpi views)",
                "items": {"type": "object"},
            },
            "chr_records": {
                "type": "array",
                "description": "CHR records (for chr_attempt/per_supi_ts views)",
                "items": {"type": "object"},
            },
            "target": {"type": "string", "description": "Optional NE/SUPI focus", "default": ""},
        },
        "required": ["algorithm", "data_view", "params"],
    },
)
async def sweep_runner(
    algorithm: str,
    data_view: str,
    params: dict,
    kpi_rows: list[dict] | None = None,
    chr_records: list[dict] | None = None,
    target: str = "",
) -> str:
    combos = _expand_grid(params)
    base = _base_args(data_view, kpi_rows, chr_records, target)

    # Only pass params the detector actually accepts (from its JSON-schema), so a
    # view-level arg like `target` doesn't break detectors that don't take it.
    tool_def = get_tool(algorithm)
    accepted = (
        set(((tool_def.parameters or {}).get("properties") or {}).keys()) if tool_def else set()
    )

    def _filter(args: dict) -> dict:
        if not accepted:
            return args
        return {k: v for k, v in args.items() if k in accepted}

    async def run_one(combo: dict) -> dict:
        args = _filter({**base, **combo})
        result_str = await dispatch(algorithm, args)
        try:
            finding = json.loads(result_str)
        except json.JSONDecodeError:
            finding = {"error": result_str}
        evidence = finding.get("evidence_elements", []) or []
        if isinstance(evidence, list):
            evidence = [str(e) for e in evidence]
        else:
            evidence = []
        return {
            "algorithm": algorithm,
            "data_view": data_view,
            "params": combo,
            "finding": finding,
            "evidence_elements": evidence,
            "confidence": float(finding.get("confidence", 0.0) or 0.0),
        }

    cells = await asyncio.gather(*(run_one(c) for c in combos))

    # Per-element agreement across the param sweep.
    element_counts: dict[str, int] = {}
    for cell in cells:
        for el in cell["evidence_elements"]:
            element_counts[el] = element_counts.get(el, 0) + 1
    n = max(len(cells), 1)
    param_concordance = {el: round(c / n, 3) for el, c in element_counts.items()}

    best = max(cells, key=lambda c: c["confidence"]) if cells else None
    report = {
        "algorithm": algorithm,
        "data_view": data_view,
        "cells": cells,
        "param_concordance": param_concordance,
        "view_concordance": {data_view: param_concordance},
        "best_cell": best,
        "used_algorithms": [algorithm],
        "param_combos": len(cells),
    }
    return json.dumps(report, ensure_ascii=False, indent=2)
