// ============================================================================
// TopBar —— 顶栏:标识 · 实时叙事 · 场景/模式/时钟控件
// ============================================================================

import type { Scenario } from "../../data/types";
import type { ClockApi } from "../../story/useStoryClock";
import type { StoryState } from "../../story/types";
import { STATUS } from "../../theme";
import { THEMES, THEME_LABELS, useTheme } from "./ThemeContext";

interface Props {
  clock: ClockApi;
  state: StoryState;
  scenario: Scenario;
  mode: "demo" | "live" | "sim";
  onToggleMode: () => void;
  liveConnected: boolean;
}

/** 双主题徽标(始终展示，按当前场景 pillars 点亮) */
const PILLARS = [
  { key: "userLevel" as const, cn: "用户级韧性", color: "#34d399" },
  { key: "autonomy" as const, cn: "网络自治", color: "#a78bfa" },
];

export function TopBar({ clock, state, scenario, mode, onToggleMode, liveConnected }: Props) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="hud" style={{ borderRadius: 10, padding: "8px 16px", display: "flex", alignItems: "center", gap: 16 }}>
      {/* 标识 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 230 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg, var(--accent), var(--accent-violet))", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px var(--accent-glow)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2 L4 7 L4 17 L12 22 L20 17 L20 7 Z" stroke="#04070f" strokeWidth="2" fill="none" />
            <circle cx="12" cy="12" r="3.2" fill="#04070f" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.04em", color: "var(--text-bright)", lineHeight: 1.1 }}>高稳智能体</div>
          <div style={{ fontSize: 8.5, letterSpacing: "0.16em", color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>HIGH STABILITY AGENT · 5GC DIGITAL TWIN</div>
        </div>
      </div>

      {/* 实时叙事 */}
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, border: `1px solid ${state.phase.color}66`, color: state.phase.glow, background: `${state.phase.color}14`, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            PHASE {state.phaseIndex} · {state.phase.en}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-bright)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state.headline}</span>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-mid)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state.subline}</div>
      </div>

      {/* 控件 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* 双主题徽标(用户级韧性 × 网络自治)*/}
        {scenario.pillars && (
          <div style={{ display: "flex", gap: 5 }}>
            {PILLARS.map((p) => {
              const on = scenario.pillars?.[p.key];
              return (
                <span
                  key={p.key}
                  title={p.cn}
                  style={{
                    fontSize: 9,
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.04em",
                    color: on ? p.color : "var(--text-faint)",
                    border: `1px solid ${on ? p.color + "88" : "rgba(71,85,105,0.4)"}`,
                    background: on ? p.color + "1a" : "transparent",
                    boxShadow: on ? `0 0 9px ${p.color}55` : "none",
                    whiteSpace: "nowrap",
                    transition: "all 0.4s ease",
                  }}
                >
                  {on ? "●" : "○"} {p.cn}
                </span>
              );
            })}
          </div>
        )}

        {/* 播放/暂停 */}
        <button className="btn" onClick={clock.toggle} title={clock.playing ? "暂停" : "播放"} style={{ minWidth: 38 }}>
          {clock.playing ? "❚❚" : "▶"}
        </button>

        {/* 变速 */}
        <div style={{ display: "flex", gap: 3, padding: 3, border: "1px solid var(--border)", borderRadius: 7 }}>
          {[0.5, 1, 2].map((sp) => (
            <button key={sp} className={clock.speed === sp ? "btn active" : "btn"} onClick={() => clock.setSpeed(sp)} style={{ padding: "4px 7px", fontSize: 9.5 }}>
              {sp}×
            </button>
          ))}
        </div>

        {/* 模式:DEMO → LIVE → SIM → DEMO */}
        <button className={mode !== "demo" ? "btn active" : "btn"} onClick={onToggleMode} title="演示 / 真实后端 / 实时仿真" style={{ fontSize: 9.5 }}>
          {mode === "live" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: liveConnected ? STATUS.healthy : STATUS.fault, boxShadow: `0 0 6px ${liveConnected ? STATUS.healthy : STATUS.fault}` }} />
              LIVE
            </span>
          ) : mode === "sim" ? (
            "SIM 实时仿真"
          ) : (
            "DEMO"
          )}
        </button>

        {/* 主题:深邃 / 暮光 / 明亮 */}
        <div style={{ display: "flex", gap: 3, padding: 3, border: "1px solid var(--border)", borderRadius: 7 }}>
          {THEMES.map((t) => (
            <button
              key={t}
              className={theme === t ? "btn active" : "btn"}
              onClick={() => setTheme(t)}
              title={`主题 · ${THEME_LABELS[t]}`}
              aria-label={`切换主题为 ${THEME_LABELS[t]}`}
              style={{ padding: "4px 7px", fontSize: 9.5 }}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
