// ============================================================================
// director —— 确定性故事导演。纯函数 direct(scenario, t, loop) → StoryState。
// 把时钟秒数映射到阶段、仿真时间戳与全部派生视图状态。
// ============================================================================

import { buildKpi, type KpiBundle } from "../data/kpi";
import { affectedEntities, recoveryReroute } from "../data/network";
import type { ConfidenceBreakdown, EvalMetrics, ReasonStep, RouteKey, Scenario } from "../data/types";
import { PHASES } from "../theme";
import type { GenerationCheck, RecoveryAction, StoryState } from "./types";

/** 8 阶段时长(秒) */
export const PHASE_DURATIONS = [3, 6, 6, 6, 13, 6, 4, 8];
export const LOOP_DURATION = PHASE_DURATIONS.reduce((a, b) => a + b, 0);

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export const GENERATION_CHECKS: GenerationCheck[] = [
  { key: "kpi_consistency", cn: "KPI 一致性", en: "KPI CONSISTENCY", passed: true },
  { key: "fault_manifestation", cn: "故障可观测性", en: "FAULT MANIFESTATION", passed: true },
  { key: "topology_coherence", cn: "拓扑一致性", en: "TOPOLOGY COHERENCE", passed: true },
  { key: "process_validity", cn: "流程有效性", en: "PROCESS VALIDITY", passed: true },
  { key: "label_correctity", cn: "标签正确性", en: "LABEL CORRECTNESS", passed: true },
];

/** 按故障类型给出(合成)恢复动作序列 */
function recoveryActionsFor(s: Scenario): RecoveryAction[] {
  switch (s.fault.faultType) {
    case "all_type_ne":
      return [
        { id: "isolate", cn: "隔离故障 gNB 集", en: "ISOLATE FAULTY gNB" },
        { id: "reselect", cn: "触发 UE 重选 / 邻区切换", en: "UE RESELECTION" },
        { id: "reroute", cn: "AMF 侧锚定,无线流量重路由", en: "RAN TRAFFIC REROUTE" },
      ];
    case "single_ne":
      return [
        { id: "isolate", cn: "隔离 AMF_3(摘除负载)", en: "ISOLATE AMF_3" },
        { id: "failover", cn: "AMF Set 内 AMF_1/AMF_2 接管会话", en: "AMF-SET FAILOVER" },
        { id: "reattach", cn: "受影响 UE 重附着至健康 AMF", en: "UE REATTACH" },
      ];
    case "path_link":
      return [
        { id: "reroute", cn: "SMF 将会话切换至备用 UPF_3", en: "SWITCH TO STANDBY UPF" },
        { id: "quarantine", cn: "隔离劣化链路 SMF_1–UPF_{1,2}", en: "QUARANTINE DEGRADED LINK" },
      ];
    default:
      return [{ id: "reroute", cn: "流量重路由至健康路径", en: "TRAFFIC REROUTE" }];
  }
}

function cordonedFor(s: Scenario): string[] {
  if (s.fault.faultType === "all_type_ne") return s.fault.elements; // gNB_1/2/3
  if (s.fault.faultType === "single_ne") return s.fault.elements; // AMF_3
  return [];
}

interface PreparedScenario {
  kpi: KpiBundle;
  recoveryActions: RecoveryAction[];
  rerouteEdges: string[];
  cordoned: string[];
}

const prepCache = new Map<string, PreparedScenario>();
function prepare(s: Scenario): PreparedScenario {
  const cached = prepCache.get(s.id);
  if (cached) return cached;
  const p: PreparedScenario = {
    kpi: buildKpi(s.fault),
    recoveryActions: recoveryActionsFor(s),
    rerouteEdges: recoveryReroute(s.fault),
    cordoned: cordonedFor(s),
  };
  prepCache.set(s.id, p);
  return p;
}

export function getKpi(s: Scenario): KpiBundle {
  return prepare(s).kpi;
}

/** 计算阶段索引与阶段内进度 */
export function phaseAt(t: number): { index: number; progress: number } {
  let acc = 0;
  for (let i = 0; i < PHASE_DURATIONS.length; i++) {
    const d = PHASE_DURATIONS[i];
    if (t < acc + d || i === PHASE_DURATIONS.length - 1) {
      return { index: i, progress: clamp((t - acc) / d, 0, 1) };
    }
    acc += d;
  }
  return { index: PHASE_DURATIONS.length - 1, progress: 1 };
}

/** 仿真时间戳随阶段推进 */
function simTFor(s: Scenario, phaseIndex: number, p: number): number {
  const fs = s.fault.faultStart;
  const fe = s.fault.faultStart + s.fault.faultDuration;
  switch (phaseIndex) {
    case 0:
      return 6;
    case 1:
      return lerp(1, fs - 3, p);
    case 2:
      return lerp(fs - 2, fs + 2, p);
    case 3:
      return fs + 1;
    case 4:
      return fs + 2; // 异常在推理期间持续
    case 5:
      return lerp(fs + 2, fe + 2, p); // 恢复动作推进,越过故障窗
    case 6:
      return lerp(fe + 2, 58, p);
    default:
      return 58;
  }
}

const HEADLINES: Record<number, { h: string; s: string }> = {
  0: { h: "网络稳态运行", s: "高稳智能体待命 · 5GC 全网健康 · 成功率 99.8%" },
  1: { h: "数字孪生 · 数据生成", s: "Agent 1 仿真故障用例 · LLM 多维校验闭环" },
  2: { h: "异常检测", s: "KPI 跌破 0.995 · 链路级告警 · 触发故障感知" },
  3: { h: "置信度评估 · 路由决策", s: "特征提取 → 加权评分 → 三路径分流" },
  4: { h: "Agent 推理 · 根因定位", s: "Hermes Agent Loop · 工具自注册 · 推理链收敛" },
  5: { h: "执行恢复动作", s: "高稳智能体下发恢复策略 · 网络自愈中" },
  6: { h: "网络恢复正常", s: "成功率回升至 99.8% · 闭环验证通过" },
  7: { h: "评估优化 · 闭环反馈", s: "Agent 3 比对真值 · 推理链质析 · 优化建议回流" },
};

export function direct(s: Scenario, t: number, loop: number): StoryState {
  const { index: phaseIndex, progress } = phaseAt(t);
  const phase = PHASES[phaseIndex];
  const p = prepare(s);
  const { neSet } = affectedEntities(s.fault);
  const simT = clamp(simTFor(s, phaseIndex, progress), 1, 60);

  // 推理步揭示(阶段4)
  const total = s.reasoning.length;
  const revealedCount = phaseIndex < 4 ? 0 : phaseIndex === 4 ? Math.ceil(progress * total) : total;
  const reasoningSteps: ReasonStep[] = s.reasoning.slice(0, revealedCount);
  const conclusionRevealed = phaseIndex > 4 || (phaseIndex === 4 && revealedCount >= total);

  // 聚焦 NE:阶段2-3=检测到的受影响集;阶段4=已揭示步骤的高亮;阶段5=隔离集
  let affectedNe: string[] = [];
  if (phaseIndex === 2 || phaseIndex === 3) affectedNe = [...neSet];
  else if (phaseIndex === 4) {
    const set = new Set<string>();
    reasoningSteps.forEach((r) => r.highlight?.nes?.forEach((n) => set.add(n)));
    affectedNe = [...set];
  } else if (phaseIndex === 5) affectedNe = p.cordoned;

  // 置信度揭示(阶段3)
  const confidenceReveal = phaseIndex < 3 ? 0 : phaseIndex === 3 ? easeOut(progress) : 1;
  const confidence: ConfidenceBreakdown | null = confidenceReveal > 0 ? s.confidence : null;
  const route: RouteKey | null = phaseIndex >= 3 && phaseIndex <= 6 ? s.confidence.route : null;

  // 评估揭示(阶段7)
  const evalRevealed = phaseIndex >= 7;
  const evalMetrics: EvalMetrics | null = evalRevealed ? s.evaluation : null;

  // 生成校验揭示(阶段1)
  const generationChecksReveal = phaseIndex < 1 ? 0 : phaseIndex === 1 ? easeOut(progress) : 1;

  // 恢复动作揭示(阶段5)
  const recoveryActive = phaseIndex === 5 || phaseIndex === 6;
  let recoveryActions: RecoveryAction[] = [];
  let rerouteEdges: string[] = [];
  let cordonedNe: string[] = [];
  if (phaseIndex === 5) {
    const n = Math.ceil(progress * p.recoveryActions.length);
    recoveryActions = p.recoveryActions.slice(0, n);
    rerouteEdges = p.rerouteEdges;
    cordonedNe = p.cordoned;
  } else if (phaseIndex === 6) {
    recoveryActions = p.recoveryActions;
    rerouteEdges = p.rerouteEdges;
  }

  const twinMode: StoryState["twinMode"] =
    phaseIndex === 0
      ? "healthy"
      : phaseIndex === 1
        ? "building"
        : phaseIndex >= 2 && phaseIndex <= 4
          ? phaseIndex === 4
            ? "diagnosing"
            : "anomaly"
          : phaseIndex === 5
            ? "recovering"
            : "healed";

  const showAnomaly = phaseIndex >= 2 && phaseIndex <= 5;

  const activeAgent: 0 | 1 | 2 | 3 =
    phaseIndex === 1 ? 1 : phaseIndex >= 2 && phaseIndex <= 5 ? 2 : phaseIndex === 7 ? 3 : 0;

  const rootCause =
    conclusionRevealed || phaseIndex >= 5
      ? { nes: s.predicted.elements, links: s.predicted.links }
      : { nes: [], links: [] };

  const cap = HEADLINES[phaseIndex];
  return {
    phaseIndex,
    phase,
    phaseProgress: progress,
    globalProgress: clamp(t / LOOP_DURATION, 0, 1),
    simT,
    loop,
    twinMode,
    showAnomaly,
    affectedNe,
    rootCause,
    recoveryActive,
    recoveryActions,
    rerouteEdges,
    cordonedNe,
    activeAgent,
    route,
    confidence,
    confidenceReveal,
    reasoningSteps,
    reasoningTotal: total,
    evalRevealed,
    evalMetrics,
    generationChecks: GENERATION_CHECKS,
    generationChecksReveal,
    headline: cap.h,
    subline: cap.s,
  };
}
