// ============================================================================
// 数据层共享类型 —— 与后端真实数据契约对齐
// ============================================================================

import type { KpiBundle } from "./kpi";
import type { NetworkGraph } from "./network";

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

/** 对比区的一侧(朴素视角 vs 多维探索后) */
export interface ComparisonSide {
  title: string;
  verdict: string;
  detail: string;
  kind?: "miss" | "falsealarm" | "hit";
}

/** 用户级 CHR 洞察 —— 拓扑弹窗展示的原因值(场景 B/C/D) */
export interface ChrInsight {
  nes: string[];
  causeCode: string;
  causeCn: string;
  detail: string;
  /** 主导原因值占比(0-100)，用于原因值分布饼图;缺省则按伴随数量估算 */
  share?: number;
  /** 伴随的相关原因值(聚类旁证，场景 C/D) */
  related?: { code: string; cn: string; share?: number }[];
}

/** 误报拦截 —— 朴素网络视角会误判的根因(场景 C) */
export interface FalseAlarm {
  naiveNe: string;
  naiveCn: string;
  reason: string;
}

/** 用户侧异常(非网络故障)—— 终端群体异常等(场景 C) */
export interface UserFault {
  gnbs: string[];
  affectedUe: number;
  kind: string;
}

/** 能力沉淀 —— 探索后形成/优化的 Skill(场景 B/C) */
export interface SkillEvolution {
  kind: "NEW" | "UPDATE";
  skillId: string;
  skillCn: string;
  insight: string;
  before?: string;
  after: string;
  nextHitRate: number;
}

/** 均质化比较一轮(场景 A/D,phase 4 弹窗) */
export interface HomogenRound {
  type: string; // 比较对象，如 "AMF / SMF 通信路径" / "AMF-UDM 正常"
  principle?: string; // 本轮应用的推理原则
  instances: { id: string; anomalous: boolean }[];
  verdict: "exclude" | "normal" | "root"; // 共性→排除 / 正常→排除(旁证) / 离群→根因
  note: string;
}
/** 均质化比较结果(场景 A/D) */
export interface HomogenResult {
  anchorNe: string; // 弹窗锚定 NE(根因)
  rounds: HomogenRound[];
  principles: string[]; // 应用的推理原则/算法(故障传播/独立性验证/故障聚合…)
}
/** 隔离标注(场景 A/B/D,phase 5 弹窗) */
export interface IsolationNote {
  isolateNe: string; // 被隔离 NE
  failoverTo: string[]; // 流量切换目标
  summary: string;
}

/** 一个演示场景 */
export interface Scenario {
  id: string;
  cn: string;
  en: string;
  tagline: string;
  /** 场景简介(标签悬停/选中弹窗)。LIVE 场景可缺省。 */
  intro?: string;
  /** 一句话目标(始终可见的上下文) */
  objective?: string;
  /** 双主题点亮:用户级韧性 / 网络自治 */
  pillars?: { userLevel: boolean; autonomy: boolean };
  /** 拓扑下对比区数据(建议 2) */
  comparison?: { naive: ComparisonSide; explored: ComparisonSide };
  /** 拓扑 CHR 原因值弹窗(场景 B) */
  chrInsight?: ChrInsight;
  /** 误报拦截(场景 C) */
  falseAlarm?: FalseAlarm;
  /** 用户侧异常(场景 C)——存在时网络 NE 保持健康 */
  userFault?: UserFault;
  /** 能力沉淀 / 技能进化(场景 B/C) */
  skillEvolution?: SkillEvolution;
  /** 均质化比较结果(场景 A/D,phase 4 弹窗) */
  homogen?: HomogenResult;
  /** 隔离标注(场景 A/B/D,phase 5 弹窗) */
  isolation?: IsolationNote;
  fault: FaultSpec;
  truth: { elements: string[]; links: string[] };
  predicted: { elements: string[]; links: string[] };
  confidence: ConfidenceBreakdown;
  reasoning: ReasonStep[];
  evaluation: EvalMetrics;
  routeIterations: number;
  llmModel: string;
  /** 真实遥测时序(来自 data.csv 聚合，优先于 buildKpi 合成) */
  realKpi?: KpiBundle;
  /** 真实拓扑图(来自 topo.txt，优先于 DEMO_GRAPH) */
  realGraph?: NetworkGraph;
}
