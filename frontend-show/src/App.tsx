// ============================================================================
// App —— 高稳智能体 · 5GC 数字孪生指挥中心(沉浸式三栏布局)
//   左:大脑架构(Brain)  中:数字孪生(DigitalTwin)  右:阶段详情面板
//   顶:TopBar  底:Timeline
// ============================================================================

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DEFAULT_SCENARIO_ID, SCENARIOS, getScenario } from "./data/scenarios";
import { fetchHealth } from "./data/api";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { Timeline } from "./components/Timeline/Timeline";
import { Brain } from "./components/Brain/Brain";
import { DigitalTwin } from "./components/DigitalTwin/DigitalTwin";
import { GenerationPanel } from "./components/panels/GenerationPanel";
import { KpiPanel } from "./components/panels/KpiPanel";
import { ConfidencePanel } from "./components/panels/ConfidencePanel";
import { ReasoningTrace } from "./components/panels/ReasoningTrace";
import { RecoveryPanel } from "./components/panels/RecoveryPanel";
import { EvaluationPanel } from "./components/panels/EvaluationPanel";

export default function App() {
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const scenario = getScenario(scenarioId);
  const clock = useStoryClock(scenario);
  const { state } = clock;

  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [liveConnected, setLiveConnected] = useState(false);

  useEffect(() => {
    if (mode !== "live") {
      setLiveConnected(false);
      return;
    }
    let alive = true;
    const poll = async () => {
      const ok = await fetchHealth();
      if (alive) setLiveConnected(ok);
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode]);

  const renderPanel = () => {
    switch (state.phaseIndex) {
      case 1:
        return <GenerationPanel scenario={scenario} state={state} />;
      case 2:
      case 6:
        return <KpiPanel scenario={scenario} state={state} />;
      case 3:
        return <ConfidencePanel state={state} />;
      case 4:
        return <ReasoningTrace state={state} />;
      case 5:
        return <RecoveryPanel state={state} />;
      case 7:
        return <EvaluationPanel state={state} />;
      default:
        return <KpiPanel scenario={scenario} state={state} />;
    }
  };

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar
          clock={clock}
          state={state}
          scenarios={SCENARIOS}
          scenario={scenario}
          onSelectScenario={setScenarioId}
          mode={mode}
          onToggleMode={() => setMode((m) => (m === "demo" ? "live" : "demo"))}
          liveConnected={liveConnected}
        />

        <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
          {/* 左:大脑 */}
          <div style={{ width: 304, minWidth: 304, display: "flex", minHeight: 0 }}>
            <Brain state={state} />
          </div>

          {/* 中:数字孪生 */}
          <div className="hud" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div className="hud-head">
              <span className="title">
                <span className="dot" />
                数字孪生 · 网络本体
              </span>
              <span style={{ color: "#5f6f87" }}>{scenario.cn} · {scenario.en}</span>
            </div>
            <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
              <DigitalTwin scenario={scenario} state={state} />
            </div>
          </div>

          {/* 右:阶段详情 */}
          <div style={{ width: 376, minWidth: 376, display: "flex", minHeight: 0 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={state.phaseIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28 }}
                style={{ width: "100%", height: "100%" }}
              >
                {renderPanel()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <Timeline clock={clock} />

        {/* live 模式提示条 */}
        {mode === "live" && (
          <div style={{ position: "fixed", bottom: 12, right: 16, fontSize: 9, color: liveConnected ? "#22c55e" : "#ef4444", fontFamily: "var(--font-mono)", background: "rgba(4,7,15,0.8)", padding: "4px 9px", borderRadius: 6, border: `1px solid ${liveConnected ? "#22c55e44" : "#ef444444"}` }}>
            {liveConnected ? "● 后端已连接 · /health 200" : "● 后端离线 · 运行 uvicorn api.app:app --port 8000"}
          </div>
        )}
      </div>
    </>
  );
}
