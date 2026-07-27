// ============================================================================
// 数据层共享类型 —— 与后端真实数据契约对齐
// ============================================================================

import type { KpiBundle } from "./kpi";
import type { NetworkGraph } from "./network";

export type NEType = "gNB" | "AMF" | "SMF" | "UPF" | "PCF" | "UDM" | "AUSF" | "NRF" | "NSSF";
export type Role = "master" | "standby" | "lb";

/** 拓扑中的网元实例 */
export interface NEInstance {
  id: string; // e.g. "AMF_3"
  type: NEType;
  role: Role;
  pool: string; // "RP_DC1_1"
  dc: string; // "DC1"
  layer: number; // 数据流分层(布局用)
  x: number;
  y: number;
}

/** 图边 */
export interface GraphEdge {
  id: string;
  a: string;
  b: string;
  kind: "flow" | "registry";
  weight: number;
  types: [NEType, NEType];
}

/** 故障规格(取自 metadata.json + result.txt) */
export interface FaultSpec {
  faultType: string; // single_ne | all_type_ne | path_link | multi_ne | ...
  faultMode: "link" | "business";
  elements: string[]; // 故障 NE id
  links: string[]; // 故障链路 "A->B"
  lossRate: number;
  faultStart: number; // 时间戳(仿真窗 1..60)
  faultDuration: number;
  ueCount: number;
  difficulty: string;
}

export type RouteKey = "workflow" | "guided" | "autonomous" | "exploration";

/** 置信度分解 —— 忠实于 confidence.py 的加权公式 */
export interface ConfidenceBreakdown {
  pattern: number; // 模式强度 ×0.40
  severity: number; // 异常严重度 ×0.20
  temporal: number; // 时间清晰度 ×0.15
  spatial: number; // 空间清晰度 ×0.15
  ambiguity: number; // 模糊度 ×(-0.10)
  score: number; // 最终 0..1
  route: RouteKey;
  patternName: string;
  matchedSkills: string[];
  affectedNeCount: number;
}

/** 推理链一步(对应 ReasoningStep) */
export interface ReasonStep {
  n: number;
  type: "thinking" | "tool_call" | "tool_result" | "conclusion";
  tool?: string;
  args?: string;
  text: string;
  result?: string;
  highlight?: { nes?: string[]; links?: string[] }; // 反向高亮拓扑元素
}

/** 评估指标(对应 EvaluationMetrics) */
export interface EvalMetrics {
  precision: number;
  recall: number;
  f1: number;
  exactMatch: boolean;
  faultTypeMatch: boolean;
  category: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILURE" | "FALSE_POSITIVE";
  traceAxes: {
    logicalCoherence: number;
    toolEfficiency: number;
    evidenceQuality: number;
    missedSignals: number;
    overall: number;
  };
  suggestions: Suggestion[];
}

export interface Suggestion {
  type: "SKILL_UPDATE" | "WORKFLOW_UPDATE" | "NEW_CASE";
  target: string;
  content: string;
  priority: number;
}

/** 对比区的一侧(朴素视角 vs 多维探索后) */
export interface ComparisonSide {
  title: string;
  verdict: string;
  detail: string;
  kind?: "miss" | "falsealarm" | "hit";
}

/** 用户级 CHR 洞察 —— 拓扑弹窗展示的原因值(场景 B/C/D) */
export interface ChrInsight {
  nes: string[];
  causeCode: string;
  causeCn: string;
  detail: string;
  /** 主导原因值占比(0-100)，用于原因值分布饼图;缺省则按伴随数量估算 */
  share?: number;
  /** 伴随的相关原因值(聚类旁证，场景 C/D) */
  related?: { code: string; cn: string; share?: number }[];
}

/** 误报拦截 —— 朴素网络视角会误判的根因(场景 C) */
export interface FalseAlarm {
  naiveNe: string;
  naiveCn: string;
  reason: string;
}

/** 用户侧异常(非网络故障)—— 终端群体异常等(场景 C) */
export interface UserFault {
  gnbs: string[];
  affectedUe: number;
  kind: string;
}

/** 能力沉淀 —— 探索后形成/优化的 Skill(场景 B/C) */
export interface SkillEvolution {
  kind: "NEW" | "UPDATE";
  skillId: string;
  skillCn: string;
  insight: string;
  before?: string;
  after: string;
  nextHitRate: number;
}

/** 均质化比较一轮(场景 A/D,phase 4 弹窗) */
export interface HomogenRound {
  type: string; // 比较对象，如 "AMF / SMF 通信路径" / "AMF-UDM 正常"
  principle?: string; // 本轮应用的推理原则
  instances: { id: string; anomalous: boolean }[];
  verdict: "exclude" | "normal" | "root"; // 共性→排除 / 正常→排除(旁证) / 离群→根因
  note: string;
}
/** 均质化比较结果(场景 A/D) */
export interface HomogenResult {
  anchorNe: string; // 弹窗锚定 NE(根因)
  rounds: HomogenRound[];
  principles: string[]; // 应用的推理原则/算法(故障传播/独立性验证/故障聚合…)
}
/** 隔离标注(场景 A/B/D,phase 5 弹窗) */
export interface IsolationNote {
  isolateNe: string; // 被隔离 NE
  failoverTo: string[]; // 流量切换目标
  summary: string;
}

/** UPF UFDR 溯源报表(场景 D/E,phase 4 定位弹窗) —— 流控溯源的关键证据 */
export interface UfdrReport {
  nes: string[]; // 锚定 NE(UPF)
  sstSurge: number; // Requested NSSAI 中 SST=3(MIoT) 注册请求突增占比(0-100)
  sstLabel: string;
  dnnSurge: number; // PDU 会话建立中物联 DNN/APN 突增占比(0-100)
  dnnLabel: string;
  summary: string;
}

/** 流控策略(场景 D/E,phase 5 恢复弹窗) —— 溯源后的处置 */
export interface FlowControl {
  kind: "ue_backoff" | "net_admission"; // D=UE 侧 back-off;E=网络侧限流
  anchorNe: string; // 锚定 NE(AMF / AMF+SMF)
  target: string; // 溯源对象描述
  measures: string[]; // 流控措施
  ratio?: { nssai: number; apn: number; algo: string; basis?: string }; // E: AMF NSSAI / SMF APN 限流比例 + 算法 + 计算依据
  converged: boolean; // 是否收敛
  summary: string;
}

/** 单个恢复策略(场景 F:UE/AMF/SMF 三层并行下发) */
export interface RecoveryStrategy {
  layer: "UE" | "AMF" | "SMF"; // 下发层
  cn: string;
  en: string;
  initialValue: number; // 首轮初始值(秒 / %)
  unit: "s" | "%"; // UE=back-off 秒;AMF/SMF=限流 %
  /** 工程控制论式公式(展示用字符串,如 "T = clamp(T0 + k·ΔCPU, 8, 30)") */
  formula: string;
  /** 公式变量表(供卡片渲染「变量 + 单位 + 边界」) */
  variables: {
    symbol: string; // 如 "T0"、"k"、"ΔCPU"
    meaning: string; // 中文含义
    unit: string; // "s" / "%" / "req/s" / "—"
    value: number | string; // 取值或表达式
    lo?: number; // clamp 下界
    hi?: number; // clamp 上界
  }[];
  explanation: string; // 一句话解释(为何这个值)
}

/** 一个 APN/DNN 的请求分布(场景 F 用户分类) */
export interface ApnItem {
  id: string; // APN/DNN 名,如 "iot-platform"
  cn: string;
  regShare: number; // 占注册请求 % (0-100)
  sessShare: number; // 占会话请求 % (0-100)
  anomalous: boolean; // 是否异常(风暴源)
}

/** 一种终端类型(场景 F 用户分类) */
export interface DeviceItem {
  id: string; // 如 "iphone"、"android"、"iot-cam"
  cn: string;
  share: number; // 占物联注册请求 % (0-100)
  supportsBackoff: boolean; // 是否支持 back-off timer(iPhone=false)
}

/** 用户分类弹窗(场景 F,phase 4 推理发现:单 APN 异常 + iPhone 不支持 back-off) */
export interface UserBreakdown {
  anchorNe: string; // 锚定 NE(UPF_1,与 UFDR 同)
  apns: ApnItem[]; // ~10 个 APN
  devices: DeviceItem[]; // ~6 种终端
  anomalousApn: string; // 异常 APN 的 id(物联平台)
  unsupportedDevice: string; // 不支持 back-off 的终端 id(iPhone)
  summary: string;
}

/** 两轮策略调整(场景 F 二轮相对首轮的差异) */
export interface RoundAdjustment {
  r1Note: string; // 首轮说明
  r2Note: string; // 二轮说明
  /** 二轮各层新值;首轮读 RecoveryStrategy.initialValue */
  r2Values: { layer: "UE" | "AMF" | "SMF"; value: number; note: string }[];
}

/** 场景 F 三层并行恢复计划(挂 Scenario.recoveryPlan) */
export interface RecoveryPlan {
  strategies: RecoveryStrategy[]; // 3 个:UE / AMF / SMF
  breakdown: UserBreakdown; // 用户分类(phase 4 揭示)
  rounds: RoundAdjustment; // 两轮调整
}

/** 风暴冲击指标(场景 D/E,phase 2 过载告警 + 突增 KPI) */
export interface StormMetrics {
  amfCpu: number; // AMF 容器 CPU%(0-100)
  smfCpu: number; // SMF 容器 CPU%(0-100)
  regSurge: number; // 注册请求突增%(相对基线)
  sessionSurge: number; // PDU 会话建立突增%(相对基线)
  impact2c: string; // 流控扩散对 2C 手机的影响描述
}

/** 大模型故障报告(场景 D/E,phase 7 评估总结) */
export interface FaultReport {
  rootCause: string; // 根因
  phenomenon: string; // 故障现象
  impact: string; // 影响范围
  action: string; // 处置动作
  outcome: string; // 结果与建议
}

/** 一个演示场景 */
export interface Scenario {
  id: string;
  cn: string;
  en: string;
  tagline: string;
  /** 场景简介(标签悬停/选中弹窗)。LIVE 场景可缺省。 */
  intro?: string;
  /** 一句话目标(始终可见的上下文) */
  objective?: string;
  /** 双主题点亮:用户级韧性 / 网络自治 */
  pillars?: { userLevel: boolean; autonomy: boolean };
  /** 拓扑下对比区数据(建议 2) */
  comparison?: { naive: ComparisonSide; explored: ComparisonSide };
  /** 拓扑 CHR 原因值弹窗(场景 B) */
  chrInsight?: ChrInsight;
  /** 误报拦截(场景 C) */
  falseAlarm?: FalseAlarm;
  /** 用户侧异常(场景 C)——存在时网络 NE 保持健康 */
  userFault?: UserFault;
  /** 能力沉淀 / 技能进化(场景 B/C) */
  skillEvolution?: SkillEvolution;
  /** 均质化比较结果(场景 A/D,phase 4 弹窗) */
  homogen?: HomogenResult;
  /** 隔离标注(场景 A/B/D,phase 5 弹窗) */
  isolation?: IsolationNote;
  /** UPF UFDR 溯源报表(场景 D/E,phase 4 定位弹窗) */
  ufdr?: UfdrReport;
  /** 流控策略(场景 D/E,phase 5 恢复弹窗) */
  flowControl?: FlowControl;
  /** 风暴冲击指标(场景 D/E,phase 2) */
  stormMetrics?: StormMetrics;
  /** 大模型故障报告(场景 D/E,phase 7) */
  faultReport?: FaultReport;
  /** 三层并行恢复计划(场景 F:3 策略 × 2 轮 + 用户分类) */
  recoveryPlan?: RecoveryPlan;
  fault: FaultSpec;
  truth: { elements: string[]; links: string[] };
  predicted: { elements: string[]; links: string[] };
  confidence: ConfidenceBreakdown;
  reasoning: ReasonStep[];
  evaluation: EvalMetrics;
  routeIterations: number;
  llmModel: string;
  /** 真实遥测时序(来自 data.csv 聚合，优先于 buildKpi 合成) */
  realKpi?: KpiBundle;
  /** 真实拓扑图(来自 topo.txt，优先于 DEMO_GRAPH) */
  realGraph?: NetworkGraph;
}
