"""ScenarioPlugin 协议 + 注册表。

MVP: 场景 F 真实接入 LIVE;A/B/C/D/E 占位。
新增场景: 在 agents/simulation/plugins/<id>.py 导出 PLUGIN: ScenarioPlugin 实例。
discover_plugins() 启动时 import 全部插件。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class ScenarioPlugin(Protocol):
    id: str
    label_cn: str
    label_en: str
    version: str
    short_intro: str
    route_expectation: str
    expected_round: int
    capabilities: Literal["live", "demo"]

    def build_topology(self) -> Any: ...
    def build_fault_config(self, topo: Any) -> Any: ...
    def build_ue_distribution(self) -> Any: ...
    def on_tick(self, ctx: "TickContext") -> list["Event"]: ...
    def diagnosis_llm_stub(self, ctx: "DiagnosisContext") -> Any: ...
    def recovery_actions(self, plan: Any) -> list["RecoveryAction"]: ...
    def on_recovery_action(self, action: "RecoveryAction", ctx: "RecoveryContext") -> list["Event"]: ...
    def request_rebatch_chr(self) -> Optional["RebatchSpec"]: ...
    def on_user_breakdown(self, breakdown: Any) -> list["RecoveryAction"]: ...


@dataclass
class TickContext:
    sim_t: int
    ne_cpu: dict[str, float]
    kpi_window: list[dict]
    chr_window: list[dict]
    active_ue: int


@dataclass
class DiagnosisContext:
    scenario_id: str
    round: int
    confidence_so_far: float
    tick_window: list[TickContext]


@dataclass
class RecoveryContext:
    scenario_id: str
    round: int
    sim_t: int
    ne_cpu: dict[str, float]


@dataclass
class RecoveryAction:
    id: str
    cn: str
    en: str
    layer: Optional[str] = None  # F: "UE" | "AMF" | "SMF"


@dataclass
class RebatchSpec:
    dimensions: list[str]  # ["device_type", "supports_backoff", "apn"]


@dataclass
class Event:
    type: str
    payload: dict


REGISTRY: dict[str, ScenarioPlugin] = {}


def register(plugin: ScenarioPlugin) -> None:
    if plugin.id in REGISTRY:
        logger.debug("overwriting plugin %s in REGISTRY", plugin.id)
    REGISTRY[plugin.id] = plugin


def capabilities_snapshot() -> dict[str, str]:
    """返回 { scenario_id: "live" | "demo" } 给前端 TopBar 用。"""
    return {pid: p.capabilities for pid, p in REGISTRY.items()}


def discover_plugins(plugin_module_prefix: str = "agents.simulation.plugins") -> None:
    """扫描 plugin 目录,import 每个 .py,把 PLUGIN 全局变量注册。"""
    import importlib
    import pkgutil
    try:
        pkg = importlib.import_module(plugin_module_prefix)
    except ModuleNotFoundError:
        logger.debug("no plugins package at %s", plugin_module_prefix)
        return
    for m in pkgutil.iter_modules(pkg.__path__):
        mod = importlib.import_module(f"{plugin_module_prefix}.{m.name}")
        plugin = getattr(mod, "PLUGIN", None)
        if plugin is not None:
            register(plugin)
        else:
            logger.debug("plugin module %s has no PLUGIN global", m.name)
