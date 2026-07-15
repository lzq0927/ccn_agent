// ============================================================================
// 构造式演示场景 —— 真实拓扑文本 + 合成遥测 + 手写推理链
//   场景 A:UPF_1 微损 · 确定性工作流(均质化比较排除 AMF/SMF + 定位 UPF_1)
//   场景 B:SMF_1 异常 · 技能引导(网络微损+终端噪声 → 多维校验排除终端)
//   场景 C:gNB 用户侧异常 · 自主探索(CHR 聚类 + 用户分群追踪发现物联终端群体异常)
//   场景 D:UDM_1 异常 · 确定性工作流(均质化对比排除 SMF + 故障聚合定位)
//   四场景共用真实 case_101 拓扑(21 NE);遥测与推理为合成。路由分落三档:
//   A/D=WORKFLOW(>0.7)、B=GUIDED(0.3~0.7)、C=AUTONOMOUS(≤0.3)。
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
  { n: 2, type: "tool_call", text: "均质化比较:AMF、SMF 全实例同现异常(共性),排除 AMF/SMF 为单点根因。", highlight: { nes: ["AMF_1", "AMF_2", "AMF_3", "SMF_1", "SMF_2"] } },
  { n: 3, type: "tool_call", text: "UPF 通信路径均质化比较:UPF_1 异常,UPF_2/UPF_3 健康,UPF_1 为唯一离群点。", highlight: { nes: ["UPF_1"] } },
  { n: 4, type: "conclusion", text: "根因为 UPF_1,确定性工作流秒级定位。", result: "WORKFLOW · 命中", highlight: { nes: ["UPF_1"] } },
];

const CONFIDENCE_A: ConfidenceBreakdown = {
  pattern: 0.9,
  severity: 0.4,
  temporal: 0.88,
  spatial: 0.8,
  ambiguity: 0.12,
  score: 0.76,
  route: "workflow",
  patternName: "upf_homogenization (UPF 均质化比较签名)",
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
  { n: 1, type: "tool_call", text: "iFFusion 异常检测:网络 KPI 微损,叠加少量终端异常。", result: "SMF 方向劣化 + 终端噪声", highlight: { nes: ["SMF_1"] } },
  { n: 2, type: "tool_call", text: "多维数据校验:CHR 用户级失败集中于会话建立。", highlight: { nes: ["SMF_1"] } },
  { n: 3, type: "thinking", text: "排除终端原因(鉴权 / 兼容性干扰),锁定网络侧。", highlight: { nes: ["SMF_1"] } },
  { n: 4, type: "conclusion", text: "根因为 SMF_1,实施恢复。", result: "GUIDED · 命中", highlight: { nes: ["SMF_1"] } },
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
  { n: 1, type: "tool_call", text: "iFFusion 异常检测:总体微跌,无网元异常。", result: "无 NE 跌破阈值" },
  { n: 2, type: "tool_call", text: "CHR 聚类:失败原因分散,无网络根因。", highlight: { nes: ["gNB_2"] } },
  { n: 3, type: "thinking", text: "用户分群追踪:物联终端群体失败率 52%。", highlight: { nes: ["gNB_2"] } },
  { n: 4, type: "conclusion", text: "物联终端群体异常,网络健康。", result: "AUTONOMOUS · 用户侧恢复" },
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
// 场景 D —— UDM_1 异常 · 确定性工作流(均质化对比排除 SMF + 故障聚合定位)
//   (原场景 A 的 UDM 内容平移至此)
// ---------------------------------------------------------------------------

const FAULT_D: FaultSpec = {
  faultType: "single_ne",
  faultMode: "link",
  elements: ["UDM_1"],
  links: [],
  lossRate: 0.062,
  faultStart: 32,
  faultDuration: 8,
  ueCount: 90,
  difficulty: "medium",
};

const REASONING_D: ReasonStep[] = [
  { n: 1, type: "tool_call", text: "iFFusion 异常检测:多个网元出现异常,含多个 SMF 与 UDM 方向。", result: "SMF_1/2、UDM_1 方向劣化", highlight: { nes: ["UDM_1"] } },
  { n: 2, type: "tool_call", text: "均质化对比:多个 SMF 同现异常(共性),排除 SMF 为单点根因。", highlight: { nes: ["UDM_1"] } },
  { n: 3, type: "tool_call", text: "故障聚合:聚合受影响流程,UDM_1 集中度最高。", highlight: { nes: ["UDM_1"] } },
  { n: 4, type: "conclusion", text: "根因为 UDM_1,确定性工作流秒级定位。", result: "WORKFLOW · 命中", highlight: { nes: ["UDM_1"] } },
];

const CONFIDENCE_D: ConfidenceBreakdown = {
  pattern: 0.92,
  severity: 0.6,
  temporal: 0.9,
  spatial: 0.82,
  ambiguity: 0.08,
  score: 0.74,
  route: "workflow",
  patternName: "udm_homogenization (均质化对比签名)",
  matchedSkills: ["core/homogenization_compare", "core/fault_aggregation"],
  affectedNeCount: 1,
};

const EVAL_D: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.95, toolEfficiency: 0.93, evidenceQuality: 0.94, missedSignals: 0.08, overall: 0.94 },
  suggestions: [],
};

export const SPEC_D: ConstructedSpec = {
  topo: COMMON_TOPO,
  fault: FAULT_D,
  kpi: (graph) => buildKpiFor(graph, FAULT_D, { propagate: 0.35 }),
  reasoning: REASONING_D,
  confidence: CONFIDENCE_D,
  evaluation: EVAL_D,
  predicted: { elements: ["UDM_1"], links: [] },
  routeIterations: 5,
  llmModel: "确定性工作流 (WorkflowEngine)",
};
