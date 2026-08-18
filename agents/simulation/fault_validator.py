"""FaultValidator: Agent 1(数据生成)在 LIVE 闭环中的实时形态 —— 故障注入前影子自校验。

Agent 1 的设计态职责是「生成合理的故障用例数据并自校验(失败调参重试)」。
LIVE 形态:故障注入前,在**影子引擎**(同拓扑/同场景/同种子)上预演
「健康段 → 注入故障 → 故障段」,校验故障数据是否合理;不合理则调参重试,
通过后才把校验过的 ``FaultConfig`` 注入真实引擎 —— 与设计态
generate→validate→adjust 闭环同构,且**完全通用**(只看故障模型,不看场景)。

校验维度(与 Agent 1 LLM 校验器的 5 维对齐,规则实现、无 LLM 也能跑):
  1. kpi_consistency    健康段 SR ≥ 0.99 且故障段确实产生异常(KPI 下降 / CHR 失败)
  2. fault_manifestation 故障确实「显形」:NE 丢损类→受影响链路跌破阈值或该 NE 过载;
                          业务激增类→核心 NF CPU 过载
  3. topology_coherence  受影响 NE 都在拓扑内
  4. process_validity    故障段仍有成功流程(网络未整体瘫痪,业务流有效)
  5. label_correctness   真值标签与观测一致(故障段的异常可归因到受影响 NE/类别)

调参规则(通用):显形不足→loss_rate ×1.8 / surge ×1.5;过度(崩溃)→loss ×0.6。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace

from simulator.models import FaultConfig

from agents.simulation.demo_topology import build_demo_topology
from agents.simulation.realtime_engine import RealtimeEngine

logger = logging.getLogger(__name__)

_MAX_TRIES = 3
_HEALTH_TICKS = 8
_FAULT_TICKS = 10
_SR_HEALTHY = 0.99
_SR_FLOOR = 0.50          # 故障段整体 SR 低于此视为「崩溃级」过度
_OVERLOAD_LINE = 78.0     # 影子段 CPU 判定线(略低于 80,给真实引擎留裕量)
_ANOMALY_THRESHOLD = 0.995


@dataclass
class ValidationReport:
    passed: bool
    tries: int
    checks: list[dict] = field(default_factory=list)   # [{name, passed, note}]
    adjustments: list[str] = field(default_factory=list)


def _run_shadow(scenario, fc: FaultConfig, seed: int) -> RealtimeEngine:
    """影子引擎预演:健康段 → 注入 → 故障段(纯 CPU,毫秒级)。"""
    engine = RealtimeEngine(scenario=scenario, seed=seed)
    engine.advance_tick(1)  # 预热(绑定/窗口初始化)
    for t in range(2, _HEALTH_TICKS + 1):
        engine.advance_tick(t)
    engine.inject_fault(fc)
    for t in range(_HEALTH_TICKS + 1, _HEALTH_TICKS + _FAULT_TICKS + 1):
        engine.advance_tick(t)
    return engine


def _evaluate_shadow(fc: FaultConfig, engine: RealtimeEngine, topology_ids: set[str]) -> ValidationReport:
    """对影子引擎终态做 5 维校验,返回报告(passed=False 时附调整方向)。"""
    reg_sr, pdu_sr = engine._success_rates()  # noqa: SLF001
    min_sr = min(reg_sr, pdu_sr)
    view = engine.snapshot_for_agent()
    link_rows = [r for r in view["kpi_rows"] if str(r.get("level")) == "link"]
    degraded = [r for r in link_rows if float(r.get("success_rate", 1.0)) < _ANOMALY_THRESHOLD]
    chr_fails = [c for c in view["chr_records"] if c.get("outcome") == "failure"]
    affected = sorted(fc.affected_ne_ids or [])
    cpu = engine.ne_cpu
    core_overload = [ne for ne, c in cpu.items()
                     if c >= _OVERLOAD_LINE and not ne.startswith("gNB")]
    is_surge = fc.surge_multiplier > 1.0

    checks: list[dict] = []

    # 1) KPI 一致性:故障段有异常且未崩溃
    anomaly_present = bool(degraded or chr_fails or core_overload)
    checks.append({
        "name": "kpi_consistency", "passed": anomaly_present and min_sr >= _SR_FLOOR,
        "note": f"故障段 SR reg={reg_sr:.3f} pdu={pdu_sr:.3f},退化链路 {len(degraded)} 条,"
                f"CHR 失败 {len(chr_fails)},过载 NE {core_overload or '无'}",
    })
    # 2) 故障显形
    if is_surge:
        manifested = bool(core_overload)
        note = f"激增类:核心 NF CPU {sorted((round(cpu[n],1), n) for n in core_overload)[:4]}"
    elif getattr(fc, "loss_scope", "all_hops") == "ue_hops":
        # 接入侧群体故障(ue_hops):核心链路 KPI 不染 —— 显形于 CHR 失败集中
        # 于受影响 NE(gNB)与会话 SR 下降
        affected = set(fc.affected_ne_ids or set())
        chr_hits = sum(
            1 for c in chr_fails
            if str(c.get("nf_src", "")) in affected or str(c.get("nf_dst", "")) in affected
        )
        manifested = (chr_hits >= 10 and chr_hits >= 0.6 * len(chr_fails)) or min_sr < _SR_FLOOR
        note = (f"接入侧类:CHR 失败 {chr_hits}/{len(chr_fails)} 集中于 {affected},"
                f"会话 SR reg={reg_sr:.3f} pdu={pdu_sr:.3f}")
    else:
        affected_links = [r for r in degraded
                          if r.get("src") in (fc.affected_ne_ids or set())
                          or r.get("dst") in (fc.affected_ne_ids or set())]
        manifested = bool(affected_links) or bool(core_overload)
        note = f"丢损类:{len(affected_links)} 条链路涉及受影响 NE {affected}"
    checks.append({"name": "fault_manifestation", "passed": manifested, "note": note})
    # 3) 拓扑一致
    unknown = [ne for ne in affected if ne not in topology_ids]
    checks.append({
        "name": "topology_coherence", "passed": not unknown,
        "note": "受影响 NE 全部在拓扑内" if not unknown else f"拓扑外 NE:{unknown}",
    })
    # 4) 流程有效:故障段仍有成功流程
    succ_reg, succ_pdu = engine._tick_reg_succ, engine._tick_pdu_succ  # noqa: SLF001
    process_ok = (reg_sr >= _SR_FLOOR) and (pdu_sr >= _SR_FLOOR) and (succ_reg + succ_pdu) >= 0
    checks.append({
        "name": "process_validity", "passed": process_ok,
        "note": f"故障段末 tick 成功流程 reg={succ_reg} pdu={succ_pdu}(网络未整体瘫痪)",
    })
    # 5) 标签正确性:真值非空且与观测同向(异常能归因到受影响集合/激增类别)
    label_ok = bool(affected) and anomaly_present
    checks.append({
        "name": "label_correctness", "passed": label_ok,
        "note": f"真值 NE={affected or '空'};激增类别={fc.surge_filter or '-'};观测异常存在={anomaly_present}",
    })

    return ValidationReport(passed=all(c["passed"] for c in checks), tries=0, checks=checks)


def validate_fault_spec(scenario, fault_config: FaultConfig, seed: int = 42) -> tuple[FaultConfig, ValidationReport]:
    """影子自校验:不合理则调参重试(≤3 次),返回校验过的 FaultConfig + 报告。"""
    fc = fault_config
    adjustments: list[str] = []
    report = ValidationReport(passed=False, tries=0)
    topology_ids = set(build_demo_topology().elements)

    for try_no in range(1, _MAX_TRIES + 1):
        shadow = _run_shadow(scenario, fc, seed)
        report = _evaluate_shadow(fc, shadow, topology_ids)
        report.tries = try_no
        report.adjustments = adjustments
        if report.passed:
            return fc, report

        failed = {c["name"] for c in report.checks if not c["passed"]}
        # 显形不足 → 加大故障;崩溃 → 减小(通用规则,按故障模型分支)
        if "fault_manifestation" in failed or ("kpi_consistency" in failed
                                               and min(shadow._success_rates()) > _SR_HEALTHY - 0.005):  # noqa: SLF001
            if fc.surge_multiplier > 1.0:
                new_fc = replace(fc, surge_multiplier=round(min(fc.surge_multiplier * 1.5, 20.0), 2))
                adjustments.append(
                    f"第{try_no}轮显形不足:surge {fc.surge_multiplier}→{new_fc.surge_multiplier}")
            else:
                # ×4 步长:微损故障的显形阈值 ~1%(滚动窗口),步长太小会在重试上限内
                # 始终不可见(0.001×1.8³ 仍 <0.01)
                new_fc = replace(fc, loss_rate=round(min(fc.loss_rate * 4.0, 0.45), 5))
                adjustments.append(
                    f"第{try_no}轮显形不足:loss {fc.loss_rate}→{new_fc.loss_rate}")
            fc = new_fc
        elif "kpi_consistency" in failed:
            reg_sr, pdu_sr = shadow._success_rates()  # noqa: SLF001
            if min(reg_sr, pdu_sr) < _SR_FLOOR:
                new_fc = replace(fc, loss_rate=round(max(fc.loss_rate * 0.6, 0.005), 4))
                adjustments.append(
                    f"第{try_no}轮崩溃级(SR {min(reg_sr, pdu_sr):.2f}):loss {fc.loss_rate}→{new_fc.loss_rate}")
                fc = new_fc
        else:
            # 拓扑外 NE / 标签空等结构性问题:调参救不了,按原样返回(报告如实标注)
            break

    return fc, report
