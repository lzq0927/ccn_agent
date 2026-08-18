// ============================================================================
// SolutionFlow —— 方案流程图(纵向:网络架构 + 高稳智能体[3 Agent 闭环])
//   上:网络侧(UE→gNB→核心网) ↕双向桥(细线箭头)
//   下:高稳智能体大盒子 —— 内嵌 AgentLoop(3 Agent + Agent2 内部6步 + 3 个闭环)。
//   Studio:发丝线面板 + 衬线标题;工作时描边转靛蓝,无辉光。
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { NetworkStrip } from "./NetworkStrip";
import { Bridge } from "./Bridge";
import { AgentLoop } from "./AgentLoop";

export function SolutionFlow({ state, scenario }: { state: StoryState; scenario: Scenario }) {
  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="panel-head">
        <span className="title">
          <span className="tick" />
          方案流程
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
          {String(state.phaseIndex).padStart(2, "0")} / 07 · {state.phase.cn}
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", minHeight: 0 }}>
        {/* 上:网络架构(抽象) */}
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel cn="网络架构" en="NETWORK" />
          <NetworkStrip scenario={scenario} />
          <Bridge state={state} />
        </div>

        {/* 下:高稳智能体(大盒子,内嵌 3 Agent 闭环图) */}
        <BrainBox state={state} />
      </div>
    </div>
  );
}

function SectionLabel({ cn: cnT, en }: { cn: string; en: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.02em" }}>{cnT}</span>
      <span className="eyebrow" style={{ fontSize: 8.5 }}>{en}</span>
      <span style={{ flex: 1, height: 1, background: "var(--line)", alignSelf: "center" }} />
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
        borderRadius: "var(--radius-card)",
        padding: "9px 10px",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-wash)" : "var(--bg-inset)",
        transition: "border-color var(--dur-2) ease, background var(--dur-2) ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <BrainGlyph active={active} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>高稳智能体</span>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>3 AGENT · 6 STEPS · 3 LOOPS</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <AgentLoop state={state} />
      </div>
    </div>
  );
}

/** 脑回线记号(工作=靛蓝,静息=墨灰) */
function BrainGlyph({ active }: { active: boolean }) {
  const col = active ? "var(--accent)" : "var(--ink-4)";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M9 2 C5.8 2 3.5 4.2 3.5 7.2 C2.2 8 1.6 9.5 2 11 C2.5 12.8 4.2 14 6.2 13.8 C7 15 8 15.6 9.3 15.6 C10.6 15.6 11.7 15 12.4 13.9 C14.5 14 16.2 12.7 16.5 10.8 C16.8 9.2 15.9 7.7 14.4 7 C14.3 4.2 12 2 9 2 Z"
        stroke={col}
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M9 3.5 L9 14" stroke={col} strokeWidth="0.9" opacity="0.7" />
      <path d="M5.5 7 C6.5 7.6 6.5 9.4 5.5 10" stroke={col} strokeWidth="0.9" opacity="0.7" fill="none" />
      <path d="M12.5 7 C11.5 7.6 11.5 9.4 12.5 10" stroke={col} strokeWidth="0.9" opacity="0.7" fill="none" />
    </svg>
  );
}
