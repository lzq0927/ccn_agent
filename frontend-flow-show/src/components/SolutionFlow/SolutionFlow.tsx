// ============================================================================
// SolutionFlow —— 方案流程图(纵向:网络架构 + 高稳智能体[3 Agent 闭环])
//   上:网络侧(UE→gNB→核心网) ↕双向桥(箭头,内容清晰)
//   下:🧠 高稳智能体大盒子 —— 内嵌 AgentLoop(3 Agent + Agent2 内部6步 + 3 个闭环),
//      填满空间、结构清晰。纯抽象方案,不绑场景。
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { NetworkStrip } from "./NetworkStrip";
import { Bridge } from "./Bridge";
import { AgentLoop } from "./AgentLoop";

export function SolutionFlow({ state, scenario }: { state: StoryState; scenario: Scenario }) {
  return (
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderTop: "2px solid #2dd4bf", boxShadow: "inset 0 2px 0 rgba(45,212,191,0.12)" }}>
      <div className="hud-head">
        <span className="title">
          <span className="dot" style={{ background: "#2dd4bf", boxShadow: "0 0 6px #2dd4bf" }} />
          方案流程
          <span style={{ fontSize: 8, fontWeight: 800, color: "#2dd4bf", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginLeft: 6, padding: "1px 5px", borderRadius: 3, background: "rgba(45,212,191,0.12)", border: "1px solid rgba(45,212,191,0.4)" }}>方案 · PLAN</span>
        </span>
        <span style={{ fontSize: 9.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>
          步骤 {state.phaseIndex}/7 · {state.phase.cn}
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, padding: "9px 11px", minHeight: 0 }}>
        {/* 上:网络架构(抽象) */}
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel cn="网络架构 · NETWORK" en="UE → gNB → 5GC 核心" />
          <NetworkStrip scenario={scenario} />
          <Bridge state={state} />
        </div>

        {/* 下:🧠 高稳智能体(大盒子,内嵌 3 Agent 闭环图) */}
        <BrainBox state={state} />
      </div>
    </div>
  );
}

function SectionLabel({ cn: cnT, en }: { cn: string; en: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 3, height: 11, background: "var(--accent)", borderRadius: 2 }} />
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-bright)", letterSpacing: "0.02em" }}>{cnT}</span>
      <span style={{ fontSize: 9, color: "var(--text-mid)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>{en}</span>
    </div>
  );
}

/** 高稳智能体大盒子:头部 + AgentLoop(3 Agent + 6 步 + 3 闭环) */
function BrainBox({ state }: { state: StoryState }) {
  const active = state.phaseIndex >= 1;
  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        padding: "8px 10px",
        border: `1.5px solid ${active ? "rgba(45,212,191,0.6)" : "var(--border-strong)"}`,
        background: active ? "linear-gradient(180deg, rgba(45,212,191,0.07), rgba(45,212,191,0.02))" : "var(--bg-panel-solid)",
        boxShadow: active ? "0 0 22px rgba(45,212,191,0.18), inset 0 0 30px rgba(45,212,191,0.04)" : "none",
        transition: "all 0.4s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span style={{ fontSize: 15 }}>🧠</span>
        <div>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-bright)" }}>高稳智能体</span>
          <span style={{ fontSize: 9.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginLeft: 7 }}>3 AGENT · 故障感知 6 步 · 3 个闭环</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <AgentLoop state={state} />
      </div>
    </div>
  );
}
