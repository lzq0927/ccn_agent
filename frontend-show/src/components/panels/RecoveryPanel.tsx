// ============================================================================
// RecoveryPanel —— 高稳智能体恢复动作日志(合成执行器,确定性脚本)
//   说明:真实系统闭环为 诊断→评估→建议,无执行器;此处按确定性脚本
//   演绎「下发恢复策略 → 网络自愈」,对应数字孪生的隔离/重路由/主备切换。
// ============================================================================

import type { StoryState } from "../../story/types";
import { STATUS } from "../../theme";
import { HudFrame } from "../shared/HudFrame";

export function RecoveryPanel({ state }: { state: StoryState }) {
  const actions = state.recoveryActions;
  const done = state.phaseIndex >= 6;
  const total = actions.length || 1;

  return (
    <HudFrame
      title="执行恢复动作 · 网络自愈"
      subtitle="HIGH STABILITY AUTO-RECOVERY"
      right={<span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, color: done ? STATUS.recovered : STATUS.faultGlow, border: `1px solid ${done ? STATUS.recovered : STATUS.fault}55`, fontFamily: "var(--font-mono)" }}>{done ? "● HEALED" : "● EXECUTING"}</span>}
    >
      <div style={{ fontSize: 10, color: "var(--text-mid)", marginBottom: 8, lineHeight: 1.5 }}>
        高稳智能体基于根因 <span style={{ color: "#fb7185" }}>{state.rootCause.nes.join(", ") || state.rootCause.links.join(", ")}</span> 下发恢复策略,数字孪生执行隔离 / 重路由 / 主备切换。
      </div>

      {/* 自愈进度 */}
      <div style={{ height: 8, borderRadius: 4, background: "var(--accent-soft)", overflow: "hidden", marginBottom: 10, border: "1px solid rgba(56,189,248,0.15)" }}>
        <div
          style={{
            height: "100%",
            width: `${((done ? total : actions.length) / total) * 100}%`,
            background: `linear-gradient(90deg, ${STATUS.warning}, ${STATUS.recovered})`,
            boxShadow: `0 0 10px ${STATUS.recovered}88`,
            transition: "width 0.5s ease",
          }}
          className={done ? undefined : "shimmer"}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {actions.map((a, i) => {
          const isLast = i === actions.length - 1 && !done;
          return (
            <div
              key={a.id}
              style={{
                display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 7,
                border: `1px solid ${isLast ? STATUS.warning + "66" : STATUS.recovered + "33"}`,
                background: isLast ? "rgba(245,158,11,0.08)" : "rgba(16,185,129,0.06)",
                animation: "float-up 0.4s ease",
              }}
            >
              <div
                style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)",
                  color: isLast ? STATUS.warning : STATUS.recovered, border: `1px solid ${isLast ? STATUS.warning : STATUS.recovered}`,
                  background: `${isLast ? STATUS.warning : STATUS.recovered}14`,
                  animation: isLast ? "blink 1.2s infinite" : undefined,
                }}
              >
                {isLast ? "▶" : "✓"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--text-bright)", fontWeight: 600 }}>{a.cn}</div>
                <div style={{ fontSize: 8.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{a.en}</div>
              </div>
            </div>
          );
        })}
        {actions.length === 0 && <div style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center", padding: "16px 0" }}>等待根因确认后下发恢复策略…</div>}
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border)", fontSize: 9, color: "var(--text-faint)", lineHeight: 1.5 }}>
        <span style={{ color: STATUS.recovered }}>●</span> 恢复后 KPI 回升,数字孪生验证业务成功率恢复至基线,进入评估闭环。
      </div>
    </HudFrame>
  );
}
