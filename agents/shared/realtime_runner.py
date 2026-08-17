"""RealtimeLiveRunner: 常驻实时仿真 + 点击触发的 LIVE 闭环 runner。

与旧 ``LiveRunner``(脚本化桩,自动跑完阶段)不同,本 runner:
  - 启动即进入**常驻 tick 循环**,驱动 ``RealtimeEngine`` 逐秒产出真实 KPI/CHR/告警
    并推 WS + 落盘(数据采集阶段:正常数据)。
  - 阶段推进由前端**点击圆圈**经 ``/control`` 触发:
      inject_fault(异常检测) → diagnose(诊断) → apply_policy(下发策略) → evaluate(评估优化)
  - 诊断走**真 ``FaultPerceptionAgent``**(经 LiveDiagnoser);策略经 policy_resolver
    **真回灌引擎**(隔离/重选/流控),后续 tick 的 KPI 真实恢复(闭环)。

复用:``_SessionBus``、``LiveDataRecorder``、``EngineStepper``、``RealtimeEngine``、
``LiveDiagnoser``、``resolve_policy_actions``。
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Optional

from agents.simulation.engine_step import EngineStepper
from agents.simulation.live_scenarios import LiveScenario
from agents.simulation.policy_resolver import resolve_policy_actions
from agents.simulation.realtime_engine import RealtimeEngine
from agents.fault_perception.live_diagnoser import LiveDiagnoser

logger = logging.getLogger(__name__)

_PHASE_NAMES = {
    0: "网络就绪", 1: "数据采集", 2: "异常检测", 3: "策略匹配",
    4: "根因推理", 5: "下发策略", 6: "网络恢复", 7: "评估优化",
}

# 方案B · 相位门控配额(仿真秒):tick loop 每进入一个数据相位只跑该配额,
# 跑完自动 pause,等下一次圆圈点击(inject_fault / apply_policy)resume 跑下一段。
# 0 = 该相位不产出 tick(诊断 / 评估是读快照,不是数据相位)。
#   - phase 1:正常数据采集段;phase 2:故障注入后异常段(SR 下降,需 ≥12 tick 稳定滚动窗口);
#   - phase 5+6:策略回灌后恢复段(SR 回升过 0.99),由 apply_policy 合并 arm。
_PHASE_QUOTA = {0: 0, 1: 12, 2: 14, 3: 0, 4: 0, 5: 10, 6: 12, 7: 0}


@dataclass
class _Ev:
    """recorder.record_tick 需要的 Event 形状(.type/.payload)。"""
    type: str
    payload: dict


class _RecorderPluginShim:
    """让旧 LiveDataRecorder.begin(plugin) 能从 LiveScenario + 引擎拿拓扑/元数据。"""

    def __init__(self, scenario: LiveScenario, engine: RealtimeEngine):
        self._scenario = scenario
        self._engine = engine

    @property
    def label_cn(self) -> str:
        return self._scenario.label_cn

    @property
    def expected_round(self) -> int:
        return self._scenario.expected_rounds

    def build_topology(self) -> Any:
        return self._engine.topology


class RealtimeLiveRunner:
    def __init__(
        self,
        session_id: str,
        scenario: LiveScenario,
        bus,
        storage: Any | None = None,
        recorder: Any | None = None,
        tick_interval: float = 0.15,
        sim_window: int = 1200,
        reasoning_step_delay: float = 0.3,
        recovery_action_delay: float = 0.3,
        post_policy_settle: float = 2.5,
    ):
        self.session_id = session_id
        self.scenario = scenario
        self.bus = bus
        self.storage = storage
        self.recorder = recorder
        self.sim_window = sim_window
        self.reasoning_step_delay = reasoning_step_delay
        self.recovery_action_delay = recovery_action_delay
        self.post_policy_settle = post_policy_settle

        self.engine = RealtimeEngine(scenario=scenario, seed=hash(session_id) & 0xFFFF)
        self.engine.round = 1
        self.stepper = EngineStepper(sim_window=sim_window, base_interval=tick_interval)
        self.diagnoser = LiveDiagnoser(bus, scenario.id)

        self._task: Optional[asyncio.Task] = None
        self._stopped = False
        self._state = "init"
        self._phase = 0
        self._round = 1
        self._last_diagnosis: Any = None
        self._step_counter = 0

        # 方案B · 相位配额门控状态
        self._phase_budget = 0                       # 当前相位剩余 tick 配额;耗尽即 pause
        self._phase_done: asyncio.Event = asyncio.Event()
        self._phase_done.set()                       # 初始无 pending 段,wait 立即返回(防死等)

    # ------------------------------------------------------------------
    # 发布 / 状态
    # ------------------------------------------------------------------
    def _publish(self, type_: str, payload: dict) -> None:
        ep = {**payload, "session_id": self.session_id, "scenario_id": self.scenario.id}
        try:
            self.bus.publish(type_, ep)
        except Exception:
            logger.exception("bus publish failed: %s", type_)
        if self.recorder is not None:
            try:
                self.recorder.record_event(type_, ep)
            except Exception:  # noqa: BLE001
                logger.exception("recorder.record_event failed: %s", type_)

    def _set_state(self, state: str) -> None:
        self._state = state
        self._publish("runner_state", {"state": state})
        if self.storage is not None:
            try:
                self.storage.update_live_session_state(self.session_id, state, self._round)
            except Exception:  # noqa: BLE001
                logger.exception("update_live_session_state failed")

    def _set_phase(self, phase: int) -> None:
        self._phase = phase
        self._publish("phase_change", {"phase": phase, "name": _PHASE_NAMES.get(phase, "")})

    def _arm_phase(self, *phases: int) -> None:
        """进入一个或多个数据相位:按 _PHASE_QUOTA 累加配额、清 done 信号、唤醒 tick loop。

        配额 > 0 时 resume,loop 跑到配额耗尽自动 pause 并 set _phase_done;
        配额 = 0(诊断/评估相位)不 resume,保持静默。本方法取代旧版「常驻 loop 不受控地跑到 sim_window」。
        """
        quota = sum(_PHASE_QUOTA.get(p, 0) for p in phases)
        self._phase_budget = quota
        self._phase_done.clear()
        if quota > 0:
            self.stepper.resume()

    async def _wait_segment(self) -> None:
        """等当前数据段跑完(配额耗尽 → loop set _phase_done);无 pending 段时立即返回。

        带超时兜底(post_policy_settle + 5s),防止异常时序下死等。供 evaluate 在判恢复前
        确认恢复段已产出,取代旧版固定 ``await asyncio.sleep(post_policy_settle)``。"""
        try:
            await asyncio.wait_for(self._phase_done.wait(), timeout=self.post_policy_settle + 5.0)
        except asyncio.TimeoutError:
            logger.warning("phase_done wait timed out at phase=%s sim_t=%s", self._phase, self.stepper.sim_t)

    # ------------------------------------------------------------------
    # 启动 / 常驻 tick 循环
    # ------------------------------------------------------------------
    def start(self) -> None:
        """同步入口:先发 runner_state/phase(进 WS buffer,TestClient 也能收到),
        再起后台 tick 循环。"""
        if self.recorder is not None:
            try:
                self.recorder.begin(_RecorderPluginShim(self.scenario, self.engine))
            except Exception:  # noqa: BLE001
                logger.exception("recorder.begin failed")
        self._set_state("simulating")
        self._set_phase(1)  # 数据采集
        self._arm_phase(1)  # 跑数据采集段(配额跑完自动暂停,等点击 inject_fault)
        self._task = asyncio.create_task(self._tick_loop())

    async def _tick_loop(self) -> None:
        try:
            while not self._stopped and self.stepper.sim_t < self.sim_window:
                # 评估完成(done)后停止产出 —— 闭环结束,不再跑空转 tick
                if self._state == "done":
                    break
                if self.stepper._paused:  # noqa: SLF001
                    await asyncio.sleep(0.05)
                    continue
                # 方案B · 相位门控:本相位配额跑完 → 自动暂停,等下一次点击 resume 跑下一段
                if self._phase_budget <= 0:
                    self.stepper.pause()
                    self._phase_done.set()
                    self._publish("phase_data_ready", {
                        "phase": self._phase, "sim_t": self.stepper.sim_t,
                    })
                    await asyncio.sleep(0.05)
                    continue
                tctx = self.stepper.step(1)
                self._phase_budget -= 1
                t = tctx.sim_t
                self.engine.round = self._round
                try:
                    snap = self.engine.advance_tick(t)
                except Exception:  # noqa: BLE001
                    logger.exception("advance_tick failed at t=%s", t)
                    break
                self._publish("tick", {
                    "sim_t": snap.sim_t, "round": snap.round,
                    "ne_cpu": snap.kpi.get("ne_cpu", {}), "active_ue": len(self.engine.bindings),
                })
                self._publish("kpi_snapshot", snap.kpi)
                for rec in snap.chr_records:
                    self._publish("chr_record", rec)
                for al in snap.alarms:
                    self._publish("alarm", al)
                if self.recorder is not None:
                    try:
                        events = [_Ev("kpi_snapshot", snap.kpi)]
                        events += [_Ev("chr_record", r) for r in snap.chr_records]
                        events += [_Ev("alarm", a) for a in snap.alarms]
                        self.recorder.record_tick(type("_Ctx", (), {"sim_t": t, "round": snap.round})(), events)
                    except Exception:  # noqa: BLE001
                        logger.exception("recorder.record_tick failed")
                await self.stepper.sleep()
        except Exception:  # noqa: BLE001
            logger.exception("tick loop crashed")
            self._publish("error", {"source": "realtime_runner", "code": "TICK", "message": "tick loop crashed", "fatal": False})

    async def stop(self) -> None:
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    # ------------------------------------------------------------------
    # 控制(供 /control 调用)
    # ------------------------------------------------------------------
    def pause(self) -> None:
        self.stepper.pause()

    def resume(self) -> None:
        self.stepper.resume()

    def set_speed(self, speed: float) -> None:
        self.stepper.set_speed(speed)

    def seek(self, sim_t: int) -> None:
        self.stepper.seek(sim_t)

    def _snapshot_with_ne_sr(self) -> dict:
        """引擎快照 + per-NE 实例 SR(供异常检测/置信度评估工具消费)。"""
        snap = self.engine.snapshot_for_agent()
        snap["ne_reg_sr"] = self.engine.ne_reg_sr
        snap["ne_pdu_sr"] = self.engine.ne_pdu_sr
        return snap

    async def handle_inject_fault(self) -> None:
        self.engine.inject_fault(self.scenario.fault_config)
        self._set_phase(2)  # 异常检测
        self._arm_phase(2)  # 跑异常检测段(故障告警由后续 tick 产出,配额跑完自动暂停)
        await self._wait_segment()  # 等异常段配额跑完,KPI/CHR 累积足
        # 真异常检测:调 KPI 异常检测工具 → 异常链路/网元 → 推 anomaly_detection(②弹窗)
        await self.diagnoser.emit_anomaly_detection(self._snapshot_with_ne_sr(), round=self._round)

    async def handle_match(self) -> None:
        """③策略匹配:真置信度评估(assessor.assess,无 LLM)→ confidence_assessment。"""
        self._set_phase(3)
        self.diagnoser.emit_assessment(self._snapshot_with_ne_sr(), round=self._round)

    async def handle_root(self) -> None:
        """④根因推理:真 Agent Loop(FaultPerceptionAgent.diagnose)→ 推理链 + diagnosis_complete。"""
        self._set_state("diagnosing")
        self._set_phase(4)
        self.diagnoser._step_n = 0  # noqa: SLF001
        agent, case_data = self.diagnoser.run_real_diagnosis(self.engine.snapshot_for_agent(), round=self._round)
        try:
            result = await agent.diagnose(case_data)
        except Exception as exc:  # noqa: BLE001
            logger.exception("real diagnose failed: %s", exc)
            self._publish("error", {"source": "diagnoser", "code": "AGENT", "message": str(exc), "fatal": False})
            return
        self._last_diagnosis = result
        self.diagnoser.emit_diagnosis_result(result, round=self._round)
        if self.recorder is not None:
            try:
                self.recorder.record_event("diagnosis_complete", {"round": self._round})
            except Exception:  # noqa: BLE001
                pass

    async def handle_diagnose(self) -> None:
        """向后兼容:等价于 match + root(旧 /control?action=diagnose 与旧测试入口)。"""
        await self.handle_match()
        await self.handle_root()

    async def handle_apply_policy(self) -> None:
        self._set_state("recovering")
        # 轮次感知:首轮用弱策略 recovery_actions_r1(若定义),二轮用完整 recovery_actions
        actions = resolve_policy_actions(self.scenario, self._last_diagnosis, round_no=self._round)
        self.engine.apply_policy(actions)
        self._set_phase(5)  # 下发策略
        recipe = self.scenario.recovery_actions_r1 if (
            self._round == 1 and self.scenario.recovery_actions_r1
        ) else self.scenario.recovery_actions
        for rec in recipe:
            self._publish("recovery_action", {
                "id": rec.get("id", ""), "cn": rec.get("cn", ""), "en": rec.get("en", ""),
                "layer": rec.get("layer"), "ts": 0, "round": self._round,
            })
            if self.recorder is not None:
                try:
                    self.recorder.record_recovery_action(
                        type("_A", (), {"id": rec.get("id", ""), "cn": rec.get("cn", ""),
                                        "en": rec.get("en", ""), "layer": rec.get("layer")})(),
                        self._round,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("record_recovery_action failed")
            await asyncio.sleep(self.recovery_action_delay)
        self._set_phase(6)  # 网络恢复(策略已回灌,后续 tick SR 回升)
        self._arm_phase(5, 6)  # 跑恢复数据段(5+6 合并配额),配额跑完自动暂停,等点击 evaluate

    async def handle_evaluate(self) -> None:
        self._set_state("evaluating")
        self._set_phase(7)  # 评估优化
        # 等恢复数据段跑完(配额耗尽)再判恢复——取代固定 settle
        await self._wait_segment()
        recovered = self.engine.is_recovered()

        # 双轮场景:首轮弱策略未恢复 → 自动进二轮(重诊 + 精调策略)
        if (
            not recovered
            and self._round < self.scenario.expected_rounds
            and self.scenario.recovery_actions_r1 is not None
            and (self._round == 1 or self.scenario.recovery_actions_r1)
        ):
            self._round += 1
            self.engine.round = self._round
            self._publish("confidence_low", {
                "score": float(getattr(self._last_diagnosis, "confidence", 0.0)) if self._last_diagnosis else 0.0,
                "current_attempt": self._round - 1, "hint": "round2_refine",
            })
            self._publish("round_change", {"round": self._round})
            await self.handle_match()          # 二轮重评估
            await self.handle_root()           # 二轮重诊
            await self.handle_apply_policy()   # 二轮精调策略
            await self._wait_segment()         # 等二轮恢复段跑完再判恢复
            recovered = self.engine.is_recovered()

        report = _build_evaluation(self.scenario, self._last_diagnosis, recovered, self._round, self.engine)
        self._publish("evaluation_report", report)
        if self.recorder is not None:
            try:
                self.recorder.record_evaluation(report)
            except Exception:  # noqa: BLE001
                logger.exception("record_evaluation failed")
        self._set_state("done")
        if self.storage is not None:
            try:
                self.storage.complete_live_session(self.session_id)
            except Exception:  # noqa: BLE001
                logger.exception("complete_live_session failed")
        if self.recorder is not None:
            try:
                self.recorder.finalize("done")
            except Exception:  # noqa: BLE001
                logger.exception("recorder.finalize failed")


def _build_evaluation(scenario: LiveScenario, diagnosis: Any, recovered: bool, round_no: int, engine: Any = None) -> dict:
    truth = sorted((scenario.fault_config.affected_ne_ids or set()))
    pred = list(getattr(diagnosis, "fault_elements", []) or []) if diagnosis else []
    tp = len(set(pred) & set(truth))
    prec = tp / len(pred) if pred else (1.0 if not truth else 0.0)
    rec = tp / len(truth) if truth else 1.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    reg_sr = pdu_sr = None
    if engine is not None:
        reg_sr, pdu_sr = engine._success_rates()  # noqa: SLF001
    return {
        "metrics": {
            "precision": round(prec, 3), "recall": round(rec, 3),
            "f1": round(f1, 3), "exact_match": set(pred) == set(truth),
        },
        "recovered": recovered,
        "amf_success_rate": round(reg_sr, 4) if reg_sr is not None else None,
        "smf_success_rate": round(pdu_sr, 4) if pdu_sr is not None else None,
        "trace_axes": {"overall": 0.9 if recovered else 0.6},
        "suggestions": [],
        "case_entry": {"scenario": scenario.id, "round": round_no, "predicted": pred, "truth": truth},
    }
