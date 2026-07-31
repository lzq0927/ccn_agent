// ============================================================================
// liveBus —— LIVE 模式事件总线(per-session 切片)
//   与 StoryState 同形;只 emit/runner_state/reasoning_step/diagnosis_complete
//   recovery_action/evaluation_report/skill_evolved/user_breakdown/error/tick
//   之外的 type 静默忽略(向前兼容)。
// ============================================================================

import type { ReasonStep, EvalMetrics, UserBreakdown } from "../data/types";
import type { RecoveryAction } from "./types";

export type RunnerState =
  | "init" | "simulating" | "diagnosing" | "restart"
  | "recovering" | "evaluating" | "done" | "failed" | "fallback_to_stub"
  | "unknown";

export interface LiveState {
  sessionId: string;
  scenarioId: string;
  runnerState: RunnerState;
  phaseIndex: number;
  progress: number;
  round: 1 | 2;
  simT: number;
  simNeCpu: Record<string, number>;
  liveKpi: LiveKpi | null;
  amfSrHist: number[];
  smfSrHist: number[];
  recentSteps: ReasonStep[];
  recoveryActions: RecoveryAction[];
  activeDiagnosis: { faultElements: string[]; faultType: string; confidence: number; route: string } | null;
  activeEvaluation: EvalMetrics | null;
  /** LIVE Agent 的置信度评估(confidence_assessment 事件) */
  confidence: { score: number; route: string; pattern: string } | null;
  userBreakdown: UserBreakdown | null;
  error: { source: string; message: string; fatal: boolean } | null;
}

export interface LiveKpi {
  amfSuccessRate: number; smfSuccessRate: number;
  amfRegRequests: number; smfPduRequests: number;
  iotRegRate: number; tocRegRate: number; iotSessRate: number; tocSessRate: number;
  amfCpu: number; smfCpu: number;
  linkAnomalies: { src: string; dst: string; successRate: number }[];
}

const _initial = (sid: string, scn: string): LiveState => ({
  sessionId: sid,
  scenarioId: scn,
  runnerState: "unknown",
  phaseIndex: 0,
  progress: 0,
  round: 1,
  simT: 0,
  simNeCpu: {},
  liveKpi: null,
  amfSrHist: [],
  smfSrHist: [],
  recentSteps: [],
  recoveryActions: [],
  activeDiagnosis: null,
  activeEvaluation: null,
  confidence: null,
  userBreakdown: null,
  error: null,
});

const _store: Map<string, LiveState> = new Map();
const _subs: Map<string, Set<() => void>> = new Map();

function _notify(sid: string) {
  const subs = _subs.get(sid);
  if (subs) subs.forEach((cb) => cb());
}

export function resetLiveBus() {
  _store.clear();
  _subs.clear();
}

export function applyEvent(sid: string, scn: string, ev: { type: string; payload: any }) {
  let st = _store.get(sid);
  if (!st) {
    st = _initial(sid, scn);
    _store.set(sid, st);
  }
  switch (ev.type) {
    case "runner_state":
      st.runnerState = ev.payload.state as RunnerState;
      break;
    case "phase_change":
      // 后端点击触发阶段推进(覆盖 DEMO 没有的 0/1/2/6 相位)
      st.phaseIndex = ev.payload.phase ?? st.phaseIndex;
      break;
    case "tick":
      st.simT = ev.payload.sim_t ?? st.simT;
      if (ev.payload.ne_cpu) st.simNeCpu = ev.payload.ne_cpu;
      break;
    case "kpi_snapshot": {
      const p = ev.payload;
      st.liveKpi = {
        amfSuccessRate: p.amf_success_rate ?? 0,
        smfSuccessRate: p.smf_success_rate ?? 0,
        amfRegRequests: p.amf_reg_requests ?? 0,
        smfPduRequests: p.smf_pdu_requests ?? 0,
        iotRegRate: p.iot_reg_rate ?? 0,
        tocRegRate: p.toc_reg_rate ?? 0,
        iotSessRate: p.iot_sess_rate ?? 0,
        tocSessRate: p.toc_sess_rate ?? 0,
        amfCpu: p.amf_cpu ?? 0,
        smfCpu: p.smf_cpu ?? 0,
        linkAnomalies: (p.link_anomalies ?? []).map((a: { src: string; dst: string; success_rate: number }) => ({
          src: a.src, dst: a.dst, successRate: a.success_rate,
        })),
      };
      // 滚动历史(sparkline 用),cap 60
      st.amfSrHist = [...st.amfSrHist, st.liveKpi.amfSuccessRate].slice(-60);
      st.smfSrHist = [...st.smfSrHist, st.liveKpi.smfSuccessRate].slice(-60);
      break;
    }
    case "reasoning_step":
      st.recentSteps.push(ev.payload as ReasonStep);
      break;
    case "confidence_assessment":
      // 推 phaseIndex=3 (策略匹配)+ 记录真 Agent 置信度/路由/模式
      st.phaseIndex = 3;
      st.confidence = {
        score: ev.payload.score ?? 0,
        route: ev.payload.route ?? "workflow",
        pattern: (ev.payload.matched_patterns?.[0] ?? ev.payload.breakdown?.patternName ?? ""),
      };
      break;
    case "diagnosis_complete":
      st.activeDiagnosis = {
        faultElements: ev.payload.fault_elements ?? [],
        faultType: ev.payload.fault_type ?? "unknown",
        confidence: ev.payload.confidence ?? 0,
        route: ev.payload.route ?? "workflow",
      };
      st.phaseIndex = 4;
      break;
    case "recovery_action":
      st.recoveryActions.push({
        id: ev.payload.id,
        cn: ev.payload.cn,
        en: ev.payload.en,
      });
      st.phaseIndex = 5;
      break;
    case "evaluation_report":
      st.activeEvaluation = ev.payload;
      st.phaseIndex = 7;
      break;
    case "skill_evolved":
      // 暂合入 evaluation
      break;
    case "user_breakdown":
      st.userBreakdown = ev.payload as UserBreakdown;
      break;
    case "error":
      st.error = {
        source: ev.payload.source ?? "unknown",
        message: ev.payload.message ?? "",
        fatal: !!ev.payload.fatal,
      };
      if (ev.payload.fatal) st.runnerState = "failed";
      break;
    default:
      // 忽略未知事件
      break;
  }
  _notify(sid);
}

export function getLiveState(sid: string): LiveState {
  return _store.get(sid) ?? _initial(sid, "unknown");
}

/** 确保 _store 里有 sid 的条目(供 useSyncExternalStore 稳定 snapshot),不触发通知。 */
export function ensureLiveState(sid: string, scn: string): LiveState {
  let st = _store.get(sid);
  if (!st) {
    st = _initial(sid, scn);
    _store.set(sid, st);
  }
  return st;
}

export const liveBus = {
  subscribe(sid: string, cb: () => void): () => void {
    if (!_subs.has(sid)) _subs.set(sid, new Set());
    _subs.get(sid)!.add(cb);
    return () => {
      _subs.get(sid)?.delete(cb);
    };
  },
};
