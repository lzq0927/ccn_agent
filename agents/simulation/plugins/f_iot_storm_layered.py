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
    def on_tick(self, ctx: TickContext): return []
    def diagnosis_llm_stub(self, ctx: DiagnosisContext): return _diagnosis_llm_stub(ctx)
    def recovery_actions(self, plan): return _recovery_actions(plan)
    def on_recovery_action(self, action, ctx): return _on_recovery_action(action, ctx)
    def request_rebatch_chr(self): return RebatchSpec(dimensions=["device_type", "supports_backoff", "apn"])
    def on_user_breakdown(self, breakdown): return []
    def on_ue_request(self, req: UeRequest) -> UeResponse: return _on_ue_request(req)


PLUGIN = FPlugin()