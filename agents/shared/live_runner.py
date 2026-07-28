"""LiveRunner: process-level session state machine."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Protocol

from agents.shared.scenario_plugin import discover_plugins

logger = logging.getLogger(__name__)

# 启动时扫描 plugins/ 目录;幂等(REGISTRY 已有则覆盖)
try:
    discover_plugins()
except Exception:  # noqa: BLE001
    logger.exception("discover_plugins failed at import time")


class RunnerState(str, Enum):
    INIT = "init"
    SIMULATING = "simulating"
    DIAGNOSING = "diagnosing"
    RESTART = "restart"
    RECOVERING = "recovering"
    EVALUATING = "evaluating"
    DONE = "done"
    FAILED = "failed"
    FALLBACK_TO_STUB = "fallback_to_stub"


@dataclass
class RunnerEvent:
    type: str
    payload: dict[str, Any]


class _BusLike(Protocol):
    def publish(self, type_: str, payload: dict) -> Any: ...


@dataclass
class LiveRunner:
    session_id: str
    scenario_id: str
    plugin: Any
    bus: _BusLike
    storage: Any
    sim_window: int = 60
    tick_interval: float = 1.0
    confidence_low_threshold: float = 0.3
    max_restarts: int = 2
    # 节流:让前端有时间逐步渲染每个阶段/步骤(避免事件瞬间灌满 → 一进就到评估)
    phase_transition_delay: float = 0.4
    reasoning_step_delay: float = 0.35
    recovery_action_delay: float = 0.4
    # 数据落盘记录器(L3 注入;None 时不落盘)
    recorder: Any = None
    _state: RunnerState = RunnerState.INIT
    _restart_count: int = 0
    _last_plan: Any = None
    _current_engine: Any = field(default=None, repr=False)

    def _publish(self, type_: str, payload: dict) -> None:
        event_payload = {
            **payload,
            "session_id": self.session_id,
            "scenario_id": self.scenario_id,
        }
        try:
            self.bus.publish(type_, event_payload)
        except Exception:
            logger.exception("bus publish failed: %s", type_)
        if self.recorder is not None:
            try:
                self.recorder.record_event(type_, event_payload)
            except Exception:  # noqa: BLE001
                logger.exception("recorder.record_event failed: %s", type_)

    async def _sleep(self, delay: float) -> None:
        """节流用的可中断 sleep(delay<=0 时跳过,便于测试快跑)。"""
        if delay > 0:
            await asyncio.sleep(delay)

    def _set_state(self, state: RunnerState) -> None:
        self._state = state
        self._publish("runner_state", {"state": state.value})
        if self.storage is not None:
            self.storage.update_live_session_state(
                self.session_id, state.value, self._restart_count
            )

    async def run(self) -> None:
        try:
            self._set_state(RunnerState.INIT)
            if self.recorder is not None:
                try:
                    self.recorder.begin(self.plugin)
                except Exception:  # noqa: BLE001
                    logger.exception("recorder.begin failed")
            while self._restart_count <= self.max_restarts:
                await self._simulate_phase()
                await self._sleep(self.phase_transition_delay)
                await self._diagnose_phase()
                if self._state == RunnerState.RESTART:
                    self._restart_count += 1
                    await self._sleep(self.phase_transition_delay)
                    continue
                break
            if self._state != RunnerState.RESTART:
                await self._sleep(self.phase_transition_delay)
                await self._recover_phase()
                await self._sleep(self.phase_transition_delay)
                await self._evaluate_phase()
                self._set_state(RunnerState.DONE)
                if self.storage is not None:
                    self.storage.complete_live_session(self.session_id)
                if self.recorder is not None:
                    try:
                        self.recorder.finalize("done")
                    except Exception:  # noqa: BLE001
                        logger.exception("recorder.finalize failed")
        except Exception as exc:
            logger.exception("LiveRunner failed: %s", self.session_id)
            self._publish(
                "error",
                {
                    "source": "live_runner",
                    "code": "EXC",
                    "message": str(exc),
                    "fatal": True,
                },
            )
            self._set_state(RunnerState.FAILED)
            if self.recorder is not None:
                try:
                    self.recorder.finalize("failed")
                except Exception:  # noqa: BLE001
                    logger.exception("recorder.finalize failed")

    async def _simulate_phase(self) -> None:
        self._set_state(RunnerState.SIMULATING)
        from agents.simulation.engine_step import EngineStepper
        from agents.simulation.live_engine import LiveEngine

        round_no = self._restart_count + 1
        # 双轮场景:每轮跑 sim_window/expected_round 个 tick,global_t 跨轮连续
        expected_round = max(1, int(getattr(self.plugin, "expected_round", 1)))
        ticks_per_round = max(1, self.sim_window // expected_round)
        offset = self._restart_count * ticks_per_round

        stepper = EngineStepper(
            sim_window=ticks_per_round,
            base_interval=self.tick_interval,
        )

        def _on_tick(plugin_ctx, events):
            # 每 tick:推 tick 事件(驱动前端 simT 游标 + CPU 仪表)
            # + plugin 产出的 KPI/CHR/告警事件 + 落盘
            tick_payload = {
                "sim_t": plugin_ctx.global_t,
                "round": plugin_ctx.round,
                "ne_cpu": plugin_ctx.ne_cpu,
                "active_ue": plugin_ctx.active_ue,
            }
            self._publish("tick", tick_payload)
            if self.recorder is not None:
                try:
                    self.recorder.record_tick(plugin_ctx, events)
                except Exception:  # noqa: BLE001
                    logger.exception("recorder.record_tick failed")
            for ev in events:
                self._publish(ev.type, ev.payload)

        engine = LiveEngine(
            stepper=stepper,
            plugin=self.plugin,
            tick_callback=_on_tick,
        )
        engine.current_round = round_no
        engine.round_offset = offset
        self._current_engine = engine
        await engine.run_async()

    async def _diagnose_phase(self) -> None:
        from agents.shared.scenario_plugin import DiagnosisContext

        self._set_state(RunnerState.DIAGNOSING)
        round_no = self._restart_count + 1
        ctx = DiagnosisContext(
            scenario_id=self.scenario_id,
            round=round_no,
            confidence_so_far=0.0,
            tick_window=[],
        )
        plan = self.plugin.diagnosis_llm_stub(ctx)
        self._last_plan = plan
        confidence = float(getattr(plan, "confidence", 0.0))
        route = getattr(plan, "route", "workflow")
        fault_elements = list(getattr(plan, "fault_elements", []))
        fault_type = getattr(plan, "fault_type", "single_ne")
        fault_mode = getattr(plan, "fault_mode", "link")

        # 1. 置信度评估(走 self._publish 自动落盘)
        self._publish(
            "confidence_assessment",
            {
                "score": confidence,
                "route": route,
                "breakdown": {},
                "matched_patterns": [],
                "round": round_no,
            },
        )

        # 2. 逐步揭示推理链(每步 sleep,前端有时间渲染)
        raw_reasoning = getattr(plan, "reasoning", []) or []
        for i, step in enumerate(raw_reasoning):
            step_payload = {
                "n": i + 1,
                "type": str(step.get("type", "thinking")),
                "text": str(step.get("text", "")),
                "round": round_no,
            }
            if step.get("result"):
                step_payload["result"] = str(step["result"])
            self._publish("reasoning_step", step_payload)
            if self.recorder is not None:
                try:
                    self.recorder.record_reasoning_step(step_payload)
                except Exception:  # noqa: BLE001
                    logger.exception("recorder.record_reasoning_step failed")
            await self._sleep(self.reasoning_step_delay)

        # 3. 诊断完成
        self._publish(
            "diagnosis_complete",
            {
                "fault_elements": fault_elements,
                "fault_type": fault_type,
                "fault_mode": fault_mode,
                "confidence": confidence,
                "route": route,
                "iterations": len(raw_reasoning),
                "round": round_no,
            },
        )

        # 4. 低置信度 → restart(场景 F 首轮:回 Agent1 补采 CHR)
        if confidence < self.confidence_low_threshold:
            self._publish(
                "confidence_low",
                {
                    "score": confidence,
                    "current_attempt": round_no,
                    "hint": "rebatch_chr",
                },
            )
            self._set_state(RunnerState.RESTART)
            return

    async def _recover_phase(self) -> None:
        self._set_state(RunnerState.RECOVERING)
        actions = self.plugin.recovery_actions(self._last_plan) or []
        for action in actions:
            self._publish(
                "recovery_action",
                {
                    "id": action.id,
                    "cn": action.cn,
                    "en": action.en,
                    "layer": action.layer,
                    "ts": 0,
                    "round": self._restart_count + 1,
                },
            )
            if self.recorder is not None:
                try:
                    self.recorder.record_recovery_action(action, self._restart_count + 1)
                except Exception:  # noqa: BLE001
                    logger.exception("recorder.record_recovery_action failed")
            await self._sleep(self.recovery_action_delay)

    async def _evaluate_phase(self) -> None:
        self._set_state(RunnerState.EVALUATING)
        report = {
            "metrics": {
                "precision": 1,
                "recall": 1,
                "f1": 1,
                "exact_match": True,
            },
            "trace_axes": {"overall": 0.9},
            "suggestions": [],
            "case_entry": {},
        }
        self._publish("evaluation_report", report)
        if self.recorder is not None:
            try:
                self.recorder.record_evaluation(report)
            except Exception:  # noqa: BLE001
                logger.exception("recorder.record_evaluation failed")


class RunnerRegistry:
    """进程级 LiveRunner 注册表;限制活跃 session 数。"""

    def __init__(self, max_active: int = 10):
        self.max_active = max_active
        self._active: set[str] = set()

    def add(self, session_id: str) -> None:
        if len(self._active) >= self.max_active:
            raise RuntimeError(
                f"max active sessions reached ({self.max_active}); reject {session_id}"
            )
        self._active.add(session_id)

    def remove(self, session_id: str) -> None:
        self._active.discard(session_id)

    def size(self) -> int:
        return len(self._active)
