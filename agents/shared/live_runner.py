"""LiveRunner: process-level session state machine."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

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
    _state: RunnerState = RunnerState.INIT
    _restart_count: int = 0
    _last_plan: Any = None

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
            while self._restart_count <= self.max_restarts:
                await self._simulate_phase()
                await self._diagnose_phase()
                if self._state == RunnerState.RESTART:
                    self._restart_count += 1
                    continue
                break
            if self._state != RunnerState.RESTART:
                await self._recover_phase()
                await self._evaluate_phase()
                self._set_state(RunnerState.DONE)
                if self.storage is not None:
                    self.storage.complete_live_session(self.session_id)
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

    async def _simulate_phase(self) -> None:
        self._set_state(RunnerState.SIMULATING)
        from agents.simulation.engine_step import EngineStepper
        from agents.simulation.live_engine import LiveEngine

        stepper = EngineStepper(
            sim_window=self.sim_window,
            base_interval=self.tick_interval,
        )
        engine = LiveEngine(stepper=stepper, plugin=self.plugin)
        self._current_engine = engine
        engine.run_sync()

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
        confidence = getattr(plan, "confidence", 0.0)
        route = getattr(plan, "route", "workflow")
        self._publish(
            "confidence_assessment",
            {"score": confidence, "route": route},
        )
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
        self._publish(
            "diagnosis_complete",
            {
                "fault_elements": getattr(plan, "fault_elements", []),
                "fault_type": "single_ne",
                "fault_mode": "link",
                "confidence": confidence,
                "route": route,
                "iterations": 1,
            },
        )

    async def _recover_phase(self) -> None:
        self._set_state(RunnerState.RECOVERING)
        actions = self.plugin.recovery_actions(self._last_plan)
        for action in actions:
            self._publish(
                "recovery_action",
                {
                    "id": action.id,
                    "cn": action.cn,
                    "en": action.en,
                    "layer": action.layer,
                    "ts": 0,
                },
            )

    async def _evaluate_phase(self) -> None:
        self._set_state(RunnerState.EVALUATING)
        self._publish(
            "evaluation_report",
            {
                "metrics": {
                    "precision": 1,
                    "recall": 1,
                    "f1": 1,
                    "exact_match": True,
                },
                "trace_axes": {"overall": 0.9},
                "suggestions": [],
                "case_entry": {},
            },
        )
