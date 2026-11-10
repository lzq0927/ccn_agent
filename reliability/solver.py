"""Deterministic mechanism experiments; no language model or legacy Agent Loop."""

from __future__ import annotations

import copy
import hashlib
import json
import platform
from dataclasses import asdict
from importlib.metadata import version
from pathlib import Path
from statistics import mean

from agents.simulation.demo_topology import build_demo_topology
from agents.simulation.live_scenarios import LiveScenario, get_scenario
from agents.simulation.realtime_engine import PolicyAction, RealtimeEngine
from reliability.catalog import boundaries, knowledge
from reliability.models import Design, FlowControl, Isolate, Reroute
from simulator.models import FaultConfig, FaultMode, FaultPointType


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False, default=lambda x: sorted(x) if isinstance(x, set) else x.value)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def engine_revision() -> str:
    root = Path(__file__).resolve().parent.parent
    sources = sorted({
        *root.joinpath("simulator").rglob("*.py"),
        *root.joinpath("agents/simulation").glob("*.py"),
        Path(__file__), root / "reliability/models.py", root / "tools/kpi_analyzer.py",
    })
    return digest({str(path.relative_to(root)): path.read_text() for path in sources})


def runtime_versions() -> dict:
    return {"python": platform.python_version(),
            **{package: version(package) for package in ("numpy", "pandas", "pydantic")}}


_LOADED_ENGINE_REVISION = engine_revision()


def _check_loaded_code() -> None:
    if engine_revision() != _LOADED_ENGINE_REVISION:
        raise ValueError("运行期间仿真源码已修改，请重启 API 和 MCP 服务后再评估")


def validate_design(design: Design, scenario: LiveScenario | None = None) -> list[str]:
    scenario = scenario or get_scenario(design.scenario_id)
    elements = build_demo_topology().elements
    isolated = {a.ne_id for a in design.actions if isinstance(a, Isolate)}
    damaged = scenario.fault_config.affected_ne_ids if scenario.fault_config.loss_rate > 0 else set()
    seen = set()
    warnings = []
    for action in design.actions:
        key = canonical(action.model_dump(exclude_none=True))
        if key in seen:
            raise ValueError("不能重复施加相同机制")
        seen.add(key)
        if isinstance(action, Isolate):
            if action.ne_id not in elements:
                raise ValueError(f"未知网元: {action.ne_id}")
            if not any(isinstance(a, Reroute) and a.from_ne_id == action.ne_id
                       for a in design.actions):
                warnings.append(f"{action.ne_id} 仅隔离未重选，仍绑定它的请求可能失败")
        elif isinstance(action, Reroute):
            source, target = elements.get(action.from_ne_id), elements.get(action.to_ne_id)
            if not source or not target:
                raise ValueError("重选源和目标必须是已有网元")
            if source.id == target.id or source.ne_type != target.ne_type:
                raise ValueError("重选目标必须是另一个同类型网元")
            if target.id in isolated or target.id in damaged:
                raise ValueError("不能重选到已隔离或注入丢损的目标")
        elif isinstance(action, FlowControl):
            warnings.append("流控可能以拒绝请求换取负载下降，请同时审阅拒绝计数")
    if not design.actions:
        warnings.append("候选方案没有机制，将与无机制基线相同")
    return list(dict.fromkeys(warnings))


def freeze_input(design: Design) -> dict:
    _check_loaded_code()
    scenario = copy.deepcopy(get_scenario(design.scenario_id))
    validate_design(design, scenario)
    return json.loads(canonical({
        "design": design.model_dump(), "scenario": asdict(scenario),
        "engine_revision": engine_revision(), "knowledge": knowledge(),
        "runtime": runtime_versions(), "methodology": boundaries(),
    }))


def _scenario(data: dict) -> LiveScenario:
    data = copy.deepcopy(data)
    fc = data.pop("fault_config")
    fc["fault_mode"] = FaultMode(fc["fault_mode"])
    fc["fault_point_type"] = FaultPointType(fc["fault_point_type"])
    fc["affected_ne_ids"] = set(fc["affected_ne_ids"])
    fc["affected_sessions"] = set(fc["affected_sessions"])
    fc["affected_links"] = [tuple(link) for link in fc["affected_links"]]
    return LiveScenario(**data, fault_config=FaultConfig(**fc))


def _observe(engine: RealtimeEngine, tick: int, design: Design) -> dict:
    kpi = engine.advance_tick(tick).kpi
    cpu = max((v for ne, v in kpi["ne_cpu"].items() if not ne.startswith("gNB")), default=0)
    reg_sr = kpi["amf_reg_successes"] / kpi["amf_reg_requests"] if kpi["amf_reg_requests"] else 0
    pdu_sr = kpi["smf_pdu_successes"] / kpi["smf_pdu_requests"] if kpi["smf_pdu_requests"] else 0
    return {
        "sim_t": tick, "registration_success_rate": reg_sr,
        "pdu_success_rate": pdu_sr, "max_core_cpu": cpu,
        "registration_requests": kpi["amf_reg_requests"],
        "pdu_requests": kpi["smf_pdu_requests"],
        "admission_rejects": kpi["admission_rejects"],
        "backoff_rejects": kpi["backoff_rejects"],
        "target_met": kpi["amf_reg_requests"] > 0 and kpi["smf_pdu_requests"] > 0
        and reg_sr >= design.targets.success_rate
        and pdu_sr >= design.targets.success_rate
        and cpu < design.targets.max_core_cpu,
    }


def _continue(engine: RealtimeEngine, design: Design) -> dict:
    start = engine.sim_t
    trajectory = [_observe(engine, t, design)
                  for t in range(start + 1, start + design.recovery_ticks + 1)]
    streak = 0
    recovered_at = None
    for point in trajectory:
        streak = streak + 1 if point["target_met"] else 0
        if streak >= design.targets.sustained_ticks and recovered_at is None:
            recovered_at = point["sim_t"] - start
    return {"final": trajectory[-1], "trajectory": trajectory,
            "recovery_time": recovered_at,
            "final_target_met": streak >= design.targets.sustained_ticks}


def solve(frozen: dict) -> dict:
    _check_loaded_code()
    if frozen["engine_revision"] != engine_revision():
        raise ValueError("模型代码版本已变化；请使用原版本重放，或创建新的评估")
    if frozen.get("runtime") != runtime_versions():
        raise ValueError("Python 或数值依赖版本已变化；请使用原环境重放，或创建新的评估")
    design = Design.model_validate(frozen["design"])
    scenario = _scenario(frozen["scenario"])
    warnings = validate_design(design, scenario)
    trials = []
    for seed in design.seeds:
        engine = RealtimeEngine(scenario=copy.deepcopy(scenario), seed=seed)
        for t in range(1, design.warmup_ticks + 1):
            healthy = _observe(engine, t, design)
        engine.inject_fault(copy.deepcopy(scenario.fault_config))
        for t in range(design.warmup_ticks + 1, design.warmup_ticks + design.fault_ticks + 1):
            fault = _observe(engine, t, design)
        candidate = copy.deepcopy(engine)
        candidate.apply_policy([PolicyAction(**a.model_dump(exclude_none=True))
                                for a in design.actions])
        trials.append({"seed": seed, "healthy": healthy, "fault": fault,
                       "baseline": _continue(engine, design),
                       "candidate": _continue(candidate, design)})
    summary = {}
    for branch in ("baseline", "candidate"):
        summary[branch] = {
            "sample_count": len(trials),
            "final_target_met_fraction": mean(t[branch]["final_target_met"] for t in trials),
            **{key: mean(t[branch]["final"][key] for t in trials) for key in (
                "registration_success_rate", "pdu_success_rate", "max_core_cpu",
                "admission_rejects", "backoff_rejects")},
        }
    summary["pdu_success_rate_delta"] = (
        summary["candidate"]["pdu_success_rate"] - summary["baseline"]["pdu_success_rate"]
    )
    return {"summary": summary, "trials": trials, "warnings": warnings,
            "evidence_level": "synthetic-simulation",
            "metric_scope": "末端12-tick滚动窗口；跨种子算术均值；不是年度可用度",
            "conclusion": "simulation_target_met" if all(
                t["candidate"]["final_target_met"] for t in trials
            ) else "simulation_target_not_met"}
