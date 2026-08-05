// ============================================================================
// 构造式演示场景 —— 真实拓扑文本 + 合成遥测 + 手写推理链
//   场景 A:UPF_1 微损 · 确定性工作流(均质化比较排除 AMF/SMF + 定位 UPF_1)
//   场景 B:SMF_1 异常 · 技能引导(网络微损+终端噪声 → 多维校验排除终端)
//   场景 C:gNB 用户侧异常 · 自主探索(CHR 聚类 + 用户分群追踪发现物联终端群体异常)
//   三场景共用真实 case_101 拓扑(21 NE);遥测与推理为合成。路由分落三档:
//   A=WORKFLOW(>0.7)、B=GUIDED(0.3~0.7)、C=AUTONOMOUS(≤0.3)。
// ============================================================================

import { buildGraphFromTopoText, type NetworkGraph } from "./network";
import { buildKpiFor, buildMildOverallKpi, buildUpfFaultKpi, type KpiBundle } from "./kpi";
import type { ScenarioNarrative } from "./real";
import type {
  ConfidenceBreakdown,
  EvalMetrics,
  FaultSpec,
  ReasonStep,
  Scenario,
} from "./types";

/** 三场景共用网络画布(真实 case_101 拓扑:单 DC,21 NE,UDM_1/AUSF_1 主备) */
const COMMON_TOPO = `DC: DC1
  ResourcePool: RP_DC1_1
    gNB: gNB_3
    AMF: AMF_3
    SMF: SMF_1
    UPF: UPF_1
    UPF: UPF_2
    PCF: PCF_2
    UDM: UDM_1(master)
    AUSF: AUSF_2(standby)
    NSSF: NSSF_2
  ResourcePool: RP_DC1_2
    gNB: gNB_1
    gNB: gNB_2
    AMF: AMF_1
    AMF: AMF_2
    SMF: SMF_2
    UPF: UPF_3
    PCF: PCF_1
    UDM: UDM_2(standby)
    AUSF: AUSF_1(master)
    NRF: NRF_1
    NRF: NRF_2
    NSSF: NSSF_1`;

export interface ConstructedSpec {
  topo: string;
  fault: FaultSpec;
  kpi: (graph: NetworkGraph) => KpiBundle;
  reasoning: ReasonStep[];
  confidence: ConfidenceBreakdown;
  evaluation: EvalMetrics;
  predicted: { elements: string[]; links: string[] };
  routeIterations: number;
  llmModel: string;
}

/** 构造式场景 → 演示 Scenario(真实拓扑 + 合成遥测 + 手写推理/评估) */
export function buildConstructedScenario(id: string, n: ScenarioNarrative, spec: ConstructedSpec): Scenario {
  const graph = buildGraphFromTopoText(spec.topo);
  return {
    id,
    cn: n.cn,
    en: n.en,
    tagline: n.tagline,
    intro: n.intro,
    objective: n.objective,
    pillars: n.pillars,
    comparison: n.comparison,
    chrInsight: n.chrInsight,
    falseAlarm: n.falseAlarm,
    userFault: n.userFault,
    skillEvolution: n.skillEvolution,
    homogen: n.homogen,
    isolation: n.isolation,
    ufdr: n.ufdr,
    flowControl: n.flowControl,
    stormMetrics: n.stormMetrics,
    faultReport: n.faultReport,
    recoveryPlan: n.recoveryPlan,
    fault: spec.fault,
    truth: { elements: spec.fault.elements, links: spec.fault.links },
    predicted: spec.predicted,
    confidence: spec.confidence,
    reasoning: spec.reasoning,
    evaluation: spec.evaluation,
    realKpi: spec.kpi(graph),
    realGraph: graph,
    routeIterations: spec.routeIterations,
    llmModel: spec.llmModel,
  };
}

// ---------------------------------------------------------------------------
// 场景 A —— UPF_1 微损 · 确定性工作流(均质化比较排除 AMF/SMF + 定位 UPF_1)
//   UPF_1 微损 → 异常传导至前端 AMF↔SMF 通信路径(AMF/SMF 全实例均质化劣化);
//   均质化比较排除 AMF/SMF 共性异常 → 对 UPF 通信路径再均质化 → UPF_1 离群。
// ---------------------------------------------------------------------------

const FAULT_A: FaultSpec = {
  faultType: "single_ne",
  faultMode: "link",
  elements: ["UPF_1"],
  links: [],
  lossRate: 0.08,
  faultStart: 30,
  faultDuration: 10,
  ueCount: 95,
  difficulty: "medium",
};

const REASONING_A: ReasonStep[] = [
  { n: 1, type: "tool_call", text: "iFFusion 异常检测:前端 AMF↔SMF 通信路径普遍出现异常。", result: "AMF↔SMF 路径劣化", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 2, type: "tool_call", text: "均质化比较:AMF、SMF 全实例同现异常(共性)，排除 AMF/SMF 为单点根因。", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 3, type: "tool_call", text: "故障排除:SMF↔UDM 通信正常 → 排除 SMF_1/SMF_2。", highlight: { nes: ["SMF_1", "SMF_2"] } },
  { n: 4, type: "tool_call", text: "故障聚合:聚合 UPF 受影响路径，UPF_1 异常、UPF_2/UPF_3 健康，UPF_1 唯一离群。", highlight: { nes: ["UPF_1"] } },
  { n: 5, type: "tool_call", text: "主机网口定位:UPF_1 所在主机的入向网口 eth-upf1 持续丢包 8.0%,其余网口正常 → 确认根因落在 UPF_1 网元侧。", result: "定位 UPF_1 主机网口丢包", highlight: { nes: ["UPF_1"] } },
  { n: 6, type: "conclusion", text: "根因为 UPF_1，确定性工作流秒级定位。", result: "WORKFLOW · 命中", highlight: { nes: ["UPF_1"] } },
];

const CONFIDENCE_A: ConfidenceBreakdown = {
  pattern: 0.9,
  severity: 0.4,
  temporal: 0.88,
  spatial: 0.8,
  ambiguity: 0.12,
  score: 0.76,
  route: "workflow",
  patternName: "upf_aggregation (UPF 故障聚合)",
  matchedSkills: ["core/homogenization_compare", "core/fault_aggregation"],
  affectedNeCount: 1,
};

const EVAL_A: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.96, toolEfficiency: 0.94, evidenceQuality: 0.95, missedSignals: 0.07, overall: 0.95 },
  suggestions: [],
};

export const SPEC_A: ConstructedSpec = {
  topo: COMMON_TOPO,
  fault: FAULT_A,
  kpi: (graph) => buildUpfFaultKpi(graph, FAULT_A),
  reasoning: REASONING_A,
  confidence: CONFIDENCE_A,
  evaluation: EVAL_A,
  predicted: { elements: ["UPF_1"], links: [] },
  routeIterations: 5,
  llmModel: "确定性工作流 (WorkflowEngine)",
};

// ---------------------------------------------------------------------------
// 场景 B —— SMF_1 异常 · 技能引导(网络微损+终端噪声 → 多维校验排除终端)
// ---------------------------------------------------------------------------

const FAULT_B: FaultSpec = {
  faultType: "single_ne",
  faultMode: "link",
  elements: ["SMF_1"],
  links: [],
  lossRate: 0.03,
  faultStart: 28,
  faultDuration: 10,
  ueCount: 60,
  difficulty: "medium",
};

const REASONING_B: ReasonStep[] = [
  // ===== 第一轮(评估未通过 → 回 Agent1 补采 CHR) =====
  { n: 1, type: "tool_call", text: "[轮1·①预处理] iFFusion 检测:SMF 方向会话成功率突降,终端原因值(鉴权/兼容)呈周期性偏高。", result: "网络突变 + 终端周期噪声 · 信号模糊", highlight: { nes: ["SMF_1"] } },
  { n: 2, type: "tool_call", text: "[轮1·②拓扑] 拓扑分析:异常集中于 SMF_1 会话管理方向,终端侧原因值干扰严重。", highlight: { nes: ["SMF_1"] } },
  { n: 3, type: "tool_call", text: "[轮1·③检测] iFFusion 融合检测确认异常,但终端噪声与网络根因难以区分。", result: "异常确认 · 终端/网络难分", highlight: { nes: ["SMF_1"] } },
  { n: 4, type: "thinking", text: "[轮1·◇策略匹配→④根因] 初判根因 SMF_1,但终端原因值长期偏高可能掩盖真实网络根因。", highlight: { nes: ["SMF_1"] } },
  { n: 5, type: "tool_call", text: "[轮1·⑤输出评估] 🤖 大模型评估:置信度 0.55 < 阈值,终端噪声未充分排除,需更多 CHR 历史。", result: "评估未通过 · 置信度不足" },
  { n: 6, type: "tool_call", text: "[轮1·⑥] 评估未通过 → loop② 回 Agent1 拉取终端原因值持续/周期性 CHR 历史。", result: "回 Agent1 补采 CHR" },
  // ===== 回到 Agent1 第二轮 =====
  { n: 7, type: "thinking", text: "Agent3 判定置信不足 → loop② 回 Agent1 补采 CHR 历史 → Agent2 第二轮执行 6 步。" },
  { n: 8, type: "tool_call", text: "[轮2·①②③] 二轮采集 + 拓扑 + 检测:拉取终端原因值多维时序历史,做降噪前后对比。", highlight: { nes: ["SMF_1"] } },
  { n: 9, type: "tool_call", text: "[轮2·④根因] CHR 降噪排除终端既有噪声(长期基线偏高,非突增)→ 5GSM#37 与突降同步 → 锁定 SMF_1。", result: "CHR 降噪 → 锁定 SMF_1", highlight: { nes: ["SMF_1"] } },
  { n: 10, type: "tool_call", text: "[轮2·⑤输出评估] 🤖 大模型评估通过,置信度达标,根因 SMF_1 确认。", result: "评估通过" },
  { n: 11, type: "tool_call", text: "[轮2·⑥恢复] 隔离 SMF_1,会话切换至健康 SMF_2 接管,受影响 UE 重建会话。", result: "第二轮恢复执行中", highlight: { nes: ["SMF_1"] } },
  { n: 12, type: "conclusion", text: "第二轮恢复策略执行后网络恢复。Agent3 评估:已恢复 → 沉淀 CHR 降噪 skill。", result: "GUIDED · 第二轮收敛" },
];

const CONFIDENCE_B: ConfidenceBreakdown = {
  pattern: 0.55,
  severity: 0.4,
  temporal: 0.7,
  spatial: 0.6,
  ambiguity: 0.3,
  score: 0.55,
  route: "guided",
  patternName: "network_with_terminal_noise (技能引导)",
  matchedSkills: ["core/chr_fusion", "core/terminal_exclusion"],
  affectedNeCount: 1,
};

const EVAL_B: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.9, toolEfficiency: 0.85, evidenceQuality: 0.9, missedSignals: 0.12, overall: 0.89 },
  suggestions: [],
};

export const SPEC_B: ConstructedSpec = {
  topo: COMMON_TOPO,
  fault: FAULT_B,
  kpi: (graph) => buildKpiFor(graph, FAULT_B),
  reasoning: REASONING_B,
  confidence: CONFIDENCE_B,
  evaluation: EVAL_B,
  predicted: { elements: ["SMF_1"], links: [] },
  routeIterations: 7,
  llmModel: "MiniMax-M3",
};

// ---------------------------------------------------------------------------
// 场景 C —— gNB 用户侧异常 · 自主探索(CHR 聚类 + 用户分群追踪 → 物联终端群体异常)
// ---------------------------------------------------------------------------

const FAULT_C: FaultSpec = {
  faultType: "terminal_group",
  faultMode: "business",
  elements: [],
  links: [],
  lossRate: 0.011,
  faultStart: 30,
  faultDuration: 12,
  ueCount: 40,
  difficulty: "hard",
};

const REASONING_C: ReasonStep[] = [
  // ===== 第一轮(大模型初判 AMF_1,评估未通过 → 回 Agent1) =====
  { n: 1, type: "tool_call", text: "[轮1·①预处理] iFFusion 检测:总体微跌,KPI 无网元异常,CHR 原因值分散。", result: "信号模糊 · 未收敛" },
  { n: 2, type: "tool_call", text: "[轮1·②拓扑] 拓扑分析:无明显网元异常,异常信号来源不明。", highlight: { nes: [] } },
  { n: 3, type: "tool_call", text: "[轮1·③检测] iFFusion 融合检测:信号模糊,未收敛到具体网元。", result: "信号模糊 · 未收敛" },
  { n: 4, type: "thinking", text: "[轮1·◇策略匹配→④根因] 🤖 大模型探索:初步判断 AMF_1 问题(注册方向异常)。", highlight: { nes: ["AMF_1"] } },
  { n: 5, type: "tool_call", text: "[轮1·⑤输出评估] 🤖 大模型评估:置信度 0.28 < 阈值,AMF_1 判断证据不足,需换角度补采。", result: "评估未通过 · 证据不足" },
  { n: 6, type: "tool_call", text: "[轮1·⑥] 评估未通过 → loop② 回 Agent1 补采数据,换角度自主探索。", result: "回 Agent1 补采" },
  // ===== 回到 Agent1 第二轮 =====
  { n: 7, type: "thinking", text: "Agent3 判定置信不足 → loop② 回 Agent1 → Agent2 第二轮自主探索(换角度)。" },
  { n: 8, type: "tool_call", text: "[轮2·①②③] 二轮采集:CHR 降噪去散点 + 聚类(原因值仍分散、无网络共因)+ 用户分群追踪。", highlight: { nes: ["gNB_2"] } },
  { n: 9, type: "tool_call", text: "[轮2·④根因] 用户分群追踪:gNB_2 物联终端群体失败率 52%,群体异常独立于网络 NE(全网健康)。", result: "物联终端群体异常", highlight: { nes: ["gNB_2"] } },
  { n: 10, type: "tool_call", text: "[轮2·⑤输出评估] 🤖 大模型评估通过:定位物联终端群体异常,网络健康,无需隔离网元。", result: "评估通过 · 网络健康" },
  { n: 11, type: "tool_call", text: "[轮2·⑥恢复] 下发用户侧恢复:通知受影响 UE 换路/重选,引导至邻区健康 gNB。", result: "第二轮恢复执行中", highlight: { nes: ["gNB_2"] } },
  { n: 12, type: "conclusion", text: "物联终端群体异常,网络健康,用户侧恢复。Agent3 评估:已恢复 → 沉淀用户分群追踪 skill。", result: "AUTONOMOUS · 第二轮收敛" },
];

const CONFIDENCE_C: ConfidenceBreakdown = {
  pattern: 0.28,
  severity: 0.28,
  temporal: 0.3,
  spatial: 0.28,
  ambiguity: 0,
  score: 0.28,
  route: "autonomous",
  patternName: "fuzzy_signal (信号模糊·自主探索)",
  matchedSkills: ["core/chr_clustering", "core/user_segment_tracking"],
  affectedNeCount: 0,
};

const EVAL_C: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.86, toolEfficiency: 0.78, evidenceQuality: 0.84, missedSignals: 0.2, overall: 0.83 },
  suggestions: [
    {
      type: "SKILL_UPDATE",
      target: "skills/core/user_segment_tracking",
      content: "新增「用户分群追踪」Skill:KPI/CHR 信号模糊时按终端类型分群定位群体异常。",
      priority: 3,
    },
  ],
};

export const SPEC_C: ConstructedSpec = {
  topo: COMMON_TOPO,
  fault: FAULT_C,
  kpi: (graph) => buildMildOverallKpi(graph, FAULT_C.faultStart, FAULT_C.faultDuration, 0.011),
  reasoning: REASONING_C,
  confidence: CONFIDENCE_C,
  evaluation: EVAL_C,
  predicted: { elements: [], links: [] },
  routeIterations: 11,
  llmModel: "MiniMax-M3",
};

// ---------------------------------------------------------------------------
// 场景 D —— AI 平台 1 故障 → UDM 过载 → AMF/SMF 协同限流(两轮收敛)
//   AI 平台 1 故障(平台 2 正常)→ 该平台终端频繁注册 → 过载点在 UDM(AMF/SMF 不过载)。
//   智能体看全局拓扑+业务流,分析出需向 AMF/SMF 下发策略以消除 UDM 过载:
//   ①UDM CPU 过载告警 ②注册/会话 KPI 降 + AMF/SMF→UDM 消息突增 ③CHR:AMF 注册 SST=3 >50%、
//   SMF DNN=MIot.xx >50% ④UFDR 关联 SUPI→AI 平台 1(仅上行)溯源终端+上报 OSS
//   ⑤线性推算需减少的消息数,按实例占比分配,向 AMF/SMF 下发 SUPI 列表 + 限 SST/DNN,
//   AMF/SMF 流控拒绝回 T3346/T3396(10min)——自身流控+返回 UE 流控双策略。
//   首轮部分终端不支持 → 仍有告警 → 二轮按差值重算 → UDM 过载消除 → AI 平台 1 恢复 → 取消流控。
// ---------------------------------------------------------------------------

const FAULT_D: FaultSpec = {
  faultType: "iot_storm",
  faultMode: "business",
  elements: ["AMF_1", "AMF_2", "SMF_1", "SMF_2", "UDM_1"],
  links: [],
  lossRate: 0.04,
  faultStart: 28,
  faultDuration: 14,
  ueCount: 80,
  difficulty: "hard",
};

const REASONING_D: ReasonStep[] = [
  // ===== 第一轮(诊断 + 策略决策,逐步分析各 NE 数据)=====
  { n: 1, type: "tool_call", text: "容器指标:AMF_1/AMF_2 CPU 88%、SMF_1/SMF_2 CPU 85%、UDM_1 CPU 92% 均超 85%,触发过载流控告警。注册 KPI、PDU 会话 KPI 下降。", result: "AMF/SMF/UDM 三点过载", highlight: { nes: ["UDM_1"] } },
  { n: 2, type: "tool_call", text: "AMF 侧分析:有问题的 UE 对接在 AMF_1/AMF_2 上,AMF → UDM 注册请求消息数突增。CHR 显示 AMF 注册请求中切片类型 SST=3 的消息占 55%。", result: "AMF 注册消息 SST=3 占 55%", highlight: { nes: ["AMF_1"] } },
  { n: 3, type: "tool_call", text: "SMF 侧分析:SMF_1/SMF_2 → UDM 会话消息数突增。CHR 显示 SMF 消息中 DNN=MIot.xx 占 58%。", result: "SMF 会话 DNN=MIot.xx 占 58%", highlight: { nes: ["SMF_1"] } },
  { n: 4, type: "tool_call", text: "UPF UFDR 溯源:用 CHR 中的终端 SUPI 关联 UPF UFDR,发现这些终端流量均发往 AI 平台 1,且仅含上行、无下行。上报 OSS(AI 平台 1 地址)。", result: "SUPI → AI 平台 1(仅上行)", highlight: { nes: ["UPF_1"] } },
  { n: 5, type: "conclusion", text: "根因确定:AI 平台 1 故障 → 该平台终端(对接 AMF_1/AMF_2)频繁注册 → AMF/SMF/UDM 三点过载。需在 AMF/SMF 侧限流消除过载。", result: "三点过载根因 · AI 平台 1", highlight: { nes: ["UDM_1"] } },
  { n: 6, type: "thinking", text: "线性推算需减少的消息数:Δmsg = (CPU−70)/(CPU−基线) × msg_total = (92−70)/(92−40) × 320 ≈ 135 消息/s。按 AMF:SMF = 55:45 分配 → AMF 减 74、SMF 减 61。决策双策略:AMF/SMF 自身流控拒绝 + 返回 UE T3346/T3396 定时器(10min)。", result: "首轮参数 · 双策略决策", highlight: { nes: ["AMF_1", "SMF_1"] } },
  // ===== 第二轮(参数调整,不含恢复结论)=====
  { n: 7, type: "thinking", text: "[轮2] Agent3 评估未通过,回 Agent1 重新采集。UDM CPU 78%(首轮策略后部分缓解但未消除);AMF/SMF 出现流控告警(首轮策略已生效)。", highlight: { nes: ["UDM_1"] } },
  { n: 8, type: "tool_call", text: "额外 CHR 分析终端类型:发现部分终端不支持 T3346 定时器,收到 Reg Reject 后立即重试,导致首轮未完全收敛。", result: "部分终端不支持 T3346", highlight: { nes: ["UDM_1"] } },
  { n: 9, type: "thinking", text: "根据当前流量差值重算:Δmsg' = (78−70)/(78−40) × 240 ≈ 50 消息/s。调整:对不支持终端改由 AMF/SMF 直接拦截(不回 Timer),支持终端加深 Timer;微调 AMF/SMF 限流比例 + 更新 SUPI 列表。", result: "二轮参数 · 终端类型感知调整", highlight: { nes: ["AMF_1", "SMF_1"] } },
  { n: 10, type: "conclusion", text: "二轮策略确定:终端类型感知 + 差值重算参数。AMF/SMF 协同限流(自身拒绝 + 返回 UE Timer)精准命中不支持终端。", result: "二轮参数确定", highlight: { nes: ["AMF_1", "SMF_1"] } },
];

const CONFIDENCE_D: ConfidenceBreakdown = {
  pattern: 0.9,
  severity: 0.82,
  temporal: 0.8,
  spatial: 0.76,
  ambiguity: 0.16,
  score: 0.8,
  route: "workflow",
  patternName: "udm_overload_tracing (UDM 过载·AMF/SMF 协同限流)",
  matchedSkills: ["core/ufdr_tracing", "core/admission_control", "core/overload_workflow"],
  affectedNeCount: 1,
};

const EVAL_D: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.9, toolEfficiency: 0.84, evidenceQuality: 0.88, missedSignals: 0.12, overall: 0.87 },
  suggestions: [
    { type: "SKILL_UPDATE", target: "skills/learned/udm_overload_admission", content: "新增「UDM 过载 → AMF/SMF 协同限流 + SUPI 精准流控」Skill:过载点在 UDM 时,按 CPU/消息线性推算减量,在 AMF/SMF 侧限流并回 UE 定时器。", priority: 3 },
  ],
};

export const SPEC_D: ConstructedSpec = {
  topo: COMMON_TOPO,
  fault: FAULT_D,
  kpi: (graph) => buildKpiFor(graph, FAULT_D),
  reasoning: REASONING_D,
  confidence: CONFIDENCE_D,
  evaluation: EVAL_D,
  predicted: { elements: [], links: [] },
  routeIterations: 11,
  llmModel: "确定性工作流 (WorkflowEngine)",
};


