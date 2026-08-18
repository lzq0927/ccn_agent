// ============================================================================
// 演示场景 —— 三场景编排(路由分落三档:工作流 / 技能引导 / 自主探索)
//   A 核心网 UPF 异常 · 确定性工作流(均质化比较排除 AMF/SMF + 定位 UPF_1)
//   B 核心网 SMF 异常 · 技能引导(多维校验排除终端 → 识别网络根因)
//   C 无线接入 gNB · 自主探索(CHR 聚类 + 用户分群追踪 → 物联终端群体异常)
// 三场景共用真实 case_101 拓扑(21 NE)+ 合成遥测 + 手写推理链。
// ============================================================================

import { type ScenarioNarrative } from "./real";
import { buildConstructedScenario, SPEC_A, SPEC_B, SPEC_C, SPEC_D } from "./constructed";
import type { Scenario } from "./types";

// 每个场景的叙事层(数据全真或合成，文案据诊断结果定稿)
const NARRATIVES: Record<string, ScenarioNarrative> = {
  A: {
    cn: "核心网 UPF 异常·确定性工作流定位",
    en: "UPF FAULT · DETERMINISTIC WORKFLOW",
    tagline: "UPF_1 微损 · 前端 AMF↔SMF 路径普遍异常 · 均质化比较秒级锁定 UPF_1",
    intro: "核心网 UPF_1 微损，异常传导至前端 AMF↔SMF 通信路径普遍劣化。AMF-SMF 路径呈均质化异常(AMF、SMF 全实例共性劣化)，据此排除 AMF/SMF;再对 UPF 路径均质化比较，定位唯一离群点 UPF_1，隔离后流量切至 UPF POOL 内 UPF_2/UPF_3。",
    objective: "UPF_1 微损 · AMF-SMF 路径均质化异常排除 + 定位 UPF_1",
    pillars: { userLevel: false, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "AMF↔SMF 普遍异常·易误报",
        detail: "AMF↔SMF 路径普遍劣化，朴素归因误指 SMF 或 AMF 链路",
        kind: "falsealarm",
      },
      explored: {
        title: "确定性工作流(均质化比较)",
        verdict: "秒级锁定 UPF_1 根因",
        detail: "AMF/SMF 均质化排除 + UPF 故障聚合 → UPF_1",
      },
    },
    homogen: {
      anchorNe: "UPF_1",
      rounds: [
        {
          type: "AMF / SMF 通信路径",
          principle: "均质化比较原则",
          instances: [
            { id: "AMF_1", anomalous: true },
            { id: "AMF_2", anomalous: true },
            { id: "AMF_3", anomalous: true },
            { id: "SMF_1", anomalous: true },
            { id: "SMF_2", anomalous: true },
          ],
          verdict: "exclude",
          note: "AMF-SMF 路径均质化异常(全实例共性劣化)→ 非单点根因",
        },
        {
          type: "SMF-UDM 正常",
          principle: "故障排除原则",
          instances: [
            { id: "SMF_1", anomalous: false },
            { id: "SMF_2", anomalous: false },
          ],
          verdict: "normal",
          note: "SMF↔UDM 通信正常 → 排除 2 个 SMF",
        },
        {
          type: "UPF 通信路径",
          principle: "故障聚合原则",
          instances: [
            { id: "UPF_1", anomalous: true },
            { id: "UPF_2", anomalous: false },
            { id: "UPF_3", anomalous: false },
          ],
          verdict: "root",
          note: "聚合受影响路径，UPF_1 离群 → 根因",
        },
      ],
      principles: ["均质化比较原则", "故障排除原则", "故障聚合原则", "故障传播原则"],
    },
    isolation: { isolateNe: "UPF_1", failoverTo: ["UPF_2", "UPF_3"], summary: "隔离 UPF_1 · 流量切至 UPF POOL 健康实例" },
  },
  B: {
    cn: "核心网 SMF 异常·多维校验识别网络根因",
    en: "SMF FAULT · MULTI-DIM VALIDATION",
    tagline: "会话管理 SMF_1 异常 · 网络微损+终端噪声 · CHR 降噪排除终端 · 定位网络根因",
    intro: "网络 SMF_1 异常，叠加少量终端异常，KPI 仅微损。经持续周期性 CHR 统计确认终端噪声为既有(非突增)，CHR 降噪排除后准确识别网络根因 SMF_1，实施恢复。",
    objective: "SMF_1 异常 · CHR 降噪排除终端，识别网络根因",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: {
        title: "仅网络聚合 KPI",
        verdict: "网络微损·难分网络/终端",
        detail: "KPI 微损叠加终端噪声，朴素方法难定根因",
        kind: "miss",
      },
      explored: {
        title: "多维数据校验(KPI+CHR)",
        verdict: "锁定网络侧 SMF_1",
        detail: "CHR 降噪排除终端噪声 + 5GSM#37 突变 → SMF_1",
      },
    },
    chrInsight: {
      nes: ["SMF_1"],
      causeCode: "5GSM:37",
      causeCn: "PDU 会话建立失败",
      share: 64,
      detail: "SMF_1 会话建立失败集中于 5GSM#37(本次突变)，伴随的终端侧原因值长期偏高(既有噪声)，经 CHR 降噪排除。",
      related: [
        { code: "5GMM:23", cn: "鉴权失败(终端侧)", share: 14 },
        { code: "5GMM:24", cn: "协议不兼容(终端侧)", share: 9 },
      ],
    },
    skillEvolution: {
      kind: "UPDATE",
      skillId: "skills/learned/chr_terminal_exclusion",
      skillCn: "CHR 降噪 + 终端排除",
      insight: "CHR 周期性基线降噪 + 突变检出 → 区分网络/终端根因",
      before: "网络微损叠加终端噪声，易漏判或误指终端",
      after: "新增 CHR 降噪步骤，网络/终端区分命中率达 0.93",
      nextHitRate: 0.93,
    },
    isolation: { isolateNe: "SMF_1", failoverTo: ["SMF_2"], summary: "隔离 SMF_1 · 会话切至健康 SMF_2 接管" },
  },
  C: {
    cn: "无线接入 gNB·物联终端群体异常自主定位",
    en: "gNB · IoT GROUP · AUTONOMOUS",
    tagline: "gNB 信号模糊·自主探索 CHR 聚类 + 用户分群追踪·定位物联终端群体异常·网络健康",
    intro: "总体 KPI 微跌、CHR 原因分散，网络无网元异常。自主探索经 CHR 聚类与用户分群追踪，发现 gNB_2 下物联终端群体失败率 52%，网络健康，下发用户侧恢复。",
    objective: "gNB 信号模糊·自主探索定位物联终端群体异常，网络无法隔离只能通知换路",
    pillars: { userLevel: true, autonomy: false },
    comparison: {
      naive: {
        title: "仅 KPI/CHR 聚合",
        verdict: "信号模糊·易误报 AMF",
        detail: "总体微跌、CHR 原因分散，朴素方法无法收敛，易误报 AMF_1",
        kind: "falsealarm",
      },
      explored: {
        title: "CHR 聚类 + 用户分群追踪",
        verdict: "定位物联终端群体异常",
        detail: "CHR 共因聚类 + 用户分群 → 物联终端群体 52% 失败",
      },
    },
    chrInsight: {
      nes: ["gNB_2"],
      causeCode: "5GSM:37",
      causeCn: "物联终端群体接入失败",
      share: 52,
      detail: "gNB_2 物联终端群体失败率 52%(原因值分布见饼图);主因接入受限，伴随多原因值，网络健康。",
      related: [
        { code: "5GMM:22", cn: "非接入层拥塞", share: 18 },
        { code: "5GSM:39", cn: "PDU 会话建立失败", share: 15 },
        { code: "5GMM:24", cn: "协议不兼容", share: 9 },
      ],
    },
    falseAlarm: {
      naiveNe: "AMF_1",
      naiveCn: "误报:AMF_1 接入故障",
      reason: "接入失败经 AMF 传导误判;CHR 共因集中于 gNB_2 物联终端，AMF_1 健康。",
    },
    userFault: { gnbs: ["gNB_2"], affectedUe: 1280, kind: "物联终端群体异常" },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/user_segment_tracking",
      skillCn: "用户分群追踪",
      insight: "CHR 聚类 + 用户分群 → 定位物联终端群体异常",
      after: "新增用户分群追踪 Skill，群体异常命中率达 0.91",
      nextHitRate: 0.91,
    },
  },

  D: {
    cn: "AI平台故障·UDM过载·AMF/SMF协同限流",
    en: "AI PLATFORM FAIL · UDM OVERLOAD",
    tagline: "AI平台1故障→终端频繁注册→UDM过载(AMF/SMF不过载)→向AMF/SMF下发限流消除UDM过载,平台恢复后取消流控",
    intro:
      "AI 平台 1 故障(平台 2 正常),其终端频繁重复注册,注册/会话消息冲击汇聚点 UDM,导致 UDM 过载(AMF/SMF 自身不过载)。智能体看全局拓扑与业务流,判定治理点在 AMF/SMF 侧:UDM CHR 发现 AMF 注册 SST=3 占 >50%、SMF DNN=MIot.xx 占 >50%;UFDR 关联 SUPI 溯源到 AI 平台 1(仅上行)。按 CPU/消息线性推算减量,向 AMF/SMF 下发 SUPI 列表 + 限 SST/DNN,流控拒绝回 T3346/T3396(10min),自身流控+返回 UE 流控双策略。首轮部分终端不支持→二轮按差值重算→UDM 过载消除→AI 平台 1 恢复→取消流控。",
    objective: "AI平台1故障致UDM过载 · 向AMF/SMF下发限流(限SST=3/DNN+T3346/T3396)消除UDM过载",
    pillars: { userLevel: false, autonomy: true },
    comparison: {
      naive: { title: "仅网元 KPI 视角", verdict: "误判 UDM 宕机/扩容", detail: "UDM CPU 过载,朴素归因误指 UDM 故障或扩容,未溯源到 AI 平台与终端", kind: "falsealarm" },
      explored: { title: "流控溯源+协同限流", verdict: "在 AMF/SMF 侧消除 UDM 过载", detail: "CHR(SST=3/DNN)+UFDR(SUPI→AI平台1)溯源,AMF/SMF 协同限流", kind: "hit" },
    },
    stormMetrics: { amfCpu: 88, smfCpu: 85, udmCpu: 92, regSurge: 280, sessionSurge: 240, msgToUdmSurge: 320, impact2c: "AMF/SMF/UDM 过载导致注册/会话处理延迟,正常 2C 手机注册与业务受影响", aiPlatform: "AI 平台 1" },
    chrInsight: {
      nes: ["UDM_1"],
      causeCode: "SST=3 / DNN=MIot.xx",
      causeCn: "切片 SST=3 注册 + DNN=MIot.xx 会话占比超半",
      share: 55,
      detail: "UDM CHR 分析:AMF 注册请求中切片类型 SST=3 的消息占 55%(>50%);SMF 消息中 DNN=MIot.xx 占 58%(>50%)→ 异常集中于该切片/该 DNN 的用户。",
      related: [
        { code: "DNN=MIot.xx", cn: "物联 DNN 会话", share: 58 },
      ],
    },
    ufdr: { nes: ["UPF_1"], sstSurge: 55, sstLabel: "SST=3(MIoT) 注册占比 55%", dnnSurge: 58, dnnLabel: "DNN=MIot.xx 会话占比 58%", summary: "用 UDM CHR 中终端 SUPI 关联 UFDR:这些终端流量均发往 AI 平台 1,且仅含上行、无下行 → 溯源 AI 平台 1 故障终端;上报 OSS(AI 平台 1 地址)支撑修复" },
    recoveryPlan: {
      strategies: [
        {
          layer: "UE",
          cn: "AMF/SMF 回 T3346/T3396(10min)",
          en: "UE BACKOFF T3346/T3396",
          initialValue: 600,
          unit: "s",
          formula: "T = rand(T_min, T_max), T∈[600,660]s",
          variables: [
            { symbol: "T_min", meaning: "下界(防过短)", unit: "s", value: 600 },
            { symbol: "T_max", meaning: "上界", unit: "s", value: 660 },
          ],
          explanation: "AMF/SMF 下次流控拒绝注册时回 T3346(注册)/T3396(会话)定时器(10min 随机),抑制终端反复注册——返回给 UE 的流控策略。",
        },
        {
          layer: "AMF",
          cn: "限 SST=3 注册用户",
          en: "AMF SST=3 LIMIT",
          initialValue: 44,
          unit: "%",
          formula: "ρ_AMF = Δmsg_AMF / msg_AMF = 74/170 ≈ 44%",
          variables: [
            { symbol: "Δmsg_AMF", meaning: "AMF 需减消息数", unit: "req/s", value: 74 },
            { symbol: "msg_AMF", meaning: "AMF→UDM 当前消息", unit: "req/s", value: 170 },
          ],
          explanation: "按 AMF:SMF=55:45 占比分配总减量 135 → AMF 减 74 消息/s → 限 SST=3 注册约 44%——AMF 自身流控。",
        },
        {
          layer: "SMF",
          cn: "限 DNN=MIot.xx 会话用户",
          en: "SMF DNN LIMIT",
          initialValue: 41,
          unit: "%",
          formula: "ρ_SMF = Δmsg_SMF / msg_SMF = 61/150 ≈ 41%",
          variables: [
            { symbol: "Δmsg_SMF", meaning: "SMF 需减消息数", unit: "req/s", value: 61 },
            { symbol: "msg_SMF", meaning: "SMF→UDM 当前消息", unit: "req/s", value: 150 },
          ],
          explanation: "SMF 减 61 消息/s → 限 DNN=MIot.xx 会话约 41%——SMF 自身流控;向 AMF/SMF 下发对应 SUPI 列表精准命中。",
        },
      ],
      rounds: {
        r1Note: "首轮按 CPU 92% / 消息 320 线性推算 Δmsg≈135,AMF/SMF 双策略全下(限 SST/DNN + 回 T3346/T3396);部分终端不支持定时器 → UDM CPU 仅降到 78%。",
        r2Note: "二轮按差值(92→78)重算 Δmsg'≈50,加深支持终端 back-off、微调限流比例 → UDM CPU 降到 68% 过载消除;AI 平台 1 恢复后自动取消流控。",
        r2Values: [
          { layer: "UE", value: 660, note: "T3346 加深 + 扩大覆盖支持终端" },
          { layer: "AMF", value: 48, note: "ρ_AMF 提至 48%" },
          { layer: "SMF", value: 42, note: "ρ_SMF 提至 42%" },
        ],
      },
    },
    faultReport: {
      rootCause: "AI 平台 1 故障 → 该平台终端(对接 AMF_1/AMF_2)频繁注册 → AMF/SMF/UDM 三点过载",
      phenomenon: "Agent 1 采集:AMF(88%)/SMF(85%)/UDM(92%) CPU 均过载 + 注册/会话 KPI 降 + 消息突增",
      impact: "UDM 过载致注册/会话处理延迟,影响正常用户接入",
      action: "Agent 2 溯源 CHR(SST=3/DNN=MIot.xx)+UFDR(SUPI→AI平台1)→ 按 CPU/消息线性推算减量 → 向 AMF/SMF 下发 SUPI 列表 + 限 SST/DNN,流控拒绝回 T3346/T3396",
      outcome: "二轮按差值重算后 UDM 过载消除(CPU 68%);AI 平台 1 恢复,智能体取消终端流控,告警消失,网络恢复;沉淀「UDM 过载→AMF/SMF 协同限流」skill",
    },
    skillEvolution: {
      kind: "UPDATE",
      skillId: "skills/learned/amf_sm_ue_admission",
      skillCn: "AMF/SMF/UE 协同流控",
      insight: "本次增加用户分群检测:首轮未恢复时,二轮通过 CHR 终端类型分析发现不支持定时器的终端类型并调整策略",
      after: "更新协同流控 skill:增加用户分群检测维度",
      nextHitRate: 0.88,
    },
  },
};

// 四场景:A(UPF·工作流)、B(SMF·技能引导)、C(gNB 物联终端群体·自主探索)、D(AI平台故障·UDM过载·AMF/SMF协同限流)
export const SCENARIOS: Scenario[] = [
  buildConstructedScenario("A", NARRATIVES.A, SPEC_A),
  buildConstructedScenario("B", NARRATIVES.B, SPEC_B),
  buildConstructedScenario("C", NARRATIVES.C, SPEC_C),
  buildConstructedScenario("D", NARRATIVES.D, SPEC_D),
];

export const DEFAULT_SCENARIO_ID = "A";

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
