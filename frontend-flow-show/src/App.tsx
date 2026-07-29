// ============================================================================
// App —— 高稳智能体 · 方案流程演示(DEMO + LIVE 双模式)
//   DEMO: useStoryClock 确定性回放 A–F(默认,且始终在跑 —— LIVE 的底板)
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
import { useLiveClock } from "./story/useLiveClock";
import { applyEvent, type LiveState } from "./story/liveBus";
import { getCapabilities, openLiveSocket, selectScenario } from "./api/live";
import type { StoryState } from "./story/types";

type Mode = "demo" | "live";

/** LIVE 事件覆盖到 DEMO 底板 —— 只覆盖后端确实推过的字段,其余保留确定性派生值 */
function mergeLive(base: StoryState, live: LiveState): StoryState {
  return {
    ...base,
    scenarioId: live.scenarioId || base.scenarioId,
    phaseIndex: live.phaseIndex || base.phaseIndex,
    round: live.round ?? base.round,
    simT: live.simT || base.simT,
    simNeCpu: Object.keys(live.simNeCpu).length ? live.simNeCpu : base.simNeCpu,
    reasoningSteps: live.recentSteps.length ? live.recentSteps : base.reasoningSteps,
    currentStep: live.recentSteps.length
      ? live.recentSteps[live.recentSteps.length - 1]
      : base.currentStep,
    recoveryActions: live.recoveryActions.length ? live.recoveryActions : base.recoveryActions,
    rootCause: live.activeDiagnosis
      ? { nes: live.activeDiagnosis.faultElements, links: base.rootCause.links }
      : base.rootCause,
    evalMetrics: live.activeEvaluation ?? base.evalMetrics,
    evalRevealed: live.activeEvaluation ? true : base.evalRevealed,
  };
}

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

          {/* 右:交互式拓扑演示(图上点圆圈,带弹窗/箭头/引导),场景 A–F */}
          <div style={{ flex: "1 1 67%", minWidth: 480, display: "flex", minHeight: 0 }}>
            <GuidedStage
              scenario={scenario}
              state={state}
              scenarios={SCENARIOS}
              currentScenarioId={scenarioId}
              onSelectScenario={setScenarioId}
              onPlayUntil={(t) => demoClock.playUntil(t)}
              onSeekTime={(t) => demoClock.seekGlobal(t / demoClock.duration)}
            />
          </div>
        </div>

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
