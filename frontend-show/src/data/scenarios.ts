// ============================================================================
// 演示场景 —— 取自/派生自真实 storage/cases 数据,数值忠实复刻系统区间
//   A 全域 gNB 链路故障 (WORKFLOW, SUCCESS)   —— 主英雄场景,默认自动播放
//   B AMF_3 单点故障      (GUIDED, PARTIAL)
//   C 用户面链路劣化      (EXPLORATION, FAILURE)
// ============================================================================

import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [
  // -------------------------------------------------------------------------
  // A — 无线接入网全域故障 (真实 case_001)
  // -------------------------------------------------------------------------
  {
    id: "A",
    cn: "无线接入网全域故障",
    en: "RAN-WIDE gNB LINK FAULT",
    tagline: "全部基站链路同步劣化 · 置信度极高 · 确定性工作流秒级定位",
    llmModel: "glm-4.6",
    routeIterations: 5,
    fault: {
      faultType: "all_type_ne",
      faultMode: "link",
      elements: ["gNB_1", "gNB_2", "gNB_3"],
      links: [],
      lossRate: 0.0582,
      faultStart: 26,
      faultDuration: 20,
      ueCount: 85,
      difficulty: "medium",
    },
    truth: { elements: ["gNB_1", "gNB_2", "gNB_3"], links: [] },
    predicted: { elements: ["gNB_1", "gNB_2", "gNB_3"], links: [] },
    confidence: {
      pattern: 1.0,
      severity: 0.725,
      temporal: 0.85,
      spatial: 0.9,
      ambiguity: 0.05,
      score: 0.8,
      route: "workflow",
      patternName: "all_type_ne (全域同类型)",
      matchedSkills: [],
      affectedNeCount: 3,
    },
    reasoning: [
      {
        n: 1,
        type: "tool_call",
        tool: "analyze_kpi_anomalies",
        args: "level=link, threshold=0.995",
        text: "扫描 link 层 KPI,阈值 0.995",
        result: "检出 9 条劣化链路,端点全部落在 gNB 实例",
        highlight: { nes: ["gNB_1", "gNB_2", "gNB_3"] },
      },
      {
        n: 2,
        type: "tool_call",
        tool: "find_common_ne",
        args: "degraded_pairs=9",
        text: "在劣化链路中统计公共网元",
        result: "主导网元类型:gNB(出现频次 100%,dominance=1.00)",
        highlight: { nes: ["gNB_1", "gNB_2", "gNB_3"] },
      },
      {
        n: 3,
        type: "tool_call",
        tool: "check_temporal_pattern",
        args: "ne=gNB_3",
        text: "分析 gNB_3 时序模式",
        result: "故障窗 t=26→46,突发 onset,窗后 sudden_recovery;pre/during/post=0.998/0.941/0.998",
      },
      {
        n: 4,
        type: "tool_call",
        tool: "check_ne_membership",
        args: "ne=[gNB_1,gNB_2,gNB_3]",
        text: "核对网元归属聚类",
        result: "聚类:单一类型(gNB),横跨 RP_DC1_1 / RP_DC1_2 两个资源池",
        highlight: { nes: ["gNB_1", "gNB_2", "gNB_3"] },
      },
      {
        n: 5,
        type: "conclusion",
        text: "判定:all_type_ne 链路模式故障,根因为全部 gNB;置信度 0.85,提交诊断。",
        result: "fault_elements=[gNB_1,gNB_2,gNB_3] · confidence=0.85",
        highlight: { nes: ["gNB_1", "gNB_2", "gNB_3"] },
      },
    ],
    evaluation: {
      precision: 1.0,
      recall: 1.0,
      f1: 1.0,
      exactMatch: true,
      faultTypeMatch: true,
      category: "SUCCESS",
      traceAxes: { logicalCoherence: 0.95, toolEfficiency: 0.92, evidenceQuality: 0.94, missedSignals: 0.12, overall: 0.93 },
      suggestions: [],
    },
  },

  // -------------------------------------------------------------------------
  // B — AMF_3 单点故障 (single_ne, GUIDED)
  // -------------------------------------------------------------------------
  {
    id: "B",
    cn: "接入门网元单点故障",
    en: "AMF_3 SINGLE-NE FAULT",
    tagline: "局部接入门异常 · 技能引导 Loop · 含一次过度归因(部分匹配)",
    llmModel: "glm-4.6",
    routeIterations: 8,
    fault: {
      faultType: "single_ne",
      faultMode: "link",
      elements: ["AMF_3"],
      links: [],
      lossRate: 0.062,
      faultStart: 30,
      faultDuration: 18,
      ueCount: 85,
      difficulty: "medium",
    },
    truth: { elements: ["AMF_3"], links: [] },
    predicted: { elements: ["AMF_3", "SMF_1"], links: [] },
    confidence: {
      pattern: 0.8,
      severity: 0.775,
      temporal: 0.8,
      spatial: 0.7,
      ambiguity: 0.15,
      score: 0.68,
      route: "guided",
      patternName: "single_ne_dominant",
      matchedSkills: ["single_ne_fault"],
      affectedNeCount: 1,
    },
    reasoning: [
      { n: 1, type: "thinking", text: "KPI 显示接入门方向异常,优先沿 UE→gNB→AMF 链路排查移动性网元。" },
      {
        n: 2,
        type: "tool_call",
        tool: "analyze_kpi_anomalies",
        args: "level=link+trace",
        text: "扫描 link 与 trace 层",
        result: "5 条劣化链路均以 AMF_3 为端点;trace 层经 AMF_3 的 UE 全部受影响",
        highlight: { nes: ["AMF_3"] },
      },
      {
        n: 3,
        type: "tool_call",
        tool: "find_common_ne",
        args: "",
        text: "统计公共网元",
        result: "AMF_3 主导度 0.92;SMF_1 间接命中系数 0.10",
        highlight: { nes: ["AMF_3", "SMF_1"] },
      },
      { n: 4, type: "tool_call", tool: "check_temporal_pattern", args: "ne=AMF_3", text: "AMF_3 时序", result: "故障窗 t=30→48,突发 onset" },
      { n: 5, type: "tool_call", tool: "check_ne_membership", args: "ne=AMF_3", text: "归属核对", result: "AMF_3 ∈ DC1 / RP_DC1_1,单一 NE", highlight: { nes: ["AMF_3"] } },
      { n: 6, type: "thinking", text: "匹配 Skill single_ne_fault,初判 AMF_3 单点故障。SMF_1 出现轻微劣化,需排除是否共因。" },
      { n: 7, type: "tool_call", tool: "isolate_fault_candidates", args: "", text: "候选排序", result: "AMF_3 排名 1(主因);SMF_1 间接命中,疑似受牵连", highlight: { nes: ["AMF_3", "SMF_1"] } },
      { n: 8, type: "conclusion", text: "采纳 AMF_3 为主根因;保守起见将间接命中的 SMF_1 一并列出。提交诊断。", result: "fault_elements=[AMF_3, SMF_1] · confidence=0.74", highlight: { nes: ["AMF_3", "SMF_1"] } },
    ],
    evaluation: {
      precision: 0.5,
      recall: 1.0,
      f1: 0.667,
      exactMatch: false,
      faultTypeMatch: true,
      category: "PARTIAL_SUCCESS",
      traceAxes: { logicalCoherence: 0.88, toolEfficiency: 0.82, evidenceQuality: 0.85, missedSignals: 0.28, overall: 0.82 },
      suggestions: [
        {
          type: "SKILL_UPDATE",
          target: "skills/core/single_ne_fault",
          content: "在 single_ne 诊断中引入「间接命中系数」阈值(默认 <0.15 视为牵连而非根因),避免将共址 SMF 误纳入 fault_elements。",
          priority: 0.72,
        },
        {
          type: "WORKFLOW_UPDATE",
          target: "link_fault_workflow.find_common_ne",
          content: "find_common_ne 之后增加二级确认步骤:剔除间接命中候选,再做 submit_diagnosis。",
          priority: 0.6,
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // C — 用户面链路劣化 (path_link, EXPLORATION, 近似失败)
  // -------------------------------------------------------------------------
  {
    id: "C",
    cn: "用户面链路微弱劣化",
    en: "SMF–UPF PATH-LINK DEGRADATION",
    tagline: "KPI 信号微弱 · CHR 失败集中 · 多算法探索融合 · 近似漏判触发难例回流",
    llmModel: "glm-4.6",
    routeIterations: 11,
    fault: {
      faultType: "path_link",
      faultMode: "link",
      elements: [],
      links: ["SMF_1->UPF_2", "SMF_1->UPF_1"],
      lossRate: 0.05,
      faultStart: 32,
      faultDuration: 16,
      ueCount: 85,
      difficulty: "hard",
    },
    truth: { elements: [], links: ["SMF_1->UPF_2", "SMF_1->UPF_1"] },
    predicted: { elements: [], links: ["SMF_1->UPF_2"] },
    confidence: {
      pattern: 0.4,
      severity: 0.625,
      temporal: 0.7,
      spatial: 0.45,
      ambiguity: 0.35,
      score: 0.42,
      route: "exploration",
      patternName: "path_level (微弱·模糊)",
      matchedSkills: ["exploration_mode", "path_link_fault"],
      affectedNeCount: 3,
    },
    reasoning: [
      { n: 1, type: "thinking", text: "KPI 总体仅跌至 0.987(低于阈值链路占比 <2%),但 CHR 显示 SMF↔UPF 段 5xx 失败高度集中 → 触发探索模式(exploration_trigger)。" },
      { n: 2, type: "tool_call", tool: "ewma_changepoint", args: "view=link_kpi, λ=0.3", text: "EWMA 控制图变点检测", result: "在 t=32 检测到均值下移(σ 超限)", highlight: { nes: ["SMF_1", "UPF_1", "UPF_2"] } },
      { n: 3, type: "tool_call", tool: "cusum_changepoint", args: "view=link_kpi", text: "CUSUM 均值漂移检测", result: "一致:t=32 处累计和越界", highlight: { nes: ["SMF_1", "UPF_1", "UPF_2"] } },
      { n: 4, type: "tool_call", tool: "correlated_failure_graph", args: "source=chr", text: "CHR 共现图谱", result: "最大连通团 SMF_1–{UPF_1,UPF_2},hub=SMF_1(hub share 0.78)", highlight: { nes: ["SMF_1", "UPF_1", "UPF_2"] } },
      { n: 5, type: "tool_call", tool: "bayesian_fusion", args: "", text: "多算法证据贝叶斯融合", result: "后验:SMF_1–UPF_2 = 0.81,SMF_1–UPF_1 = 0.44;agreement=2/3", highlight: { nes: ["SMF_1", "UPF_2"] } },
      { n: 6, type: "thinking", text: "消融分析:剔除任一检测器,首位候选不变(robust)。但次优候选 SMF_1–UPF_1 后验仅 0.44,低于保留阈值。" },
      { n: 7, type: "conclusion", text: "采纳后验最高的 SMF_1→UPF_2 为根因链路;次优项因后验不足未保留。提交诊断。", result: "fault_links=[SMF_1->UPF_2] · confidence=0.62", highlight: { nes: ["SMF_1", "UPF_2"] } },
    ],
    evaluation: {
      precision: 1.0,
      recall: 0.5,
      f1: 0.667,
      exactMatch: false,
      faultTypeMatch: false,
      category: "FAILURE",
      traceAxes: { logicalCoherence: 0.78, toolEfficiency: 0.7, evidenceQuality: 0.72, missedSignals: 0.52, overall: 0.68 },
      suggestions: [
        {
          type: "NEW_CASE",
          target: "agents/data_generation (hard_case_generator)",
          content: "新增 path_link / 用户面链路微弱劣化难例(lossRate<0.05、单链路),强化 EXPLORATION 模式对「次优后验」边界的训练。",
          priority: 0.85,
        },
        {
          type: "SKILL_UPDATE",
          target: "skills/exploration/bayesian_fusion",
          content: "融合输出对后验处于 [0.40, 0.60] 的次优候选改为「并列保留」,而非仅取最高项,降低近似漏判。",
          priority: 0.75,
        },
      ],
    },
  },
];

export const DEFAULT_SCENARIO_ID = "A";
export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
