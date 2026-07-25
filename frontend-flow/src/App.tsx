// ============================================================================
// App —— 高稳智能体 · 方案流程演示
//   纯 DEMO 模式:useStoryClock 确定性回放 A–E 场景(含 D/E 流控溯源两轮)。
//   原 SIM 实时仿真模式与 DEMO 无本质视觉差别,已下线,D/E 统一在 DEMO 中。
// ============================================================================

import { useState } from "react";
import { SCENARIOS, getScenario } from "./data/scenarios";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { SolutionFlow } from "./components/SolutionFlow/SolutionFlow";
import { ExecutionPanel } from "./components/ExecutionPanel/ExecutionPanel";

export default function App() {
  const [scenarioId, setScenarioId] = useState("A");
  const scenario = getScenario(scenarioId);
  const clock = useStoryClock(scenario);
  const { state } = clock;

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar clock={clock} state={state} scenario={scenario} />

        <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
          {/* 左:方案(抽象架构 + AgentLoop) */}
          <div style={{ flex: "0 0 38%", minWidth: 360, display: "flex", minHeight: 0 }}>
            <SolutionFlow state={state} scenario={scenario} />
          </div>

          {/* 右:现场运行(拓扑为主 + 全弹窗),场景 A–E */}
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
      </div>
    </>
  );
}
