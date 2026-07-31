"""EngineStepper: 把现有 SimulationEngine.simulate() 拆为按 tick 推进。

设计原则:
- 不修改 simulator/engine.py;EngineStepper 在外部循环 step()。
- step(dt) 返回 TickContext;LiveEngine 拿 ctx 调 plugin.on_tick()。
- pause/resume/seek 用于 LiveRunner 控制。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class EngineTickContext:
    sim_t: int
    dt: int = 1
    extra: dict = field(default_factory=dict)


# 公开别名:文档/外部 API 使用 TickContext,实现类仍叫 EngineTickContext
TickContext = EngineTickContext


class EngineStepper:
    """单步推进的仿真时钟。配合 SimulationEngine 使用。"""

    def __init__(self, sim_window: int = 60, base_interval: float = 1.0):
        self.sim_window = sim_window
        self.base_interval = base_interval
        self._sim_t = 0
        self._paused = False
        self._speed = 1.0

    @property
    def sim_t(self) -> int:
        return self._sim_t

    def step(self, dt: int = 1) -> EngineTickContext:
        if self._paused:
            return EngineTickContext(sim_t=self._sim_t, dt=0)
        self._sim_t += dt
        if self._sim_t > self.sim_window:
            self._sim_t = self.sim_window
        return EngineTickContext(sim_t=self._sim_t, dt=dt)

    def is_done(self) -> bool:
        return self._sim_t >= self.sim_window

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    def set_speed(self, speed: float) -> None:
        assert speed > 0
        self._speed = speed

    @property
    def speed(self) -> float:
        return self._speed

    async def sleep(self) -> None:
        """按 base_interval / speed 等待(供 LiveRunner 主循环调)。

        interval=0 时仍 ``await asyncio.sleep(0)`` 让出控制权——否则常驻 tick 循环
        会独占事件循环,卡死 WS / 控制请求。"""
        if self.base_interval <= 0:
            await asyncio.sleep(0)
            return
        await asyncio.sleep(self.base_interval / self._speed)

    def seek(self, sim_t: int) -> None:
        self._sim_t = max(0, min(sim_t, self.sim_window))
