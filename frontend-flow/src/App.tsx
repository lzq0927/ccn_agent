// ============================================================================
// App —— 高稳智能体 · 方案流程演示
//   两种模式(顶栏切换):
//     · DEMO —— 内置样本数据确定性自动循环(场景 A–E),不依赖后端/LLM
//     · SIM  —— 实时仿真模式:UE 实时产生注册/PDU 会话流程,智能体实时监测处置(过载场景 D/E)
//   DEMO 布局:左 SolutionFlow(方案)/ 右 ExecutionPanel(现网运行) / 底 Timeline
// ============================================================================

import { useState } from "react";
import { DEFAULT_SCENARIO_ID, SCENARIOS, getScenario } from "./data/scenarios";
import type { Scenario } from "./data/types";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { Timeline } from "./components/Timeline/Timeline";
import { SolutionFlow } from "./components/SolutionFlow/SolutionFlow";
import { ExecutionPanel } from "./components/ExecutionPanel/ExecutionPanel";
import { SimView } from "./components/Sim/SimView";

export type AppMode = "demo" | "sim";

export default function App() {
  const [mode, setMode] = useState<AppMode>("demo");
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const scenario: Scenario = getScenario(scenarioId);
  const clock = useStoryClock(scenario);
  const { state } = clock;

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar clock={clock} state={state} scenario={scenario} mode={mode} onSelectMode={setMode} />

        {mode === "sim" ? (
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <SimView />
          </div>
        ) : (
          <>
            <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
              {/* 左:方案(抽象架构 + 底部清晰闭环) */}
              <div style={{ flex: "0 0 38%", minWidth: 360, display: "flex", minHeight: 0 }}>
                <SolutionFlow state={state} scenario={scenario} />
              </div>

              {/* 右:现场运行(拓扑为主 · 常驻恒定尺寸 · 全弹窗) */}
              <div style={{ flex: "1 1 62%", minWidth: 460, display: "flex", minHeight: 0 }}>
                <ExecutionPanel
                  scenario={scenario}
                  state={state}
                  scenarios={SCENARIOS}
                  currentScenarioId={scenarioId}
                  onSelectScenario={setScenarioId}
                />
              </div>
            </div>

            <Timeline clock={clock} />
          </>
        )}
      </div>
    </>
  );
}
