// ============================================================================
// App —— 高稳智能体 · 方案流程演示(DEMO + LIVE 双模式)
//   DEMO: useStoryClock 确定性回放 A–D(默认,且始终在跑 —— LIVE 的底板)
//   LIVE: useLiveClock 订阅后端 WS 事件流,把实时字段叠加到 DEMO 底板上
//         (LiveState 只覆盖 StoryState 的一个子集,其余仍走 director 派生,
//          保证 SolutionFlow / ExecutionPanel 永远拿到完整的 StoryState)
//   降级: capabilities 拉取失败 / select 失败 / WS 断线 → 自动回 DEMO 并提示
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { SCENARIOS, getScenario } from "./data/scenarios";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { SolutionFlow } from "./components/SolutionFlow/SolutionFlow";
import { GuidedStage } from "./components/Guide/GuidedStage";
import { StepAxis } from "./components/StepAxis/StepAxis";
import { useLiveClock } from "./story/useLiveClock";
import { applyEvent, type LiveState } from "./story/liveBus";
import { getCapabilities, openLiveSocket, selectScenario, control } from "./api/live";
import { walkStops } from "./story/director";
import type { StoryState } from "./story/types";

type Mode = "demo" | "live";

/** LIVE 事件覆盖到 DEMO 底板 —— 只覆盖后端确实推过的字段,其余保留确定性派生值。
 *  注意:phaseIndex 不取 live.phaseIndex —— 后端 phase_change 异步到达会滞后于点击,
 *  导致弹窗显示「上一个相位」(点异常检测显示数据采集…)。相位由圆圈点击直接驱动
 *  (GuidedStage 定位 demoClock → base.phaseIndex),后端只负责产出数据事件。
 *  round 取 live(真实闭环:后端 round_change 驱动,可与 DEMO 剧本轮次不同)。 */
function mergeLive(base: StoryState, live: LiveState): StoryState {
  // Agent 1 影子自校验结果 → 覆盖 5 维校验灯的真实通过状态
  const generationChecks = live.dataValidation
    ? base.generationChecks.map((c) => {
        const hit = live.dataValidation!.checks.find((v) => v.name === c.key);
        return hit ? { ...c, passed: hit.passed } : c;
      })
    : base.generationChecks;
  // 真实评估已到 → 「评估未通过」回路由真实结果驱动(recovered=false 且多轮)
  const liveLoopBack =
    live.activeEvaluation && live.activeEvaluation.recovered === false && (live.round ?? 1) > 1
      ? ("loop2" as const)
      : null;
  return {
    ...base,
    scenarioId: live.scenarioId || base.scenarioId,
    phaseIndex: base.phaseIndex,
    round: live.round ?? base.round,
    simT: live.simT || base.simT,
    simNeCpu: Object.keys(live.simNeCpu).length ? live.simNeCpu : base.simNeCpu,
    liveKpi: live.liveKpi ?? base.liveKpi,
    amfSrHist: live.amfSrHist.length ? live.amfSrHist : base.amfSrHist,
    smfSrHist: live.smfSrHist.length ? live.smfSrHist : base.smfSrHist,
    linkHist: live.linkHist ?? base.linkHist,
    neRegSrHist: live.neRegSrHist ?? base.neRegSrHist,
    nePduSrHist: live.nePduSrHist ?? base.nePduSrHist,
    anomalyResult: live.anomalyResult ?? base.anomalyResult,
    liveConfidence: live.confidence ?? base.liveConfidence,
    evalMetrics: live.activeEvaluation ?? base.evalMetrics,
    evalRevealed: live.activeEvaluation ? true : base.evalRevealed,
    reasoningSteps: live.recentSteps.length ? live.recentSteps : base.reasoningSteps,
    currentStep: live.recentSteps.length
      ? live.recentSteps[live.recentSteps.length - 1]
      : base.currentStep,
    recoveryActions: live.recoveryActions.length ? live.recoveryActions : base.recoveryActions,
    generationChecks,
    loopBackKind: live.activeEvaluation ? liveLoopBack : base.loopBackKind,
    rootCause: live.activeDiagnosis
      ? { nes: live.activeDiagnosis.faultElements, links: base.rootCause.links }
      : base.rootCause,
  };
}

/** 圆圈点击 → 后端 control 动作(LIVE 模式;phase 1/4/6 仅视觉,不发后端) */
const PHASE_ACTION: Record<number, string> = {
  2: "inject_fault", // 异常检测 → 注入故障 + 真异常检测工具
  3: "match",        // 策略匹配 → 真置信度评估
  4: "root",         // 根因推理 → 真 Agent Loop
  5: "apply_policy", // 下发策略 → 真回灌仿真
  7: "evaluate",     // 评估优化 → 检查恢复
};

export default function App() {
  const [scenarioId, setScenarioId] = useState("A");
  const [mode, setMode] = useState<Mode>("demo");
  const [capabilities, setCapabilities] = useState<Record<string, "live" | "demo">>({});
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  // ws 放 ref:关闭是副作用清理,不该触发重渲染(放 state 会让 effect 自身依赖变化)
  const wsRef = useRef<WebSocket | null>(null);

  const scenario = getScenario(scenarioId);
  const demoClock = useStoryClock(scenario);
  const liveClock = useLiveClock(liveSessionId ?? "_", scenarioId, demoClock);

  // 启动时拉 capabilities;失败仅告警,继续 DEMO
  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch((e) => console.warn("capabilities failed:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // 模式 / 场景变化 → 该场景支持 LIVE 时建 session + WS,否则清理回 DEMO
  useEffect(() => {
    const closeWs = () => {
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null; // 主动关不触发降级提示
          wsRef.current.close();
        } catch {
          /* 忽略 */
        }
        wsRef.current = null;
      }
    };

    if (mode !== "live" || capabilities[scenarioId] !== "live") {
      closeWs();
      setLiveSessionId(null);
      return;
    }

    let cancelled = false;
    selectScenario(scenarioId)
      .then((resp) => {
        if (cancelled) return;
        if (resp.demo) {
          // 后端只给了 DEMO 占位 —— 静默留在 DEMO
          setMode("demo");
          return;
        }
        setLiveSessionId(resp.session_id);
        setLiveError(null);
        wsRef.current = openLiveSocket(
          resp.session_id,
          (ev) => applyEvent(resp.session_id, scenarioId, ev),
          () => {
            setLiveError("WS 断线,自动回 DEMO");
            setMode("demo");
          },
        );
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLiveError(`select 失败: ${e.message};自动回 DEMO`);
        setMode("demo");
      });

    return () => {
      cancelled = true;
      closeWs();
    };
  }, [mode, scenarioId, capabilities]);

  const isLive = mode === "live" && liveSessionId !== null;
  const state = isLive ? mergeLive(demoClock.state, liveClock.state) : demoClock.state;
  const playheadRef = isLive ? liveClock.playheadRef : demoClock.playheadRef;

  // LIVE:仅在 session 建立时定位到「数据采集」相位(phase 1)——之后完全由圆圈点击驱动
  // (GuidedStage 定位 demoClock)。不在每次后端 phase_change 时定位 —— 那会异步滞后,
  // 导致弹窗显示上一个相位(点异常检测却显示数据采集)。
  useEffect(() => {
    if (!isLive) return;
    const stops = walkStops(scenario);
    const stop = stops.find((s) => s.phase === 1);
    if (stop) demoClock.seekGlobal(stop.time / demoClock.duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, scenario.id]);

  // LIVE:真实闭环进入下一轮(round_change)→ 时间轴定位到该轮的「数据采集」停靠点
  // (DEMO 底板作为展示骨架;数据/轮次/结果全部来自后端真实事件)
  useEffect(() => {
    if (!isLive || liveClock.state.round <= 1) return;
    const stops = walkStops(scenario);
    const stop = stops.find((s) => s.phase === 1 && s.round === liveClock.state.round)
      ?? stops.find((s) => s.phase === 1);
    if (stop) demoClock.seekGlobal(stop.time / demoClock.duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveClock.state.round, scenario.id]);

  // LIVE:圆圈点击触发后端阶段(注入故障 / 诊断 / 下发策略 / 评估)
  const onPhaseTrigger = (phase: number) => {
    if (!isLive || !liveSessionId) return;
    const action = PHASE_ACTION[phase];
    if (action) void control(liveSessionId, action);
  };

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar
          clock={{ ...demoClock, state, playheadRef }}
          state={state}
          scenario={scenario}
          mode={mode}
          onModeChange={setMode}
          liveCapabilities={capabilities}
        />

        <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
          {/* 左:方案(抽象架构 + AgentLoop) */}
          <div style={{ flex: "0 0 33%", minWidth: 340, display: "flex", minHeight: 0 }}>
            <SolutionFlow state={state} scenario={scenario} />
          </div>

          {/* 右:弹窗式拓扑演示(全宽画布+点击圆圈弹出),场景 A–D */}
          <div style={{ flex: "1 1 67%", minWidth: 480, display: "flex", minHeight: 0 }}>
            <GuidedStage
              scenario={scenario}
              state={state}
              scenarios={SCENARIOS}
              currentScenarioId={scenarioId}
              onSelectScenario={setScenarioId}
              onPlayUntil={(t) => demoClock.playUntil(t)}
              onSeekTime={(t) => demoClock.seekGlobal(t / demoClock.duration)}
              onPhaseTrigger={onPhaseTrigger}
              isLive={isLive}
              playing={demoClock.playing}
            />
          </div>
        </div>

        {/* 底部全宽:闭环步骤长轴(8/12/14 步,当前步高亮 + 一句话结论) */}
        <StepAxis scenario={scenario} state={state} playheadRef={playheadRef} />

        {liveError && (
          <div
            data-testid="live-error"
            style={{ position: "fixed", bottom: 12, right: 12, background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", color: "#fca5a5", padding: "8px 12px", borderRadius: 6, fontSize: 12 }}
          >
            {liveError}
          </div>
        )}
      </div>
    </>
  );
}
