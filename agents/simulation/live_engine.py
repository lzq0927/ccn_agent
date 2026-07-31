"""LiveEngine: 把 EngineStepper 与 ScenarioPlugin 绑在一起。

run_sync(): 同步跑完全部 tick(测试用)。
run_async(): 异步循环,LiveRunner 主流程用。
admit_ue_request(): UE 注册/PDU 会话准入由 plugin.on_ue_request 决策。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

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
    """EngineStepper + ScenarioPlugin 绑定。

    tick_callback: 每 tick 推进后回调 (plugin_ctx, events),供 LiveRunner
    把 KPI/CHR/告警事件 publish 到 WS + 落盘。None 时仅累积到 self.events。
    current_round: 当前诊断轮次(场景 F 双轮),透传到 TickContext.round。
    """

    def __init__(
        self,
        stepper: EngineStepper,
        plugin,
        tick_callback: Callable | None = None,
    ):
        self.stepper = stepper
        self.plugin = plugin
        self.tick_callback = tick_callback
        self.current_round: int = 1
        self.round_offset: int = 0  # global_t = round_offset + sim_t(跨轮连续)
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
            round=self.current_round,
            global_t=self.round_offset + ctx.sim_t,
        )
        events = self.plugin.on_tick(plugin_ctx) or []
        self.events.extend(events)
        if self.tick_callback is not None:
            try:
                self.tick_callback(plugin_ctx, events)
            except Exception:  # noqa: BLE001 — 回调失败不能拖垮仿真
                import logging
                logging.getLogger(__name__).exception("tick_callback failed")
        return ctx

    def admit_ue_request(self, req: UeRequest) -> UeResponse:
        if not hasattr(self.plugin, "on_ue_request"):
            return UeResponse("ALLOW")
        return self.plugin.on_ue_request(req)
