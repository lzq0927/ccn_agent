// ============================================================================
// 构造式演示场景 —— 真实拓扑文本 + 合成遥测 + 手写推理链
//   场景 A:UDM_1 异常 · 确定性工作流(故障传播原则 + 故障聚合原则)定位根因
//   场景 D:用户追踪 —— KPI/CHR 仅见模糊信号 → 用户分群追踪发现物联终端群体异常
//   拓扑取自真实 storage/cases(case_003 / case_101)的网络结构;遥测与推理为
//   据叙事定稿的合成数据(真实管线无对应可观测 UDM 用例,故构造)。
// ============================================================================

import { buildGraphFromTopoText, type NetworkGraph } from "./network";
import { buildKpiFor, buildMildOverallKpi, type KpiBundle } from "./kpi";
import type { ScenarioNarrative } from "./real";
import type {
  ConfidenceBreakdown,
  EvalMetrics,
  FaultSpec,
  ReasonStep,
  Scenario,
} from "./types";

/** 场景 A 网络画布(真实 case_003 拓扑:DC1+DC2,UDM_1 master) */
const TOPO_A = `DC: DC1
  ResourcePool: RP_DC1_1
    gNB: gNB_7
    AMF: AMF_1
    SMF: SMF_5
    SMF: SMF_7
    PCF: PCF_1
    NSSF: NSSF_3
  ResourcePool: RP_DC1_2
    gNB: gNB_2
    gNB: gNB_3
    gNB: gNB_8
    gNB: gNB_11
    gNB: gNB_12
    AMF: AMF_2
    AMF: AMF_4
    SMF: SMF_1
    SMF: SMF_6
    UPF: UPF_1
    UPF: UPF_5
    UPF: UPF_6
    PCF: PCF_2
    UDM: UDM_1(master)
    AUSF: AUSF_2(standby)
    NRF: NRF_2
    NRF: NRF_4
    NSSF: NSSF_1
DC: DC2
  ResourcePool: RP_DC2_1
    gNB: gNB_1
    gNB: gNB_5
    SMF: SMF_8
    UPF: UPF_7
    PCF: PCF_3
    AUSF: AUSF_1(master)
    NSSF: NSSF_2
  ResourcePool: RP_DC2_2
    gNB: gNB_4
    gNB: gNB_6
    gNB: gNB_9
    gNB: gNB_10
    AMF: AMF_3
    SMF: SMF_2
    SMF: SMF_3
    SMF: SMF_4
    UPF: UPF_2
    UPF: UPF_3
    UPF: UPF_4
    UDM: UDM_2(standby)
    NRF: NRF_1
    NRF: NRF_3`;

/** 场景 D 网络画布(真实 case_101 拓扑:单 DC,gNB_2 为用户异常接入点) */
const TOPO_D = `DC: DC1
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
// 场景 A —— UDM_1 异常 · 确定性工作流(故障传播原则 + 故障聚合原则)
// ---------------------------------------------------------------------------

const FAULT_A: FaultSpec = {
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

const REASONING_A: ReasonStep[] = [
  {
    n: 1,
    type: "tool_call",
    tool: "analyze_kpi_anomalies",
    args: "level=link",
    text: "签约/鉴权方向多链路跌破阈值,异常表象涉及 SMF 与 UDM_1 方向。",
    result: "劣化链路:SMF_1/2/6/7 → UDM_1",
    highlight: { nes: ["UDM_1"] },
  },
  {
    n: 2,
    type: "tool_call",
    tool: "trace_fault_propagation",
    args: "故障传播原则",
    text: "沿业务流回溯:所有劣化汇聚于 Nudm 接口,异常由 UDM_1 向 SMF 传播。",
    result: "传播汇聚点 = UDM_1(Nudm),SMF 为表象",
    highlight: { nes: ["UDM_1"] },
  },
  {
    n: 3,
    type: "tool_call",
    tool: "aggregate_faults",
    args: "故障聚合原则",
    text: "按网元聚合受影响流程,UDM_1 命中度最高,其余 NE 仅各 1 条。",
    result: "UDM_1 score=0.96 · 次优 SMF_1=0.31",
    highlight: { nes: ["UDM_1"] },
  },
  {
    n: 4,
    type: "tool_call",
    tool: "check_temporal_pattern",
    args: "ne=UDM_1",
    text: "时序核对:劣化 onset 与 UDM_1 故障窗吻合,矩形下跌。",
    result: "onset=T32 · 窗口吻合",
  },
  {
    n: 5,
    type: "conclusion",
    text: "确定性工作流判定根因 UDM_1,秒级定位,无需 LLM 介入。",
    result: "fault_elements=[UDM_1] · WORKFLOW · F1=1.00",
    highlight: { nes: ["UDM_1"] },
  },
];

const CONFIDENCE_A: ConfidenceBreakdown = {
  pattern: 0.92,
  severity: 0.6,
  temporal: 0.9,
  spatial: 0.82,
  ambiguity: 0.08,
  score: 0.74,
  route: "workflow",
  patternName: "udm_subscription_propagation (故障传播签名)",
  matchedSkills: ["core/fault_propagation", "core/fault_aggregation"],
  affectedNeCount: 1,
};

const EVAL_A: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.95, toolEfficiency: 0.93, evidenceQuality: 0.94, missedSignals: 0.08, overall: 0.94 },
  suggestions: [],
};

export const SPEC_A: ConstructedSpec = {
  topo: TOPO_A,
  fault: FAULT_A,
  kpi: (graph) => buildKpiFor(graph, FAULT_A, { propagate: 0.35 }),
  reasoning: REASONING_A,
  confidence: CONFIDENCE_A,
  evaluation: EVAL_A,
  predicted: { elements: ["UDM_1"], links: [] },
  routeIterations: 5,
  llmModel: "确定性工作流 (WorkflowEngine)",
};

// ---------------------------------------------------------------------------
// 场景 D —— 用户追踪:KPI/CHR 模糊信号 → 用户分群追踪发现物联终端群体异常
// ---------------------------------------------------------------------------

const FAULT_D: FaultSpec = {
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

const REASONING_D: ReasonStep[] = [
  {
    n: 1,
    type: "tool_call",
    tool: "analyze_kpi_anomalies",
    args: "level=link",
    text: "总体 SR 温和下跌,但无单一网元跌破阈值——信号模糊。",
    result: "无 NE 跌破阈值 · 信号分散",
  },
  {
    n: 2,
    type: "tool_call",
    tool: "chr_failure_clustering",
    args: "CHR 聚类",
    text: "CHR 失败集中于 gNB_2,但原因值分散,无明显网络根因。",
    result: "cluster: gNB_2 · 原因值分散",
    highlight: { nes: ["gNB_2"] },
  },
  {
    n: 3,
    type: "thinking",
    text: "网络侧无根因,触发用户级分群追踪。",
    result: "route=EXPLORATION · 启动用户追踪",
  },
  {
    n: 4,
    type: "tool_call",
    tool: "track_user_segment",
    args: "按终端类型分群",
    text: "按终端类型分群:gNB_2 物联终端群体失败率 38%。",
    result: "物联终端 · fail=38% · 1280 UE",
    highlight: { nes: ["gNB_2"] },
  },
  {
    n: 5,
    type: "tool_call",
    tool: "cluster_group_anomaly",
    args: "群体异常定位",
    text: "该群体跨多切片共因,网络 NE 健康 → 终端群体异常。",
    result: "群体异常确认 · 网络正常",
  },
  {
    n: 6,
    type: "conclusion",
    text: "判定用户侧群体异常(物联终端),网络无责,下发用户侧恢复。",
    result: "user-segment=IoT(1280 UE) · EXPLORATION · F1=1.00",
  },
];

const CONFIDENCE_D: ConfidenceBreakdown = {
  pattern: 0.5,
  severity: 0.35,
  temporal: 0.6,
  spatial: 0.35,
  ambiguity: 0.45,
  score: 0.38,
  route: "exploration",
  patternName: "fuzzy_signal (信号模糊·需用户级追踪)",
  matchedSkills: ["core/chr_clustering", "core/user_segment_tracking"],
  affectedNeCount: 0,
};

const EVAL_D: EvalMetrics = {
  precision: 1,
  recall: 1,
  f1: 1,
  exactMatch: true,
  faultTypeMatch: true,
  category: "SUCCESS",
  traceAxes: { logicalCoherence: 0.88, toolEfficiency: 0.8, evidenceQuality: 0.86, missedSignals: 0.18, overall: 0.85 },
  suggestions: [
    {
      type: "SKILL_UPDATE",
      target: "skills/core/user_segment_tracking",
      content: "新增「用户分群追踪」Skill:KPI/CHR 信号模糊时按终端类型分群定位群体异常。",
      priority: 3,
    },
  ],
};

export const SPEC_D: ConstructedSpec = {
  topo: TOPO_D,
  fault: FAULT_D,
  kpi: (graph) => buildMildOverallKpi(graph, FAULT_D.faultStart, FAULT_D.faultDuration, 0.011),
  reasoning: REASONING_D,
  confidence: CONFIDENCE_D,
  evaluation: EVAL_D,
  predicted: { elements: [], links: [] },
  routeIterations: 9,
  llmModel: "MiniMax-M3",
};
