// ============================================================================
// 方案层静态数据 —— 「准备阶段」规划文案 + 故障感知 6 步流水线 + 探索回环描述
//   这些是「方案讲解」的表示层数据,不进 Scenario 数据契约(后者由 scenarios/constructed 驱动)。
//   PerceptionFlow / PrepBand 据此渲染;探索迭代数差异体现三场景路由深度。
// ============================================================================

import type { RouteKey } from "./types";

/** 三 Agent 的准备阶段规划文案 */
export interface PrepPlan {
  agent: string; // "A1" / "A2" / "A3"
  cn: string;
  en: string;
  detail: string;
  color: string;
}

export const PREP_PLANS: PrepPlan[] = [
  {
    agent: "A1",
    cn: "数据采集规划",
    en: "DATA COLLECTION",
    detail: "规划采集目标 · KPI 逐链路成功率时序 · CHR 原因值分布 · 3GPP 信令日志",
    color: "#38bdf8",
  },
  {
    agent: "A2",
    cn: "任务规划 + Skill 注册",
    en: "PERCEPTION · 6 TASKS",
    detail: "规划 6 步诊断任务 · 注册 6 类 Skill · 探索式 Agent Loop 待命",
    color: "#a78bfa",
  },
  {
    agent: "A3",
    cn: "评估优化规划",
    en: "EVALUATION",
    detail: "规划评估维度 · 精确匹配 P/R/F1 · 推理链质量 · 优化建议产出",
    color: "#2dd4bf",
  },
];

/** 故障感知 6 步流水线 + 每步注册的 Skill */
export interface PipelineStep {
  n: number; // 1..6
  cn: string;
  en: string;
  icon: string;
  skill: { id: string; cn: string };
}

export const PIPELINE: PipelineStep[] = [
  { n: 1, cn: "数据预处理", en: "DATA PREP", icon: "🔧", skill: { id: "telemetry_aggregation", cn: "遥测聚合归一" } },
  { n: 2, cn: "拓扑分析", en: "TOPOLOGY", icon: "🗺", skill: { id: "topology_modeling", cn: "拓扑·业务流建模" } },
  { n: 3, cn: "异常检测", en: "ANOMALY", icon: "🔍", skill: { id: "anomaly_detection", cn: "iFFusion 融合检测" } },
  { n: 4, cn: "根因定位", en: "ROOT CAUSE", icon: "🎯", skill: { id: "root_cause", cn: "故障聚合·均质化" } },
  { n: 5, cn: "输出评估", en: "EVALUATION", icon: "📊", skill: { id: "trace_quality", cn: "推理链质析" } },
  { n: 6, cn: "恢复策略", en: "RECOVERY", icon: "🛡", skill: { id: "recovery_orchestration", cn: "恢复编排" } },
];

/** 置信度门 —— 决策节点(非编号步) */
export interface GateInfo {
  cn: string;
  en: string;
}

export const GATE: GateInfo = { cn: "策略匹配", en: "POLICY MATCH" };

/** 探索回环的一轮迭代 —— B/C 场景逐轮揭示「采什么数据 · 用什么方法 · 是否收敛」 */
export interface ExplorationIter {
  round: number;
  data: string; // 采集什么数据
  method: string; // 用什么方法
  result: string; // 结果
  converged: boolean;
}

export interface ExplorationSpec {
  /** 置信度门处显示的判定结论 */
  gateScore: number;
  route: RouteKey;
  gateVerdict: string;
  /** 探索迭代:A=[] 直达、B=1 轮、C=2 轮 */
  iterations: ExplorationIter[];
}

/** 三场景的探索回环规格(与 scenarios.ts 的路由深度一致) */
export const EXPLORATION: Record<string, ExplorationSpec> = {
  A: {
    gateScore: 0.76,
    route: "workflow",
    gateVerdict: "置信度 0.76 > 0.7 · 确定性工作流 · 直达根因",
    iterations: [],
  },
  B: {
    gateScore: 0.55,
    route: "guided",
    gateVerdict: "置信度 0.55 · 技能引导 · 探索 1 轮收敛",
    iterations: [
      {
        round: 1,
        data: "拉取终端原因值的持续 / 周期性 CHR 历史",
        method: "CHR 降噪 · 剔除长期基线既有噪声",
        result: "网络侧 5GSM#37 突变收敛 → 锁定 SMF_1",
        converged: true,
      },
    ],
  },
  C: {
    gateScore: 0.28,
    route: "autonomous",
    gateVerdict: "置信度 0.28 · 信号模糊 · 自主探索多轮收敛",
    iterations: [
      {
        round: 1,
        data: "CHR 原因值分布(整体)",
        method: "CHR 降噪去散点 + 共因聚类",
        result: "原因值仍分散 · 无网络共因 · 未收敛",
        converged: false,
      },
      {
        round: 2,
        data: "按终端类型分群的用户数据",
        method: "换角度 · 用户分群追踪",
        result: "gNB_2 物联终端群体 52% 失败 · 收敛",
        converged: true,
      },
    ],
  },
  F: {
    gateScore: 0.32,
    route: "autonomous",
    gateVerdict: "置信度 0.32 · 信号模糊 · 3 策略并行 · 2 轮收敛",
    iterations: [
      {
        round: 1,
        data: "容器 CPU + UFDR 溯源 + APN/终端类型分类",
        method: "分层接纳控制 · 3 策略并行下发(UE back-off + AMF NSSAI + SMF DNN)",
        result: "iPhone 不支持 back-off → 立即重试放大风暴 · 失败反升 · 未收敛",
        converged: false,
      },
      {
        round: 2,
        data: "终端类型分群(确认仅 iPhone 不支持 back-off)",
        method: "终端类型感知调整 · 对 iPhone 不下发 back-off + AMF/SMF 限流微调",
        result: "iPhone 由 AMF NSSAI 直接拦截 · 失败陡降 87% · 收敛",
        converged: true,
      },
    ],
  },
};

/** 缺省(A 场景直达) */
export function getExploration(scenarioId: string): ExplorationSpec {
  return EXPLORATION[scenarioId] ?? EXPLORATION.A;
}
