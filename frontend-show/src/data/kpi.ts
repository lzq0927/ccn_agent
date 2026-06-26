// ============================================================================
// KPI 时序生成器 —— 忠实复刻 simulator 的 success_rate 签名
//   基线 0.997~0.999(背景噪声);故障窗 [faultStart, faultStart+duration) 内
//   受影响实体按 lossRate 矩形下跌至 ~0.85~0.97;窗后恢复。
// ============================================================================

import { EDGES, NODES, affectedEntities } from "./network";
import type { FaultSpec } from "./types";

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

  const baseSr = () => clamp(1 - (0.0015 + rng() * 0.0015), 0.99, 0.9995);

  for (const e of EDGES) {
    if (e.kind !== "flow") continue;
    flowCount++;
    const aff = edgeSet.has(e.id);
    const s: number[] = [];
    for (let t = 1; t <= TIMESTEPS; t++) {
      if (aff && inWindow(t)) {
        const drop = clamp(fault.lossRate + (rng() - 0.5) * 0.02, 0.01, 0.15);
        s.push(clamp(1 - drop, 0.8, 0.999));
      } else {
        s.push(baseSr());
      }
    }
    edges[e.id] = s;
    for (let t = 0; t < TIMESTEPS; t++) overallAcc[t] += s[t];
  }

  for (const n of NODES) {
    const aff = neSet.has(n.id);
    const s: number[] = [];
    for (let t = 1; t <= TIMESTEPS; t++) {
      if (aff && inWindow(t)) {
        const drop = clamp(fault.lossRate + (rng() - 0.5) * 0.02, 0.01, 0.15);
        s.push(clamp(1 - drop, 0.8, 0.999));
      } else {
        s.push(baseSr());
      }
    }
    nodes[n.id] = s;
  }

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
