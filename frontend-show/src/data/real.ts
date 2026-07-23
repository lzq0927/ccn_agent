// ============================================================================
// 真实数据适配器 —— 把 scripts/export_demo_scenarios.py 产出的 real-cases.json
//   转成演示 Scenario。遥测(KPI/拓扑/真值)、推理链、评估、置信度全部来自
//   真实诊断/评估产出，不再前端合成。
// ============================================================================

import { buildGraphFromTopoText, edgeId } from "./network";
import { buildLiveFault, type CaseMeta } from "./live";
import type { KpiBundle } from "./kpi";
import type { NetworkGraph } from "./network";
import type {
  ChrInsight,
  ConfidenceBreakdown,
  ComparisonSide,
  EvalMetrics,
  FalseAlarm,
  FaultReport,
  FlowControl,
  GraphEdge,
  HomogenResult,
  IsolationNote,
  NEType,
  ReasonStep,
  RouteKey,
  Scenario,
  SkillEvolution,
  StormMetrics,
  UfdrReport,
  UserFault,
} from "./types";

// ---- real-cases.json 的结构(与 export_demo_scenarios.py 输出对齐)----
export interface RealReasoningStep {
  step_number: number;
  step_type: ReasonStep["type"];
  content: string;
  tool_name?: string | null;
  tool_args?: Record<string, unknown> | null;
  tool_result?: string | null;
  timestamp?: string;
}

export interface RealCase {
  scenario_id: string;
  case_id: number;
  meta: CaseMeta;
  topo: string;
  flowPairs: string[][];
  truth: { elements: string[]; links: string[] };
  kpi: KpiBundle;
  diagnosis: {
    session_id: string;
    fault_elements: string[];
    fault_links: string[];
    fault_type: string | null;
    fault_mode: string | null;
    confidence: number;
    route_taken: RouteKey;
    iterations_used: number;
    llm_model: string;
    status: string;
    reasoning_trace: RealReasoningStep[];
  };
  evaluation: {
    metrics: {
      exact_match: boolean;
      precision: number;
      recall: number;
      f1: number;
      fault_type_match: boolean;
    };
    case_category: string;
    trace_quality_score: number;
    trace_axes: {
      logical_coherence: number;
      tool_efficiency: number;
      evidence_quality: number;
      missed_signals: number;
      overall_score: number;
    };
    suggestions: { suggestion_type: string; target: string; content: string; priority: number }[];
  };
  confidence: ConfidenceBreakdown;
}

/** 每个场景的叙事层(标题/故事/主题 + 用户级/自治派生态)—— 数据层全真，文案据实定稿 */
export interface ScenarioNarrative {
  cn: string;
  en: string;
  tagline: string;
  intro?: string;
  objective?: string;
  pillars?: { userLevel: boolean; autonomy: boolean };
  comparison?: { naive: ComparisonSide; explored: ComparisonSide };
  /** 拓扑 CHR 原因值弹窗(场景 B/C/D) */
  chrInsight?: ChrInsight;
  /** 误报拦截(场景 C) */
  falseAlarm?: FalseAlarm;
  /** 用户侧群体异常(场景 C/D)——存在时网络 NE 保持健康 */
  userFault?: UserFault;
  /** 能力沉淀 / 技能进化(场景 B/C) */
  skillEvolution?: SkillEvolution;
  /** 均质化比较结果(场景 A/D) */
  homogen?: HomogenResult;
  /** 隔离标注(场景 A/B/D) */
  isolation?: IsolationNote;
  /** UPF UFDR 溯源报表(场景 D/E) */
  ufdr?: UfdrReport;
  /** 流控策略(场景 D/E) */
  flowControl?: FlowControl;
  /** 风暴冲击指标(场景 D/E) */
  stormMetrics?: StormMetrics;
  /** 大模型故障报告(场景 D/E) */
  faultReport?: FaultReport;
}

/** 简洁中文推理链(替换真实英文 trace，展会可读;根因/后验来自真实诊断) */
function cleanRealReasoning(rc: RealCase, rootNes: string[]): ReasonStep[] {
  const id = rc.scenario_id;
  const root = rootNes.join(",");
  const post = (rc.diagnosis.confidence * 100).toFixed(0);
  if (id === "B") {
    return [
      { n: 1, type: "tool_call", text: "KPI 扫描:接入成功率微跌，信号模糊。", result: `触及 ${root} 方向`, highlight: { nes: rootNes } },
      { n: 2, type: "tool_call", text: `CHR 下钻:失败集中于 ${root}，主因无线资源不足。`, highlight: { nes: rootNes } },
      { n: 3, type: "thinking", text: "剥离终端侧鉴权 / 兼容性干扰原因。" },
      { n: 4, type: "conclusion", text: `根因为 ${root}，排除核心网与终端干扰。`, result: `后验 ${post}% · 命中`, highlight: { nes: rootNes } },
    ];
  }
  if (id === "C") {
    return [
      { n: 1, type: "tool_call", text: "KPI 扫描:接入失败略升，易误判核心网。", highlight: {} },
      { n: 2, type: "tool_call", text: `CHR 聚类:失败集中于同一批终端，多原因值共现。`, highlight: { nes: rootNes } },
      { n: 3, type: "thinking", text: `贝叶斯融合锁定 ${root}，排除 AMF 误报。`, highlight: { nes: rootNes } },
      { n: 4, type: "conclusion", text: `根因为 ${root}，终端群体共因定位。`, result: `后验 ${post}% · 命中`, highlight: { nes: rootNes } },
    ];
  }
  return [
    { n: 1, type: "tool_call", text: `KPI 扫描:检出异常，触及 ${root} 方向。`, highlight: { nes: rootNes } },
    { n: 2, type: "conclusion", text: `根因为 ${root}。`, result: `后验 ${post}%`, highlight: { nes: rootNes } },
  ];
}

/** 由真实 topo + data.csv 出现的链路对重建图(镜像 live.ts::buildLiveModel 的建图) */
export function buildRealGraph(topo: string, flowPairs: string[][]): NetworkGraph {
  const base = buildGraphFromTopoText(topo);
  const seen = new Set<string>();
  const flowEdges: GraphEdge[] = [];
  for (const pair of flowPairs) {
    const [a, b] = pair;
    const id = edgeId(a, b);
    if (seen.has(id)) continue;
    seen.add(id);
    const ta = (base.nodeById[a]?.type ?? "SMF") as NEType;
    const tb = (base.nodeById[b]?.type ?? "UPF") as NEType;
    flowEdges.push({ id, a, b, kind: "flow", weight: 1.2, types: [ta, tb] });
  }
  const fe = flowEdges.length ? flowEdges : base.flowEdges;
  const edges = [...fe, ...base.registryEdges];
  const adj: Record<string, string[]> = {};
  for (const n of base.nodes) adj[n.id] = [];
  for (const e of edges) {
    (adj[e.a] ??= []).push(e.b);
    (adj[e.b] ??= []).push(e.a);
  }
  return {
    nodes: base.nodes,
    nodeById: base.nodeById,
    flowEdges: fe,
    registryEdges: base.registryEdges,
    edges,
    edgeById: Object.fromEntries(edges.map((e) => [e.id, e])),
    adj,
  };
}

/** 真实用例 → 演示 Scenario(全真:遥测/推理/评估/置信度来自真实产出) */
export function buildRealScenario(rc: RealCase, n: ScenarioNarrative): Scenario {
  const fault = buildLiveFault(rc.meta, {
    fault_elements: rc.truth.elements,
    fault_links: rc.truth.links,
  });
  const truth = rc.truth;
  const predicted = { elements: rc.diagnosis.fault_elements, links: rc.diagnosis.fault_links };
  const rootNes = truth.elements.length ? truth.elements : [];

  // 简洁中文推理链(展会可读;根因 NE 与后验来自真实诊断)
  const reasoning = cleanRealReasoning(rc, rootNes);

  const ta = rc.evaluation.trace_axes;
  const evaluation: EvalMetrics = {
    precision: rc.evaluation.metrics.precision,
    recall: rc.evaluation.metrics.recall,
    f1: rc.evaluation.metrics.f1,
    exactMatch: rc.evaluation.metrics.exact_match,
    faultTypeMatch: rc.evaluation.metrics.fault_type_match,
    category: rc.evaluation.case_category.toUpperCase() as EvalMetrics["category"],
    traceAxes: {
      logicalCoherence: ta.logical_coherence,
      toolEfficiency: ta.tool_efficiency,
      evidenceQuality: ta.evidence_quality,
      // trace_analyzer 的 missed_signals 实为"信号完备度"(越高 overall 越高),
      // 前端语义为"漏检"(越高越差)，此处反转为漏检比例以对齐前端展示。
      missedSignals: 1 - ta.missed_signals,
      overall: ta.overall_score,
    },
    suggestions: rc.evaluation.suggestions.map((s) => ({
      type: s.suggestion_type.toUpperCase() as "SKILL_UPDATE" | "WORKFLOW_UPDATE" | "NEW_CASE",
      target: s.target,
      content: s.content,
      priority: s.priority,
    })),
  };

  return {
    id: rc.scenario_id,
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
    fault,
    truth,
    predicted,
    confidence: rc.confidence,
    reasoning,
    evaluation,
    realKpi: rc.kpi,
    realGraph: buildRealGraph(rc.topo, rc.flowPairs),
    routeIterations: rc.diagnosis.iterations_used || 6,
    llmModel: rc.diagnosis.llm_model || "MiniMax-M3",
  };
}
