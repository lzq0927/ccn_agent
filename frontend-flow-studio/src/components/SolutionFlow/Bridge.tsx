// ============================================================================
// Bridge —— 核心网(上) ↔ 高稳智能体(下) 的双向衔接(细线箭头,无框)
//   ↑ 指令上行(靛蓝)   ↓ 数据下行(钢蓝)
//   Studio:细杆 + 小三角 + 微字标签,唯一动效是慢速数据点。
// ============================================================================
import type { StoryState } from "../../story/types";

export function Bridge({ state }: { state: StoryState }) {
  const dataOn = state.phaseIndex >= 1; // 数据下行(采集起持续)
  const cmdOn = state.phaseIndex === 5 || state.phaseIndex === 6; // 指令上行(恢复)

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "4px 0" }}>
      {/* ↑ 指令上行:字在左 */}
      <TextBlock title="指令上行" sub="恢复 · 策略" on={cmdOn} color="#7d8af2" align="right" />
      <Arrow dir="up" on={cmdOn} color="#7d8af2" />
      {/* ↓ 数据下行:字在右 */}
      <Arrow dir="down" on={dataOn} color="#6f9fd8" />
      <TextBlock title="数据下行" sub="KPI · CHR · 日志" on={dataOn} color="#6f9fd8" align="left" />
    </div>
  );
}

function TextBlock({ title, sub, on, color, align }: { title: string; sub: string; on: boolean; color: string; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, opacity: on ? 1 : 0.45, transition: "opacity var(--dur-2) ease", textAlign: align, minWidth: 92 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: on ? color : "var(--ink-4)" }}>{title}</span>
      <span className="mono" style={{ fontSize: 9, color: "var(--ink-4)", marginTop: 1 }}>{sub}</span>
    </div>
  );
}

function Arrow({ dir, on, color }: { dir: "up" | "down"; on: boolean; color: string }) {
  return (
    <svg width="20" height="42" style={{ flexShrink: 0, overflow: "visible" }} aria-hidden>
      <line
        x1="10"
        y1={dir === "down" ? 6 : 36}
        x2="10"
        y2={dir === "down" ? 32 : 10}
        stroke={on ? color : "var(--ink-5)"}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={on ? 0.9 : 0.6}
      />
      <polygon
        points={dir === "down" ? "6,31 10,38 14,31" : "6,11 10,4 14,11"}
        fill={on ? color : "var(--ink-5)"}
        opacity={on ? 0.95 : 0.6}
      />
      {on && (
        <circle r="1.8" fill={color}>
          <animateMotion dur="1.6s" repeatCount="indefinite" path={dir === "down" ? "M10,7 L10,31" : "M10,31 L10,7"} />
        </circle>
      )}
    </svg>
  );
}
