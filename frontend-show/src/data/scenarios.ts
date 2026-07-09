// ============================================================================
// 演示场景 —— 三场景编排(路由分落三档:工作流 / 技能引导 / 自主探索)
//   A 核心网 UDM 异常 · 确定性工作流(均质化对比排除 SMF + 故障聚合)
//   B 核心网 SMF 异常 · 技能引导(多维校验排除终端 → 识别网络根因)
//   C 无线接入 gNB · 自主探索(CHR 聚类 + 用户分群追踪 → 物联终端群体异常)
// 三场景共用真实 case_101 拓扑(21 NE)+ 合成遥测 + 手写推理链。
// ============================================================================

import { type ScenarioNarrative } from "./real";
import { buildConstructedScenario, SPEC_A, SPEC_B, SPEC_C } from "./constructed";
import type { Scenario } from "./types";

// 每个场景的叙事层(数据全真或合成,文案据诊断结果定稿)
const NARRATIVES: Record<string, ScenarioNarrative> = {
  A: {
    cn: "核心网 UDM 异常·确定性工作流定位",
    en: "UDM FAULT · DETERMINISTIC WORKFLOW",
    tagline: "签约管理 UDM_1 故障 · 多网元(含多 SMF)异常表象 · 均质化对比+聚合秒级收敛",
    intro: "核心网 UDM_1 故障,多网元(含多个 SMF)现异常表象。均质化对比排除 SMF 共性异常,故障聚合定位 UDM_1 根因。",
    objective: "UDM_1 异常 · 均质化对比排除 SMF + 故障聚合定位",
    pillars: { userLevel: false, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "易误报 SMF 为根因",
        detail: "多 SMF 共性异常,朴素归因误指 SMF",
        kind: "falsealarm",
      },
      explored: {
        title: "确定性工作流(均质化+聚合)",
        verdict: "秒级锁定 UDM_1 根因",
        detail: "均质化对比排除 SMF + 聚合 → UDM_1",
      },
    },
  },
  B: {
    cn: "核心网 SMF 异常·多维校验识别网络根因",
    en: "SMF FAULT · MULTI-DIM VALIDATION",
    tagline: "会话管理 SMF_1 异常 · 网络微损+终端噪声 · CHR 多维校验排除终端 · 定位网络根因",
    intro: "网络 SMF_1 异常,叠加少量终端异常,KPI 仅微损。多维数据校验发现 CHR 用户级异常,排除终端原因后准确识别网络根因 SMF_1,实施恢复。",
    objective: "SMF_1 异常 · CHR 多维校验排除终端,识别网络根因",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "网络微损·难分网络/终端",
        detail: "KPI 微损叠加终端噪声,朴素方法难定根因",
        kind: "miss",
      },
      explored: {
        title: "多维数据校验(KPI+CHR)",
        verdict: "锁定网络侧 SMF_1",
        detail: "CHR 集中 + 排除终端原因 → SMF_1",
      },
    },
    chrInsight: {
      nes: ["SMF_1"],
      causeCode: "5GSM:37",
      causeCn: "PDU 会话建立失败",
      share: 64,
      detail: "SMF_1 会话建立失败集中于 5GSM#37,伴随少量终端侧干扰原因,已排除。",
      related: [
        { code: "5GMM:23", cn: "鉴权失败(终端侧)", share: 14 },
        { code: "5GMM:24", cn: "协议不兼容(终端侧)", share: 9 },
      ],
    },
    skillEvolution: {
      kind: "UPDATE",
      skillId: "skills/learned/chr_terminal_exclusion",
      skillCn: "CHR 多维校验 + 终端排除",
      insight: "CHR 原因值校验 + 终端干扰排除 → 识别网络根因",
      before: "网络微损叠加终端噪声,易漏判或误指终端",
      after: "新增终端排除步骤,网络/终端区分命中率达 0.93",
      nextHitRate: 0.93,
    },
  },
  C: {
    cn: "无线接入 gNB·物联终端群体异常自主定位",
    en: "gNB · IoT GROUP · AUTONOMOUS",
    tagline: "gNB 信号模糊·自主探索 CHR 聚类 + 用户分群追踪·定位物联终端群体异常·网络健康",
    intro: "总体 KPI 微跌、CHR 原因分散,网络无网元异常。自主探索经 CHR 聚类与用户分群追踪,发现 gNB_2 下物联终端群体失败率 38%,网络健康,下发用户侧恢复。",
    objective: "gNB 信号模糊·自主探索定位物联终端群体异常,网络无法隔离只能通知换路",
    pillars: { userLevel: true, autonomy: false },
    comparison: {
      naive: {
        title: "仅 KPI/CHR 聚合",
        verdict: "信号模糊·易误报 AMF",
        detail: "总体微跌、CHR 原因分散,朴素方法无法收敛,易误报 AMF_1",
        kind: "falsealarm",
      },
      explored: {
        title: "CHR 聚类 + 用户分群追踪",
        verdict: "定位物联终端群体异常",
        detail: "CHR 共因聚类 + 用户分群 → 物联终端群体 38% 失败",
      },
    },
    chrInsight: {
      nes: ["gNB_2"],
      causeCode: "5GSM:37",
      causeCn: "物联终端群体接入失败",
      share: 46,
      detail: "gNB_2 物联终端群体失败率 38%,集中涌现;主因接入受限,伴随多原因值,网络健康。",
      related: [
        { code: "5GMM:22", cn: "非接入层拥塞", share: 19 },
        { code: "5GSM:39", cn: "PDU 会话建立失败", share: 15 },
        { code: "5GMM:24", cn: "协议不兼容", share: 11 },
      ],
    },
    falseAlarm: {
      naiveNe: "AMF_1",
      naiveCn: "误报:AMF_1 接入故障",
      reason: "接入失败经 AMF 传导误判;CHR 共因集中于 gNB_2 物联终端,AMF_1 健康。",
    },
    userFault: { gnbs: ["gNB_2"], affectedUe: 1280, kind: "物联终端群体异常" },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/user_segment_tracking",
      skillCn: "用户分群追踪",
      insight: "CHR 聚类 + 用户分群 → 定位物联终端群体异常",
      after: "新增用户分群追踪 Skill,群体异常命中率达 0.91",
      nextHitRate: 0.91,
    },
  },
};

// 三场景:A(构造 UDM · 工作流)、B(构造 SMF · 技能引导)、C(构造 gNB 物联终端群体 · 自主探索)
export const SCENARIOS: Scenario[] = [
  buildConstructedScenario("A", NARRATIVES.A, SPEC_A),
  buildConstructedScenario("B", NARRATIVES.B, SPEC_B),
  buildConstructedScenario("C", NARRATIVES.C, SPEC_C),
];

export const DEFAULT_SCENARIO_ID = "A";

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
