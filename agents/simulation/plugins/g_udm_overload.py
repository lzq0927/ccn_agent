"""场景 G plugin:AI 平台故障 → UDM 过载 → AMF/SMF 协同限流(两轮收敛)。

叙事对齐 frontend-flow-show 现有场景 G(不修改前者,此处为 frontend-flow 的
LIVE 实现):
- AI 平台 1 故障 → 该平台终端频繁注册 → 消息冲击汇聚点 UDM(AMF/SMF 自身不过载)
- 检测:UDM CPU 过载告警 + 注册/会话 SR 降 + AMF/SMF→UDM 消息突增
- 溯源:CHR(SST=3 / DNN=MIot.xx)+ UFDR(SUPI→AI 平台 1,仅上行)
- 处置:向 AMF/SMF 下发限流(限 SST=3 / DNN + 回 T3346/T3396)消除 UDM 过载
- 两轮:首轮诊断信号不足(UDM 过载但根因待溯源)→ 回 Agent1 补采 CHR/UFDR
       → 二轮溯源 AI 平台 1 + 终端类型感知 → AMF/SMF 协同限流收敛

LIVE 两轮复用 LiveRunner 的 confidence-restart 机制:
  round1 confidence 0.28(< 0.3)→ restart → round2 confidence 0.8 → recover
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
    # UDM_1 过载(被 AI 平台终端冲击);build_fault_config 供未来真 simulator 用,
    # 当前 LIVE KPI 由 on_tick 合成,不依赖此配置。
    return FaultConfig(
        fault_point_type=FaultPointType.SINGLE_NE,
        fault_mode=FaultMode.BUSINESS,
        affected_ne_ids={"UDM_1"},
        loss_rate=0.04,
        fault_start=28,
        fault_duration=20,
    )


def _build_ue_distribution() -> dict:
    # AI 平台 1 终端(SST=3 / DNN=MIot.xx)频繁注册;部分终端不支持 T3346 定时器
    return {
        "platforms": [
            {"id": "ai-platform-1", "anomalous": True, "terminals": 320},
            {"id": "ai-platform-2", "anomalous": False, "terminals": 60},
        ],
        "slices": [{"sst": 3, "dnn": "MIot.xx", "anomalous": True}],
        "devices": [
            {"id": "iot-cam", "supports_t3346": True},
            {"id": "iot-meter", "supports_t3346": True},
            {"id": "legacy-sensor", "supports_t3346": False},  # 不支持 → 首轮未收敛
        ],
    }


# ---------------------------------------------------------------------------
# 诊断 stub(两轮)
# ---------------------------------------------------------------------------
def _diagnosis_llm_stub(ctx: DiagnosisContext) -> _Plan:
    if ctx.round == 1:
        # 首轮:UDM 过载告警 + AMF/SMF→UDM 消息突增 + 初步 CHR(SST=3/DNN),
        # 但根因(谁冲击 UDM)待 UFDR 溯源 → 置信不足,回 Agent1 补采
        return _Plan(
            fault_elements=[],
            confidence=0.28,
            route="autonomous",
            round=1,
            reasoning=[
                {"type": "tool_call", "text": "UDM_1 容器 CPU 92% > 85% 触发过载流控告警;注册 SR、PDU 会话 SR 下降;AMF/SMF CPU 正常(58/52)。"},
                {"type": "tool_call", "text": "AMF→UDM 注册请求消息突增,UDM CHR 显示 SST=3 占 55%;SMF→UDM 会话消息突增,DNN=MIot.xx 占 58%。"},
                {"type": "thinking", "text": "UDM 为被冲击方,根因(冲击 UDM 的终端来源)待 UFDR 关联 SUPI 溯源,首轮证据不足。"},
                {"type": "conclusion", "text": "首轮置信度 0.28 < 阈值,需回 Agent1 补采 UFDR(SUPI→流量去向)+ 终端类型。"},
            ],
        )
    # 二轮:UFDR 关联 SUPI→AI 平台 1(仅上行)+ 终端类型(部分不支持 T3346)
    # → 根因 AI 平台 1 → 向 AMF/SMF 下发协同限流消除 UDM 过载
    return _Plan(
        fault_elements=["UDM_1"],
        confidence=0.8,
        route="workflow",
        round=2,
        reasoning=[
            {"type": "tool_call", "text": "[轮2] UFDR 关联 UDM CHR 中终端 SUPI:这些终端流量均发往 AI 平台 1,且仅含上行、无下行 → 溯源 AI 平台 1 故障终端;上报 OSS。"},
            {"type": "tool_call", "text": "[轮2] CHR 终端类型分析:发现部分终端(legacy-sensor)不支持 T3346 定时器,首轮收到 Reg Reject 后立即重试,致未完全收敛。"},
            {"type": "thinking", "text": "[轮2] 线性推算减量:Δmsg=(78−70)/(78−40)×240≈50 消息/s;按 AMF:SMF=55:45 分配。决策:对不支持终端由 AMF/SMF 直接拦截,支持终端加深 T3346/T3396。"},
            {"type": "conclusion", "text": "根因 AI 平台 1 故障 → 终端频繁注册冲击 UDM;向 AMF/SMF 下发限 SST=3/DNN + 回 T3346/T3396,消除 UDM 过载。"},
        ],
    )


def _recovery_actions(plan: _Plan) -> list[RecoveryAction]:
    # 仅 round2(收敛后)下发;round1 confidence 低 → restart,不 recover
    if plan.round == 1 or plan.confidence < 0.3:
        return []
    return [
        RecoveryAction(
            id="r2_ue_timer", cn="[轮2] AMF/SMF 回 T3346/T3396(10min,支持终端加深)",
            en="R2 UE T3346/T3396", layer="UE",
        ),
        RecoveryAction(
            id="r2_amf_sst", cn="[轮2] AMF 限 SST=3 注册 ρ=48%(差值重算)",
            en="R2 AMF SST=3 LIMIT 48%", layer="AMF",
        ),
        RecoveryAction(
            id="r2_smf_dnn", cn="[轮2] SMF 限 DNN=MIot.xx 会话 ρ=42%",
            en="R2 SMF DNN LIMIT 42%", layer="SMF",
        ),
    ]


def _on_recovery_action(action: RecoveryAction, ctx: RecoveryContext) -> list[Event]:
    return [Event(type="recovery_action_progress", payload={"id": action.id, "ne_cpu": ctx.ne_cpu})]


def _on_ue_request(req: UeRequest) -> UeResponse:
    # 二轮:AI 平台 1 终端(SST=3 / DNN=MIot.xx)按限流概率拒绝 + 回 T3346
    if req.sst == 3 or req.apn == "MIot.xx":
        return UeResponse(verdict="BACKOFF", backoff_seconds=600, note="限流 + 回 T3346(10min)")
    return UeResponse(verdict="ALLOW")


# ---------------------------------------------------------------------------
# 真实数据合成:on_tick 按 global_t 产 UDM 过载 KPI/CHR/告警
#   时间轴与 DEMO 对齐:AI 平台故障起 28 / UDM 过载峰 36 / 二轮限流收敛 44-58
# ---------------------------------------------------------------------------
_GO_START = 28  # AI 平台 1 故障 → 终端频繁注册
_GO_PEAK = 36   # UDM 过载峰(CPU 92%)
_GO_CONV = 44   # 二轮 AMF/SMF 协同限流生效
_GO_END = 58    # UDM 过载消除


def _kpi_at(t: int) -> dict:
    """按全局仿真时间合成 UDM 过载 KPI(AMF/SMF 不过载,过载点在 UDM)。"""
    if t < _GO_START:
        return {"udm_cpu": 40.0, "amf_cpu": 40.0, "smf_cpu": 38.0,
                "amf_sr": 0.995, "smf_sr": 0.995,
                "reg_rate": 50.0, "sess_rate": 80.0,
                "msg_to_udm": 90.0, "ai_platform_reg_share": 8.0}
    if t < _GO_PEAK:
        ramp = (t - _GO_START) / max(1, (_GO_PEAK - _GO_START))  # 0→1
        return {"udm_cpu": 40 + 52 * ramp, "amf_cpu": 40 + 18 * ramp, "smf_cpu": 38 + 14 * ramp,
                "amf_sr": 0.995 - 0.135 * ramp, "smf_sr": 0.995 - 0.12 * ramp,
                "reg_rate": 50 + 180 * ramp, "sess_rate": 80 + 120 * ramp,
                "msg_to_udm": 90 + 230 * ramp, "ai_platform_reg_share": 8 + 64 * ramp}
    if t < _GO_CONV:
        # 过载峰维持(首轮策略未完全收敛,UDM 仍 92% 过载)
        return {"udm_cpu": 92.0, "amf_cpu": 58.0, "smf_cpu": 52.0,
                "amf_sr": 0.86, "smf_sr": 0.875,
                "reg_rate": 230.0, "sess_rate": 200.0,
                "msg_to_udm": 320.0, "ai_platform_reg_share": 72.0}
    if t < _GO_END:
        # 二轮协同限流收敛:UDM CPU 92→68(过载消除),各项恢复
        conv = (t - _GO_CONV) / max(1, (_GO_END - _GO_CONV))  # 0→1
        return {"udm_cpu": 92 - 24 * conv, "amf_cpu": 58 - 17 * conv, "smf_cpu": 52 - 13 * conv,
                "amf_sr": 0.86 + 0.134 * conv, "smf_sr": 0.875 + 0.119 * conv,
                "reg_rate": 230 - 175 * conv, "sess_rate": 200 - 118 * conv,
                "msg_to_udm": 320 - 225 * conv, "ai_platform_reg_share": 72 - 62 * conv}
    return {"udm_cpu": 42.0, "amf_cpu": 41.0, "smf_cpu": 39.0,
            "amf_sr": 0.994, "smf_sr": 0.994,
            "reg_rate": 55.0, "sess_rate": 82.0,
            "msg_to_udm": 95.0, "ai_platform_reg_share": 10.0}


def _on_tick(ctx) -> list:
    """每个仿真秒合成 UDM 过载 KPI + CHR + 告警,并填 ctx.ne_cpu/active_ue。"""
    t = ctx.global_t
    kpi = _kpi_at(t)

    ctx.ne_cpu = {
        "UDM_1": kpi["udm_cpu"], "UDM_2": kpi["udm_cpu"] * 0.5,  # 备机轻载
        "AMF_1": kpi["amf_cpu"], "AMF_2": kpi["amf_cpu"] * 0.96, "AMF_3": kpi["amf_cpu"] * 0.92,
        "SMF_1": kpi["smf_cpu"], "SMF_2": kpi["smf_cpu"] * 0.95,
        "UPF_1": 35.0, "UPF_2": 33.0, "UPF_3": 31.0,
        "PCF_1": 24.0, "PCF_2": 22.0,
        "AUSF_1": 20.0, "AUSF_2": 18.0,
        "NRF_1": 14.0, "NRF_2": 13.0,
        "NSSF_1": 21.0, "NSSF_2": 20.0,
    }
    ctx.active_ue = int(kpi["reg_rate"] * 6)

    events = [Event(
        type="kpi_snapshot",
        payload={"sim_t": t, "round": ctx.round,
                 "udm_cpu": round(kpi["udm_cpu"], 2),
                 "amf_cpu": round(kpi["amf_cpu"], 2), "smf_cpu": round(kpi["smf_cpu"], 2),
                 "amf_success_rate": round(kpi["amf_sr"], 4),
                 "smf_success_rate": round(kpi["smf_sr"], 4),
                 "reg_rate": round(kpi["reg_rate"], 1), "sess_rate": round(kpi["sess_rate"], 1),
                 "msg_to_udm": round(kpi["msg_to_udm"], 1),
                 "ai_platform_reg_share": round(kpi["ai_platform_reg_share"], 1)},
    )]

    # CHR(故障期:SST=3 注册 + DNN=MIot.xx 会话)
    if t >= _GO_START:
        events.append(Event(type="chr_record", payload={
            "sim_t": t, "round": ctx.round, "ue_id": f"ai1-{t % 60:03d}",
            "device_type": "iot-cam", "slice_sst": 3, "dnn": "MIot.xx",
            "procedure": "registration", "cause_code": "SST=3",
            "cause_cn": "切片 SST=3(MIoT) 注册占比 55%", "success": False,
        }))
        if t < _GO_CONV:
            events.append(Event(type="chr_record", payload={
                "sim_t": t, "round": ctx.round, "ue_id": f"ai1-{(t + 40) % 60:03d}",
                "device_type": "iot-meter", "slice_sst": 3, "dnn": "MIot.xx",
                "procedure": "pdu_create", "cause_code": "DNN=MIot.xx",
                "cause_cn": "DNN=MIot.xx 会话占比 58%", "success": False,
            }))

    # 告警(UDM 过载 + SR 跌 + 消息突增 + 二轮限流生效)
    if t == _GO_START:
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "AMF_1", "severity": "major",
            "category": "registration_surge", "message": "AMF→UDM 注册请求突增(SST=3 占比异常)",
        }))
    if kpi["udm_cpu"] >= 85 and t in (_GO_PEAK, _GO_PEAK + 2, _GO_CONV - 2):
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "UDM_1",
            "severity": "critical" if kpi["udm_cpu"] >= 90 else "major",
            "category": "cpu_overload", "message": f"UDM_1 CPU {kpi['udm_cpu']:.0f}% 过载(被终端消息冲击)",
        }))
    if t == _GO_CONV:
        events.append(Event(type="alarm", payload={
            "sim_t": t, "ne_id": "AMF_1", "severity": "info",
            "category": "admission_control",
            "message": "二轮 AMF/SMF 协同限流生效(限 SST=3/DNN + 回 T3346),UDM 过载开始消除",
        }))

    return events


class GPlugin:
    id = "G"
    label_cn = "AI平台故障·UDM过载·AMF/SMF协同限流"
    label_en = "AI PLATFORM FAIL · UDM OVERLOAD"
    version = "1.0"
    short_intro = "AI 平台 1 故障→终端频繁注册→UDM 过载(AMF/SMF 不过载)→协同限流消除 UDM 过载"
    route_expectation = "workflow"
    expected_round = 2
    capabilities = "live"

    def build_topology(self): return _build_topology()
    def build_fault_config(self, topo): return _build_fault_config(topo)
    def build_ue_distribution(self): return _build_ue_distribution()
    def on_tick(self, ctx: TickContext): return _on_tick(ctx)
    def diagnosis_llm_stub(self, ctx: DiagnosisContext): return _diagnosis_llm_stub(ctx)
    def recovery_actions(self, plan): return _recovery_actions(plan)
    def on_recovery_action(self, action, ctx): return _on_recovery_action(action, ctx)
    def request_rebatch_chr(self): return RebatchSpec(dimensions=["slice_sst", "dnn", "device_type", "supports_t3346"])
    def on_user_breakdown(self, breakdown): return []
    def on_ue_request(self, req: UeRequest) -> UeResponse: return _on_ue_request(req)


PLUGIN = GPlugin()
