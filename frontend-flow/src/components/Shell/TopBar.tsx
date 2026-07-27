// ============================================================================
// TopBar —— 顶栏:标识 · 实时叙事 · 时钟控件(播放/变速/主题)
//   (场景选择已移至右栏 ExecutionPanel;frontend-flow 纯 DEMO 自动播放)
//   新增:DEMO / LIVE 模式切换(不可用时降级 + title 提示)
// ============================================================================

import type { Scenario } from "../../data/types";
import type { ClockApi } from "../../story/useStoryClock";
import type { StoryState } from "../../story/types";
import { THEMES, THEME_LABELS, useTheme } from "./ThemeContext";

/** 顶栏模式 —— DEMO 走确定性回放,LIVE 接真实后端事件流 */
export type TopBarMode = "demo" | "live";

interface Props {
  clock: ClockApi;
  state: StoryState;
  scenario: Scenario;
  /** 当前模式。缺省 "demo"。T7.2 接入后由 App 显式传入。 */
  mode?: TopBarMode;
  /** 模式切换回调。缺省 noop(显示 toggle 但点击无效)。 */
  onModeChange?: (next: TopBarMode) => void;
  /**
   * 场景级 LIVE 能力映射 —— key 为场景 id,value 为该场景支持的最高模式。
   * 缺省 = 所有场景都不可切 LIVE(LIVE 按钮禁用)。
   */
  liveCapabilities?: Record<string, "live" | "demo">;
}

/** 双主题徽标(始终展示,按当前场景 pillars 点亮)—— 对齐收敛色板 */
const PILLARS = [
  { key: "userLevel" as const, cn: "用户级韧性", color: "#34d399" },
  { key: "autonomy" as const, cn: "网络自治", color: "#2dd4bf" },
];

export function TopBar({
  clock,
  state,
  scenario,
  mode = "demo",
  onModeChange = () => {},
  liveCapabilities = {},
}: Props) {
  const { theme, setTheme } = useTheme();
  const canLive = liveCapabilities[scenario.id] === "live";
  return (
    <div className="hud" style={{ borderRadius: 10, padding: "8px 16px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
        {/* 标识 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 200 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, var(--accent), var(--accent-violet))", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px var(--accent-glow)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2 L4 7 L4 17 L12 22 L20 17 L20 7 Z" stroke="#04070f" strokeWidth="2" fill="none" />
              <circle cx="12" cy="12" r="3.2" fill="#04070f" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.04em", color: "var(--text-bright)", lineHeight: 1.1 }}>高稳智能体</div>
            <div style={{ fontSize: 8, letterSpacing: "0.16em", color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>HIGH STABILITY AGENT · FLOW</div>
          </div>
        </div>

        {/* 实时叙事 */}
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, border: `1px solid ${state.phase.color}66`, color: state.phase.glow, background: `${state.phase.color}14`, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
              PHASE {state.phaseIndex} · {state.phase.en}
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text-bright)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state.headline}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-mid)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state.subline}</div>
        </div>

        {/* 控件 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {scenario.pillars && (
            <div style={{ display: "flex", gap: 5 }}>
              {PILLARS.map((p) => {
                const on = scenario.pillars?.[p.key];
                return (
                  <span
                    key={p.key}
                    title={p.cn}
                    style={{
                      fontSize: 8.5,
                      padding: "3px 7px",
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
          {/* DEMO / LIVE 模式切换 —— 不可用时降级 */}
          <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
            <button
              className={mode === "demo" ? "btn active" : "btn"}
              onClick={() => onModeChange("demo")}
              data-testid="mode-demo"
            >
              DEMO
            </button>
            <button
              className={mode === "live" ? "btn active" : "btn"}
              onClick={() => onModeChange("live")}
              data-testid="mode-live"
              disabled={!canLive}
              title={
                canLive
                  ? "切到 LIVE(后端实时)"
                  : "该场景暂未支持 LIVE,使用 DEMO"
              }
            >
              {canLive ? "切到 LIVE" : "LIVE 不可用"}
            </button>
          </div>
          <button className="btn" onClick={clock.toggle} title={clock.playing ? "暂停" : "播放"} style={{ minWidth: 36 }}>
            {clock.playing ? "❚❚" : "▶"}
          </button>
          <div style={{ display: "flex", gap: 3, padding: 3, border: "1px solid var(--border)", borderRadius: 7 }}>
            {[0.5, 1, 2].map((sp) => (
              <button key={sp} className={clock.speed === sp ? "btn active" : "btn"} onClick={() => clock.setSpeed(sp)} style={{ padding: "4px 7px", fontSize: 9.5 }}>
                {sp}×
              </button>
            ))}
          </div>
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
    </div>
  );
}
