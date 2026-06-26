// ============================================================================
// 故事板类型 —— director 在每个时钟帧产出的派生状态,驱动所有视图
// ============================================================================

import type { ConfidenceBreakdown, EvalMetrics, ReasonStep, RouteKey } from "../data/types";
import type { PhaseDef } from "../theme";

export interface RecoveryAction {
  id: string;
  cn: string;
  en: string;
}

export interface GenerationCheck {
  key: string;
  cn: string;
  en: string;
  passed: boolean;
}

export interface StoryState {
  phaseIndex: number;
  phase: PhaseDef;
  phaseProgress: number; // 当前阶段内进度 0..1
  globalProgress: number; // 整轮进度 0..1
  simT: number; // 仿真时间戳 1..60(驱动 KPI 着色)
  loop: number; // 第几轮循环

  // —— 数字孪生 ——
  twinMode: "healthy" | "building" | "anomaly" | "diagnosing" | "recovering" | "healed";
  showAnomaly: boolean; // 显示异常脉冲
  affectedNe: string[]; // 当前高亮的受影响 NE(随推理展开)
  rootCause: { nes: string[]; links: string[] }; // 最终根因(结论后)
  recoveryActive: boolean;
  recoveryActions: RecoveryAction[]; // 已揭示的恢复动作
  rerouteEdges: string[]; // 重路由高亮边
  cordonedNe: string[]; // 隔离的 NE

  // —— 大脑 ——
  activeAgent: 0 | 1 | 2 | 3; // 0 闲 / 1 生成 / 2 感知 / 3 评估
  route: RouteKey | null;

  // —— 面板数据 ——
  confidence: ConfidenceBreakdown | null;
  confidenceReveal: number; // 0..1
  reasoningSteps: ReasonStep[]; // 已揭示的推理步
  reasoningTotal: number;
  evalRevealed: boolean;
  evalMetrics: EvalMetrics | null;
  generationChecks: GenerationCheck[];
  generationChecksReveal: number;

  headline: string; // 顶部大字叙事
  subline: string; // 副标题
}
