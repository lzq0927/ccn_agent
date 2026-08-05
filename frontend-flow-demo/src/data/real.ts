// ============================================================================
// 场景叙事类型 —— DEMO 场景的文案 / 主题层(数据由 constructed.ts 构造)。
//   frontend-flow 不含 LIVE / real-cases 适配,仅保留 scenarios.ts 依赖的叙事类型。
// ============================================================================

import type {
  ChrInsight,
  ComparisonSide,
  FalseAlarm,
  FaultReport,
  FlowControl,
  HomogenResult,
  IsolationNote,
  RecoveryPlan,
  SkillEvolution,
  StormMetrics,
  UfdrReport,
  UserFault,
} from "./types";

/** 每个场景的叙事层(标题 / 故事 / 主题 + 用户级韧性 / 网络自治派生态) */
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
  /** 大模型故障报告(场景 D) */
  faultReport?: FaultReport;
  /** 三层并行恢复计划(场景 D) */
  recoveryPlan?: RecoveryPlan;
}
