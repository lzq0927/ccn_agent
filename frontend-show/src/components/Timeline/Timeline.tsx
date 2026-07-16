// ============================================================================
// Timeline —— 底部 8 阶段 scrubber:点击跳转 + 全局进度播放头
// ============================================================================

import { PHASES } from "../../theme";
import { PHASE_DURATIONS, LOOP_DURATION } from "../../story/director";
import type { ClockApi } from "../../story/useStoryClock";

export function Timeline({ clock }: { clock: ClockApi }) {
  const { state, seekPhase, time, playheadRef } = clock;
  const total = LOOP_DURATION;

  return (
    <div className="hud" style={{ borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
          闭环时间轴 · LOOP {state.loop + 1}
        </span>
        <div style={{ flex: 1, display: "flex", gap: 4, height: 30, position: "relative" }}>
          {PHASES.map((p, i) => {
            const w = (PHASE_DURATIONS[i] / total) * 100;
            const isCur = state.phaseIndex === i;
            const passed = state.phaseIndex > i;
            return (
              <button
                key={p.id}
                onClick={() => seekPhase(i)}
                style={{
                  flexBasis: `${w}%`,
                  maxWidth: `${w}%`,
                  border: `1px solid ${isCur ? p.color : passed ? `${p.color}55` : "rgba(56,189,248,0.12)"}`,
                  background: isCur ? `${p.color}1f` : passed ? `${p.color}0a` : "var(--bg-panel)",
                  borderRadius: 6,
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                  padding: "3px 7px",
                  textAlign: "left",
                  transition: "all 0.3s ease",
                  boxShadow: isCur ? `0 0 14px ${p.color}44, inset 0 0 12px ${p.color}14` : "none",
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: isCur || passed ? p.glow : "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {i + 1}. {p.cn}
                </div>
                <div style={{ fontSize: 7, letterSpacing: "0.06em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.en}
                </div>
                {isCur && <div className="shimmer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />}
              </button>
            );
          })}
          {/* 全局播放头 —— 由 useStoryClock 的 rAF 直接驱动 DOM，不随 React 渲染节流 */}
          <div ref={playheadRef} style={{ position: "absolute", top: -4, bottom: -4, width: 2, background: "var(--text-bright)", boxShadow: "0 0 8px var(--text-bright)", pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: -3, left: -4, width: 10, height: 10, borderRadius: "50%", background: "var(--text-bright)", boxShadow: "0 0 10px var(--text-bright)" }} />
          </div>
        </div>
        <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
          {time.toFixed(1)}s / {total}s
        </span>
      </div>
    </div>
  );
}
