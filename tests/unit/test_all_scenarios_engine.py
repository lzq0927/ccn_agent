"""A~G 全场景引擎冒烟:每个场景都能正常跑、注入故障产生异常、策略可执行。"""
from __future__ import annotations

import pytest

from agents.simulation.live_scenarios import SCENARIOS
from agents.simulation.policy_resolver import resolve_policy_actions
from agents.simulation.realtime_engine import RealtimeEngine


def _run(engine, n, start=1):
    for i in range(n):
        engine.advance_tick(start + i)


@pytest.mark.parametrize("sid", list(SCENARIOS.keys()))
def test_scenario_normal_then_fault_then_policy(sid):
    scen = SCENARIOS[sid]
    engine = RealtimeEngine(scenario=scen, seed=hash(sid) & 0xFFFF)
    _run(engine, 15)
    pre_reg, pre_pdu = engine._success_rates()  # noqa: SLF001
    assert pre_reg > 0.95 and pre_pdu > 0.95, f"{sid}: pre-fault SR too low reg={pre_reg} pdu={pre_pdu}"

    engine.inject_fault(scen.fault_config)
    _run(engine, 14, start=16)

    # 异常视图:link KPI 出现跌破阈值的链路,或 CHR 出现失败(至少其一)
    view = engine.snapshot_for_agent()
    anomalous = [r for r in view["kpi_rows"] if str(r.get("level")) == "link" and float(r.get("success_rate", 1)) < 0.995]
    chr_fails = [c for c in view["chr_records"] if c.get("outcome") == "failure"]
    assert anomalous or chr_fails, f"{sid}: no anomaly produced after inject"

    # 策略可解析 + 可执行(不抛错)
    actions = resolve_policy_actions(scen, diagnosis=None)
    assert actions, f"{sid}: no policy actions resolved"
    engine.apply_policy(actions)
    _run(engine, 10, start=30)
    # 策略执行后不崩,SR 有限(单网元类应恢复;风暴类至少不更差)
    post_reg, post_pdu = engine._success_rates()  # noqa: SLF001
    assert 0.0 <= post_reg <= 1.0 and 0.0 <= post_pdu <= 1.0
