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
  /** 当前诊断-恢复轮次(真实闭环:由后端 round_change 驱动,非剧本) */
  round: number;
  simT: number;
  simNeCpu: Record<string, number>;
  liveKpi: LiveKpi | null;
  amfSrHist: number[];
  smfSrHist: number[];
  /** 每条有向链路的 KPI 滚动时序(画「路径 KPI 曲线」用),cap 60 */
  linkHist: Record<string, number[]>;
  /** per-NE 实例 KPI 滚动时序(AMF 注册 / SMF PDU,cap 60)→ ②弹窗均质化比较曲线 */
  neRegSrHist: Record<string, number[]>;
  nePduSrHist: Record<string, number[]>;
  /** ②异常检测真工具产出(analyze_kpi_anomalies + find_common_ne) */
  anomalyResult: {
    degradedLinks: { src: string; dst: string; minSr: number | null; avgSr: number | null; count: number | null }[];
    topNe: string | null;
    neFrequency: { neId: string; count: number; ratio: number }[];
    neRegSr: Record<string, number>;
    nePduSr: Record<string, number>;
  } | null;
  recentSteps: ReasonStep[];
  /** 当前轮的恢复策略(通用规划器推导;round_change 时重置) */
  recoveryActions: RecoveryAction[];
  /** 全部轮次的恢复策略(按时间序,带轮次标签) */
  allRecoveryActions: RecoveryAction[];
  activeDiagnosis: { faultElements: string[]; faultType: string; confidence: number; route: string } | null;
  activeEvaluation: EvalMetrics | null;
  /** LIVE Agent 的置信度评估(confidence_assessment 事件) */
  confidence: { score: number; route: string; pattern: string } | null;
  /** Agent 1 影子自校验结果(data_validation 事件,注入时发) */
  dataValidation: {
    passed: boolean;
    tries: number;
    checks: { name: string; passed: boolean; note: string }[];
    adjustments: string[];
  } | null;
  /** ④ CHR 洞察(真实数据:原因值分布/共因 NF/类别归因) */
  chrInsight: {
    failTotal: number;
    causeCode: string;
    causeShare: number;
    related: { code: string; share: number }[];
    nes: string[];
    dominantClass: { key: string; failShare: number; baseShare: number } | null;
    round: number;
  } | null;
  /** ④ 均质化比较(真实数据:实例级对比 + 判定) */
  homogen: {
    anchorNe: string | null;
    anchorExclusivity: number;
    rounds: { type: string; verdict: string; note: string; instances: { id: string; anomalous: boolean; sr: number | null }[] }[];
    round: number;
  } | null;
  /** 控制面提示(幂等点击/忙碌守卫等,非错误) */
  controlNote: string | null;
  /** 未恢复 → 下一轮的提示(confidence_low 事件,真实闭环) */
  lowConfidence: { score: number; attempt: number; hint: string } | null;
  /** Agent 3 Skill 沉淀(skill_evolved 事件) */
  skillEvolved: { kind: string; route: string; skillId: string; insight: string } | null;
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
  linkHist: {},
  neRegSrHist: {},
  nePduSrHist: {},
  anomalyResult: null,
  recentSteps: [],
  recoveryActions: [],
  allRecoveryActions: [],
  activeDiagnosis: null,
  activeEvaluation: null,
  confidence: null,
  dataValidation: null,
  chrInsight: null,
  homogen: null,
  controlNote: null,
  lowConfidence: null,
  skillEvolved: null,
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
      // 每条链路 KPI 时序(画路径 KPI 曲线),cap 60;只保留近 12 条链路避免无限增长
      const lsr: Record<string, number> = p.link_sr ?? {};
      const next: Record<string, number[]> = {};
      const ids = Object.keys(lsr);
      for (const id of ids) {
        const prev = st.linkHist[id] ?? [];
        next[id] = [...prev, lsr[id]].slice(-60);
      }
      st.linkHist = next;
      // per-NE 实例 KPI 时序(AMF 注册 / SMF PDU,cap 60)→ ②弹窗均质化比较曲线
      const accumNe = (prevHist: Record<string, number[]>, cur: Record<string, number>): Record<string, number[]> => {
        const h: Record<string, number[]> = {};
        for (const ne of Object.keys(cur)) h[ne] = [...(prevHist[ne] ?? []), cur[ne]].slice(-60);
        return h;
      };
      st.neRegSrHist = accumNe(st.neRegSrHist, p.ne_reg_sr ?? {});
      st.nePduSrHist = accumNe(st.nePduSrHist, p.ne_pdu_sr ?? {});
      break;
    }
    case "anomaly_detection": {
      const d = ev.payload;
      st.anomalyResult = {
        degradedLinks: (d.degraded_links ?? []).map((x: { src: string; dst: string; min_sr: number | null; avg_sr: number | null; count: number | null }) => ({
          src: x.src, dst: x.dst,
          minSr: x.min_sr ?? null, avgSr: x.avg_sr ?? null, count: x.count ?? null,
        })),
        topNe: d.top_ne ?? null,
        neFrequency: (d.ne_frequency ?? []).map((n: { ne_id: string; count: number; ratio: number }) => ({
          neId: n.ne_id, count: n.count, ratio: n.ratio,
        })),
        neRegSr: d.ne_reg_sr ?? {},
        nePduSr: d.ne_pdu_sr ?? {},
      };
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
    case "recovery_action": {
      const action: RecoveryAction = {
        id: ev.payload.id,
        cn: ev.payload.cn,
        en: ev.payload.en,
        layer: ev.payload.layer,
        rationale: ev.payload.rationale,
        round: ev.payload.round ?? st.round,
      };
      st.recoveryActions.push(action);
      st.allRecoveryActions.push(action);
      st.phaseIndex = 5;
      break;
    }
    case "round_change":
      // 真实闭环:未恢复 → 下一轮(重观察→重诊→加强策略);重置当前轮策略列表
      st.round = ev.payload.round ?? st.round + 1;
      st.recoveryActions = [];
      break;
    case "confidence_low":
      st.lowConfidence = {
        score: ev.payload.score ?? 0,
        attempt: ev.payload.current_attempt ?? 0,
        hint: ev.payload.hint ?? "",
      };
      break;
    case "data_validation":
      st.dataValidation = {
        passed: !!ev.payload.passed,
        tries: ev.payload.tries ?? 1,
        checks: ev.payload.checks ?? [],
        adjustments: ev.payload.adjustments ?? [],
      };
      break;
    case "evaluation_report":
      st.activeEvaluation = ev.payload;
      st.phaseIndex = 7;
      break;
    case "chr_insight": {
      const p = ev.payload;
      st.chrInsight = {
        failTotal: p.fail_total ?? 0,
        causeCode: p.cause_code ?? "",
        causeShare: p.cause_share ?? 0,
        related: (p.related ?? []).map((r: { code: string; share: number }) => ({
          code: r.code, share: r.share,
        })),
        nes: p.nes ?? [],
        dominantClass: p.dominant_class
          ? { key: p.dominant_class.key, failShare: p.dominant_class.fail_share, baseShare: p.dominant_class.base_share }
          : null,
        round: p.round ?? 1,
      };
      break;
    }
    case "homogen_report": {
      const p = ev.payload;
      st.homogen = {
        anchorNe: p.anchor_ne ?? null,
        anchorExclusivity: p.anchor_exclusivity ?? 0,
        rounds: (p.rounds ?? []).map((r: { type: string; verdict: string; note: string; instances: { id: string; anomalous: boolean; sr: number | null }[] }) => ({
          type: r.type, verdict: r.verdict, note: r.note,
          instances: (r.instances ?? []).map((i) => ({
            id: i.id, anomalous: !!i.anomalous, sr: i.sr ?? null,
          })),
        })),
        round: p.round ?? 1,
      };
      break;
    }
    case "control_note":
      st.controlNote = ev.payload.message ?? null;
      break;
    case "skill_evolved":
      st.skillEvolved = {
        kind: ev.payload.kind ?? "UPDATE",
        route: ev.payload.route ?? "",
        skillId: ev.payload.skill_id ?? "",
        insight: ev.payload.insight ?? "",
      };
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
  // 不可变发布:store 换新引用 —— useSyncExternalStore 以引用变化判定重渲染,
  // 原地 mutate 会让 LIVE 事件(推理链/策略/评估)到达后永远不触发渲染,
  // 面板冻结在「点击瞬间」的快照(②有数据只因 demoClock 恰好重渲染了一帧)。
  _store.set(sid, { ...st });
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
