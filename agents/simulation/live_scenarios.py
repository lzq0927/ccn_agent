"""LIVE 场景配置表(A~G)—— **纯故障/流量规格,无任何恢复剧本**。

每个 ``LiveScenario`` 只描述「网络长什么样 + 发生什么故障」:
  - 故障配置(FaultConfig,含业务激增 surge_multiplier/surge_filter)
  - UE 规模与业务类别占比(iot_ratio)、到达 λ
恢复策略完全由 ``policy_planner`` 从「诊断结果 + 网络遥测」**通用推导**;
恢复与否、需要几轮,由 ``RealtimeEngine`` 的真实状态决定(非剧本)。

``route_expectation`` 仅为测试期望元数据(信号清晰度应落入的路由档),
运行时**不读**——实际路由由 ``ConfidenceAssessor`` 对真实数据的评估决定。
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
    route_expectation: str          # 仅测试期望:workflow | guided | autonomous | exploration
    fault_config: FaultConfig
    ue_count: int = 80
    iot_ratio: float = 0.0           # 物联网终端占比(sst=3 / dnn=iot)
    base_reg_lambda: float = 14.0    # 每秒注册到达基础 λ
    base_pdu_lambda: float = 26.0    # 每秒 PDU 建立到达基础 λ
    terminal_noise: float = 0.0      # 终端侧既有 CHR 噪声率(0=默认 0.001)
    kpi_columns: list[str] = field(default_factory=list)


# 默认 KPI 列(所有场景一致;风暴场景值由故障模型填充)
_KPI_BASE = [
    "sim_t", "round",
    "amf_success_rate", "smf_success_rate",
    "amf_reg_requests", "smf_pdu_requests",
    "iot_reg_rate", "toc_reg_rate", "iot_sess_rate", "toc_sess_rate",
    "amf_cpu", "smf_cpu",
]


def _fc(
    point: FaultPointType,
    mode: FaultMode,
    nes: set[str],
    loss: float,
    surge: float = 1.0,
    surge_filter: dict | None = None,
    loss_filter: dict | None = None,
    loss_scope: str = "all_hops",
) -> FaultConfig:
    """构造 LIVE 故障配置。fault_start/duration 置宽窗(注入时刻由点击决定)。

    surge > 1 时为业务激增类故障:匹配 surge_filter 的类别到达激增 surge 倍,
    冲击全网 NF(不设 per-hop 丢损);否则为网元/链路丢损类(loss_filter 非空时
    仅匹配类别丢损,如「gNB 仅对物联终端群体异常」)。
    """
    return FaultConfig(
        fault_point_type=point, fault_mode=mode, loss_rate=loss,
        fault_start=0, fault_duration=10**9, affected_ne_ids=set(nes),
        surge_multiplier=surge,
        surge_filter=dict(surge_filter or {}),
        loss_filter=dict(loss_filter or {}),
        loss_scope=loss_scope,
    )


# ---------------------------------------------------------------------------
# 场景 A —— UPF_1 微损 · 信号清晰(预期确定性工作流,单网元隔离+重选即恢复)
# ---------------------------------------------------------------------------
SCENARIO_A = LiveScenario(
    id="A",
    label_cn="UPF_1 微损 · 确定性工作流",
    label_en="UPF_1 MICRO-LOSS · WORKFLOW",
    short_intro="UPF_1 链路微损→PDU 会话成功率下降;定位后隔离 UPF_1 并切换会话恢复",
    route_expectation="workflow",
    fault_config=_fc(FaultPointType.SINGLE_NE, FaultMode.LINK, {"UPF_1"}, 0.08),
    ue_count=95, iot_ratio=0.0,
    kpi_columns=list(_KPI_BASE),
)

# ---------------------------------------------------------------------------
# 场景 B —— SMF_1 微损 · 信号中等(网络侧微损,非用户级集中 → 确定性/技能路径)
# ---------------------------------------------------------------------------
SCENARIO_B = LiveScenario(
    id="B",
    label_cn="SMF_1 微损 · 技能引导",
    label_en="SMF_1 FAULT · GUIDED",
    short_intro="SMF_1 链路微损叠加终端噪声,KPI 仅微损;CHR 降噪排除终端后定位网络根因",
    route_expectation="guided",
    fault_config=_fc(FaultPointType.SINGLE_NE, FaultMode.LINK, {"SMF_1"}, 0.008),
    ue_count=120, iot_ratio=0.0, terminal_noise=0.04,
    kpi_columns=list(_KPI_BASE),
)

# ---------------------------------------------------------------------------
# 场景 C —— gNB_2 下物联终端群体异常 · 用户侧故障(信号在 CHR 类别归因中显形)
# ---------------------------------------------------------------------------
SCENARIO_C = LiveScenario(
    id="C",
    label_cn="物联终端群体异常 · 自主探索",
    label_en="IOT GROUP FAULT · AUTONOMOUS",
    short_intro="gNB_2 仅对物联终端群体异常(ToC 正常);用户侧重选至邻区 gNB 恢复",
    route_expectation="autonomous",
    fault_config=_fc(FaultPointType.SINGLE_NE, FaultMode.BUSINESS, {"gNB_2"}, 0.35,
                     loss_filter={"sst": 3}, loss_scope="ue_hops"),
    ue_count=40, iot_ratio=0.5,
    kpi_columns=list(_KPI_BASE),
)

# ---------------------------------------------------------------------------
# 场景 D —— 物联网注册风暴 · UE back-off(激增类;部分终端不支持 back-off)
# ---------------------------------------------------------------------------
SCENARIO_D = LiveScenario(
    id="D",
    label_cn="物联网注册风暴 · UE back-off",
    label_en="IOT STORM · UE BACKOFF",
    short_intro="物联终端(sst=3)注册激增冲击 AMF/SMF;准入控制+终端 back-off 收敛",
    route_expectation="guided",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                     {"AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"}, 0.0,
                     surge=8.0, surge_filter={"sst": 3}),
    ue_count=80, iot_ratio=0.8,
    kpi_columns=list(_KPI_BASE),
)

# ---------------------------------------------------------------------------
# 场景 E —— 物联网风暴 · AMF NSSAI + SMF DNN 限流(激增类)
# ---------------------------------------------------------------------------
SCENARIO_E = LiveScenario(
    id="E",
    label_cn="物联网风暴 · NSSAI/APN 限流",
    label_en="IOT STORM · NSSAI/APN ADMISSION",
    short_intro="物联风暴冲击 AMF/SMF;AMF 限 NSSAI + SMF 限 DNN 双通道准入收敛",
    route_expectation="autonomous",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                     {"AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"}, 0.0,
                     surge=8.0, surge_filter={"sst": 3}),
    ue_count=80, iot_ratio=0.8,
    kpi_columns=list(_KPI_BASE),
)

# ---------------------------------------------------------------------------
# 场景 F —— 物联风暴 · 多层协同恢复(iPhone 类终端不支持 back-off 放大激增)
# ---------------------------------------------------------------------------
SCENARIO_F = LiveScenario(
    id="F",
    label_cn="物联风暴 · 多层协同·终端类型感知",
    label_en="IOT STORM · LAYERED ADMISSION",
    short_intro="物联风暴 + 部分终端类型不支持 back-off 反复重试;多层准入协同收敛",
    route_expectation="workflow",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                     {"AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"}, 0.0,
                     surge=8.0, surge_filter={"sst": 3}),
    ue_count=80, iot_ratio=0.85,
    kpi_columns=list(_KPI_BASE),
)

# ---------------------------------------------------------------------------
# 场景 G —— AI 平台故障 → UDM 过载 → 上游 AMF/SMF 协同限流(激增类)
# ---------------------------------------------------------------------------
SCENARIO_G = LiveScenario(
    id="G",
    label_cn="UDM 过载 · AMF/SMF 协同限流",
    label_en="UDM OVERLOAD · CO-ADMISSION",
    short_intro="AI 平台终端频繁注册 → 汇聚点 UDM 过载;在上游 AMF/SMF 限流消除",
    route_expectation="workflow",
    fault_config=_fc(FaultPointType.PATH_SESSION, FaultMode.BUSINESS,
                     {"AMF_1", "AMF_2", "SMF_1", "SMF_2", "UDM_1"}, 0.0,
                     surge=8.0, surge_filter={"sst": 3}),
    ue_count=80, iot_ratio=0.8,
    kpi_columns=list(_KPI_BASE),
)


SCENARIOS: dict[str, LiveScenario] = {
    s.id: s for s in (SCENARIO_A, SCENARIO_B, SCENARIO_C, SCENARIO_D, SCENARIO_E, SCENARIO_F, SCENARIO_G)
}


def get_scenario(scenario_id: str) -> LiveScenario | None:
    return SCENARIOS.get(scenario_id)
