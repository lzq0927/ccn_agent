// ============================================================================
// KPI 时序生成器 —— 忠实复刻 simulator 的 success_rate 签名
//   基线 0.997~0.999(背景噪声);故障窗 [faultStart, faultStart+duration) 内
//   受影响实体按 lossRate 矩形下跌至 ~0.85~0.97;窗后恢复。
// ============================================================================

import { EDGES, NODES, affectedEntities, type NetworkGraph } from "./network";
import type { FaultSpec, NEType } from "./types";

export const TIMESTEPS = 60;
const ANOMALY_THRESHOLD = 0.995;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

/** 健康基线序列:每条序列独立基线(0.997~0.9995)+ 共模慢漂移 + 抖动 → 曲线有波动、各网元有差异(均 ≥0.995) */
function healthySeries(rng: () => number): number[] {
  const base = 0.997 + rng() * 0.0025;
  const s: number[] = [];
  for (let t = 1; t <= TIMESTEPS; t++) {
    s.push(clamp(base + Math.sin(t / 8.5) * 0.0012 + (rng() - 0.5) * 0.001, 0.995, 0.9995));
  }
  return s;
}

export interface KpiBundle {
  steps: number;
  overall: number[]; // 网络总体(均值)
  edges: Record<string, number[]>;
  nodes: Record<string, number[]>;
  faultStart: number;
  faultEnd: number;
  threshold: number;
}

/** 为某场景故障生成全套 KPI 时序 */
export function buildKpi(fault: FaultSpec): KpiBundle {
  const { neSet, edgeSet } = affectedEntities(fault);
  const rng = mulberry32(((fault.faultStart * 97 + fault.lossRate * 1000) | 0) + 1);
  const faultStart = fault.faultStart;
  const faultEnd = fault.faultStart + fault.faultDuration;
  const inWindow = (t: number) => t >= faultStart && t < faultEnd;

  const edges: Record<string, number[]> = {};
  const nodes: Record<string, number[]> = {};
  const overallAcc = new Array(TIMESTEPS).fill(0);
  let flowCount = 0;

  for (const e of EDGES) {
    if (e.kind !== "flow") continue;
    flowCount++;
    const s = healthySeries(rng);
    if (edgeSet.has(e.id)) {
      for (let t = 1; t <= TIMESTEPS; t++) {
        if (inWindow(t)) {
          const drop = clamp(fault.lossRate + (rng() - 0.5) * 0.02, 0.01, 0.15);
          s[t - 1] = clamp(1 - drop, 0.8, 0.999);
        }
      }
    }
    edges[e.id] = s;
    for (let t = 0; t < TIMESTEPS; t++) overallAcc[t] += s[t];
  }

  for (const n of NODES) {
    const s = healthySeries(rng);
    if (neSet.has(n.id)) {
      for (let t = 1; t <= TIMESTEPS; t++) {
        if (inWindow(t)) {
          const drop = clamp(fault.lossRate + (rng() - 0.5) * 0.02, 0.01, 0.15);
          s[t - 1] = clamp(1 - drop, 0.8, 0.999);
        }
      }
    }
    nodes[n.id] = s;
  }

  const overall = overallAcc.map((v) => (flowCount ? v / flowCount : 0.999));
  return { steps: TIMESTEPS, overall, edges, nodes, faultStart, faultEnd, threshold: ANOMALY_THRESHOLD };
}

/**
 * 图感知 KPI 合成 —— 与 buildKpi 同签名逻辑,但作用在任意 NetworkGraph 上。
 * 用于构造式演示场景(真实拓扑 + 合成遥测)。opts.propagate>0 时,根因 NE 的
 * 邻居(共享业务链路)按比例轻度劣化,呈现「多网元异常表象」的传播感。
 */
export function buildKpiFor(
  graph: NetworkGraph,
  fault: FaultSpec,
  opts?: { propagate?: number },
): KpiBundle {
  const neSet = new Set<string>(fault.elements);
  for (const lk of fault.links) {
    for (const p of lk.split(/[->]/)) {
      const t = p.trim();
      if (t) neSet.add(t);
    }
  }
  const edgeSet = new Set<string>();
  for (const ne of neSet) {
    for (const e of graph.flowEdges) {
      if (e.a === ne || e.b === ne) edgeSet.add(e.id);
    }
  }
  // 传播邻居:与根因 NE 共享业务链路的其它 NE(场景 A「多网元异常表象」)
  const propagate = opts?.propagate ?? 0;
  const neighSet = new Set<string>();
  if (propagate > 0) {
    for (const e of graph.flowEdges) {
      if (neSet.has(e.a) && !neSet.has(e.b)) neighSet.add(e.b);
      if (neSet.has(e.b) && !neSet.has(e.a)) neighSet.add(e.a);
    }
  }

  const rng = mulberry32(((fault.faultStart * 97 + fault.lossRate * 1000) | 0) + 7);
  const faultStart = fault.faultStart;
  const faultEnd = fault.faultStart + fault.faultDuration;
  const inWindow = (t: number) => t >= faultStart && t < faultEnd;

  const edges: Record<string, number[]> = {};
  const nodes: Record<string, number[]> = {};
  const overallAcc = new Array(TIMESTEPS).fill(0);
  let flowCount = 0;

  const pushSeries = (aff: boolean, neigh: boolean): number[] => {
    const s = healthySeries(rng);
    if (!aff && !(neigh && propagate > 0)) return s;
    for (let t = 1; t <= TIMESTEPS; t++) {
      if (!inWindow(t)) continue;
      if (aff) {
        const drop = clamp(fault.lossRate + (rng() - 0.5) * 0.02, 0.01, 0.15);
        s[t - 1] = clamp(1 - drop, 0.8, 0.999);
      } else if (neigh && propagate > 0) {
        const drop = clamp(fault.lossRate * propagate + (rng() - 0.5) * 0.01, 0.003, 0.05);
        s[t - 1] = clamp(1 - drop, 0.8, 0.999);
      }
    }
    return s;
  };

  for (const e of graph.flowEdges) {
    flowCount++;
    const aff = edgeSet.has(e.id);
    const neigh = neighSet.has(e.a) || neighSet.has(e.b);
    const s = pushSeries(aff, neigh);
    edges[e.id] = s;
    for (let t = 0; t < TIMESTEPS; t++) overallAcc[t] += s[t];
  }
  for (const n of graph.nodes) {
    nodes[n.id] = pushSeries(neSet.has(n.id), neighSet.has(n.id));
  }

  const overall = overallAcc.map((v) => (flowCount ? v / flowCount : 0.999));
  return { steps: TIMESTEPS, overall, edges, nodes, faultStart, faultEnd, threshold: ANOMALY_THRESHOLD };
}

/**
 * 构造「仅总体微跌、网元全绿」的 KPI(用户侧异常场景 D):
 * overall 在故障窗内温和下跌 dip,nodes/edges 保持基线 —— 网络本体健康,信号却模糊。
 */
export function buildMildOverallKpi(
  graph: NetworkGraph,
  faultStart: number,
  faultDuration: number,
  dip = 0.011,
): KpiBundle {
  const faultEnd = faultStart + faultDuration;
  const rng = mulberry32(((faultStart * 97 + dip * 1000) | 0) + 13);
  const edges: Record<string, number[]> = {};
  const nodes: Record<string, number[]> = {};
  for (const e of graph.flowEdges) edges[e.id] = healthySeries(rng);
  for (const n of graph.nodes) nodes[n.id] = healthySeries(rng);
  const edgeList = graph.flowEdges;
  const overall: number[] = [];
  for (let t = 1; t <= TIMESTEPS; t++) {
    let s = 0;
    for (const e of edgeList) s += edges[e.id][t - 1];
    let v = edgeList.length ? s / edgeList.length : 0.999;
    if (t >= faultStart && t < faultEnd) v = clamp(v - dip + (rng() - 0.5) * 0.002, 0.8, 0.999);
    overall.push(v);
  }
  return { steps: TIMESTEPS, overall, edges, nodes, faultStart, faultEnd, threshold: ANOMALY_THRESHOLD };
}

/**
 * UPF 微损型故障的传播 KPI(构造式 UPF 场景):
 *   根因 UPF_1 微损,异常向前端传导 —— AMF↔SMF 通信路径(及其 AMF/SMF 网元)
 *   普遍出现轻度劣化(均质化);UPF_1 为唯一离群点,UPF_2/UPF_3 保持健康。
 *   呈现「前端 AMF/SMF 均质化异常 + UPF_1 离群」的症状,供均质化比较定位。
 */
export function buildUpfFaultKpi(graph: NetworkGraph, fault: FaultSpec): KpiBundle {
  const root = fault.elements[0] ?? "UPF_1";
  const lossRate = fault.lossRate;
  const rng = mulberry32(((fault.faultStart * 97 + lossRate * 1000) | 0) + 23);
  const faultStart = fault.faultStart;
  const faultEnd = fault.faultStart + fault.faultDuration;
  const inWindow = (t: number) => t >= faultStart && t < faultEnd;

  type Tier = "root" | "ctrl" | "none";
  // 根因(UPF_1)微损最重;前端 AMF/SMF 为轻度传导表象(均质化)。
  const dropFor = (tier: Tier): number => {
    if (tier === "root") return clamp(lossRate + (rng() - 0.5) * 0.012, 0.02, 0.1);
    if (tier === "ctrl") return clamp(lossRate * 0.68 + (rng() - 0.5) * 0.01, 0.012, 0.06);
    return 0;
  };
  const series = (tier: Tier): number[] => {
    const s = healthySeries(rng);
    if (tier === "none") return s;
    for (let t = 1; t <= TIMESTEPS; t++) {
      if (!inWindow(t)) continue;
      s[t - 1] = clamp(1 - dropFor(tier), 0.8, 0.999);
    }
    return s;
  };

  const nodeTier = (id: string, type: NEType): Tier => {
    if (id === root) return "root";
    if (type === "AMF" || type === "SMF") return "ctrl";
    return "none";
  };
  const edgeTier = (a: NEType, b: NEType, aId: string, bId: string): Tier => {
    if (aId === root || bId === root) return "root"; // SMF↔UPF_1
    const types = new Set<NEType>([a, b]);
    if (types.has("AMF") && types.has("SMF")) return "ctrl"; // AMF↔SMF 前端路径
    return "none";
  };

  const edges: Record<string, number[]> = {};
  const nodes: Record<string, number[]> = {};
  const overallAcc = new Array(TIMESTEPS).fill(0);
  let flowCount = 0;
  for (const e of graph.flowEdges) {
    flowCount++;
    const s = series(edgeTier(e.types[0], e.types[1], e.a, e.b));
    edges[e.id] = s;
    for (let t = 0; t < TIMESTEPS; t++) overallAcc[t] += s[t];
  }
  for (const n of graph.nodes) nodes[n.id] = series(nodeTier(n.id, n.type));

  const overall = overallAcc.map((v) => (flowCount ? v / flowCount : 0.999));
  return { steps: TIMESTEPS, overall, edges, nodes, faultStart, faultEnd, threshold: ANOMALY_THRESHOLD };
}

/** 线性插值采样(允许浮点 t 实现平滑动画) */
export function sample(series: number[], t: number): number {
  if (series.length === 0) return 0.999;
  const i = clamp(Math.floor(t) - 1, 0, series.length - 1);
  const j = clamp(i + 1, 0, series.length - 1);
  const frac = clamp(t - 1 - i, 0, 1);
  return series[i] + (series[j] - series[i]) * frac;
}

/** 一个时序中"异常比例"(低于阈值的点占比) */
export function anomalyRatio(series: number[], threshold = ANOMALY_THRESHOLD): number {
  if (!series.length) return 0;
  return series.filter((v) => v < threshold).length / series.length;
}
