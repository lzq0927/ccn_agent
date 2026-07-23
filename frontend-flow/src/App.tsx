// ============================================================================
// App —— 高稳智能体 · 方案流程演示(两栏布局)
//   左:方案流程图(SolutionFlow · 纵向架构+流程:网络侧 / 双向连接 / 高稳智能体[MessageBus+3Agent+Storage] + 嵌入 6 步流水线+双 loop,自动推进)
//   右:方案运行(ExecutionPanel · 上=大拓扑常驻 / 下=阶段执行详情,8 相位全覆盖)
//   顶:TopBar(场景 A/B/C 切换·唯一入口)  底:Timeline
//   纯 DEMO 模式:内置样本数据确定性自动循环,不依赖后端/LLM。
//   切换场景自动重置到 phase 0(useStoryClock 在 scenario.id 变化时重置)。
// ============================================================================

import { useState } from "react";
import { DEFAULT_SCENARIO_ID, SCENARIOS, getScenario } from "./data/scenarios";
import type { Scenario } from "./data/types";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { Timeline } from "./components/Timeline/Timeline";
import { SolutionFlow } from "./components/SolutionFlow/SolutionFlow";
import { ExecutionPanel } from "./components/ExecutionPanel/ExecutionPanel";

export default function App() {
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const scenario: Scenario = getScenario(scenarioId);
  const clock = useStoryClock(scenario);
  const { state } = clock;

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar
          clock={clock}
          state={state}
          scenario={scenario}
        />

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
      </div>
    </>
  );
}
