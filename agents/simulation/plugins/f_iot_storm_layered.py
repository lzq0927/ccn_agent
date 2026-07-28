"""场景 F plugin:三层并行恢复·终端类型感知。

- capabilities="live"
- 首轮 3 策略全下 → iPhone 失败反升 → confidence 0.28 → restart
- 二轮回 Agent1 补采 CHR(终端类型) → 排除 iPhone → 收敛 confidence 0.6
- UE 准入:首轮所有终端按 AMF/SMF 限流;二轮对 iPhone 直接 DENY(让 NSSAI 拦截)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agents.shared.scenario_plugin import (
    DiagnosisContext,
    Event,
    RebatchSpec,
    RecoveryAction,
    RecoveryContext,
    TickContext,
)
from agents.simulation.live_engine import UeRequest, UeResponse
from simulator.topology import TopologyGenerator
from simulator.models import FaultConfig, FaultPointType, FaultMode


@dataclass
class _Plan:
    fault_elements: list[str]
    confidence: float
    route: str = "workflow"
    round: int = 1
    reasoning: list[dict] = field(default_factory=list)


def _build_topology() -> Any:
    return TopologyGenerator().generate(0, seed=101)


def _build_fault_config(topo: Any) -> FaultConfig:
    return FaultConfig(
        fault_point_type=FaultPointType.PATH_SESSION,
        fault_mode=FaultMode.BUSINESS,
        affected_ne_ids={"UPF_1"},
        loss_rate=0.0,  # 流控溯源不是单点丢包
        fault_start=28,
        fault_duration=20,
    )


def _build_ue_distribution() -> dict:
    # 10 个 APN,6 种终端;仅「物联网平台」APN 异常;iPhone 不支持 back-off
    return {
        "apns": [
            {"id": "iot-platform", "anomalous": True},
            {"id": "web-default", "anomalous": False},
        ] + [{"id": f"apn_{i}", "anomalous": False} for i in range(8)],
        "devices": [
            {"id": "iphone", "supports_backoff": False},
            {"id": "android", "supports_backoff": True},
            {"id": "huawei", "supports_backoff": True},
            {"id": "iot-cam", "supports_backoff": True},
            {"id": "iot-meter", "supports_backoff": True},
            {"id": "windows-iot", "supports_backoff": True},
        ],
    }


def _diagnosis_llm_stub(ctx: DiagnosisContext) -> _Plan:
    if ctx.round == 1:
        # 首轮:3 策略全下,iPhone 失败反升,confidence 0.28
        return _Plan(
            fault_elements=[],
            confidence=0.28,
            route="autonomous",
            round=1,
            reasoning=[
                {"type": "thinking", "text": "首轮 3 策略并行下发(UE back-off + AMF NSSAI + SMF DNN)"},
                {"type": "tool_call", "text": "iPhone 不支持 back-off timer,立即重试,放大风暴"},
                {"type": "conclusion", "text": "首轮失败反升,置信度 0.28 < 阈值"},
            ],
        )
    # 二轮:终端类型感知,排除 iPhone,收敛
    return _Plan(
        fault_elements=["AMF_1"],
        confidence=0.6,
        route="workflow",
        round=2,
        reasoning=[
            {"type": "thinking", "text": "回 Agent1 补采 CHR(终端类型×APN×back-off 支持)"},
            {"type": "tool_call", "text": "终端分群:仅 iPhone 不支持 back-off;APN 异常仅「物联网平台」"},
            {"type": "conclusion", "text": "二轮:对 iPhone 不下发 back-off,改由 AMF NSSAI 拦截;微调 AMF/SMF 限流比例"},
        ],
    )


def _recovery_actions(plan: _Plan) -> list[RecoveryAction]:
    if plan.round == 1 or plan.confidence < 0.3:
        return [
            RecoveryAction(id="r1_ue_backoff", cn="[轮1] UE back-off T=12s", en="R1 UE BACKOFF", layer="UE"),
            RecoveryAction(id="r1_amf_nssai", cn="[轮1] AMF NSSAI 接纳 ρ=75%", en="R1 AMF NSSAI 75%", layer="AMF"),
            RecoveryAction(id="r1_smf_dnn", cn="[轮1] SMF DNN 接纳 ρ=70%", en="R1 SMF DNN 70%", layer="SMF"),
        ]
    return [
        RecoveryAction(id="r2_ue_backoff", cn="[轮2] UE back-off T=14s(排除 iPhone)", en="R2 UE BACKOFF (EXCL IPHONE)", layer="UE"),
        RecoveryAction(id="r2_amf_nssai", cn="[轮2] AMF NSSAI ρ=57%(微调)", en="R2 AMF NSSAI 57%", layer="AMF"),
        RecoveryAction(id="r2_smf_dnn", cn="[轮2] SMF DNN ρ=52%(微调)", en="R2 SMF DNN 52%", layer="SMF"),
    ]


def _on_recovery_action(action: RecoveryAction, ctx: RecoveryContext) -> list[Event]:
    return [Event(type="recovery_action_progress", payload={"id": action.id, "ne_cpu": ctx.ne_cpu})]


def _on_ue_request(req: UeRequest) -> UeResponse:
    # 二轮:对 iPhone + 物联 APN 直接 DENY(由 AMF NSSAI 拦截)
    if req.device_type == "iphone" and req.apn == "iot-platform":
        return UeResponse(verdict="DENY", note="iphone+iot denied by NSSAI")
    # 物联终端 + 物联 APN:按反压限流
    if req.apn == "iot-platform":
        return UeResponse(verdict="ALLOW", note="iot allowed by NSSAI")
    return UeResponse(verdict="ALLOW")


# ---------------------------------------------------------------------------
# 真实数据合成:on_tick 按 global_t 产出 KPI/CHR/告警
#   时间轴与 DEMO simTForF 对齐:风暴起 28 / 反升峰 36 / 收敛 44-58 / 恢复 58+
#   首轮(global_t 1-30):稳态 + 风暴初起 → confidence 低中止
#   二轮(global_t 31-60):攀升 + 反升 + 收敛 + 恢复
# ---------------------------------------------------------------------------
_FS_START = 28  # 风暴起(物联注册突增)
_FS_PEAK = 36   # 反升峰(首轮 iPhone 不支持 back-off,反复重试放大风暴)
_FS_CONV = 44   # 收敛开始(二轮排除 iPhone,NSSAI+APN 准入控制生效)
_FS_END = 58    # 收敛完成


def _kpi_at(t: int) -> dict:
    """按全局仿真时间合成流控风暴 KPI(与 DEMO 曲线对齐,便于落盘核对)。"""
    if t < _FS_START:
        return {"amf_cpu": 40.0, "smf_cpu": 38.0, "iot_reg": 5.0, "toc_reg": 15.0,
                "iot_sess": 40.0, "toc_sess": 300.0, "amf_sr": 0.995, "smf_sr": 0.995}
    if t < _FS_PEAK:
        ramp = (t - _FS_START) / max(1, (_FS_PEAK - _FS_START))  # 0→1
        return {"amf_cpu": 40 + 55 * ramp, "smf_cpu": 38 + 53 * ramp,
                "iot_reg": 5 + 175 * ramp, "toc_reg": 15 + 7 * ramp,
                "iot_sess": 40 + 280 * ramp, "toc_sess": 300 + 60 * ramp,
                "amf_sr": 0.995 - 0.135 * ramp, "smf_sr": 0.995 - 0.12 * ramp}
    if t < _FS_CONV:
        # 反升段:首轮策略失败,维持高位
        return {"amf_cpu": 95.0, "smf_cpu": 91.0, "iot_reg": 186.0, "toc_reg": 22.0,
                "iot_sess": 320.0, "toc_sess": 360.0, "amf_sr": 0.86, "smf_sr": 0.875}
    if t < _FS_END:
        conv = (t - _FS_CONV) / max(1, (_FS_END - _FS_CONV))  # 0→1
        return {"amf_cpu": 95 - 55 * conv, "smf_cpu": 91 - 53 * conv,
                "iot_reg": 186 - 158 * conv, "toc_reg": 22 - 7 * conv,
                "iot_sess": 320 - 280 * conv, "toc_sess": 360 - 60 * conv,
                "amf_sr": 0.86 + 0.135 * conv, "smf_sr": 0.875 + 0.12 * conv}
    return {"amf_cpu": 42.0, "smf_cpu": 40.0, "iot_reg": 8.0, "toc_reg": 15.0,
            "iot_sess": 45.0, "toc_sess": 300.0, "amf_sr": 0.994, "smf_sr": 0.994}


def _on_tick(ctx) -> list:
    """每个仿真秒合成 KPI 快照 + CHR + 告警,并填 ctx.ne_cpu/active_ue。"""
    t = ctx.global_t
    kpi = _kpi_at(t)

    # NE CPU(AMF/SMF 各实例分担,其余 NE 基线)
    ctx.ne_cpu = {
        "AMF_1": kpi["amf_cpu"], "AMF_2": kpi["amf_cpu"] * 0.96, "AMF_3": kpi["amf_cpu"] * 0.92,
        "SMF_1": kpi["smf_cpu"], "SMF_2": kpi["smf_cpu"] * 0.95,
        "UPF_1": 35.0, "UPF_2": 33.0, "UPF_3": 31.0,
        "PCF_1": 24.0, "PCF_2": 22.0,
        "UDM_1": 19.0, "UDM_2": 17.0,
        "AUSF_1": 18.0, "AUSF_2": 16.0,
        "NRF_1": 14.0, "NRF_2": 13.0,
        "NSSF_1": 21.0, "NSSF_2": 20.0,
    }
    ctx.active_ue = int(kpi["iot_reg"] * 8 + kpi["toc_reg"] * 5)

    events = [Event(
        type="kpi_snapshot",
        payload={"sim_t": t, "round": ctx.round,
                 "amf_cpu": round(kpi["amf_cpu"], 2), "smf_cpu": round(kpi["smf_cpu"], 2),
                 "iot_reg_rate": round(kpi["iot_reg"], 1), "toc_reg_rate": round(kpi["toc_reg"], 1),
                 "iot_sess_rate": round(kpi["iot_sess"], 1), "toc_sess_rate": round(kpi["toc_sess"], 1),
                 "amf_success_rate": round(kpi["amf_sr"], 4), "smf_success_rate": round(kpi["smf_sr"], 4)},
    )]

    # CHR(风暴期:物联终端会话失败 + 首轮 iPhone 反复重试)
    if t >= _FS_START:
        if ctx.round == 1 and t >= _FS_PEAK - 4:
            events.append(Event(type="chr_record", payload={
                "sim_t": t, "round": ctx.round, "ue_id": f"iphone-{t % 30:03d}",
                "device_type": "iphone", "apn": "iot-platform", "procedure": "registration",
                "cause_code": "5GMM:22", "cause_cn": "拥塞(iPhone 不支持 back-off,反复重试)",
                "success": False,
            }))
        elif t < _FS_CONV:
            events.append(Event(type="chr_record", payload={
                "sim_t": t, "round": ctx.round, "ue_id": f"iot-{t % 80:03d}",
                "device_type": "iot-meter", "apn": "iot-platform", "procedure": "pdu_create",
                "cause_code": "5GSM:37", "cause_cn": "PDU 会话建立失败", "success": False,
            }))

    # 告警(风暴起 + CPU 过载 + 收敛生效)
    if t == _FS_START:
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "AMF_1", "severity": "major",
            "category": "registration_storm", "message": "物联终端注册请求突增,疑似注册风暴",
        }))
    if kpi["amf_cpu"] >= 85 and t in (_FS_PEAK, _FS_PEAK + 2, _FS_CONV):
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "AMF_1",
            "severity": "critical" if kpi["amf_cpu"] >= 90 else "major",
            "category": "cpu_overload", "message": f"AMF_1 CPU {kpi['amf_cpu']:.0f}% 过载",
        }))
    if kpi["smf_cpu"] >= 85 and t in (_FS_PEAK, _FS_PEAK + 2, _FS_CONV):
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "SMF_1",
            "severity": "critical" if kpi["smf_cpu"] >= 90 else "major",
            "category": "cpu_overload", "message": f"SMF_1 CPU {kpi['smf_cpu']:.0f}% 过载",
        }))
    if t == _FS_CONV:
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "AMF_1", "severity": "info",
            "category": "admission_control", "message": "二轮 NSSAI+APN 准入控制生效,开始收敛",
        }))

    return events


class FPlugin:
    id = "F"
    label_cn = "流控溯源·物联网风暴(三层并行·终端类型感知)"
    label_en = "IOT STORM · LAYERED ADMISSION"
    version = "1.0"
    short_intro = "3 策略并行下发,iPhone 失败反升,二轮终端类型感知收敛"
    route_expectation = "workflow+exploration"
    expected_round = 2
    capabilities = "live"

    def build_topology(self): return _build_topology()
    def build_fault_config(self, topo): return _build_fault_config(topo)
    def build_ue_distribution(self): return _build_ue_distribution()
    def on_tick(self, ctx: TickContext): return _on_tick(ctx)
    def diagnosis_llm_stub(self, ctx: DiagnosisContext): return _diagnosis_llm_stub(ctx)
    def recovery_actions(self, plan): return _recovery_actions(plan)
    def on_recovery_action(self, action, ctx): return _on_recovery_action(action, ctx)
    def request_rebatch_chr(self): return RebatchSpec(dimensions=["device_type", "supports_backoff", "apn"])
    def on_user_breakdown(self, breakdown): return []
    def on_ue_request(self, req: UeRequest) -> UeResponse: return _on_ue_request(req)


PLUGIN = FPlugin()