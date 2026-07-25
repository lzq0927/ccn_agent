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
  lossRate: 0.035,
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
  { n: 5, type: "conclusion", text: "根因为 UPF_1，确定性工作流秒级定位。", result: "WORKFLOW · 命中", highlight: { nes: ["UPF_1"] } },
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
// 场景 D —— 物联网注册风暴 · 流控溯源(策略1:溯源到 UE · Registration Reject + back-off)
//   物联网平台故障 → 物联终端反复上线 → 注册风暴冲击 AMF、PDU 会话风暴冲击 SMF。
//   检测:AMF/SMF 容器 CPU 过载 + KPI + AMF 上行 NAS(PDU 请求)/SMF N11(PDU 建立)突增。
//   定位:UPF UFDR → SST=3(MIoT) 注册突增 + 物联 DNN 会话突增 → 溯源到物联终端群体。
//   处置:AMF 对注册成功终端发 Registration Reject + 下发 back-off timer → 收敛。
//   (AMF/SMF 为被冲击方,非硬故障,不隔离)
// ---------------------------------------------------------------------------

const FAULT_D: FaultSpec = {
  faultType: "iot_storm",
  faultMode: "business",
  elements: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"],
  links: [],
  lossRate: 0.035,
  faultStart: 28,
  faultDuration: 12,
  ueCount: 80,
  difficulty: "hard",
};

const REASONING_D: ReasonStep[] = [
  { n: 1, type: "tool_call", text: "iFFusion+容器指标检测:AMF、SMF 容器 CPU 过载告警,KPI 受影响;AMF 收到的注册/携带 PDU 请求的上行 NAS 传输、SMF N11 PDU 建立请求明显突增。", result: "AMF/SMF 被注册/会话风暴冲击", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 2, type: "thinking", text: "溯源:注册请求集中于物联网终端(应用平台故障致反复重复上线),AMF/SMF 为被冲击方、非网元硬故障。", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 3, type: "tool_call", text: "策略(溯源到 UE):决策对注册成功的物联终端发 Registration Reject,并下发 back-off timer 抑制反复上线。", result: "决策:UE 侧 back-off 流控", highlight: { nes: ["AMF_1"] } },
  { n: 4, type: "conclusion", text: "根因为物联终端注册风暴;决策下发 UE 侧 back-off 流控,待执行后验证收敛。", result: "GUIDED · 待执行恢复" },
];

const CONFIDENCE_D: ConfidenceBreakdown = {
  pattern: 0.62,
  severity: 0.5,
  temporal: 0.6,
  spatial: 0.55,
  ambiguity: 0.25,
  score: 0.55,
  route: "guided",
  patternName: "iot_storm_ue_tracing (流控溯源·UE 侧 back-off)",
  matchedSkills: ["core/ufdr_tracing", "core/ue_backoff"],
  affectedNeCount: 2,
};

const EVAL_D: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.9, toolEfficiency: 0.85, evidenceQuality: 0.9, missedSignals: 0.12, overall: 0.88 },
  suggestions: [
    { type: "SKILL_UPDATE", target: "skills/learned/iot_storm_tracing", content: "新增「UFDR 流控溯源」Skill:CPU 过载 + UFDR(SST=3/物联 DNN)溯源到物联终端冲击。", priority: 3 },
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
  routeIterations: 7,
  llmModel: "MiniMax-M3",
};

// ---------------------------------------------------------------------------
// 场景 E —— 物联网风暴 · 流控溯源(策略2:溯源到 AMF+SMF · NSSAI/APN 限流 + 比例算法)
//   UE 不支持 back-off timer → 策略1 无法收敛 → 探索策略2:
//   AMF 限制物联切片 NSSAI 接入 + SMF 限制物联 APN/DNN 接入,两限制比例由算法实时调节
//   → 注册/会话请求下降 → 恢复。(2 轮探索)
// ---------------------------------------------------------------------------

const FAULT_E: FaultSpec = {
  faultType: "iot_storm",
  faultMode: "business",
  elements: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"],
  links: [],
  lossRate: 0.04,
  faultStart: 28,
  faultDuration: 14,
  ueCount: 80,
  difficulty: "hard",
};

const REASONING_E: ReasonStep[] = [
  // ===== 第一轮(完整 6 步) =====
  { n: 1, type: "tool_call", text: "[轮1·①预处理] 容器指标采集:AMF/SMF CPU 过载 + 注册/会话突增,流控扩散影响 2C 手机。", result: "AMF/SMF 被冲击", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 2, type: "tool_call", text: "[轮1·②拓扑] 溯源:注册请求集中于物联网终端(应用平台故障致反复上线),AMF/SMF 为被冲击方。", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 3, type: "tool_call", text: "[轮1·③检测] iFFusion 融合检测:AMF 注册突增 + SMF 会话突增 → 物联终端风暴。", result: "异常确认", highlight: { nes: ["AMF_1", "SMF_1"] } },
  { n: 4, type: "thinking", text: "[轮1·◇策略匹配→④根因] 置信度 0.30,信号模糊,策略匹配:溯源到物联终端群体。", highlight: { nes: ["AMF_1"] } },
  { n: 5, type: "tool_call", text: "[轮1·⑤输出评估] 评估通过,执行⑥恢复策略 1:AMF Reg Reject + back-off timer。", result: "评估通过", highlight: { nes: ["AMF_1"] } },
  { n: 6, type: "tool_call", text: "[轮1·⑥恢复策略 1] back-off 执行后仅 20% 终端支持,冲击未收敛 → Agent3 评估:网络未恢复。", result: "首轮恢复失败", highlight: { nes: ["AMF_1"] } },
  // ===== 回到 Agent1 第二轮 =====
  { n: 7, type: "thinking", text: "Agent3 判定未恢复 → 通过 loop② 回 Agent1 重新采集 → Agent2 第二轮执行 6 步。", highlight: { nes: [] } },
  { n: 8, type: "tool_call", text: "[轮2·①②③] 第二轮采集 + 拓扑 + 检测:UPF UFDR 溯源 SST=3(MIoT) 注册突增 + 物联 DNN 会话突增。", result: "SST=3 + 物联 DNN", highlight: { nes: ["UPF_1"] } },
  { n: 9, type: "thinking", text: "[轮2·◇策略匹配→④根因] 二轮溯源定位 AMF(物联 NSSAI 接入)与 SMF(物联 APN/DNN 接入)。", highlight: { nes: ["AMF_1", "SMF_1"] } },
  { n: 10, type: "tool_call", text: "[轮2·⑤输出评估] 评估通过,决策恢复策略 2:AMF 限制 NSSAI + SMF 限制 APN,比例按容量/流量/CPU 反压实调节。", result: "策略 2:双通道限流", highlight: { nes: ["AMF_1", "SMF_1"] } },
  { n: 11, type: "tool_call", text: "[轮2·⑥恢复策略 2] AMF NSSAI + SMF APN 双通道限流执行,注册/会话请求同步下降。", result: "第二轮执行中", highlight: { nes: ["AMF_1", "SMF_1"] } },
  { n: 12, type: "conclusion", text: "第二轮恢复策略 2 执行后冲击收敛,网络恢复。Agent3 评估:已恢复 → 沉淀 NSSAI/APN 准入控制 skill。", result: "AUTONOMOUS · 第二轮收敛" },
];

const CONFIDENCE_E: ConfidenceBreakdown = {
  pattern: 0.34,
  severity: 0.5,
  temporal: 0.35,
  spatial: 0.32,
  ambiguity: 0.2,
  score: 0.3,
  route: "autonomous",
  patternName: "iot_storm_net_tracing (流控溯源·网络侧限流)",
  matchedSkills: ["core/ufdr_tracing", "core/admission_control"],
  affectedNeCount: 2,
};

const EVAL_E: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.88, toolEfficiency: 0.8, evidenceQuality: 0.86, missedSignals: 0.16, overall: 0.85 },
  suggestions: [
    { type: "SKILL_UPDATE", target: "skills/learned/admission_control", content: "新增「NSSAI/APN 准入控制」Skill:UE back-off 失效时,网络侧双通道限流 + 比例算法收敛。", priority: 3 },
  ],
};

export const SPEC_E: ConstructedSpec = {
  topo: COMMON_TOPO,
  fault: FAULT_E,
  kpi: (graph) => buildKpiFor(graph, FAULT_E),
  reasoning: REASONING_E,
  confidence: CONFIDENCE_E,
  evaluation: EVAL_E,
  predicted: { elements: [], links: [] },
  routeIterations: 11,
  llmModel: "MiniMax-M3",
};

