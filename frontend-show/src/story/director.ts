// ============================================================================
// director —— 确定性故事导演。纯函数 direct(scenario, t, loop) → StoryState。
// 把时钟秒数映射到阶段、仿真时间戳与全部派生视图状态。
// ============================================================================

import { buildKpi, type KpiBundle } from "../data/kpi";
import { affectedEntities, recoveryReroute } from "../data/network";
import type { ChrInsight, ConfidenceBreakdown, EvalMetrics, ReasonStep, RouteKey, Scenario } from "../data/types";
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
    case "single_ne": {
      // 按实际故障 NE 动态生成(AMF_3 / SMF_1 / …)
      const ne = s.fault.elements[0] ?? "AMF_3";
      const type = ne.replace(/_\d+$/, "");
      return [
        { id: "isolate", cn: `隔离 ${ne}(摘除负载)`, en: `ISOLATE ${ne}` },
        { id: "failover", cn: `${type} Set 内健康实例接管会话`, en: `${type}-SET FAILOVER` },
        { id: "reattach", cn: "受影响 UE 重附着 / 重建会话", en: "UE REATTACH · REBUILD" },
      ];
    }
    case "path_link":
      return [
        { id: "reroute", cn: "SMF 将会话切换至备用 UPF_3", en: "SWITCH TO STANDBY UPF" },
        { id: "quarantine", cn: "隔离劣化链路 SMF_1–UPF_{1,2}", en: "QUARANTINE DEGRADED LINK" },
      ];
    case "terminal_group":
      // 网络无责 · 主动服务用户:通知重选路,不隔离任何网元
      return [
        { id: "notify", cn: "网络主动通知受影响 UE 重选 / 切换邻区", en: "NOTIFY UE RESELECTION" },
        { id: "guide", cn: "引导 gNB_2 流量至邻区健康 gNB", en: "GUIDE TO NEIGHBOR gNB" },
        { id: "restore", cn: "用户侧恢复 · 网络无需隔离网元", en: "USER-SIDE RESTORE" },
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

/** 场景化动作解说(覆盖关键相位,讲清「此刻在干什么」;LIVE 无条目则回落) */
const SCENARIO_SUB: Record<string, Record<number, string>> = {
  A: {
    2: "AMF_3 方向 KPI 跌破 0.995 · 异常特征清晰",
    3: "置信度 0.74 > 0.7 · 直达确定性工作流(不走 LLM)",
    4: "工作流固定 5 步 · 秒级锁定 AMF_3 · 网络自治",
    5: "隔离 AMF_3 · AMF Set 接管会话 · 自愈中",
  },
  B: {
    2: "网络 KPI 仅微损 0.987 · 叠加终端噪声 · 信号模糊",
    3: "置信度 0.54 · 技能引导 Loop · 触发多维校验",
    4: "多维校验:CHR 5xx 集中 + 排除终端共性 → 锁定 SMF_1",
    5: "隔离 SMF_1 · 会话重建 · 保护受影响用户体验",
  },
  C: {
    2: "网络 KPI 微损 · AMF 侧失败略升 · 朴素视角易误报 AMF",
    3: "置信度 0.42 · 信号模糊 · 拦截快速归因 · 触发多维探索",
    4: "多维探索:CHR/UE 共因集中于 gNB_2 · 排除网络根因",
    5: "网络无责 · 主动通知 gNB_2 用户重选路 · 用户侧恢复",
  },
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

  // —— 用户级韧性 × 网络自治 · 扩展派生态(随相位确定性揭示)——
  // 当前执行中的推理步(最后揭示的一步)
  const currentStep: ReasonStep | null = reasoningSteps.length ? reasoningSteps[reasoningSteps.length - 1] : null;

  // 对比区「多维探索后」揭示度:phase<4 → 0;phase4 easeOut;phase≥5 → 1
  // (「仅网络KPI」朴素侧在 phase≥2 即出现,由 ComparisonPanel 按 phaseIndex 处理)
  const comparisonReveal = phaseIndex < 4 ? 0 : phaseIndex === 4 ? easeOut(progress) : 1;

  // 用户级 CHR 原因值弹窗(场景 B):推理起至恢复前
  const chrPopup: ChrInsight | null = s.chrInsight && phaseIndex >= 4 && phaseIndex <= 6 ? s.chrInsight : null;

  // 误报拦截(场景 C):phase 2-4 可见,phase≥3 被置信度拦截/划掉
  const falseAlarmActive = !!s.falseAlarm && phaseIndex >= 2 && phaseIndex <= 4;
  const falseAlarmIntercepted = !!s.falseAlarm && phaseIndex >= 3;

  // 用户侧群体异常(场景 C):检测至恢复期间渲染,恢复后清除
  const userLevel = s.userFault ? { gnbs: s.userFault.gnbs, affectedUe: s.userFault.affectedUe, kind: s.userFault.kind } : null;
  const userLevelActive = !!s.userFault && phaseIndex >= 2 && phaseIndex <= 5;

  // 能力沉淀揭示(phase 7)
  const skillReveal = phaseIndex >= 7 ? easeOut(progress) : 0;

  const cap = HEADLINES[phaseIndex];
  const subline = SCENARIO_SUB[s.id]?.[phaseIndex] ?? cap.s;
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
    subline,
    currentStep,
    comparisonReveal,
    chrPopup,
    falseAlarmActive,
    falseAlarmIntercepted,
    userLevel,
    userLevelActive,
    skillReveal,
  };
}
