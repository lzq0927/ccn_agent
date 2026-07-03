// ============================================================================
// 演示场景 —— 四场景编排
//   A 核心网 UDM 异常 · 确定性工作流(故障传播+聚合原则)定位     [构造:真实拓扑+合成]
//   B 无线接入 gNB_1 故障 · CHR 用户级定位 + 剥离终端干扰       [真实 case_101]
//   C 无线接入 gNB_2 故障 · CHR 聚类锁定终端群体共因            [真实 case_9001]
//   D 用户追踪 · KPI/CHR 模糊 → 用户分群发现物联终端群体异常    [构造:真实拓扑+合成]
// A/D:真实管线无对应可观测用例(UDM standby 不可观测 / 用户追踪为新概念),
//     故取真实拓扑文本 + 合成遥测 + 手写推理链。B/C:全真驱动。
// ============================================================================

import realCasesJson from "./real-cases.json";
import { buildRealScenario, type RealCase, type ScenarioNarrative } from "./real";
import { buildConstructedScenario, SPEC_A, SPEC_D } from "./constructed";
import type { Scenario } from "./types";

// 每个场景的叙事层(数据全真或合成,文案据诊断结果定稿)
const NARRATIVES: Record<string, ScenarioNarrative> = {
  A: {
    cn: "核心网 UDM 异常·确定性工作流定位",
    en: "UDM FAULT · DETERMINISTIC WORKFLOW",
    tagline: "签约管理 UDM_1 链路故障 · 多网元异常表象 · 故障传播+聚合原则秒级收敛 · 网络自治",
    intro:
      "核心网签约管理 UDM_1 发生链路故障,异常沿 Nudm 接口向 SMF 侧传播,多个网元呈现异常表象。置信度评估命中故障传播签名(0.74>0.7),直达确定性工作流:沿业务流回溯(故障传播原则)+ 按网元聚合受影响流程(故障聚合原则),一致收敛到 UDM_1(命中度 0.96,次优差 3 倍),秒级锁定根因,无需 LLM 介入——体现网络自治。",
    objective: "UDM_1 异常 · 确定性工作流(故障传播+聚合原则)秒级定位,多网元表象下一击收敛",
    pillars: { userLevel: false, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "多网元劣化·易误指 SMF",
        detail: "UDM 故障向 SMF 侧传播,朴素归因易指向表象网元 SMF_1/SMF_2",
        kind: "miss",
      },
      explored: {
        title: "确定性工作流(传播+聚合)",
        verdict: "秒级锁定 UDM_1 根因",
        detail: "故障传播原则回溯 Nudm + 故障聚合原则汇聚 → UDM_1 命中度 0.96",
      },
    },
  },
  B: {
    cn: "无线接入 gNB_1 故障·CHR 用户级定位",
    en: "gNB_1 FAULT · CHR USER-LEVEL",
    tagline: "无线接入 gNB_1 故障 · KPI+CHR 跨层融合 · 原因值集中锁定无线侧 · 用户级韧性",
    intro:
      "无线接入侧 gNB_1 发生故障,部分终端接入失败。网络聚合 KPI 仅微损,叠加终端噪声,信号模糊。多维探索下钻到 CHR 用户级记录:失败原因值(无线资源不足)集中分布于 gNB_1,同时识别并剥离伴随的终端侧干扰原因(终端不兼容 / 鉴权失败),跨层证据融合后锁定 gNB_1,排除核心网与终端干扰——体现用户级韧性。",
    objective: "gNB_1 异常 · CHR 原因值集中 + 剥离终端干扰,跨层融合锁定无线侧根因",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "易误指核心网网元",
        detail: "接入失败经 AMF/SMF 传导,朴素归因易指向核心网接入门",
        kind: "miss",
      },
      explored: {
        title: "KPI+CHR 跨层融合",
        verdict: "锁定无线侧 gNB_1",
        detail: "CHR 原因值集中 + 剥离终端干扰 → 融合收敛 gNB_1",
      },
    },
    chrInsight: {
      nes: ["gNB_1"],
      causeCode: "5GMM:22",
      causeCn: "无线资源不足(RRC 拒绝)",
      detail: "gNB_1 接入失败集中于 5GMM cause#22(占比 41%),并伴随两类终端侧干扰原因,已剥离。",
      related: [
        { code: "5GMM:23", cn: "鉴权失败(终端侧干扰)" },
        { code: "5GMM:24", cn: "协议不兼容(终端侧干扰)" },
      ],
    },
    skillEvolution: {
      kind: "UPDATE",
      skillId: "skills/learned/ran_chr_fusion",
      skillCn: "无线侧 CHR 融合定位",
      insight: "CHR 原因值集中度 + 终端干扰剥离 → 锁定无线侧根因",
      before: "仅依赖链路 KPI,接入类故障易误指核心网",
      after: "新增 CHR 原因值聚类 + 干扰剥离步骤,接入类命中率达 0.94",
      nextHitRate: 0.94,
    },
  },
  C: {
    cn: "无线接入 gNB_2·CHR 聚类锁定终端群体共因",
    en: "gNB_2 · CHR CLUSTERING · GROUP CAUSE",
    tagline: "无线接入 gNB_2 故障 · CHR 聚类 + 共因分析 · 伴随多原因值 · 鲁棒融合",
    intro:
      "gNB_2 接入段出现失败,网络聚合 KPI 仅微损,朴素视角易误报核心网 AMF。多维探索在 CHR 用户级记录上聚类:失败集中于同一批终端的共因(接入受限),并伴随多个相关原因值,贝叶斯融合后定位终端群体异常并锁定 gNB_2,消融分析显示结论鲁棒——体现网络自治在群体异常下的稳定诊断。",
    objective: "gNB_2 异常 · CHR 聚类锁定终端群体共因 + 伴随原因值,排除核心网误报",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "易误报核心网 AMF",
        detail: "接入失败经 AMF 传导,朴素视角误指 AMF_1 为根因",
        kind: "falsealarm",
      },
      explored: {
        title: "CHR 聚类 + 共因分析",
        verdict: "锁定 gNB_2 · 终端群体共因",
        detail: "CHR 共因集中于同一批终端 + 伴随多原因值 → 贝叶斯融合收敛 gNB_2",
      },
    },
    chrInsight: {
      nes: ["gNB_2"],
      causeCode: "5GMM:22",
      causeCn: "接入受限(终端群体共因)",
      detail: "gNB_2 下失败聚类于同一批终端,主因为接入受限,伴随多个相关原因值,判定终端群体异常并锁定 gNB_2。",
      related: [
        { code: "5GMM:23", cn: "鉴权超时" },
        { code: "5GSM:37", cn: "PDU 会话建立失败" },
        { code: "5GMM:24", cn: "协议不兼容" },
      ],
    },
    falseAlarm: {
      naiveNe: "AMF_1",
      naiveCn: "误报:AMF_1 接入故障",
      reason: "接入失败经 AMF 传导,朴素视角误判 AMF_1;CHR 共因集中于 gNB_2 终端,AMF_1 健康。",
    },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/terminal_group_clustering",
      skillCn: "终端群体共因聚类",
      insight: "CHR 多原因值共因聚类 → 识别终端群体异常,排除核心网误报",
      after: "新增终端群体共因聚类 Skill,群体异常场景命中率达 0.91",
      nextHitRate: 0.91,
    },
  },
  D: {
    cn: "用户追踪·物联终端群体异常",
    en: "USER TRACK · IoT TERMINAL GROUP",
    tagline: "KPI/CHR 信号模糊无法定根因 · 用户分群追踪发现物联终端群体异常 · 用户级韧性",
    intro:
      "总体 KPI 温和下跌、CHR 原因值分散,网络侧无任何网元跌破阈值,朴素归因停滞。触发用户级分群追踪:按终端类型分群 gNB_2 失败 UE,物联终端(IMSI-001xxx)群体失败率 38% 集中涌现,跨多切片共因,而网络 NE 全部健康——判定为用户侧群体异常,网络无责,下发用户侧恢复——体现用户级韧性与精准溯源。",
    objective: "KPI/CHR 模糊 → 用户分群追踪定位物联终端群体异常,网络本体健康",
    pillars: { userLevel: true, autonomy: false },
    comparison: {
      naive: {
        title: "仅 KPI/CHR 聚合",
        verdict: "信号模糊·无法定根因",
        detail: "总体微跌 0.989、CHR 原因值分散,朴素方法无法收敛,易误报某 NE",
        kind: "miss",
      },
      explored: {
        title: "用户分群追踪",
        verdict: "定位物联终端群体异常",
        detail: "按 SUPI/终端类型分群 → 物联终端 38% 失败集中涌现,网络健康",
      },
    },
    chrInsight: {
      nes: ["gNB_2"],
      causeCode: "5GSM:37",
      causeCn: "物联终端群体接入失败",
      detail: "gNB_2 下物联终端(IMSI-001xxx)群体失败率 38%,跨多切片集中涌现;网络 NE 健康,判定终端侧群体异常。",
      related: [
        { code: "5GMM:22", cn: "非接入层拥塞" },
        { code: "5GSM:39", cn: "PDU 会话建立失败" },
      ],
    },
    userFault: { gnbs: ["gNB_2"], affectedUe: 1280, kind: "物联终端群体异常" },
  },
};

// B/C 来自真实管线产出(case_101 / case_9001)
const realCases = realCasesJson as unknown as RealCase[];
const REAL_BY_ID: Record<string, Scenario> = {};
for (const rc of realCases) {
  if (NARRATIVES[rc.scenario_id]) {
    REAL_BY_ID[rc.scenario_id] = buildRealScenario(rc, NARRATIVES[rc.scenario_id]);
  }
}

// 四场景:A(构造 UDM)、B(真实)、C(真实)、D(构造 用户追踪)
export const SCENARIOS: Scenario[] = [
  buildConstructedScenario("A", NARRATIVES.A, SPEC_A),
  REAL_BY_ID.B,
  REAL_BY_ID.C,
  buildConstructedScenario("D", NARRATIVES.D, SPEC_D),
];

export const DEFAULT_SCENARIO_ID = "A";

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
