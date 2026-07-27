"""LiveEngine: 把 EngineStepper 与 ScenarioPlugin 绑在一起。

run_sync(): 同步跑完全部 tick(测试用)。
run_async(): 异步循环,LiveRunner 主流程用。
admit_ue_request(): UE 注册/PDU 会话准入由 plugin.on_ue_request 决策。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from agents.simulation.engine_step import EngineStepper, EngineTickContext


Verdict = Literal["ALLOW", "DENY", "BACKOFF"]


@dataclass
class UeRequest:
    ue_id: str
    kind: Literal["registration", "pdu_create"]
    sim_t: int
    apn: str | None = None
    sst: int | None = None
    device_type: str | None = None
    supports_backoff: bool | None = None


@dataclass
class UeResponse:
    verdict: Verdict
    backoff_seconds: int = 0
    note: str = ""


class LiveEngine:
    def __init__(self, stepper: EngineStepper, plugin):
        self.stepper = stepper
        self.plugin = plugin
        self.events: list = []

    def run_sync(self) -> None:
        while not self.stepper.is_done():
            self._tick_once()

    async def run_async(self) -> None:
        while not self.stepper.is_done():
            self._tick_once()
            await self.stepper.sleep()

    def _tick_once(self) -> EngineTickContext:
        ctx = self.stepper.step(dt=1)
        from agents.shared.scenario_plugin import TickContext
        plugin_ctx = TickContext(
            sim_t=ctx.sim_t,
            ne_cpu={},
            kpi_window=[],
            chr_window=[],
            active_ue=0,
        )
        events = self.plugin.on_tick(plugin_ctx)
        self.events.extend(events)
        return ctx

    def admit_ue_request(self, req: UeRequest) -> UeResponse:
        if not hasattr(self.plugin, "on_ue_request"):
            return UeResponse("ALLOW")
        return self.plugin.on_ue_request(req)
