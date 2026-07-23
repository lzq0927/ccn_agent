// ============================================================================
// 实时仿真引擎 —— 物联网注册风暴过载场景(D/E 两策略)
//   确定性(种子 RNG)、纯函数 step(state, dt) → 新状态。前端用定时器驱动。
//   时间线(秒,LOOP=52):normal[0,8) → storm[8,14) → detect[14,18) → trace[18,26)
//   → recover[26,36) → healed[36,46) → tail[46,52) → 循环。
//   正常态:UE 已注册,每秒一定比例发起 PDU 会话;故障:物联平台故障→物联终端反复
//   重注册,注册风暴冲击 AMF、会话风暴冲击 SMF,流控扩散影响 2C 手机。智能体实时监测
//   →检测→溯源→D/E 策略恢复。
// ============================================================================

import { SIM_LOOP, type SimEvent, type SimPhase, type SimState, type SimStrategy } from "./types";

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const PHASE_BOUNDARIES: { until: number; phase: SimPhase }[] = [
  { until: 8, phase: "normal" },
  { until: 14, phase: "storm" },
  { until: 18, phase: "detect" },
  { until: 26, phase: "trace" },
  { until: 36, phase: "recover" },
  { until: 46, phase: "healed" },
  { until: SIM_LOOP, phase: "healed" },
];
function phaseAt(t: number): SimPhase {
  for (const b of PHASE_BOUNDARIES) if (t < b.until) return b.phase;
  return "healed";
}

/** recover 阶段已抑制比例(0..1):D 全员支持 back-off 快收敛;E 仅 20% 支持,二轮准入限流 */
function recoveryReduction(t: number, strategy: SimStrategy): number {
  if (t < 26) return 0;
  if (t >= 36) return 1;
  const rp = (t - 26) / 10; // recover 进度 0..1
  if (strategy === "D") return clamp(rp * 1.3, 0, 1);
  // E:首轮 back-off 仅 20%(rp 0~0.5),二轮 NSSAI/APN 准入限流(rp 0.5~1)
  return rp < 0.5 ? 0.2 * (rp / 0.5) : 0.2 + 0.8 * ((rp - 0.5) / 0.5);
}

/** 风暴强度 0..1(故障表象强度,recover 后按策略抑制) */
export function stormIntensityAt(t: number, strategy: SimStrategy): number {
  const phase = phaseAt(t);
  if (phase === "normal" || phase === "healed") return 0;
  let base = 1;
  if (phase === "storm") base = clamp((t - 8) / 6, 0, 1); // 渐起
  if (phase === "recover") base = 1;
  const red = recoveryReduction(t, strategy);
  return clamp(base * (1 - red), 0, 1);
}

export function initSim(strategy: SimStrategy): SimState {
  return {
    t: 0,
    loop: 0,
    phase: "normal",
    strategy,
    amfCpu: 40,
    smfCpu: 38,
    regRate: 20,
    iotRegRate: 5,
    sessionRate: 340,
    twoCThrottle: 0,
    stormIntensity: 0,
    iotBackoffSupport: strategy === "E" ? 0.2 : 1.0,
    nssaiLimit: 0,
    apnLimit: 0,
    ratioAlgo: "PID 反压实调节",
    converged: false,
    agentStep: "",
    events: [],
  };
}

function pad(n: number, w: number) {
  return String(n).padStart(w, "0");
}

/** 由当前状态生成一批 UE 事件(采样,控制数量),追加到事件流(保留最近 14 条) */
function genEvents(s: SimState, dt: number, rng: () => number): SimEvent[] {
  const out: SimEvent[] = [];
  const si = s.stormIntensity;
  const push = (e: SimEvent) => out.push(e);
  const phase = s.phase;

  // 物联重注册(风暴期大量;recover 期 D 全 reject / E 部分准入拒绝)
  const iotRegN = Math.min(3, Math.round((s.iotRegRate * dt) / 60)); // 采样缩放
  for (let i = 0; i < iotRegN; i++) {
    const ue = `IoT_${pad(Math.floor(rng() * 2000), 4)}`;
    let result: SimEvent["result"] = "success";
    let detail = "注册请求";
    if (phase === "recover") {
      if (s.strategy === "D") {
        result = "reject";
        detail = "AMF Registration Reject + back-off";
      } else {
        // E:20% back-off 成功,二轮 NSSAI 准入拒绝
        const inRound2 = s.t >= 31;
        result = inRound2 ? "reject" : rng() < s.iotBackoffSupport ? "success" : "fail";
        detail = inRound2 ? "AMF NSSAI 准入拒绝" : "back-off(20% 支持)";
      }
    }
    push({ t: s.t, ue, group: "IoT", kind: "registration", result, detail });
  }

  // PDU 会话建立(2C + 物联);风暴期 2C 被限流(流控扩散),E 准入期物联被限
  const sessN = Math.min(3, Math.round((s.sessionRate * dt) / 120));
  for (let i = 0; i < sessN; i++) {
    const isIot = rng() < 0.3 + si * 0.4;
    const ue = isIot ? `IoT_${pad(Math.floor(rng() * 2000), 4)}` : `2C_${pad(Math.floor(rng() * 10000), 5)}`;
    let result: SimEvent["result"] = "success";
    let detail = "PDU 会话建立";
    if (!isIot && s.twoCThrottle > 0 && rng() < s.twoCThrottle) {
      result = "throttled";
      detail = "流控扩散·2C 被限流";
    } else if (isIot && phase === "recover" && s.strategy === "E" && s.t >= 31) {
      result = "throttled";
      detail = "SMF APN/DNN 准入拒绝";
    } else if (si > 0.8 && rng() < 0.2) {
      result = "fail";
      detail = "过载·建立失败";
    }
    push({ t: s.t, ue, group: isIot ? "IoT" : "2C", kind: "pdu_session", result, detail });
  }
  return out;
}

function agentStepText(s: SimState): string {
  switch (s.phase) {
    case "normal":
      return "稳态监测:UE 已注册,每秒一定比例发起 PDU 会话;AMF/SMF 负载正常";
    case "storm":
      return "⚠ 物联应用平台故障 → 物联终端反复重注册,注册/会话风暴冲击 AMF/SMF,流控扩散影响 2C 手机";
    case "detect":
      return "异常检测:AMF/SMF 容器 CPU 过载 + 注册/PDU 会话请求突增 → 触发溯源";
    case "trace":
      return s.strategy === "D"
        ? "溯源到物联终端注册风暴 → 决策 UE 侧 back-off(Registration Reject + back-off timer)"
        : "首轮 UE back-off(仅 20% 支持)未收敛 → 二轮 UFDR(SST=3+物联 DNN)溯源 AMF(NSSAI)/SMF(APN)";
    case "recover":
      return s.strategy === "D"
        ? "执行:AMF Reg Reject + back-off timer → 物联重注册收敛"
        : "执行策略2:AMF 限 NSSAI + SMF 限 APN,比例按容量/流量/CPU 反压实调节 → 收敛";
    case "healed":
      return "✓ 收敛:物联冲击下降,2C 用户上网恢复;物联平台恢复后物联终端快速收敛";
  }
}

/** 推进 dt(秒)。rng 为确定性随机源(同一 state+seed → 同一后续)。 */
export function stepSim(prev: SimState, dt: number, rng: () => number): SimState {
  let t = prev.t + dt;
  let loop = prev.loop;
  if (t >= SIM_LOOP) {
    t -= SIM_LOOP;
    loop += 1;
  }
  const phase = phaseAt(t);
  const strategy = prev.strategy;
  const si = stormIntensityAt(t, strategy);

  // 准入限制比(E 二轮,round2 t>=31)
  let nssaiLimit = 0;
  let apnLimit = 0;
  if (strategy === "E" && phase === "recover" && t >= 31) {
    const r2 = clamp((t - 31) / 5, 0, 1);
    nssaiLimit = 0.55 * r2;
    apnLimit = 0.45 * r2;
  }

  const iotRegRate = 5 + si * 895;
  const sessionRate = 340 + si * 560;
  const regRate = 15 + iotRegRate;
  const amfCpu = 40 + si * 52;
  const smfCpu = 38 + si * 50;
  const twoCThrottle = si * 0.35;
  const converged = phase === "healed" || (phase === "recover" && recoveryReduction(t, strategy) >= 0.95);

  const next: SimState = {
    ...prev,
    t,
    loop,
    phase,
    stormIntensity: si,
    iotRegRate,
    sessionRate,
    regRate,
    amfCpu,
    smfCpu,
    twoCThrottle,
    nssaiLimit,
    apnLimit,
    converged,
    agentStep: "",
    events: prev.events,
  };
  next.agentStep = agentStepText(next);

  const newEvents = genEvents(next, dt, rng);
  const events = newEvents.length ? [...newEvents, ...prev.events].slice(0, 14) : prev.events;
  return { ...next, events };
}

export { mulberry32 };
