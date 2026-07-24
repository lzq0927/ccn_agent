// ============================================================================
// App —— 高稳智能体 · 方案流程演示
//   两种模式(顶栏切换),共用同一套主可视化(拓扑 + AgentLoop + 弹窗 + Timeline):
//     · DEMO —— useStoryClock 确定性回放 A–E 场景
//     · SIM  —— useSimClock 实时仿真引擎驱动(UE 实时注册/PDU 会话,全网 CPU 实时)
//   SIM 模式的"场景选择"即策略 D/E(ExecutionPanel 顶部切换)。
// ============================================================================

import { useState } from "react";
import { SCENARIOS, getScenario } from "./data/scenarios";
import type { Scenario } from "./data/types";
import { useStoryClock } from "./story/useStoryClock";
import { useSimClock } from "./story/useSimClock";
import { TopBar } from "./components/Shell/TopBar";
import { SolutionFlow } from "./components/SolutionFlow/SolutionFlow";
import { ExecutionPanel } from "./components/ExecutionPanel/ExecutionPanel";

export type AppMode = "demo" | "sim";

const SIM_SCENARIOS = SCENARIOS.filter((s) => s.id === "D" || s.id === "E");

export default function App() {
  const [mode, setMode] = useState<AppMode>("demo");
  const [scenarioId, setScenarioId] = useState("A");
  const [simStrategy, setSimStrategy] = useState<"D" | "E">("D");

  const isSim = mode === "sim";
  const demoScenario = getScenario(scenarioId);
  const simScenario = getScenario(simStrategy);

  // 两个 clock 都常驻(rAF),按模式取用。SIM 用 simStrategy 对应的 D/E 场景。
  const demoClock = useStoryClock(demoScenario);
  const simClock = useSimClock(simScenario, simStrategy);

  const clock = isSim ? simClock : demoClock;
  const scenario: Scenario = isSim ? simScenario : demoScenario;
  const { state } = clock;

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar
          clock={clock}
          state={state}
          scenario={scenario}
          mode={mode}
          onSelectMode={setMode}
        />

        <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
          {/* 左:方案(抽象架构 + AgentLoop) */}
          <div style={{ flex: "0 0 38%", minWidth: 360, display: "flex", minHeight: 0 }}>
            <SolutionFlow state={state} scenario={scenario} />
          </div>

          {/* 右:现场运行(拓扑为主 + 全弹窗)。
              DEMO:场景 A–E;SIM:策略 D/E(场景选择器即策略切换) */}
          <div style={{ flex: "1 1 62%", minWidth: 460, display: "flex", minHeight: 0 }}>
            <ExecutionPanel
              scenario={scenario}
              state={state}
              scenarios={isSim ? SIM_SCENARIOS : SCENARIOS}
              currentScenarioId={isSim ? simStrategy : scenarioId}
              onSelectScenario={isSim ? (id) => setSimStrategy(id as "D" | "E") : setScenarioId}
            />
          </div>
        </div>
      </div>
    </>
  );
}
