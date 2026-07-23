// ============================================================================
// 实时仿真类型 —— 过载场景(物联网注册风暴)的实时事件仿真
//   UE 实时产生注册 / PDU 会话建立流程;高稳智能体实时监测并处置(D/E 两策略)。
// ============================================================================

export type SimPhase = "normal" | "storm" | "detect" | "trace" | "recover" | "healed";
export type SimStrategy = "D" | "E";

export type SimEventKind = "registration" | "pdu_session";
export type SimEventResult = "success" | "reject" | "throttled" | "fail";

export interface SimEvent {
  t: number; // 仿真秒
  ue: string; // UE id,如 "IoT_1287" / "2C_04213"
  group: "2C" | "IoT";
  kind: SimEventKind;
  result: SimEventResult;
  detail?: string;
}

export interface SimState {
  t: number; // 仿真秒(0..LOOP)
  loop: number; // 第几轮
  phase: SimPhase;
  strategy: SimStrategy;

  // —— 实时指标 ——
  amfCpu: number; // AMF 容器 CPU%(0-100)
  smfCpu: number; // SMF 容器 CPU%(0-100)
  regRate: number; // 注册请求速率(次/s,总)
  iotRegRate: number; // 物联终端重注册速率(次/s)
  sessionRate: number; // PDU 会话建立速率(次/s)
  twoCThrottle: number; // 2C 手机会话被限流比例(0-1,流控扩散)
  stormIntensity: number; // 风暴强度 0..1(派生用)

  // —— 策略状态 ——
  iotBackoffSupport: number; // 支持 back-off 的物联终端占比(E=0.2,D=1.0)
  nssaiLimit: number; // E:NSSAI 准入限制比 0..1
  apnLimit: number; // E:APN 准入限制比 0..1
  ratioAlgo: string; // 比例算法标签
  converged: boolean;

  // —— 智能体实时叙事 ——
  agentStep: string;

  // —— UE 事件流(最近,有上限)——
  events: SimEvent[];
}

export const SIM_LOOP = 52; // 单轮仿真时长(s)
