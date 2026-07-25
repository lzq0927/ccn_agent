// ============================================================================
// Timeline —— 底部 8 阶段 scrubber:点击跳转 + 全局进度播放头
//   去彩虹:统一 accent(青)状态化 —— 待启动=中性 / 已完成=淡青填充 / 当前=青高亮+脉冲
//   仅当前段保留相位色小圆点作为语义提示。
// ============================================================================

import { PHASE_DURATIONS, LOOP_DURATION } from "../../story/director";
import type { ClockApi } from "../../story/useStoryClock";

export function Timeline({ clock }: { clock: ClockApi }) {
  const { state, seekPhase, time, playheadRef } = clock;
  const total = LOOP_DURATION; // 8 阶段按钮宽度基准(各场景通用)
  const dur = clock.duration; // 实际单轮时长(E 两轮 68s,其余 50s)—— 用于播放头与时间标签
  const cur = state.phaseIndex;

  return (
    <div className="hud" style={{ borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
          闭环时间轴 · LOOP {state.loop + 1}
        </span>
        <div style={{ flex: 1, display: "flex", gap: 4, height: 30, position: "relative" }}>
          {PHASE_DURATIONS.map((d, i) => {
            const w = (d / total) * 100;
            const isCur = cur === i;
            const passed = cur > i;
            // 统一 accent 状态化:待启动=中性 / 已完成=淡青 / 当前=青高亮
            const border = isCur ? "var(--accent)" : passed ? "rgba(56,189,248,0.4)" : "rgba(148,163,184,0.18)";
            const bg = isCur ? "var(--accent-strong)" : passed ? "var(--accent-a12)" : "var(--bg-panel)";
            const labelColor = isCur ? "var(--accent)" : passed ? "var(--text-soft)" : "var(--text-dim)";
            return (
              <button
                key={i}
                onClick={() => seekPhase(i)}
                style={{
                  flexBasis: `${w}%`,
                  maxWidth: `${w}%`,
                  border: `1px solid ${border}`,
                  background: bg,
                  borderRadius: 6,
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                  padding: "3px 7px",
                  textAlign: "left",
                  transition: "all 0.3s ease",
                  boxShadow: isCur ? "0 0 14px var(--accent-glow), inset 0 0 12px var(--accent-medium)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {/* 已完成=对勾 · 当前=相位色脉冲点 */}
                  {passed ? (
                    <span style={{ fontSize: 8, color: "var(--accent)", lineHeight: 1 }}>✓</span>
                  ) : isCur ? (
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: state.phase.color, boxShadow: `0 0 6px ${state.phase.color}`, animation: "blink 1.3s ease-in-out infinite", flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-faint)", flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, color: labelColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i + 1}. {state && i === cur ? state.phase.cn : PHASE_LABELS[i]}
                  </span>
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
          {time.toFixed(1)}s / {dur}s
        </span>
      </div>
    </div>
  );
}

// 静态相位标签(避免引入 PHASES 整数组只为取一行;当前段用 state.phase.cn)
const PHASE_LABELS = ["网络就绪", "数据采集", "异常检测", "策略匹配", "根因推理", "执行恢复", "网络恢复", "评估优化"];
