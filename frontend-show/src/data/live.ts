// ============================================================================
// LIVE 模式适配器 —— 把真实用例文件(topo/data.csv/result/metadata)转成
//   NetworkGraph + KpiBundle，驱动数字孪生与 KPI 面板。
//   真实链路取自 data.csv 的 link 层行;KPI 为真实 success_rate 时序。
// ============================================================================

import { buildGraphFromTopoText, edgeId, type NetworkGraph } from "./network";
import { TIMESTEPS, type KpiBundle } from "./kpi";
import type { ConfidenceBreakdown, EvalMetrics, FaultSpec, GraphEdge, NEType, ReasonStep, RouteKey, Scenario } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface CaseMeta {
  fault_type?: string;
  fault_mode?: string;
  fault_start?: number;
  fault_duration?: number;
  loss_rate?: number;
  ue_count?: number;
  difficulty?: string;
}

export interface LiveModel {
  graph: NetworkGraph;
  kpi: KpiBundle;
}

interface LinkRow {
  t: number;
  src: string;
  dst: string;
  sr: number;
}

function parseLinkRows(csv: string): LinkRow[] {
  const lines = csv.replace(/\r/g, "").trim().split("\n");
  const out: LinkRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 6) continue;
    const level = c[1];
    if (level !== "link") continue;
    const src = c[3];
    const dst = c[4];
    if (!src || !dst) continue;
    const t = parseInt(c[0], 10);
    const sr = parseFloat(c[5]);
    if (!isFinite(t) || !isFinite(sr)) continue;
    out.push({ t, src, dst, sr });
  }
  return out;
}

/** 用基线 0.999 填补缺失时间戳 */
function fillGaps(arr: number[]) {
  for (let i = 0; i < arr.length; i++) if (isNaN(arr[i])) arr[i] = 0.999;
}

function rebuildAdj(edges: GraphEdge[], nodeIds: string[]): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const id of nodeIds) m[id] = [];
  for (const e of edges) {
    (m[e.a] ??= []).push(e.b);
    (m[e.b] ??= []).push(e.a);
  }
  return m;
}

/** 由真实 topo + data.csv 构建图与真实 KPI 时序 */
export function buildLiveModel(topoText: string, csvText: string, meta: CaseMeta): LiveModel {
  const base = buildGraphFromTopoText(topoText);
  const rows = parseLinkRows(csvText);

  // 真实业务流链路 = data.csv 中出现过的 link 对(去重)
  const pairEdges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = edgeId(r.src, r.dst);
    if (seen.has(id)) continue;
    seen.add(id);
    const ta = (base.nodeById[r.src]?.type ?? "SMF") as NEType;
    const tb = (base.nodeById[r.dst]?.type ?? "UPF") as NEType;
    pairEdges.push({ id, a: r.src, b: r.dst, kind: "flow", weight: 1.2, types: [ta, tb] });
  }
  const flowEdges = pairEdges.length ? pairEdges : base.flowEdges;
  const edges = [...flowEdges, ...base.registryEdges];
  const graph: NetworkGraph = {
    nodes: base.nodes,
    nodeById: base.nodeById,
    flowEdges,
    registryEdges: base.registryEdges,
    edges,
    edgeById: Object.fromEntries(edges.map((e) => [e.id, e])),
    adj: rebuildAdj(edges, base.nodes.map((n) => n.id)),
  };

  // 逐链路时序(同边同 t 多行取均值)
  const edgeSeries: Record<string, number[]> = {};
  for (const e of flowEdges) edgeSeries[e.id] = new Array(TIMESTEPS).fill(NaN);
  const count: Record<string, number[]> = {};
  for (const id in edgeSeries) count[id] = new Array(TIMESTEPS).fill(0);
  for (const r of rows) {
    const id = edgeId(r.src, r.dst);
    const idx = clamp(r.t - 1, 0, TIMESTEPS - 1);
    const arr = edgeSeries[id];
    if (!arr) continue;
    if (count[id][idx] === 0) arr[idx] = r.sr;
    else arr[idx] = (arr[idx] * count[id][idx] + r.sr) / (count[id][idx] + 1);
    count[id][idx]++;
  }
  for (const id in edgeSeries) fillGaps(edgeSeries[id]);

  // 总体 = 各链路逐 t 均值
  const overall = new Array(TIMESTEPS).fill(0.999);
  for (let t = 0; t < TIMESTEPS; t++) {
    let s = 0;
    let c = 0;
    for (const id in edgeSeries) {
      const v = edgeSeries[id][t];
      if (!isNaN(v)) {
        s += v;
        c++;
      }
    }
    overall[t] = c ? s / c : 0.999;
  }

  // 节点 = 关联业务链路逐 t 均值
  const nodeSeries: Record<string, number[]> = {};
  for (const n of graph.nodes) {
    const inc = graph.flowEdges.filter((e) => e.a === n.id || e.b === n.id);
    const arr = new Array(TIMESTEPS).fill(0.999);
    for (let t = 0; t < TIMESTEPS; t++) {
      let s = 0;
      let c = 0;
      for (const e of inc) {
        const v = edgeSeries[e.id]?.[t];
        if (v !== undefined && !isNaN(v)) {
          s += v;
          c++;
        }
      }
      arr[t] = c ? s / c : 0.999;
    }
    nodeSeries[n.id] = arr;
  }

  const faultStart = meta.fault_start ?? 20;
  const faultEnd = faultStart + (meta.fault_duration ?? 15);
  const kpi: KpiBundle = {
    steps: TIMESTEPS,
    overall,
    edges: edgeSeries,
    nodes: nodeSeries,
    faultStart,
    faultEnd,
    threshold: 0.995,
  };
  return { graph, kpi };
}

/** 由真实 metadata + result 构建故障规格(供 director 的 simT 映射与受影响集) */
export function buildLiveFault(meta: CaseMeta, result: { fault_elements?: string[]; fault_links?: string[] }): FaultSpec {
  return {
    faultType: meta.fault_type ?? "unknown",
    faultMode: meta.fault_mode === "business" ? "business" : "link",
    elements: result.fault_elements ?? [],
    links: result.fault_links ?? [],
    lossRate: meta.loss_rate ?? 0.06,
    faultStart: meta.fault_start ?? 20,
    faultDuration: meta.fault_duration ?? 15,
    ueCount: meta.ue_count ?? 0,
    difficulty: meta.difficulty ?? "medium",
  };
}

const MULTI_TYPES = new Set(["all_type_ne", "dc", "resource_pool", "multi_type_ne"]);
const PATH_TYPES = new Set(["path_link", "path_trace", "path_session", "switch"]);

/** 简化但忠实的置信度评估(镜像 confidence.py 的加权公式 + 阈值路由) */
export function assessLive(fault: FaultSpec): ConfidenceBreakdown {
  const isNormal = fault.elements.length === 0 && fault.links.length === 0;
  const multi = MULTI_TYPES.has(fault.faultType);
  const pathLike = PATH_TYPES.has(fault.faultType);
  const pattern = isNormal ? 1.0 : multi ? 1.0 : fault.elements.length === 1 ? 0.8 : pathLike ? 0.4 : 0.6;
  const severity = Math.min((fault.lossRate ?? 0.06) / 0.08, 1);
  const temporal = 0.8;
  const spatial = isNormal ? 1.0 : multi ? 0.9 : fault.elements.length === 1 ? 0.7 : 0.45;
  const ambiguity = isNormal ? 0.0 : pathLike ? 0.35 : 0.1;
  const score = clamp01(pattern * 0.4 + severity * 0.2 + temporal * 0.15 + spatial * 0.15 - ambiguity * 0.1);
  let route: RouteKey = score > 0.7 ? "workflow" : score > 0.3 ? "guided" : "autonomous";
  if (pathLike && severity < 0.7) route = "exploration"; // CHR 集中失败触发探索
  const patternName = isNormal ? "normal (无异常)" : multi ? `${fault.faultType} (多 NE)` : fault.elements.length === 1 ? "single_ne_dominant" : pathLike ? "path_level (链路级)" : fault.faultType;
  return {
    pattern,
    severity,
    temporal,
    spatial,
    ambiguity,
    score,
    route,
    patternName,
    matchedSkills: [],
    affectedNeCount: Math.max(fault.elements.length, fault.links.length),
  };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

/** 链路型故障的端点 NE */
function linkEndpoints(links: string[]): string[] {
  const s = new Set<string>();
  for (const lk of links) for (const p of lk.split(/[->]/)) if (p.trim()) s.add(p.trim());
  return [...s];
}

/** 为真实用例构建演示 Scenario(真实 fault/truth + 估算置信度 + 示意推理链 + 假定命中评估) */
export function buildLiveScenario(meta: CaseMeta, result: { fault_elements?: string[]; fault_links?: string[] }, caseId: number): Scenario {
  const fault = buildLiveFault(meta, result);
  const conf = assessLive(fault);
  const truth = { elements: result.fault_elements ?? [], links: result.fault_links ?? [] };
  const nes = truth.elements.length ? truth.elements : linkEndpoints(truth.links);
  const isNormal = nes.length === 0;
  const multi = MULTI_TYPES.has(fault.faultType);

  const reasoning: ReasonStep[] = isNormal
    ? [
        { n: 1, type: "tool_call", tool: "analyze_kpi_anomalies", args: "全层扫描", text: "扫描全层 KPI", result: "未检出低于阈值的异常链路", highlight: { nes: [] } },
        { n: 2, type: "conclusion", text: "判定网络正常 (normal)，无根因。", result: "confidence=0.95 · route=WORKFLOW" },
      ]
    : [
        { n: 1, type: "tool_call", tool: "analyze_kpi_anomalies", args: "level=link", text: "扫描 link 层 KPI", result: `检出劣化链路，触及 ${nes.join(", ")}`, highlight: { nes } },
        { n: 2, type: "tool_call", tool: "find_common_ne", args: "", text: "统计公共网元", result: `主导 NE: ${nes.join(", ")}(dominance 高)`, highlight: { nes } },
        { n: 3, type: "tool_call", tool: "check_temporal_pattern", args: `ne=${nes[0]}`, text: "时序模式分析", result: `故障窗 T${fault.faultStart}-${fault.faultStart + fault.faultDuration}，突发 onset` },
        { n: 4, type: "tool_call", tool: "check_ne_membership", args: `ne=${nes.join(",")}`, text: "归属聚类核对", result: `聚类:${multi ? "多 NE / 跨资源池" : "单一 NE"}`, highlight: { nes } },
        { n: 5, type: "conclusion", text: `判定根因:${fault.faultType}(${fault.faultMode} 模式)`, result: `fault_elements=[${nes.join(",")}] · confidence=${conf.score.toFixed(2)}`, highlight: { nes } },
      ];

  const evaluation: EvalMetrics = {
    precision: 1,
    recall: 1,
    f1: 1,
    exactMatch: true,
    faultTypeMatch: true,
    category: "SUCCESS",
    traceAxes: { logicalCoherence: 0.9, toolEfficiency: 0.88, evidenceQuality: 0.9, missedSignals: 0.15, overall: 0.9 },
    suggestions: [],
  };

  return {
    id: `live-${caseId}`,
    cn: `真实用例 #${caseId}`,
    en: `LIVE CASE #${caseId}`,
    tagline: `真实遥测驱动 · ${meta.fault_type ?? "normal"} · ${meta.difficulty ?? ""} · 推理为示意路径`,
    fault,
    truth,
    predicted: truth, // 假定命中(真实诊断需运行 Agent 2 闭环)
    confidence: conf,
    reasoning,
    evaluation,
    routeIterations: conf.route === "workflow" ? 5 : conf.route === "guided" ? 8 : 11,
    llmModel: "glm-4.6",
  };
}

