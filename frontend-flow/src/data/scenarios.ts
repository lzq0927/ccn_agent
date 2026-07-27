// ============================================================================
// 演示场景 —— 三场景编排(路由分落三档:工作流 / 技能引导 / 自主探索)
//   A 核心网 UPF 异常 · 确定性工作流(均质化比较排除 AMF/SMF + 定位 UPF_1)
//   B 核心网 SMF 异常 · 技能引导(多维校验排除终端 → 识别网络根因)
//   C 无线接入 gNB · 自主探索(CHR 聚类 + 用户分群追踪 → 物联终端群体异常)
// 三场景共用真实 case_101 拓扑(21 NE)+ 合成遥测 + 手写推理链。
// ============================================================================

import { type ScenarioNarrative } from "./real";
import { buildConstructedScenario, SPEC_A, SPEC_B, SPEC_C, SPEC_D, SPEC_E, SPEC_F } from "./constructed";
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

// 场景 D/E:流控溯源(物联网注册风暴)
  D: {
    cn: "流控溯源·物联网注册风暴(UE 侧 back-off)",
    en: "IOT STORM · UE BACK-OFF",
    tagline: "物联终端反复上线→注册/会话风暴冲击 AMF/SMF · 溯源到 UE · Registration Reject+back-off 收敛",
    intro:
      "物联网应用平台故障,物联终端反复重复上线(其他 UE 正常),注册风暴冲击 AMF、注册成功后产生大量 PDU 会话建立冲击 SMF,AMF/SMF 容器 CPU 过载;流控扩散影响正常 2C 手机(注册/会话被限流、无法上网)。智能体溯源到物联终端注册风暴,策略1(溯源到 UE):AMF 对注册成功终端发 Registration Reject 并下发 back-off timer,冲击收敛后正常用户上网恢复;物联平台恢复后物联终端快速收敛。",
    objective: "物联网注册风暴 · 溯源到 UE,Registration Reject + back-off timer 收敛",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: { title: "仅网元 KPI 视角", verdict: "误判 AMF/SMF 宕机", detail: "AMF/SMF CPU 过载,朴素归因误指网元故障或扩容", kind: "falsealarm" },
      explored: { title: "流控溯源", verdict: "溯源到物联终端风暴", detail: "注册风暴集中于物联终端 → UE 侧 back-off 收敛", kind: "hit" },
    },
    stormMetrics: { amfCpu: 92, smfCpu: 88, regSurge: 320, sessionSurge: 280, impact2c: "流控扩散至 2C 手机:日常注册/会话建立被限流,部分手机无法上网" },
    flowControl: {
      kind: "ue_backoff",
      anchorNe: "AMF_1",
      target: "物联网终端(UE)",
      measures: ["AMF 对注册成功终端发 Registration Reject", "下发 back-off timer 抑制反复上线"],
      converged: true,
      summary: "UE 侧 back-off 收敛 · 注册冲击下降 · 正常用户上网恢复",
    },
    faultReport: {
      rootCause: "物联网应用平台故障 -> 物联终端反复注册上线",
      phenomenon: "Agent 1 采集:AMF/SMF CPU 过载 + 注册/会话突增 + 流控扩散影响 2C 手机",
      impact: "正常 2C 手机注册/会话被限流,部分手机无法上网",
      action: "Agent 2 溯源物联终端风暴 -> 决策 UE back-off(Reg Reject + back-off timer) -> 执行后收敛",
      outcome: "冲击收敛,2C 用户上网恢复;物联平台恢复后物联终端快速收敛;沉淀 UFDR 流控溯源 skill",
    },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/iot_storm_tracing",
      skillCn: "UFDR 流控溯源",
      insight: "CPU 过载 + 注册风暴分析溯源到物联终端冲击",
      after: "新增流控溯源 skill,命中率达 0.90",
      nextHitRate: 0.9,
    },
  },
  E: {
    cn: "流控溯源·物联网风暴(网络侧 NSSAI/APN 限流)",
    en: "IOT STORM · NETWORK ADMISSION",
    tagline: "仅 20% UE 支持 back-off→首轮缓解仍过载 · 探索策略2:AMF 限 NSSAI + SMF 限 APN,比例按容量/流量/CPU 反压调节收敛",
    intro:
      "物联网应用平台故障致物联终端反复上线,注册/会话风暴冲击 AMF/SMF,流控扩散影响正常 2C 手机。策略1(UE 侧 back-off)仅约 20% 物联终端支持该定时器,过载程度降低但未消除、仍过载;智能体自主探索策略2(网络侧):二轮 UFDR 溯源 SST=3 + 物联 DNN,定位 AMF(物联 NSSAI)/SMF(物联 APN),双通道准入限流,比例按容器容量/实时流量/CPU 负载做反压自保流控、PID 实时调节,注册与会话请求同步下降后恢复。",
    objective: "20% UE 支持 back-off 不足以收敛 · 网络侧 NSSAI+APN 限流(反压比例算法)收敛",
    pillars: { userLevel: false, autonomy: true },
    comparison: {
      naive: { title: "仅网元 KPI 视角", verdict: "误判 AMF/SMF 宕机/扩容", detail: "CPU 过载,朴素归因误指网元故障", kind: "falsealarm" },
      explored: { title: "流控溯源+准入控制", verdict: "网络侧限流收敛", detail: "AMF NSSAI + SMF APN 双通道限流,反压比例算法实时调节", kind: "hit" },
    },
    ufdr: { nes: ["UPF_1"], sstSurge: 70, sstLabel: "SST=3(MIoT) 注册突增", dnnSurge: 74, dnnLabel: "物联 DNN 会话突增", summary: "二轮溯源:SST=3 + 物联 DNN → 定位 AMF(NSSAI)/SMF(APN) 接入点" },
    stormMetrics: { amfCpu: 95, smfCpu: 91, regSurge: 360, sessionSurge: 310, impact2c: "流控扩散至 2C 手机:注册/会话建立被限流,部分手机无法上网" },
    flowControl: {
      kind: "net_admission",
      anchorNe: "AMF_1",
      target: "AMF + SMF(网络侧)",
      measures: ["AMF 限制物联切片 NSSAI 接入", "SMF 限制物联 APN/DNN 接入"],
      ratio: { nssai: 55, apn: 45, algo: "PID 反压实调节", basis: "依据 AMF/SMF 容器容量、实时流量、CPU 负载做反压/自保流控,PID 实时调节 NSSAI/APN 双通道比例" },
      converged: true,
      summary: "网络侧双通道限流收敛 · 注册/会话请求下降 · 正常用户上网恢复",
    },
    faultReport: {
      rootCause: "物联网应用平台故障 -> 物联终端反复注册上线",
      phenomenon: "Agent 1 采集:AMF/SMF CPU 过载 + 注册/会话突增 + 流控扩散影响 2C 手机",
      impact: "正常 2C 手机注册/会话被限流,部分手机无法上网",
      action: "Agent 2 溯源物联终端 -> 首轮 back-off(20% 支持)未收敛 -> 二轮 UFDR 溯源 SST=3 + 物联 DNN -> AMF 限 NSSAI + SMF 限 APN(反压比例算法)",
      outcome: "注册/会话请求收敛,2C 用户上网恢复;物联平台恢复后物联终端快速收敛;沉淀 NSSAI/APN 准入控制 skill",
    },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/admission_control",
      skillCn: "NSSAI/APN 准入控制",
      insight: "UE back-off 不足以收敛时,网络侧 NSSAI+APN 限流 + 反压比例算法收敛",
      after: "新增准入控制 skill,命中率达 0.88",
      nextHitRate: 0.88,
    },
  },
  F: {
    cn: "流控溯源·物联网风暴(三层并行·终端类型感知)",
    en: "IOT STORM · LAYERED ADMISSION",
    tagline: "3 策略并行(UE back-off + AMF NSSAI + SMF DNN)· iPhone 不支持 back-off 致首轮失败反升 · 二轮排除 iPhone 收敛",
    intro:
      "物联网应用平台故障致物联终端反复上线,注册/会话风暴冲击 AMF/SMF,流控扩散影响正常 2C 手机。智能体决策首轮 3 策略并行(UE back-off + AMF 限 NSSAI + SMF 限 DNN),但 iPhone 终端不支持 back-off timer,收到 Reg Reject 后立即重试,反而放大风暴、失败数反升。二轮 loop② 回 Agent1 溯源终端类型,确认仅 iPhone 不支持 back-off,对 iPhone 不下发 back-off(由 AMF NSSAI 直接拦截)并微调 AMF/SMF 限流比例,失败陡降收敛。过程中用户分类展示:10 个 APN 中仅「物联网平台」APN 异常、6 种终端中仅 iPhone 不支持 back-off。",
    objective: "3 策略并行下发 · 首轮 iPhone back-off 失败反升 · 二轮终端类型感知调整收敛",
    pillars: { userLevel: true, autonomy: true },
    comparison: {
      naive: { title: "仅网元 KPI 视角", verdict: "误判 AMF/SMF 宕机/扩容", detail: "CPU 过载,朴素归因误指网元故障,且盲目下发 back-off 忽略终端异构", kind: "falsealarm" },
      explored: { title: "分层接纳 + 终端类型感知", verdict: "3 策略并行 + 排除不支持终端", detail: "首轮发现 iPhone 不支持 back-off 放大风暴,二轮终端类型感知调整收敛", kind: "hit" },
    },
    ufdr: { nes: ["UPF_1"], sstSurge: 72, sstLabel: "SST=3(MIoT) 注册突增", dnnSurge: 76, dnnLabel: "物联平台 DNN 会话突增", summary: "UFDR 溯源:SST=3 + 物联平台 DNN → 定位 AMF(NSSAI)/SMF(DNN) 接入点" },
    stormMetrics: { amfCpu: 93, smfCpu: 89, regSurge: 360, sessionSurge: 310, impact2c: "流控扩散至 2C 手机:首轮 iPhone 立即重试放大风暴,注册/会话被限流加剧" },
    recoveryPlan: {
      strategies: [
        {
          layer: "UE",
          cn: "UE back-off timer",
          en: "UE BACKOFF TIMER",
          initialValue: 12,
          unit: "s",
          formula: "T = clamp(T0 + k·ΔCPU, T_min, T_max)",
          variables: [
            { symbol: "T0", meaning: "基线 back-off(轻度过载)", unit: "s", value: 8 },
            { symbol: "k", meaning: "CPU 超阈放大系数", unit: "s/%", value: 0.6 },
            { symbol: "ΔCPU", meaning: "AMF CPU 超阈值量", unit: "%", value: 7, lo: 0, hi: 15 },
            { symbol: "T_min", meaning: "下界(防过短立即重试)", unit: "s", value: 8 },
            { symbol: "T_max", meaning: "上界(防过长窒息)", unit: "s", value: 30 },
          ],
          explanation: "首轮 ΔCPU=7 → T=8+0.6×7≈12s,抑制支持终端反复上线;iPhone 忽略该定时器→立即重试,放大风暴。",
        },
        {
          layer: "AMF",
          cn: "AMF NSSAI 接纳限流",
          en: "AMF NSSAI ADMISSION",
          initialValue: 75,
          unit: "%",
          formula: "ρ_AMF = clamp(ρ_base + α·c − β·ΔCPU, 30, 80)",
          variables: [
            { symbol: "ρ_base", meaning: "基线限流比例", unit: "%", value: 40 },
            { symbol: "α", meaning: "拥塞度系数", unit: "%", value: 35 },
            { symbol: "c", meaning: "拥塞度 (R−R_norm)/(R_peak−R_norm)", unit: "—", value: "≈1(风暴)", lo: 0, hi: 1 },
            { symbol: "β", meaning: "CPU 反压系数(首轮 0 / 二轮 1.2)", unit: "%/%", value: "0→1.2" },
            { symbol: "ΔCPU", meaning: "AMF CPU 超阈值量", unit: "%", value: 7, lo: 0, hi: 15 },
          ],
          explanation: "首轮 c=1、β=0 → ρ=40+35=75%;对 SST=3(MIoT)切片注册做接纳控制,超额直接 reject。",
        },
        {
          layer: "SMF",
          cn: "SMF DNN 会话接纳限流",
          en: "SMF DNN ADMISSION",
          initialValue: 70,
          unit: "%",
          formula: "ρ_SMF = clamp(ρ_base + γ·c + δ·ΔCPU_sess, 25, 75)",
          variables: [
            { symbol: "ρ_base", meaning: "基线会话限流比例", unit: "%", value: 35 },
            { symbol: "γ", meaning: "拥塞度系数", unit: "%", value: 30 },
            { symbol: "c", meaning: "拥塞度", unit: "—", value: "1→0.5", lo: 0, hi: 1 },
            { symbol: "δ", meaning: "SMF CPU 反压系数", unit: "%/%", value: 0.8 },
            { symbol: "ΔCPU_sess", meaning: "SMF CPU 超阈值量", unit: "%", value: 6, lo: 0, hi: 15 },
          ],
          explanation: "首轮 c=1 → ρ=35+30+0.8×6≈70%;对物联 DNN 的 PDU 会话建立做接纳控制,与 AMF 双通道同步限流。",
        },
      ],
      breakdown: {
        anchorNe: "UPF_1",
        apns: [
          { id: "iot-platform", cn: "物联网平台", regShare: 68, sessShare: 64, anomalous: true },
          { id: "internet", cn: "公众互联网", regShare: 8, sessShare: 9, anomalous: false },
          { id: "cmnet", cn: "CMNET", regShare: 6, sessShare: 7, anomalous: false },
          { id: "ims", cn: "IMS 语音", regShare: 5, sessShare: 6, anomalous: false },
          { id: "iot-cam", cn: "物联摄像头", regShare: 3, sessShare: 5, anomalous: false },
          { id: "enterprise", cn: "企业专线", regShare: 3, sessShare: 2, anomalous: false },
          { id: "iot-meter", cn: "智能水表", regShare: 2, sessShare: 3, anomalous: false },
          { id: "mms", cn: "彩信", regShare: 2, sessShare: 2, anomalous: false },
          { id: "vowifi", cn: "VoWiFi", regShare: 2, sessShare: 1, anomalous: false },
          { id: "other", cn: "其他", regShare: 1, sessShare: 1, anomalous: false },
        ],
        devices: [
          { id: "iphone", cn: "iPhone", share: 35, supportsBackoff: false },
          { id: "android", cn: "Android 手机", share: 22, supportsBackoff: true },
          { id: "harmony", cn: "HarmonyOS", share: 18, supportsBackoff: true },
          { id: "iot-cam", cn: "物联摄像头", share: 12, supportsBackoff: true },
          { id: "iot-meter", cn: "智能水表", share: 8, supportsBackoff: true },
          { id: "iot-sensor", cn: "物联传感", share: 5, supportsBackoff: true },
        ],
        anomalousApn: "iot-platform",
        unsupportedDevice: "iphone",
        summary: "10 个 APN 中仅「物联网平台」APN 注册/会话占比异常飙高(68%);6 种终端中仅 iPhone 不支持 back-off timer。",
      },
      rounds: {
        r1Note: "首轮 3 策略全下:iPhone 不支持 back-off,收到 Reg Reject 立即重试(放大 2.4×),等效注册率 0.35×2.4+0.65×0.3=1.035 → 失败反升 3.5%。",
        r2Note: "二轮对 iPhone 不下发 back-off(由 AMF NSSAI 直接 drop,不触发 retry),非 iPhone back-off 加深;等效注册率 0.35×0.4+0.65×0.2=0.27 → 下降 74%。",
        r2Values: [
          { layer: "UE", value: 14, note: "T=14s · 排除 iPhone,仅作用于 65% 支持终端 · 补偿性延长" },
          { layer: "AMF", value: 57, note: "ρ=40+35×0.6−1.2×3≈57% · c 降至 0.6、CPU 反压开启" },
          { layer: "SMF", value: 52, note: "ρ=35+30×0.5+0.8×2≈52% · 会话限流同步收敛" },
        ],
      },
    },
    faultReport: {
      rootCause: "物联网应用平台故障 -> 物联终端反复注册上线 + 终端类型异构(iPhone 不支持 back-off)",
      phenomenon: "Agent 1 采集:AMF/SMF CPU 过载 + 注册/会话突增 + 单一物联平台 APN 异常 + 流控扩散影响 2C 手机",
      impact: "首轮 3 策略全下:iPhone 不支持 back-off 致失败反升,正常 2C 手机注册/会话被限流加剧",
      action: "Agent 2 溯源物联终端 + 用户分类(单 APN 异常 / iPhone 不支持 back-off) -> 二轮对 iPhone 不下发 back-off + AMF/SMF 限流微调",
      outcome: "二轮排除 iPhone back-off 后收敛,2C 用户上网恢复;沉淀「终端类型感知的分层接纳控制」skill",
    },
    skillEvolution: {
      kind: "NEW",
      skillId: "skills/learned/terminal_aware_admission",
      skillCn: "终端类型感知的分层接纳控制",
      insight: "3 策略并行下发前先按终端类型分群,排除不支持 back-off 的终端,避免首轮放大风暴",
      after: "新增终端感知分层接纳 skill,命中率达 0.89",
      nextHitRate: 0.89,
    },
  },
};

// 六场景:A(UPF·工作流)、B(SMF·技能引导)、C(gNB 物联终端群体·自主探索)、D/E(物联网风暴·流控溯源)、F(三层并行·终端类型感知)
export const SCENARIOS: Scenario[] = [
  buildConstructedScenario("A", NARRATIVES.A, SPEC_A),
  buildConstructedScenario("B", NARRATIVES.B, SPEC_B),
  buildConstructedScenario("C", NARRATIVES.C, SPEC_C),
  buildConstructedScenario("D", NARRATIVES.D, SPEC_D),
  buildConstructedScenario("E", NARRATIVES.E, SPEC_E),
  buildConstructedScenario("F", NARRATIVES.F, SPEC_F),
];

export const DEFAULT_SCENARIO_ID = "A";

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
