"""LIVE 场景配置表(A~G)——把前端 constructed.ts 的故障规格平移到后端。

每个 ``LiveScenario`` 描述:故障配置(FaultConfig)、UE 规模与物联网占比、到达 λ、
是否风暴、期望诊断轮数、KPI 列、恢复配方(isolate/reroute/flow_control + 前端展示文案)。

``RealtimeEngine`` 据此驱动真实仿真;``policy_resolver`` 据 ``recovery_actions`` 把诊断
结果翻译成可执行的 ``PolicyAction``。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from simulator.models import FaultConfig, FaultMode, FaultPointType


@dataclass
class LiveScenario:
    id: str
    label_cn: str
    label_en: str
    short_intro: str
    route_expectation: str
    fault_config: FaultConfig
    ue_count: int = 80
    iot_ratio: float = 0.0           # 物联网终端占比
    base_reg_lambda: float = 14.0    # 每秒注册到达基础 λ
    base_pdu_lambda: float = 26.0    # 每秒 PDU 建立到达基础 λ
    is_storm: bool = False           # iot 风暴(抬升到达 λ + 过载)
    expected_rounds: int = 1
    kpi_columns: list[str] = field(default_factory=list)
    # 恢复配方:每条 = 前端展示 {id,cn,en,layer} + 引擎策略 {policy:{kind,...}}
    recovery_actions: list[dict] = field(default_factory=list)


# 默认 KPI 列(单网元/链路类场景:A/B)
_KPI_BASE = [
    "sim_t", "round",
    "amf_success_rate", "smf_success_rate",
    "amf_reg_requests", "smf_pdu_requests",
    "iot_reg_rate", "toc_reg_rate", "iot_sess_rate", "toc_sess_rate",
    "amf_cpu", "smf_cpu",
]
# 风暴类场景(D/E/F/G):强调 iot 速率
_KPI_STORM = _KPI_BASE  # 列相同,值由场景填充


def _fc(point: FaultPointType, mode: FaultMode, nes: set[str], loss: float) -> FaultConfig:
    # fault_start/duration 在 LIVE 由点击注入,realtime_engine 不按时间窗口触发,故置宽窗
    return FaultConfig(
        fault_point_type=point, fault_mode=mode, loss_rate=loss,
        fault_start=0, fault_duration=10**9, affected_ne_ids=set(nes),
    )


# ---------------------------------------------------------------------------
# 场景 A —— UPF_1 微损 · 确定性工作流(单轮)
# ---------------------------------------------------------------------------
SCENARIO_A = LiveScenario(
    id="A",
    label_cn="UPF_1 微损 · 确定性工作流",
    label_en="UPF_1 MICRO-LOSS · WORKFLOW",
    short_intro="UPF_1 链路微损→PDU 会话成功率下降;隔离 UPF_1 并切换会话至 UPF_2/3 恢复",
    route_expectation="workflow",
    fault_config=_fc(FaultPointType.SINGLE_NE, FaultMode.LINK, {"UPF_1"}, 0.035),
    ue_count=95, iot_ratio=0.0, is_storm=False, expected_rounds=1,
    kpi_columns=list(_KPI_BASE),
    recovery_actions=[
        {"id": "iso_upf1", "cn": "隔离 UPF_1", "en": "ISOLATE UPF_1", "layer": "UPF",
         "policy": {"kind": "isolate", "ne_id": "UPF_1"}},
        {"id": "reroute_upf1", "cn": "受影响会话切换至 UPF_2/UPF_3 接管", "en": "REROUTE TO UPF_2/3",
         "layer": "UPF", "policy": {"kind": "reroute", "from_ne_id": "UPF_1"}},
    ],
)

# ---------------------------------------------------------------------------
# 场景 B —— SMF_1 异常 · 技能引导(双轮)
# ---------------------------------------------------------------------------
SCENARIO_B = LiveScenario(
    id="B",
    label_cn="SMF_1 异常 · 技能引导",
    label_en="SMF_1 FAULT · GUIDED",
    short_intro="SMF_1 链路异常+终端噪声;CHR 降噪排除终端,隔离 SMF_1 切换至 SMF_2",
    route_expectation="guided",
    fault_config=_fc(FaultPointType.SINGLE_NE, FaultMode.LINK, {"SMF_1"}, 0.03),
    ue_count=60, iot_ratio=0.0, is_storm=False, expected_rounds=2,
    kpi_columns=list(_KPI_BASE),
    recovery_actions=[
        {"id": "iso_smf1", "cn": "隔离 SMF_1", "en": "ISOLATE SMF_1", "layer": "SMF",
         "policy": {"kind": "isolate", "ne_id": "SMF_1"}},
        {"id": "reroute_smf1", "cn": "会话切换至健康 SMF_2 接管", "en": "REROUTE TO SMF_2",
         "layer": "SMF", "policy": {"kind": "reroute", "from_ne_id": "SMF_1"}},
    ],
)

# ---------------------------------------------------------------------------
# 场景 C —— gNB 用户侧物联终端群体异常 · 自主探索(双轮,网络健康不隔离 NE)
# ---------------------------------------------------------------------------
SCENARIO_C = LiveScenario(
    id="C",
    label_cn="物联终端群体异常 · 自主探索",
    label_en="IOT GROUP FAULT · AUTONOMOUS",
    short_intro="gNB_2 下物联终端群体失败(网络 NE 健康);用户侧重选至邻区 gNB",
    route_expectation="autonomous",
    fault_config=_fc(FaultPointType.SINGLE_NE, FaultMode.BUSINESS, {"gNB_2"}, 0.011),
    ue_count=40, iot_ratio=0.5, is_storm=False, expected_rounds=2,
    kpi_columns=list(_KPI_BASE),
    recovery_actions=[
        {"id": "user_reroute", "cn": "通知受影响 UE 换路/重选至邻区健康 gNB", "en": "USER REROUTE",
         "layer": "UE", "policy": {"kind": "reroute", "from_ne_id": "gNB_2"}},
    ],
)

# ---------------------------------------------------------------------------
# 场景 D —— 物联网注册风暴 · 流控溯源到 UE(back-off)(双轮)
# ---------------------------------------------------------------------------
SCENARIO_D = LiveScenario(
    id="D",
    label_cn="物联网注册风暴 · UE back-off",
    label_en="IOT STORM · UE BACKOFF",
    short_intro="物联风暴冲击 AMF/SMF;UE back-off + AMF Reg Reject 收敛",
    route_expectation="guided",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                      {"AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"}, 0.035),
    ue_count=80, iot_ratio=0.8, is_storm=True, expected_rounds=2,
    kpi_columns=list(_KPI_STORM),
    recovery_actions=[
        {"id": "ue_backoff", "cn": "对注册成功物联终端发 Reg Reject + back-off timer", "en": "UE BACKOFF",
         "layer": "UE", "policy": {"kind": "flow_control", "layer": "UE", "ratio": 0.6, "flt": {"sst": 3}}},
    ],
)

# ---------------------------------------------------------------------------
# 场景 E —— 物联网风暴 · AMF NSSAI + SMF DNN 限流(双轮)
# ---------------------------------------------------------------------------
SCENARIO_E = LiveScenario(
    id="E",
    label_cn="物联网风暴 · NSSAI/APN 限流",
    label_en="IOT STORM · NSSAI/APN ADMISSION",
    short_intro="UE back-off 不足;AMF 限 NSSAI + SMF 限 DNN 双通道比例限流收敛",
    route_expectation="autonomous",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                      {"AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"}, 0.04),
    ue_count=80, iot_ratio=0.8, is_storm=True, expected_rounds=2,
    kpi_columns=list(_KPI_STORM),
    recovery_actions=[
        {"id": "amf_nssai", "cn": "AMF 限制物联切片 NSSAI 接纳 ρ=60%", "en": "AMF NSSAI 60%",
         "layer": "AMF", "policy": {"kind": "flow_control", "layer": "AMF", "ratio": 0.6, "flt": {"sst": 3}}},
        {"id": "smf_dnn", "cn": "SMF 限制物联 APN/DNN 接纳 ρ=60%", "en": "SMF DNN 60%",
         "layer": "SMF", "policy": {"kind": "flow_control", "layer": "SMF", "ratio": 0.6, "flt": {"dnn": "iot"}}},
    ],
)

# ---------------------------------------------------------------------------
# 场景 F —— 物联风暴 · 三层并行恢复(终端类型感知,双轮)
# ---------------------------------------------------------------------------
SCENARIO_F = LiveScenario(
    id="F",
    label_cn="物联风暴 · 三层并行·终端类型感知",
    label_en="IOT STORM · LAYERED ADMISSION",
    short_intro="3 策略并行;iPhone 不支持 back-off 放大→二轮排除 iPhone+限流微调收敛",
    route_expectation="workflow",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                      {"AMF_1", "SMF_1", "SMF_2"}, 0.04),
    ue_count=80, iot_ratio=0.8, is_storm=True, expected_rounds=2,
    kpi_columns=list(_KPI_STORM),
    recovery_actions=[
        {"id": "ue_backoff", "cn": "UE back-off T=14s(排除 iPhone)", "en": "UE BACKOFF (EXCL IPHONE)",
         "layer": "UE", "policy": {"kind": "flow_control", "layer": "UE", "ratio": 0.55, "flt": {"sst": 3}}},
        {"id": "amf_nssai", "cn": "AMF NSSAI 接纳 ρ=57%", "en": "AMF NSSAI 57%",
         "layer": "AMF", "policy": {"kind": "flow_control", "layer": "AMF", "ratio": 0.57, "flt": {"sst": 3}}},
        {"id": "smf_dnn", "cn": "SMF DNN 接纳 ρ=52%", "en": "SMF DNN 52%",
         "layer": "SMF", "policy": {"kind": "flow_control", "layer": "SMF", "ratio": 0.52, "flt": {"dnn": "iot"}}},
    ],
)

# ---------------------------------------------------------------------------
# 场景 G —— AI 平台故障 → UDM 过载 → AMF/SMF 协同限流(双轮)
# ---------------------------------------------------------------------------
SCENARIO_G = LiveScenario(
    id="G",
    label_cn="UDM 过载 · AMF/SMF 协同限流",
    label_en="UDM OVERLOAD · CO-ADMISSION",
    short_intro="AI 平台故障→UDM 过载;AMF/SMF 协同限流消除 UDM 过载",
    route_expectation="workflow",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                      {"AMF_1", "AMF_2", "SMF_1", "SMF_2", "UDM_1"}, 0.04),
    ue_count=80, iot_ratio=0.8, is_storm=True, expected_rounds=2,
    kpi_columns=list(_KPI_STORM),
    recovery_actions=[
        {"id": "amf_nssai", "cn": "AMF 限 SST=3 接纳 + 回 UE T3346", "en": "AMF NSSAI + T3346",
         "layer": "AMF", "policy": {"kind": "flow_control", "layer": "AMF", "ratio": 0.55, "flt": {"sst": 3}}},
        {"id": "smf_dnn", "cn": "SMF 限 DNN=MIot 接纳 + 回 UE T3396", "en": "SMF DNN + T3396",
         "layer": "SMF", "policy": {"kind": "flow_control", "layer": "SMF", "ratio": 0.5, "flt": {"dnn": "iot"}}},
    ],
)


SCENARIOS: dict[str, LiveScenario] = {
    s.id: s for s in (SCENARIO_A, SCENARIO_B, SCENARIO_C, SCENARIO_D, SCENARIO_E, SCENARIO_F, SCENARIO_G)
}


def get_scenario(scenario_id: str) -> LiveScenario | None:
    return SCENARIOS.get(scenario_id)
