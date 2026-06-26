// ============================================================================
// 数据层共享类型 —— 与后端真实数据契约对齐
// ============================================================================

export type NEType = "gNB" | "AMF" | "SMF" | "UPF" | "PCF" | "UDM" | "AUSF" | "NRF" | "NSSF";
export type Role = "master" | "standby" | "lb";

/** 拓扑中的网元实例 */
export interface NEInstance {
  id: string; // e.g. "AMF_3"
  type: NEType;
  role: Role;
  pool: string; // "RP_DC1_1"
  dc: string; // "DC1"
  layer: number; // 数据流分层(布局用)
  x: number;
  y: number;
}

/** 图边 */
export interface GraphEdge {
  id: string;
  a: string;
  b: string;
  kind: "flow" | "registry";
  weight: number;
  types: [NEType, NEType];
}

/** 故障规格(取自 metadata.json + result.txt) */
export interface FaultSpec {
  faultType: string; // single_ne | all_type_ne | path_link | multi_ne | ...
  faultMode: "link" | "business";
  elements: string[]; // 故障 NE id
  links: string[]; // 故障链路 "A->B"
  lossRate: number;
  faultStart: number; // 时间戳(仿真窗 1..60)
  faultDuration: number;
  ueCount: number;
  difficulty: string;
}

export type RouteKey = "workflow" | "guided" | "autonomous" | "exploration";

/** 置信度分解 —— 忠实于 confidence.py 的加权公式 */
export interface ConfidenceBreakdown {
  pattern: number; // 模式强度 ×0.40
  severity: number; // 异常严重度 ×0.20
  temporal: number; // 时间清晰度 ×0.15
  spatial: number; // 空间清晰度 ×0.15
  ambiguity: number; // 模糊度 ×(-0.10)
  score: number; // 最终 0..1
  route: RouteKey;
  patternName: string;
  matchedSkills: string[];
  affectedNeCount: number;
}

/** 推理链一步(对应 ReasoningStep) */
export interface ReasonStep {
  n: number;
  type: "thinking" | "tool_call" | "tool_result" | "conclusion";
  tool?: string;
  args?: string;
  text: string;
  result?: string;
  highlight?: { nes?: string[]; links?: string[] }; // 反向高亮拓扑元素
}

/** 评估指标(对应 EvaluationMetrics) */
export interface EvalMetrics {
  precision: number;
  recall: number;
  f1: number;
  exactMatch: boolean;
  faultTypeMatch: boolean;
  category: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILURE" | "FALSE_POSITIVE";
  traceAxes: {
    logicalCoherence: number;
    toolEfficiency: number;
    evidenceQuality: number;
    missedSignals: number;
    overall: number;
  };
  suggestions: Suggestion[];
}

export interface Suggestion {
  type: "SKILL_UPDATE" | "WORKFLOW_UPDATE" | "NEW_CASE";
  target: string;
  content: string;
  priority: number;
}

/** 一个演示场景 */
export interface Scenario {
  id: string;
  cn: string;
  en: string;
  tagline: string;
  fault: FaultSpec;
  truth: { elements: string[]; links: string[] };
  predicted: { elements: string[]; links: string[] };
  confidence: ConfidenceBreakdown;
  reasoning: ReasonStep[];
  evaluation: EvalMetrics;
  routeIterations: number;
  llmModel: string;
}
