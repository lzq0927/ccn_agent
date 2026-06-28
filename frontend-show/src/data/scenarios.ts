// ============================================================================
// 演示场景 —— 取自/派生自真实 storage/cases 数据,数值忠实复刻系统区间。
// 三个场景串成「确定性自愈 → 多维校验保用户 → 误报拦截自学习」递进故事,
// 分别落在置信度路由三档上,共同体现「用户级韧性 × 网络自治」两大主题。
//
//   A 网络中 AMF 异常 · 确定性工作流解决        (WORKFLOW,    SUCCESS, 网络自治)
//   B 网络异常+终端噪声 · 多维校验发现用户级 CHR (GUIDED,      SUCCESS, 用户级+自治)
//   C 网络正常+终端群体异常 · 误报拦截自学习     (EXPLORATION, SUCCESS, 用户级+自治+能力沉淀)
// ============================================================================

import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [
  // -------------------------------------------------------------------------
  // A — 网络中 AMF 异常 · 确定性工作流解决 (single_ne, WORKFLOW, SUCCESS)
  //     主英雄场景:高置信度 → 工作流直达根因,秒级自愈,无需 LLM 探索/学习。
  // -------------------------------------------------------------------------
  {
    id: "A",
    cn: "网络 AMF 异常·确定性自愈",
    en: "AMF FAULT · DETERMINISTIC WORKFLOW",
    tagline: "接入门 AMF_3 故障 · 置信度 0.74 · 工作流秒级定位 · 网络自治自愈",
    intro: "核心网接入门 AMF_3 发生链路故障,异常特征清晰、置信度高(>0.7)。系统走确定性工作流,无需 LLM 探索即可秒级定位根因并自愈——体现网络自治能力。",
    objective: "网络侧 AMF_3 异常 · 确定性工作流秒级定位并自愈",
    pillars: { userLevel: false, autonomy: true },
    comparison: {
      naive: { title: "仅网络聚合 KPI", verdict: "可定位·但依赖人工逐链路排查", detail: "总体 SR 跌至 0.937,人工沿 UE→gNB→AMF 排查,耗时且依赖经验", kind: "hit" },
      explored: { title: "确定性工作流", verdict: "秒级直达 AMF_3 根因", detail: "高置信度 → 工作流固定步骤直接锁定 AMF_3,无需多维探索" },
    },
    llmModel: "deterministic",
    routeIterations: 5,
    fault: {
      faultType: "single_ne",
      faultMode: "link",
      elements: ["AMF_3"],
      links: [],
      lossRate: 0.063,
      faultStart: 30,
      faultDuration: 18,
      ueCount: 85,
      difficulty: "medium",
    },
    truth: { elements: ["AMF_3"], links: [] },
    predicted: { elements: ["AMF_3"], links: [] },
    confidence: {
      pattern: 0.85,
      severity: 0.82,
      temporal: 0.9,
      spatial: 0.75,
      ambiguity: 0.08,
      score: 0.74,
      route: "workflow",
      patternName: "single_ne_dominant",
      matchedSkills: ["single_ne_fault"],
      affectedNeCount: 1,
    },
    reasoning: [
      { n: 1, type: "tool_call", tool: "analyze_kpi_anomalies", args: "level=link, threshold=0.995", text: "工作流①:扫描 link 层 KPI", result: "检出 5 条劣化链路,端点全部为 AMF_3", highlight: { nes: ["AMF_3"] } },
      { n: 2, type: "tool_call", tool: "find_common_ne", args: "degraded_pairs=5", text: "工作流②:统计公共网元", result: "主导网元 AMF_3(dominance=0.96)", highlight: { nes: ["AMF_3"] } },
      { n: 3, type: "tool_call", tool: "check_temporal_pattern", args: "ne=AMF_3", text: "工作流③:时序模式核对", result: "故障窗 T30→48,突发 onset,窗后 sudden_recovery" },
      { n: 4, type: "tool_call", tool: "check_ne_membership", args: "ne=AMF_3", text: "工作流④:归属聚类核对", result: "AMF_3 ∈ DC1 / RP_DC1_1,单一 NE", highlight: { nes: ["AMF_3"] } },
      { n: 5, type: "conclusion", text: "工作流⑤:判定 AMF_3 单点链路故障,置信度 0.74,提交诊断(无 LLM 推理)。", result: "fault_elements=[AMF_3] · route=WORKFLOW", highlight: { nes: ["AMF_3"] } },
    ],
    evaluation: {
      precision: 1.0,
      recall: 1.0,
      f1: 1.0,
      exactMatch: true,
      faultTypeMatch: true,
      category: "SUCCESS",
      traceAxes: { logicalCoherence: 0.95, toolEfficiency: 0.94, evidenceQuality: 0.93, missedSignals: 0.1, overall: 0.94 },
      suggestions: [],
    },
  },

  // -------------------------------------------------------------------------
  // B — 网络异常 + 少量终端异常 · 多维校验发现用户级 CHR (GUIDED, SUCCESS)
  //     网络 KPI 仅微损 + 终端噪声叠加;多维校验发现用户级 CHR 集中,排除终端
  //     共性后精准锁定网络根因。体现「用户级韧性」:用用户级信号保护用户体验。
  // -------------------------------------------------------------------------
  {
    id: "B",
    cn: "网络微损·多维校验保用户",
    en: "FAINT NET FAULT · MULTI-DIM CHR",
    tagline: "SMF_1 链路微劣化 + 终端噪声 · 网络KPI微损 · CHR 集中暴露用户级根因",
    intro: "网络侧 SMF_1 链路微弱劣化,叠加少量终端偶发失败,网络总体 KPI 仅微损、信号模糊。Agent 通过 link+trace+CHR 多维数据校验,发现用户级会话建立 5xx 集中,排除终端共性后精准锁定网络根因——用户级韧性。",
    objective: "终端噪声叠加·网络KPI微损,多维校验发现用户级CHR,排除终端后精准定位网络根因",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: { title: "仅网络聚合 KPI", verdict: "信号微弱·受终端噪声干扰", detail: "总体 SR 仅跌至 0.987,难以区分网络故障与终端偶发,易漏判", kind: "miss" },
      explored: { title: "多维校验(link+trace+CHR)", verdict: "锁定网络根因 SMF_1", detail: "CHR 会话建立 5xx 集中 + 终端失败无共性 → 排除终端,确认网络侧" },
    },
    chrInsight: {
      nes: ["SMF_1"],
      causeCode: "5xx · cause=insufficient_resource",
      causeCn: "会话建立失败·资源不足",
      detail: "CHR 显示经 SMF_1 的 PDU 会话建立请求集中返回 5xx,与网络会话管理路径强相关,而非终端随机失败",
    },
    skillEvolution: {
      kind: "UPDATE",
      skillId: "skills/core/multi_dim_validation",
      skillCn: "多维数据校验",
      insight: "终端噪声叠加、网络 KPI 微损时,用 CHR 用户级信号 + 终端共性排除来确认网络根因,避免漏判",
      before: "仅依赖网络 KPI 聚合,微弱信号下易漏判",
      after: "link+trace+CHR 多维校验 + 终端共性排除阈值",
      nextHitRate: 0.92,
    },
    llmModel: "glm-4.6",
    routeIterations: 8,
    fault: {
      faultType: "single_ne",
      faultMode: "link",
      elements: ["SMF_1"],
      links: [],
      lossRate: 0.05,
      faultStart: 32,
      faultDuration: 16,
      ueCount: 85,
      difficulty: "medium",
    },
    truth: { elements: ["SMF_1"], links: [] },
    predicted: { elements: ["SMF_1"], links: [] },
    confidence: {
      pattern: 0.6,
      severity: 0.625,
      temporal: 0.75,
      spatial: 0.55,
      ambiguity: 0.25,
      score: 0.54,
      route: "guided",
      patternName: "single_ne_dominant (终端噪声叠加)",
      matchedSkills: ["single_ne_fault", "multi_dim_validation"],
      affectedNeCount: 1,
    },
    reasoning: [
      { n: 1, type: "thinking", text: "网络 KPI 仅微跌至 0.987,叠加少量终端偶发失败;信号模糊,需多维校验,避免误判或漏判。" },
      { n: 2, type: "tool_call", tool: "analyze_kpi_anomalies", args: "level=link+trace+session", text: "多维扫描 link/trace/session", result: "网络侧 SMF_1 方向成功率微降;终端失败零星、随机分布", highlight: { nes: ["SMF_1"] } },
      { n: 3, type: "tool_call", tool: "cross_layer_validate", args: "source=chr, view=session", text: "CHR 用户级跨层校验", result: "经 SMF_1 的 PDU 会话建立请求集中返回 5xx(cause=insufficient_resource)", highlight: { nes: ["SMF_1"] } },
      { n: 4, type: "tool_call", tool: "exclude_terminal_cause", args: "ue_failures=scatter", text: "排除终端共性根因", result: "终端失败无共性时段/区域,排除终端根因;5xx 集中在网络会话路径" },
      { n: 5, type: "tool_call", tool: "check_temporal_pattern", args: "ne=SMF_1", text: "SMF_1 时序模式", result: "故障窗 T32→48,与 CHR 5xx 集中时段对齐", highlight: { nes: ["SMF_1"] } },
      { n: 6, type: "conclusion", text: "排除终端噪声后,CHR 用户级 5xx 集中指向网络侧;锁定 SMF_1 链路微弱劣化为根因。", result: "fault_elements=[SMF_1] · confidence=0.62 · route=GUIDED", highlight: { nes: ["SMF_1"] } },
    ],
    evaluation: {
      precision: 1.0,
      recall: 1.0,
      f1: 1.0,
      exactMatch: true,
      faultTypeMatch: true,
      category: "SUCCESS",
      traceAxes: { logicalCoherence: 0.91, toolEfficiency: 0.86, evidenceQuality: 0.9, missedSignals: 0.16, overall: 0.9 },
      suggestions: [
        { type: "SKILL_UPDATE", target: "skills/core/multi_dim_validation", content: "终端噪声叠加、网络 KPI 微损场景:引入 CHR 用户级信号 + 终端共性排除阈值,降低微弱信号下的漏判。", priority: 0.78 },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // C — 网络正常 + 终端群体异常 · 误报拦截自学习 (EXPLORATION, SUCCESS)
  //     高潮场景:网络本体健康,仅 gNB_2 范围终端群体异常致 KPI 微损。朴素网络
  //     视角会误报 AMF;置信度拦截 → 多维探索识别为用户侧 → 网络主动通知用户
  //     重选路 → 沉淀新 Skill,下次准确识别。体现「网络自治 + 能力沉淀」。
  // -------------------------------------------------------------------------
  {
    id: "C",
    cn: "网络正常·终端群体误报拦截",
    en: "FALSE-ALARM INTERCEPT · USER-LEVEL",
    tagline: "网络健康 · gNB_2 终端群体异常致KPI微损 · 信心拦截AMF误报 · 沉淀Skill",
    intro: "网络本体完全正常,gNB_2 覆盖范围的终端群体异常导致总体 KPI 微损。仅看网络聚合 KPI 会误报接入门 AMF;置信度评估因信号模糊拦截快速归因,触发多维探索,识别为 gNB_2 用户侧异常(非网络),网络主动通知受影响用户重选路,并沉淀新 Skill 供下次准确识别。",
    objective: "网络正常·终端群体异常致KPI微损,置信度拦截AMF误报,多维探索识别gNB_2用户侧,网络主动通知用户重选路",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: { title: "仅网络聚合 KPI", verdict: "误报 AMF_3 网络根因", detail: "AMF 侧会话失败略升 → 朴素归因接入门;忽视失败的用户侧分布", kind: "falsealarm" },
      explored: { title: "多维探索(KPI+CHR+UE图谱)", verdict: "识别 gNB_2 终端群体·网络无责", detail: "CHR/UE 共因集中于 gNB_2 接入群,核心网 NE 时序正常 → 排除网络根因" },
    },
    falseAlarm: {
      naiveNe: "AMF_3",
      naiveCn: "误报 AMF_3 为网络根因",
      reason: "仅看网络聚合 KPI:AMF 侧会话失败略升,朴素快速归因易指向接入门 AMF_3",
    },
    userFault: {
      gnbs: ["gNB_2"],
      affectedUe: 23,
      kind: "终端群体接入异常",
    },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/terminal_group_not_network",
      skillCn: "终端群体异常·非网络根因",
      insight: "网络 KPI 微损 + AMF 侧失败略升时,先用 CHR/UE 共因图谱排除网络根因,再归因用户侧,避免误报接入门",
      after: "新增 terminal_group_not_network skill:置信度拦截后优先多维探索,识别终端群体异常并主动服务用户",
      nextHitRate: 0.95,
    },
    llmModel: "glm-4.6",
    routeIterations: 11,
    fault: {
      faultType: "terminal_group",
      faultMode: "link",
      elements: ["gNB_2"],
      links: [],
      lossRate: 0.038,
      faultStart: 34,
      faultDuration: 14,
      ueCount: 85,
      difficulty: "hard",
    },
    truth: { elements: ["gNB_2"], links: [] },
    predicted: { elements: ["gNB_2"], links: [] },
    confidence: {
      pattern: 0.45,
      severity: 0.5,
      temporal: 0.7,
      spatial: 0.5,
      ambiguity: 0.4,
      score: 0.42,
      route: "exploration",
      patternName: "user_level (终端群体·网络模糊)",
      matchedSkills: ["exploration_mode", "terminal_group_not_network"],
      affectedNeCount: 1,
    },
    reasoning: [
      { n: 1, type: "thinking", text: "网络聚合 KPI 微损,AMF 侧失败略升——朴素视角易归因 AMF;但信号模糊,置信度拦截快速归因,触发多维探索。" },
      { n: 2, type: "tool_call", tool: "analyze_kpi_anomalies", args: "level=all, threshold=0.995", text: "全层 KPI 扫描", result: "网络 KPI 微损;AMF 方向失败略升,但无核心网单点明显劣化", highlight: { nes: ["AMF_3"] } },
      { n: 3, type: "tool_call", tool: "cross_layer_validate", args: "source=chr", text: "CHR 用户级跨层校验", result: "失败集中分布于 gNB_2 覆盖的终端群,非核心网会话路径" },
      { n: 4, type: "tool_call", tool: "correlated_failure_graph", args: "source=ue", text: "UE 共因图谱", result: "最大连通团 = gNB_2 接入的 23 个 UE(hub=gNB_2),核心网 NE 无共因", highlight: { nes: ["gNB_2"] } },
      { n: 5, type: "tool_call", tool: "exclude_network_cause", args: "nes=AMF,SMF,UPF", text: "排除网络根因", result: "AMF/SMF/UPF 时序正常、无劣化,排除网络侧故障" },
      { n: 6, type: "thinking", text: "判定为 gNB_2 范围终端群体接入异常(非网络故障);网络本体健康,无需隔离任何网元。" },
      { n: 7, type: "conclusion", text: "网络正常,根因为 gNB_2 终端群体异常;建议网络主动通知受影响用户重选/切换邻区。沉淀 Skill 供下次准确识别。", result: "fault_elements=[gNB_2] · confidence=0.58 · route=EXPLORATION", highlight: { nes: ["gNB_2"] } },
    ],
    evaluation: {
      precision: 1.0,
      recall: 1.0,
      f1: 1.0,
      exactMatch: true,
      faultTypeMatch: true,
      category: "SUCCESS",
      traceAxes: { logicalCoherence: 0.9, toolEfficiency: 0.84, evidenceQuality: 0.88, missedSignals: 0.18, overall: 0.89 },
      suggestions: [
        { type: "NEW_CASE", target: "agents/data_generation (hard_case_generator)", content: "新增「网络正常+终端群体异常致KPI微损」难例,强化 EXPLORATION 对用户级根因与网络误报的区分训练。", priority: 0.85 },
        { type: "SKILL_UPDATE", target: "skills/learned/terminal_group_not_network", content: "新增 terminal_group_not_network skill:网络 KPI 微损+AMF 失败略升时,先用 CHR/UE 共因图谱排除网络根因,再归因用户侧。", priority: 0.8 },
      ],
    },
  },
];

export const DEFAULT_SCENARIO_ID = "A";
export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
