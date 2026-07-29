// ============================================================================
// director —— 确定性故事导演。纯函数 direct(scenario, t, loop) → StoryState。
// 把时钟秒数映射到阶段、仿真时间戳与全部派生视图状态。
// ============================================================================

import { buildKpi, type KpiBundle } from "../data/kpi";
import { affectedEntities, recoveryReroute } from "../data/network";
import type { ChrInsight, ConfidenceBreakdown, EvalMetrics, ReasonStep, RouteKey, Scenario } from "../data/types";
import { PHASES } from "../theme";
import type { GenerationCheck, RecoveryAction, StoryState } from "./types";

/** 8 阶段时长(秒) */
export const PHASE_DURATIONS = [3, 6, 6, 6, 13, 6, 4, 8];
export const LOOP_DURATION = PHASE_DURATIONS.reduce((a, b) => a + b, 0);

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export const GENERATION_CHECKS: GenerationCheck[] = [
  { key: "kpi_consistency", cn: "KPI 一致性", en: "KPI CONSISTENCY", passed: true },
  { key: "fault_manifestation", cn: "故障可观测性", en: "FAULT MANIFESTATION", passed: true },
  { key: "topology_coherence", cn: "拓扑一致性", en: "TOPOLOGY COHERENCE", passed: true },
  { key: "process_validity", cn: "流程有效性", en: "PROCESS VALIDITY", passed: true },
  { key: "label_correctity", cn: "标签正确性", en: "LABEL CORRECTNESS", passed: true },
];

/** 按故障类型给出(合成)恢复动作序列 */
function recoveryActionsFor(s: Scenario): RecoveryAction[] {
  switch (s.fault.faultType) {
    case "all_type_ne":
      return [
        { id: "isolate", cn: "隔离故障 gNB 集", en: "ISOLATE FAULTY gNB" },
        { id: "reselect", cn: "触发 UE 重选 / 邻区切换", en: "UE RESELECTION" },
        { id: "reroute", cn: "AMF 侧锚定，无线流量重路由", en: "RAN TRAFFIC REROUTE" },
      ];
    case "single_ne": {
      // 按实际故障 NE 动态生成(UDM_1 / SMF_1 / …)
      const ne = s.fault.elements[0] ?? "AMF_3";
      const type = ne.replace(/_\d+$/, "");
      // UDM 主备:先核查备机容量，再隔离主机，流量切备
      if (type === "UDM") {
        return [
          { id: "capacity", cn: "容量核查:UDM_2(备)可接管控量", en: "CHECK STANDBY CAPACITY" },
          { id: "isolate", cn: `隔离 ${ne}(主)`, en: `ISOLATE ${ne} (PRIMARY)` },
          { id: "promote", cn: "UDM_2(备)升主，流量切换过去", en: "PROMOTE STANDBY UDM" },
        ];
      }
      // SMF:隔离故障实例，切换至健康 SMF_2 接管
      if (type === "SMF") {
        return [
          { id: "isolate", cn: `隔离 ${ne}`, en: `ISOLATE ${ne}` },
          { id: "failover", cn: "切换至健康 SMF_2 接管会话", en: "FAILOVER TO SMF_2" },
          { id: "reattach", cn: "受影响 UE 重建会话", en: "UE REBUILD SESSION" },
        ];
      }
      // UPF:隔离故障实例，流量切换至 UPF POOL 内其它健康 UPF
      if (type === "UPF") {
        return [
          { id: "isolate", cn: `隔离 ${ne}`, en: `ISOLATE ${ne}` },
          { id: "failover", cn: "流量切换至 UPF POOL 健康实例 UPF_2/UPF_3", en: "FAILOVER TO UPF_2 / UPF_3" },
          { id: "restore", cn: "负载均衡恢复 · 受影响 UE 无感", en: "TRAFFIC RESTORED" },
        ];
      }
      return [
        { id: "isolate", cn: `隔离 ${ne}(摘除负载)`, en: `ISOLATE ${ne}` },
        { id: "failover", cn: `${type} Set 内健康实例接管会话`, en: `${type}-SET FAILOVER` },
        { id: "reattach", cn: "受影响 UE 重附着 / 重建会话", en: "UE REATTACH · REBUILD" },
      ];
    }
    case "path_link":
      return [
        { id: "reroute", cn: "SMF 将会话切换至备用 UPF_3", en: "SWITCH TO STANDBY UPF" },
        { id: "quarantine", cn: "隔离劣化链路 SMF_1–UPF_{1,2}", en: "QUARANTINE DEGRADED LINK" },
      ];
    case "terminal_group":
      // gNB 无法隔离 · 只能通知用户换路
      return [
        { id: "notify", cn: "网络侧无法隔离 gNB · 通知受影响 UE 换路/重选", en: "NOTIFY UE REROUTE" },
        { id: "guide", cn: "引导 gNB_2 流量至邻区健康 gNB", en: "GUIDE TO NEIGHBOR gNB" },
        { id: "restore", cn: "用户侧恢复 · 网络无需隔离网元", en: "USER-SIDE RESTORE" },
      ];
    case "iot_storm":
      // 流控溯源:不隔离网元,按场景下发流控策略
      if (s.id === "E") {
        // E:首轮 back-off(20% 支持,未收敛)→ 二轮 NSSAI+APN 限流(收敛)
        return [
          { id: "r1_backoff", cn: "[轮1] AMF Reg Reject + back-off(仅 20% 支持,未收敛)", en: "R1 BACKOFF FAIL" },
          { id: "r2_nssai", cn: "[轮2] AMF 限制物联切片 NSSAI 接入", en: "R2 NSSAI LIMIT" },
          { id: "r2_apn", cn: "[轮2] SMF 限制物联 APN/DNN 接入", en: "R2 APN LIMIT" },
          { id: "r2_ratio", cn: "[轮2] 两限制比例 · 算法实时调节", en: "R2 RATIO CONTROL" },
        ];
      }
      if (s.id === "F") {
        // F:首轮 3 策略并行全下(UE/AMF/SMF);二轮 3 策略但 UE 层排除 iPhone
        return [
          { id: "r1_ue_backoff", cn: "[轮1] UE 层:back-off T=12s(全发,iPhone 忽略→放大)", en: "R1 UE BACKOFF" },
          { id: "r1_amf_nssai", cn: "[轮1] AMF 层:限物联 NSSAI 接纳 ρ_AMF=75%", en: "R1 AMF NSSAI 75%" },
          { id: "r1_smf_apn", cn: "[轮1] SMF 层:限物联 DNN 接纳 ρ_SMF=70%", en: "R1 SMF DNN 70%" },
          { id: "r2_ue_backoff", cn: "[轮2] UE 层:back-off T=14s(排除 iPhone,仅 65% 终端)", en: "R2 UE BACKOFF (EXCL IPHONE)" },
          { id: "r2_amf_nssai", cn: "[轮2] AMF 层:限 NSSAI ρ_AMF=57%(微调)", en: "R2 AMF NSSAI 57%" },
          { id: "r2_smf_apn", cn: "[轮2] SMF 层:限 DNN ρ_SMF=52%(微调)", en: "R2 SMF DNN 52%" },
        ];
      }
      // D:首轮 back-off 即收敛
      return [
        { id: "reg_reject", cn: "AMF 对注册成功终端发 Registration Reject", en: "AMF REGISTRATION REJECT" },
        { id: "backoff", cn: "下发 back-off timer 抑制反复上线", en: "UE BACK-OFF TIMER" },
      ];
    default:
      return [{ id: "reroute", cn: "流量重路由至健康路径", en: "TRAFFIC REROUTE" }];
  }
}

function cordonedFor(s: Scenario): string[] {
  if (s.fault.faultType === "all_type_ne") return s.fault.elements; // gNB_1/2/3
  if (s.fault.faultType === "single_ne") return s.fault.elements; // AMF_3
  return [];
}

interface PreparedScenario {
  kpi: KpiBundle;
  recoveryActions: RecoveryAction[];
  rerouteEdges: string[];
  cordoned: string[];
}

const prepCache = new Map<string, PreparedScenario>();
function prepare(s: Scenario): PreparedScenario {
  const cached = prepCache.get(s.id);
  if (cached) return cached;
  const p: PreparedScenario = {
    kpi: s.realKpi ?? buildKpi(s.fault),
    recoveryActions: recoveryActionsFor(s),
    rerouteEdges: recoveryReroute(s.fault),
    cordoned: cordonedFor(s),
  };
  prepCache.set(s.id, p);
  return p;
}

export function getKpi(s: Scenario): KpiBundle {
  return prepare(s).kpi;
}

/** 计算阶段索引与阶段内进度 */
export function phaseAt(t: number): { index: number; progress: number } {
  let acc = 0;
  for (let i = 0; i < PHASE_DURATIONS.length; i++) {
    const d = PHASE_DURATIONS[i];
    if (t < acc + d || i === PHASE_DURATIONS.length - 1) {
      return { index: i, progress: clamp((t - acc) / d, 0, 1) };
    }
    acc += d;
  }
  return { index: PHASE_DURATIONS.length - 1, progress: 1 };
}

// —— 两轮场景时间线:B/C/E。首轮评估/恢复未通过 → loop② 回 Agent1 → 二轮重新执行 → 恢复成功 ——
//   E 首轮含 back-off 恢复(phase5,部分缓解后未收敛);B/C 首轮评估未通过,不走到恢复(phase4 后直接回 Agent1)
const TWO_ROUND_IDS = new Set(["B", "C", "E", "F", "G"]);
type Seg = { dur: number; phase: number; round: 1 | 2 };
const R1_COMMON: Seg[] = [
  { dur: 3, phase: 0, round: 1 },
  { dur: 4, phase: 1, round: 1 }, { dur: 4, phase: 2, round: 1 }, { dur: 3, phase: 3, round: 1 },
  { dur: 6, phase: 4, round: 1 },
];
const R1_WITH_RECOV: Seg[] = [...R1_COMMON, { dur: 4, phase: 5, round: 1 }]; // E/F/G:首轮恢复(未收敛)
const R2_SEGS: Seg[] = [
  { dur: 4, phase: 1, round: 2 }, { dur: 4, phase: 2, round: 2 }, { dur: 3, phase: 3, round: 2 },
  { dur: 9, phase: 4, round: 2 }, { dur: 6, phase: 5, round: 2 },
  { dur: 5, phase: 6, round: 2 }, { dur: 13, phase: 7, round: 2 },
];
function twoRoundSegs(id: string): Seg[] {
  return (id === "E" || id === "F" || id === "G") ? [...R1_WITH_RECOV, ...R2_SEGS] : [...R1_COMMON, ...R2_SEGS];
}
const TWO_ROUND_LOOP: Record<string, number> = {};
for (const id of ["B", "C", "E", "F", "G"]) TWO_ROUND_LOOP[id] = twoRoundSegs(id).reduce((a, b) => a + b.dur, 0);

export function loopDurationFor(s: Scenario): number {
  return TWO_ROUND_IDS.has(s.id) ? (TWO_ROUND_LOOP[s.id] ?? LOOP_DURATION) : LOOP_DURATION;
}

/** 交互式走查停靠点:按场景段时间线展平成 [(phase, round, time)]。
 *  两轮场景:轮1 全部段跑完(含恢复失败)再到轮2 —— 解决"一上来就轮2"。
 *  单轮场景:8 相位顺次。time = 该段末(内容完整展开)。 */
export interface WalkStop { phase: number; round: 1 | 2; time: number; }
export function walkStops(s: Scenario): WalkStop[] {
  const total = loopDurationFor(s);
  const clampT = (t: number) => Math.min(Math.max(0, t), total - 0.01);
  if (TWO_ROUND_IDS.has(s.id)) {
    const segs = twoRoundSegs(s.id);
    const stops: WalkStop[] = [];
    let acc = 0;
    for (const seg of segs) {
      acc += seg.dur;
      stops.push({ phase: seg.phase, round: seg.round, time: clampT(acc - 0.05) });
    }
    return stops;
  }
  const out: WalkStop[] = [];
  let acc = 0;
  for (let i = 0; i < PHASE_DURATIONS.length; i++) {
    acc += PHASE_DURATIONS[i];
    out.push({ phase: i, round: 1, time: clampT(acc - 0.05) });
  }
  return out;
}

function phaseAtForScenario(s: Scenario, t: number): { index: number; progress: number; round: 1 | 2 } {
  if (TWO_ROUND_IDS.has(s.id)) {
    const segs = twoRoundSegs(s.id);
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (t < acc + segs[i].dur || i === segs.length - 1) {
        return { index: segs[i].phase, progress: clamp((t - acc) / segs[i].dur, 0, 1), round: segs[i].round };
      }
      acc += segs[i].dur;
    }
    return { index: 7, progress: 1, round: 2 as const };
  }
  const r = phaseAt(t);
  return { index: r.index, progress: r.progress, round: 1 as const };
}

/** E 场景 simT 映射:两轮映射到仿真时间 1-60,第一轮结束 back-off 部分缓解,第二轮 NSSAI+APN 完全恢复 */
function simTForE(phaseIndex: number, p: number, round: 1 | 2): number {
  if (round === 1) {
    switch (phaseIndex) {
      case 0: return 6;
      case 1: return lerp(6, 24, p);
      case 2: return lerp(24, 28, p);
      case 3: return 28;
      case 4: return lerp(28, 30, p);
      case 5: return lerp(30, 33, p); // back-off 部分缓解
      default: return 33;
    }
  }
  // round 2
  switch (phaseIndex) {
    case 1: return lerp(33, 36, p);
    case 2: return lerp(36, 40, p);
    case 3: return 40;
    case 4: return lerp(40, 44, p);
    case 5: return lerp(44, 52, p); // NSSAI+APN 完全恢复
    case 6: return lerp(52, 56, p);
    default: return 56;
  }
}

/** F 场景 simT 映射:首轮 3 策略全下(iPhone 放大致失败反升,simT 32→36 ↔ iotReg 180→186),
 *  二轮排除 iPhone 收敛(simT 44→54 ↔ iotReg 186→28)。连续递增,KPI 游标不倒走。 */
function simTForF(phaseIndex: number, p: number, round: 1 | 2): number {
  if (round === 1) {
    switch (phaseIndex) {
      case 0: return 6;
      case 1: return lerp(6, 26, p);
      case 2: return lerp(26, 30, p);    // 风暴起 fs=28
      case 3: return 30;
      case 4: return lerp(30, 32, p);    // 推理 + 用户分类
      case 5: return lerp(32, 36, p);    // 首轮 3 策略:失败反升段
      default: return 36;                // 首轮结束于失败峰
    }
  }
  switch (phaseIndex) {
    case 1: return lerp(36, 39, p);
    case 2: return lerp(39, 42, p);
    case 3: return 42;
    case 4: return lerp(42, 44, p);      // 二轮溯源终端类型
    case 5: return lerp(44, 54, p);      // 二轮收敛段
    case 6: return lerp(54, 58, p);
    default: return 58;
  }
}

/** B/C 两轮 simT 映射:首轮故障持续(评估未通过不恢复),二轮推进到 faultEnd 完成恢复
 *  基于各场景 faultStart(fs)/faultEnd(fe) 自适应。 */
function simTForTwoRound(s: Scenario, phaseIndex: number, p: number, round: 1 | 2): number {
  const fs = s.fault.faultStart;
  const fe = fs + s.fault.faultDuration;
  if (round === 1) {
    switch (phaseIndex) {
      case 0: return Math.max(1, fs - 6);
      case 1: return lerp(Math.max(1, fs - 6), fs - 2, p);
      case 2: return lerp(fs - 2, fs, p);
      case 3: return fs;
      case 4: return lerp(fs, fs + 2, p); // 根因+评估,故障持续
      case 5: return lerp(fs + 2, fs + 4, p); // 评估未通过,故障仍未恢复
      default: return fs + 4;
    }
  }
  switch (phaseIndex) {
    case 1: return lerp(fs + 4, fs + 6, p);
    case 2: return lerp(fs + 6, fs + 8, p);
    case 3: return fs + 8;
    case 4: return lerp(fs + 8, fe - 2, p); // 二轮根因
    case 5: return lerp(fe - 2, fe, p); // 二轮恢复 → SR 回升
    case 6: return lerp(fe, fe + 4, p);
    default: return Math.min(60, fe + 4);
  }
}

/** 仿真时间戳随阶段推进 */
function simTFor(s: Scenario, phaseIndex: number, p: number): number {
  const fs = s.fault.faultStart;
  const fe = s.fault.faultStart + s.fault.faultDuration;
  switch (phaseIndex) {
    case 0:
      return 6;
    case 1:
      return lerp(1, fs - 3, p);
    case 2:
      return lerp(fs - 2, fs + 2, p);
    case 3:
      return fs + 1;
    case 4:
      return fs + 2; // 异常在推理期间持续
    case 5:
      return lerp(fs + 2, fe + 2, p); // 恢复动作推进，越过故障窗
    case 6:
      return lerp(fe + 2, 58, p);
    default:
      return 58;
  }
}

// —— D/E 实时仿真数据(挪自 SIM 引擎):物联注册/会话请求率 + 全网 CPU,随 simT 波动 ——
//   与 KPI 曲线共用 iotRegAt/sessIotAt,保证曲线与实时数值一致。

/** D/E 物联注册请求数/s(按仿真时间,与 KPI 曲线一致) */
export function iotRegAt(s: Scenario, t: number): number {
  if (s.id === "F") {
    if (t < 28) return 5;
    if (t < 32) return lerp(5, 180, (t - 28) / 4);    // 风暴起
    if (t < 36) return lerp(180, 186, (t - 32) / 4);  // 首轮:iPhone 放大,反升
    if (t < 44) return 186;                            // 首轮失败峰持续
    if (t < 54) return lerp(186, 28, (t - 44) / 10);  // 二轮排除 iPhone,收敛
    return 28;
  }
  if (s.id === "E") {
    if (t < 28) return 5;
    if (t < 30) return 180;
    if (t < 33) return lerp(180, 140, (t - 30) / 3); // back-off 部分缓解
    if (t < 44) return 140; // 未收敛
    if (t < 52) return lerp(140, 5, (t - 44) / 8); // NSSAI+APN 完全恢复
    return 5;
  }
  const fs = s.fault.faultStart, fe = fs + s.fault.faultDuration;
  if (t < fs) return 5;
  if (t < fe) { const rs = fs + (fe - fs) * 0.6; return t < rs ? 180 : lerp(180, 5, (t - rs) / (fe - rs)); }
  return 5;
}

/** D/E 物联 PDU 会话建立数/s */
export function sessIotAt(s: Scenario, t: number): number {
  if (s.id === "F") {
    if (t < 28) return 40;
    if (t < 32) return lerp(40, 400, (t - 28) / 4);
    if (t < 36) return lerp(400, 405, (t - 32) / 4);  // 首轮微升
    if (t < 44) return 405;
    if (t < 54) return lerp(405, 95, (t - 44) / 10);  // 二轮收敛
    return 95;
  }
  if (s.id === "E") {
    if (t < 28) return 40;
    if (t < 30) return 400;
    if (t < 33) return lerp(400, 300, (t - 30) / 3);
    if (t < 44) return 300;
    if (t < 52) return lerp(300, 40, (t - 44) / 8);
    return 40;
  }
  const fs = s.fault.faultStart, fe = fs + s.fault.faultDuration;
  if (t < fs) return 40;
  if (t < fe) { const rs = fs + (fe - fs) * 0.6; return t < rs ? 400 : lerp(400, 40, (t - rs) / (fe - rs)); }
  return 40;
}

/** 风暴强度 0..1(由物联注册率归一) */
export function stormSi(s: Scenario, t: number): number {
  return clamp((iotRegAt(s, t) - 5) / 175, 0, 1);
}

/** D/E 实时请求率 + CPU(随 simT 波动,挪自 SIM 引擎同款公式) */
export function liveStormRates(s: Scenario, simT: number) {
  const si = stormSi(s, simT);
  const iotRegRate = iotRegAt(s, simT);
  return {
    amfCpu: 40 + si * 52,
    smfCpu: 38 + si * 50,
    regRate: 15 + iotRegRate,
    iotRegRate,
    sessionRate: sessIotAt(s, simT),
    twoCThrottle: si * 0.35,
  };
}

/** 全网 NE CPU%(AMF/SMF 来自风暴强度;其它估算 + 实例噪声,随 simT 波动) */
export function liveNeCpu(s: Scenario, simT: number): Record<string, number> {
  const graph = s.realGraph;
  if (!graph) return {};
  const si = stormSi(s, simT);
  const out: Record<string, number> = {};
  let seed = (Math.floor(simT * 5) + 1) | 0;
  const noise = () => { seed = (Math.imul(seed, 9301) + 49297) % 233280; return seed / 233280; };
  for (const n of graph.nodes) {
    let cpu: number;
    if (s.stormMetrics?.udmCpu != null) {
      // G 场景:过载在 UDM(AMF/SMF 仅因消息增多略升,不过载)
      if (n.type === "UDM") cpu = 40 + si * 55;
      else if (n.type === "AMF") cpu = 42 + si * 12;
      else if (n.type === "SMF") cpu = 40 + si * 10;
      else if (n.type === "UPF") cpu = 32 + si * 6;
      else cpu = 28 + si * 3;
    } else {
      if (n.type === "AMF") cpu = 40 + si * 52;
      else if (n.type === "SMF") cpu = 38 + si * 50;
      else if (n.type === "gNB") cpu = 30 + si * 14;
      else if (n.type === "UPF") cpu = 32 + si * 10;
      else cpu = 26 + si * 4;
    }
    cpu += (noise() - 0.5) * 4;
    out[n.id] = Math.max(5, Math.min(99, Math.round(cpu)));
  }
  return out;
}

const HEADLINES: Record<number, { h: string; s: string }> = {
  0: { h: "网络稳态运行", s: "逐链路监测待命 · 5GC 全网健康 · 成功率 99.8%" },
  1: { h: "数字孪生 · 数据采集", s: "Agent 1 现网采集遥测 · LLM 多维校验闭环" },
  2: { h: "异常检测", s: "KPI/CHR 双线并行 · 任一检出异常即触发根因分析 · 异常全面初筛" },
  3: { h: "策略匹配", s: "异常全面初筛 · 多维特征加权评分 · 三路径分流" },
  4: { h: "Agent 推理 · 根因定位", s: "多维数据综合判断 · 推理链收敛 · 防误报与漏报" },
  5: { h: "执行恢复动作", s: "高稳智能体下发恢复策略 · 网络自愈中" },
  6: { h: "网络恢复正常", s: "成功率回升至 99.8% · 闭环验证通过" },
  7: { h: "评估优化 · 闭环反馈", s: "Agent 3 比对真值 · 推理链质析 · 优化建议回流" },
};

/** 过程中标注的算法(除相位4外，各相位通用) */
const ALGO_BY_PHASE: Record<number, { cn: string; en: string }[]> = {
  0: [],
  1: [
    { cn: "现网遥测采集", en: "LIVE TELEMETRY" },
    { cn: "LLM 多维校验", en: "LLM VALIDATION" },
  ],
  2: [
    { cn: "CHR 降噪→聚类", en: "CHR DENOISE→CLUSTER" },
    { cn: "KPI 异常检测→时空求解", en: "KPI→SPATIO-TEMPORAL" },
  ],
  3: [
    { cn: "特征加权评分", en: "WEIGHTED SCORING" },
    { cn: "路由分流", en: "ROUTE DISPATCH" },
  ],
  4: [], // 场景相关，见 ALGO_REASON
  5: [{ cn: "恢复策略编排", en: "POLICY ORCHESTRATION" }],
  6: [{ cn: "闭环验证", en: "CLOSED-LOOP VERIFY" }],
  7: [
    { cn: "P/R/F1 比对", en: "P/R/F1 MATCH" },
    { cn: "推理链质析", en: "TRACE QUALITY" },
  ],
};

/** 相位4(根因推理)的场景化算法链 —— 讲清每类故障用了哪些算法 */
const ALGO_REASON: Record<string, { cn: string; en: string }[]> = {
  A: [
    { cn: "iFFusion 融合异常检测", en: "iFFUSION ANOMALY" },
    { cn: "AMF/SMF 均质化比较", en: "AMF/SMF HOMOGENIZE" },
    { cn: "故障排除", en: "FAULT EXCLUSION" },
    { cn: "UPF 故障聚合", en: "UPF AGGREGATION" },
    { cn: "根因定位", en: "ROOT-CAUSE" },
  ],
  B: [
    { cn: "iFFusion 融合(KPI+CHR)", en: "iFFUSION FUSION" },
    { cn: "CHR 多维时序统计", en: "CHR TIME-SERIES" },
    { cn: "CHR 降噪排除终端", en: "CHR DENOISE" },
    { cn: "根因定位", en: "ROOT-CAUSE" },
  ],
  C: [
    { cn: "iFFusion 融合异常检测", en: "iFFUSION ANOMALY" },
    { cn: "CHR 聚类", en: "CHR CLUSTERING" },
    { cn: "用户分群追踪", en: "USER-SEGMENT TRACK" },
    { cn: "群体异常定位", en: "GROUP ANOMALY" },
  ],
  D: [
    { cn: "AMF/SMF 容器 CPU 过载检测", en: "CPU OVERLOAD DETECT" },
    { cn: "AMF 注册/上行 NAS 突增分析", en: "REG/NAS SURGE" },
    { cn: "溯源到物联终端注册风暴", en: "TRACE TO IOT UE" },
    { cn: "UE 侧 back-off 流控决策", en: "UE BACK-OFF DECISION" },
  ],
  E: [
    { cn: "AMF/SMF 容器 CPU 过载检测", en: "CPU OVERLOAD DETECT" },
    { cn: "策略1 UE back-off(未收敛)", en: "UE BACK-OFF FAIL" },
    { cn: "UPF UFDR 报表溯源(二轮)", en: "UFDR TRACING R2" },
    { cn: "SST=3 + 物联 DNN 双突增", en: "SST=3 + IOT DNN SURGE" },
    { cn: "策略2 AMF NSSAI + SMF APN 限流", en: "NET ADMISSION" },
    { cn: "比例算法实时调节", en: "RATIO CONTROL" },
  ],
  F: [
    { cn: "AMF/SMF 容器 CPU 过载检测", en: "CPU OVERLOAD DETECT" },
    { cn: "UFDR + APN/终端类型分类溯源", en: "UFDR + APN/DEVICE TRACE" },
    { cn: "首轮 3 策略并行下发", en: "R1 3-STRATEGY PARALLEL" },
    { cn: "iPhone back-off 失败反升检测", en: "IPHONE BACKOFF FAIL" },
    { cn: "二轮终端类型感知调整", en: "R2 DEVICE-AWARE ADJUST" },
    { cn: "分层接纳限流收敛", en: "LAYERED ADMISSION CONVERGE" },
  ],
};

/** 当前相位激活的算法标签 */
function algorithmsFor(s: Scenario, phaseIndex: number): { cn: string; en: string }[] {
  if (phaseIndex === 4) return ALGO_REASON[s.id] ?? ALGO_REASON.A;
  return ALGO_BY_PHASE[phaseIndex] ?? [];
}

/** 场景化动作解说(覆盖关键相位，讲清「此刻在干什么」;LIVE 无条目则回落) */
const SCENARIO_SUB: Record<string, Record<number, string>> = {
  A: {
    2: "iFFusion 逐链路检出:前端 AMF↔SMF 通信路径普遍异常 · 异常全面初筛",
    3: "置信度 0.76 > 0.7 · 命中 UPF 故障聚合 · 直达确定性工作流(不走 LLM)",
    4: "均质化比较+故障排除收敛范围 · 故障聚合定位 UPF_1 · 防误报",
    5: "隔离 UPF_1 · 流量切换至 UPF POOL 内 UPF_2/UPF_3 接管",
  },
  B: {
    2: "KPI+CHR 双线并行 · KPI 检出 SMF 方向微损 / CHR 检出终端噪声周期性偏高 · 任一即触发根因",
    3: "置信度 0.55·技能引导 Loop·CHR 多维校验降噪",
    4: "CHR 降噪:终端噪声长期基线(非突增)排除 · 5GSM#37 与突降同步 → 锁定 SMF_1",
    5: "隔离 SMF_1·切换至健康 SMF 接管·UE 恢复",
  },
  C: {
    2: "逐链路监测 · 无链路/网元跌破阈值 · 仅 CHR 原因值分散",
    3: "置信度 0.28·信号模糊·自主探索 Loop·多轮收敛·拦截 AMF 误报",
    4: "CHR 聚类 + 用户分群追踪:物联终端群体 52% 失败·网络健康·防误报",
    5: "网络侧无法隔离 gNB·通知物联终端群体换路·用户侧恢复",
  },
  D: {
    2: "AMF/SMF 容器 CPU 过载 + KPI 受影响 · AMF 上行 NAS / SMF N11 PDU 建立突增",
    3: "置信度 0.55 · 技能引导 · 流控溯源",
    4: "溯源到物联终端注册风暴 · 决策 UE 侧 back-off(Registration Reject + back-off timer)",
    5: "执行:AMF Registration Reject + back-off timer → 待验证收敛",
  },
  E: {
    2: "AMF/SMF 容器 CPU 过载 + KPI 受影响 · 注册/会话风暴冲击",
    3: "置信度 0.30 · 信号模糊 · 自主探索策略",
    4: "策略1(UE back-off)未收敛 → 二轮拉取 UFDR(SST=3 + 物联 DNN)→ 溯源 AMF/SMF · 决策策略2",
    5: "执行策略2:AMF 限 NSSAI + SMF 限 APN · 比例算法实时调节 → 待验证收敛",
  },
  F: {
    2: "AMF/SMF 容器 CPU 过载 + 注册/会话风暴冲击 · 单一物联平台 APN 异常",
    3: "置信度 0.32 · 信号模糊 · 自主探索 · 决策首轮 3 策略并行",
    4: "用户分类:10 APN 仅物联平台异常 / 6 终端仅 iPhone 不支持 back-off · 决策 3 策略并行(UE/AMF/SMF)",
    5: "首轮 3 策略全下:iPhone back-off 失败反升 → 二轮排除 iPhone + AMF/SMF 限流微调收敛",
  },
};

export function direct(s: Scenario, t: number, loop: number): StoryState {
  const dur = loopDurationFor(s);
  const phaseInfo = phaseAtForScenario(s, t);
  const phaseIndex = phaseInfo.index;
  const progress = phaseInfo.progress;
  const eRound = phaseInfo.round;
  const phase = PHASES[phaseIndex];
  const p = prepare(s);
  const { neSet } = affectedEntities(s.fault);
  const simT = clamp(
    s.id === "E" ? simTForE(phaseIndex, progress, eRound)
      : s.id === "F" ? simTForF(phaseIndex, progress, eRound)
        : TWO_ROUND_IDS.has(s.id) ? simTForTwoRound(s, phaseIndex, progress, eRound)
          : simTFor(s, phaseIndex, progress),
    1, 60,
  );

  // D/E(iot_storm)实时仿真数据:CPU/请求率随 simT 波动(挪自 SIM 引擎,DEMO 内置)
  const isStorm = s.fault.faultType === "iot_storm";
  const simRates = isStorm ? liveStormRates(s, simT) : undefined;
  const simNeCpu = isStorm ? liveNeCpu(s, simT) : undefined;

  // 推理步揭示(阶段4) — 两轮场景(B/C/E):轮1揭示1-6,轮2揭示7-12
  const total = s.reasoning.length;
  const isTwoRound = TWO_ROUND_IDS.has(s.id);
  // 回路:B/C 首轮⑤评估未通过 → loop①(⑤ 回 Agent1,Agent2 内部,不走 Agent3)
  //       E 首轮 back-off 未收敛 → loop②(经 Agent3,A3→A1);二轮回到 Agent1 瞬间(phase1)对应回路保持亮
  const failBC = (s.id === "B" || s.id === "C") && phaseIndex === 4 && progress > 0.6;
  const failEF = (s.id === "E" || s.id === "F") && phaseIndex >= 5;
  const loopBackKind: "loop1" | "loop2" | null = isTwoRound
    ? ((eRound === 1 && (failBC || failEF)) || (eRound === 2 && phaseIndex <= 1)
      ? (s.id === "E" || s.id === "F" ? "loop2" : "loop1")
      : null)
    : null;
  let revealedCount: number;
  if (isTwoRound) {
    if (phaseIndex < 4) revealedCount = eRound === 2 ? 6 : 0;
    else if (phaseIndex === 4) revealedCount = eRound === 1 ? Math.ceil(progress * 6) : 6 + Math.ceil(progress * (total - 6));
    else revealedCount = eRound === 1 ? 6 : total; // phase≥5:首轮仅 1-6 步,二轮才全部
  } else {
    revealedCount = phaseIndex < 4 ? 0 : phaseIndex === 4 ? Math.ceil(progress * total) : total;
  }
  const reasoningSteps: ReasonStep[] = s.reasoning.slice(0, revealedCount);
  const conclusionRevealed = (isTwoRound ? eRound === 2 : phaseIndex > 4) || (phaseIndex === 4 && revealedCount >= total);

  // 聚焦 NE:阶段2-3=检测到的受影响集;阶段4=已揭示步骤的高亮;阶段5=隔离集
  let affectedNe: string[] = [];
  if (phaseIndex === 2 || phaseIndex === 3) affectedNe = [...neSet];
  else if (phaseIndex === 4) {
    const set = new Set<string>();
    reasoningSteps.forEach((r) => r.highlight?.nes?.forEach((n) => set.add(n)));
    affectedNe = [...set];
  } else if (phaseIndex === 5) affectedNe = p.cordoned;

  // 置信度揭示(阶段3)
  const confidenceReveal = phaseIndex < 3 ? 0 : phaseIndex === 3 ? easeOut(progress) : 1;
  const confidence: ConfidenceBreakdown | null = confidenceReveal > 0 ? s.confidence : null;
  const route: RouteKey | null = phaseIndex >= 3 && phaseIndex <= 6 ? s.confidence.route : null;

  // 评估揭示(阶段7)
  const evalRevealed = phaseIndex >= 7;
  const evalMetrics: EvalMetrics | null = evalRevealed ? s.evaluation : null;

  // 生成校验揭示(阶段1)
  const generationChecksReveal = phaseIndex < 1 ? 0 : phaseIndex === 1 ? easeOut(progress) : 1;

  // 恢复动作揭示(阶段5) — 两轮场景:
  //   E: 轮1=back-off(1条,部分缓解);轮2=NSSAI+APN 全部
  //   B/C: 轮1 评估未通过→不执行恢复(空);轮2 渐进揭示
  const recoveryActive = phaseIndex === 5 || phaseIndex === 6;
  let recoveryActions: RecoveryAction[] = [];
  let rerouteEdges: string[] = [];
  let cordonedNe: string[] = [];
  if (phaseIndex === 5) {
    if (s.id === "E") {
      const n = eRound === 1 ? Math.min(1, Math.ceil(progress * 1)) : p.recoveryActions.length;
      recoveryActions = p.recoveryActions.slice(0, n);
    } else if (s.id === "F") {
      // F:轮1 揭示 r1_* 前 3 条,轮2 揭示 r2_* 后 3 条,各按 ceil(progress*3) 渐进
      const n = Math.min(3, Math.ceil(progress * 3));
      recoveryActions = eRound === 1 ? p.recoveryActions.slice(0, n) : p.recoveryActions.slice(3, 3 + n);
    } else if (isTwoRound) {
      // B/C:仅二轮执行恢复;轮1评估未通过,recoveryActions 保持空
      if (eRound === 2) {
        const n = Math.ceil(progress * p.recoveryActions.length);
        recoveryActions = p.recoveryActions.slice(0, n);
      }
    } else {
      const n = Math.ceil(progress * p.recoveryActions.length);
      recoveryActions = p.recoveryActions.slice(0, n);
    }
    rerouteEdges = p.rerouteEdges;
    cordonedNe = p.cordoned;
  } else if (phaseIndex === 6) {
    recoveryActions = p.recoveryActions;
    rerouteEdges = p.rerouteEdges;
  }

  const twinMode: StoryState["twinMode"] =
    phaseIndex === 0
      ? "healthy"
      : phaseIndex === 1
        ? "building"
        : phaseIndex >= 2 && phaseIndex <= 4
          ? phaseIndex === 4
            ? "diagnosing"
            : "anomaly"
          : phaseIndex === 5
            ? "recovering"
            : "healed";

  const showAnomaly = phaseIndex >= 2 && phaseIndex <= 5;

  const activeAgent: 0 | 1 | 2 | 3 =
    phaseIndex === 1 ? 1 : phaseIndex >= 2 && phaseIndex <= 5 ? 2 : phaseIndex === 7 ? 3 : 0;

  const rootCause =
    conclusionRevealed || phaseIndex >= 5
      ? { nes: s.predicted.elements, links: s.predicted.links }
      : { nes: [], links: [] };

  // —— 用户级韧性 × 网络自治 · 扩展派生态(随相位确定性揭示)——
  // 当前执行中的推理步(最后揭示的一步)
  const currentStep: ReasonStep | null = reasoningSteps.length ? reasoningSteps[reasoningSteps.length - 1] : null;

  // 对比区「多维探索后」揭示度:phase<4 → 0;phase4 easeOut;phase≥5 → 1
  // (「仅网络KPI」朴素侧在 phase≥2 即出现，由 ComparisonPanel 按 phaseIndex 处理)
  const comparisonReveal = phaseIndex < 4 ? 0 : phaseIndex === 4 ? easeOut(progress) : 1;

  // 用户级 CHR 原因值弹窗(场景 B/C):仅在根因推理阶段(phase 4)展示
  const chrPopup: ChrInsight | null = s.chrInsight && phaseIndex === 4 ? s.chrInsight : null;

  // 均质化比较结果弹窗(场景 A/D):根因推理期间(phase 4)
  const homogenPopup = s.homogen && phaseIndex === 4 ? s.homogen : null;

  // 隔离标注弹窗(场景 A/B/D):执行恢复期间(phase 5，与隔离围栏同步)
  const isolationPopup = s.isolation && phaseIndex === 5 ? s.isolation : null;

  // 流控溯源(场景 D/E):CPU 过载标注(phase≥2)、UFDR 溯源弹窗(phase 4)、流控策略弹窗(phase 5)
  const cpuOverloadNe = phaseIndex >= 2 && s.fault.faultType === "iot_storm" ? s.fault.elements : [];
  const flowControlPopup = s.flowControl && phaseIndex === 5 ? s.flowControl : null;
  // 场景 F 三层并行恢复计划:phase 4 揭示用户分类(breakdown),phase 5 揭示策略(strategies,按 round 区分)
  const recoveryPlan = s.recoveryPlan && (phaseIndex === 4 || phaseIndex === 5) ? s.recoveryPlan : null;
  // E 轮2 UFDR 弹窗(phase 4 第二轮才显示)
  const ufdrPopup = s.id === "E"
    ? (s.ufdr && phaseIndex === 4 && eRound === 2 ? s.ufdr : null)
    : (s.ufdr && phaseIndex === 4 ? s.ufdr : null);

  // 误报拦截(场景 C):phase 2-4 可见，phase≥3 被置信度拦截/划掉
  const falseAlarmActive = !!s.falseAlarm && phaseIndex >= 2 && phaseIndex <= 4;
  const falseAlarmIntercepted = !!s.falseAlarm && phaseIndex >= 3;

  // 用户侧群体异常(场景 C):检测至恢复期间渲染，恢复后清除
  const userLevel = s.userFault ? { gnbs: s.userFault.gnbs, affectedUe: s.userFault.affectedUe, kind: s.userFault.kind } : null;
  const userLevelActive = !!s.userFault && phaseIndex >= 2 && phaseIndex <= 5;

  // 能力沉淀揭示(phase 7)
  const skillReveal = phaseIndex >= 7 ? easeOut(progress) : 0;

  const cap = HEADLINES[phaseIndex];
  const subline = SCENARIO_SUB[s.id]?.[phaseIndex] ?? cap.s;
  return {
    scenarioId: s.id,
    phaseIndex,
    phase,
    phaseProgress: progress,
    globalProgress: clamp(t / dur, 0, 1),
    simT,
    loop,
    round: eRound,
    loopBackKind,
    twinMode,
    showAnomaly,
    affectedNe,
    rootCause,
    recoveryActive,
    recoveryActions,
    rerouteEdges,
    cordonedNe,
    activeAgent,
    route,
    confidence,
    confidenceReveal,
    reasoningSteps,
    reasoningTotal: total,
    evalRevealed,
    evalMetrics,
    generationChecks: GENERATION_CHECKS,
    generationChecksReveal,
    headline: cap.h,
    subline,
    algorithms: algorithmsFor(s, phaseIndex),
    currentStep,
    comparisonReveal,
    chrPopup,
    homogenPopup,
    isolationPopup,
    cpuOverloadNe,
    ufdrPopup,
    flowControlPopup,
    recoveryPlan,
    falseAlarmActive,
    falseAlarmIntercepted,
    userLevel,
    userLevelActive,
    skillReveal,
    simRates,
    simNeCpu,
  };
}
