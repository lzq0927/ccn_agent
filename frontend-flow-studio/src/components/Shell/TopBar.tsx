// ============================================================================
// TopBar —— 顶栏:标识 · 实时叙事 · 时钟控件(播放/变速/主题)
//   Studio 设计:衬线标题 + eyebrow;控件全部收敛为分段控件(选中=表面提级)。
//   DEMO / LIVE 模式切换(不可用时禁用 + title 提示)。
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
  /** 当前模式。缺省 "demo"。 */
  mode?: TopBarMode;
  /** 模式切换回调。缺省 noop。 */
  onModeChange?: (next: TopBarMode) => void;
  /** 场景级 LIVE 能力映射 —— key 为场景 id,value 为该场景支持的最高模式。 */
  liveCapabilities?: Record<string, "live" | "demo">;
}

/** 双支柱徽标:点亮 = 语义色描边,不发光 */
const PILLARS = [
  { key: "userLevel" as const, cn: "用户级韧性", color: "#35b57c" },
  { key: "autonomy" as const, cn: "网络自治", color: "#7d8af2" },
];

/** 品牌记号:细线六边形 + 中心点(靛蓝墨水) */
function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <path
        d="M13 2.6 L22.2 7.8 L22.2 18.2 L13 23.4 L3.8 18.2 L3.8 7.8 Z"
        stroke="var(--accent)"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="var(--accent-wash)"
      />
      <circle cx="13" cy="13" r="2.6" fill="var(--accent)" />
      <circle cx="13" cy="13" r="5.6" stroke="var(--accent)" strokeWidth="0.9" opacity="0.45" fill="none" />
    </svg>
  );
}

/** 播放/暂停:几何记号 */
function PlayGlyph({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1" y="1" width="2.6" height="8" rx="0.6" fill="currentColor" />
      <rect x="6.4" y="1" width="2.6" height="8" rx="0.6" fill="currentColor" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
    </svg>
  );
}

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
    <div className="panel" style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
        {/* 标识 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 208 }}>
          <BrandMark />
          <div>
            <div
              className="font-display"
              style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)", lineHeight: 1.15, letterSpacing: "0.02em" }}
            >
              高稳智能体
            </div>
            <div className="eyebrow" style={{ marginTop: 1 }}>HIGH-STABILITY AGENT · STUDIO</div>
          </div>
        </div>

        {/* 实时叙事:eyebrow 相位 + 衬线标题 */}
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10 }}>
            <span
              className="mono"
              style={{ fontSize: 9, letterSpacing: "0.06em", color: "var(--ink-4)", whiteSpace: "nowrap" }}
            >
              {String(state.phaseIndex).padStart(2, "0")} · {state.phase.en}
            </span>
            <span
              className="font-display"
              style={{ fontSize: 15.5, fontWeight: 600, color: "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {state.headline}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {state.subline}
          </div>
        </div>

        {/* 控件:全部安静分段 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {scenario.pillars && (
            <div style={{ display: "flex", gap: 5 }}>
              {PILLARS.map((p) => {
                const on = scenario.pillars?.[p.key];
                return (
                  <span
                    key={p.key}
                    title={p.cn}
                    className="tag"
                    style={{
                      color: on ? p.color : "var(--ink-5)",
                      borderColor: on ? `${p.color}66` : "var(--line)",
                      transition: "all var(--dur-2) ease",
                    }}
                  >
                    {p.cn}
                  </span>
                );
              })}
            </div>
          )}
          {/* DEMO / LIVE 模式切换 —— 不可用时禁用 */}
          <div className="seg" data-testid="mode-seg" style={{ marginLeft: 4 }}>
            <button
              className={mode === "demo" ? "seg-btn active" : "seg-btn"}
              onClick={() => onModeChange("demo")}
              data-testid="mode-demo"
            >
              DEMO
            </button>
            <button
              className={mode === "live" ? "seg-btn active" : "seg-btn"}
              onClick={() => onModeChange("live")}
              data-testid="mode-live"
              disabled={!canLive}
              title={canLive ? "切到 LIVE(后端实时)" : "该场景暂未支持 LIVE,使用 DEMO"}
            >
              LIVE
            </button>
          </div>
          <button className="icon-btn" onClick={clock.toggle} title={clock.playing ? "暂停" : "播放"} aria-label={clock.playing ? "暂停" : "播放"}>
            <PlayGlyph playing={clock.playing} />
          </button>
          <div className="seg">
            {[0.5, 1, 2].map((sp) => (
              <button key={sp} className={clock.speed === sp ? "seg-btn active" : "seg-btn"} onClick={() => clock.setSpeed(sp)}>
                {sp}×
              </button>
            ))}
          </div>
          <div className="seg">
            {THEMES.map((t) => (
              <button
                key={t}
                className={theme === t ? "seg-btn active" : "seg-btn"}
                onClick={() => setTheme(t)}
                title={`主题 · ${THEME_LABELS[t]}`}
                aria-label={`切换主题为 ${THEME_LABELS[t]}`}
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
