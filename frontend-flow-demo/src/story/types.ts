// ============================================================================
// 故事板类型 —— director 在每个时钟帧产出的派生状态，驱动所有视图
// ============================================================================

import type { ChrInsight, ConfidenceBreakdown, EvalMetrics, FlowControl, HomogenResult, IsolationNote, ReasonStep, RecoveryPlan, RouteKey, UfdrReport, UserFault } from "../data/types";
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
  scenarioId: string; // 场景标识(A/B/C/D/E)—— 供视图按场景分支
  phaseIndex: number;
  phase: PhaseDef;
  phaseProgress: number; // 当前阶段内进度 0..1
  globalProgress: number; // 整轮进度 0..1
  simT: number; // 仿真时间戳 1..60(驱动 KPI 着色)
  loop: number; // 第几轮循环
  round: 1 | 2; // Agent2 执行轮次(E 两轮:首轮 back-off 未收敛 / 二轮 NSSAI+APN 收敛)
  loopBackKind: "loop1" | "loop2" | null; // 评估/恢复未通过回 Agent1 的回路:B/C=loop①(⑤评估未通过,A2→A1)/ E=loop②(经 Agent3,A3→A1)

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

  /** 当前相位激活的算法标签(过程中标注:异常检测/CHR聚类/故障聚合/根因定位…) */
  algorithms: { cn: string; en: string }[];

  // —— 流控溯源(场景 D/E)——
  cpuOverloadNe: string[]; // CPU 过载标注 NE(phase≥2,iot_storm 时为 AMF/SMF)
  ufdrPopup: UfdrReport | null; // UPF UFDR 溯源报表(phase 4)
  flowControlPopup: FlowControl | null; // 流控策略(phase 5)
  recoveryPlan?: RecoveryPlan | null; // 三层并行恢复计划(场景 F,phase 4-5)

  // —— SIM 实时仿真专属(DEMO 模式 undefined)——
  simNeCpu?: Record<string, number>; // 全网 NE CPU%(SIM 模式)
  simRates?: { amfCpu: number; smfCpu: number; regRate: number; iotRegRate: number; sessionRate: number; twoCThrottle: number };
  /** LIVE 真实仿真快照(后端 kpi_snapshot;DEMO 模式 undefined) */
  liveKpi?: {
    amfSuccessRate: number; smfSuccessRate: number;
    amfRegRequests: number; smfPduRequests: number;
    iotRegRate: number; tocRegRate: number; iotSessRate: number; tocSessRate: number;
    amfCpu: number; smfCpu: number;
    linkAnomalies: { src: string; dst: string; successRate: number }[];
  };
  amfSrHist?: number[]; // LIVE AMF 注册成功率滚动历史(sparkline)
  smfSrHist?: number[]; // LIVE SMF PDU 成功率滚动历史

  // —— 用户级韧性 × 网络自治 · 扩展派生态(确定性，随相位揭示)——
  currentStep: ReasonStep | null; // 当前执行中的推理步(最后揭示的一步)
  comparisonReveal: number; // 拓扑下对比区揭示度 0..1
  chrPopup: ChrInsight | null; // 用户级 CHR 原因值弹窗(场景 B)
  homogenPopup: HomogenResult | null; // 均质化比较结果弹窗(场景 A/D,phase 4)
  isolationPopup: IsolationNote | null; // 隔离标注弹窗(场景 A/B/D,phase 5)
  falseAlarmActive: boolean; // 朴素误报标记可见(场景 C,phase 2-4)
  falseAlarmIntercepted: boolean; // 误报已被置信度拦截/划掉(phase≥3)
  userLevel: UserFault | null; // 用户侧群体异常(场景 C)
  userLevelActive: boolean; // 是否渲染用户级异常标记
  skillReveal: number; // 能力沉淀揭示度 0..1(phase 7)
}
