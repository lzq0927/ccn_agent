// ============================================================================
// Bridge —— 核心网(上) ↔ 高稳智能体(下) 的双向衔接(纯箭头,无框)
//   ↑ 指令上行:字在箭头左边(恢复·策略)
//   ↓ 数据下行:字在箭头右边(KPI·CHR·日志)
//   不加任何外框,仅箭头+文字。网络在上、智能体在下,故箭头垂直。
// ============================================================================

import { motion } from "framer-motion";
import type { StoryState } from "../../story/types";

export function Bridge({ state }: { state: StoryState }) {
  const dataOn = state.phaseIndex >= 1; // 数据下行(采集起持续)
  const cmdOn = state.phaseIndex === 5 || state.phaseIndex === 6; // 指令上行(恢复)

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "4px 0" }}>
      {/* ↑ 指令上行:字在左 */}
      <TextBlock title="指令上行" sub="恢复 · 策略" on={cmdOn} color="#f59e0b" align="right" />
      <Arrow dir="up" on={cmdOn} color="#f59e0b" />
      {/* ↓ 数据下行:字在右 */}
      <Arrow dir="down" on={dataOn} color="#38bdf8" />
      <TextBlock title="数据下行" sub="KPI · CHR · 日志" on={dataOn} color="#38bdf8" align="left" />
    </div>
  );
}

function TextBlock({ title, sub, on, color, align }: { title: string; sub: string; on: boolean; color: string; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, opacity: on ? 1 : 0.6, transition: "opacity 0.4s ease", textAlign: align, minWidth: 92 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: on ? color : "var(--text-mid)" }}>{title}</span>
      <span style={{ fontSize: 9.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{sub}</span>
    </div>
  );
}

function Arrow({ dir, on, color }: { dir: "up" | "down"; on: boolean; color: string }) {
  return (
    <svg width="22" height="46" style={{ flexShrink: 0, overflow: "visible" }}>
      <line x1="11" y1={dir === "down" ? 5 : 41} x2="11" y2={dir === "down" ? 36 : 10} stroke={on ? color : "var(--text-faint)"} strokeWidth="3" strokeLinecap="round" className={on ? "flow-dash" : undefined} />
      <polygon points={dir === "down" ? "4,33 11,44 18,33" : "4,12 11,2 18,12"} fill={on ? color : "var(--text-faint)"} />
      {on && <motion.circle cx="11" cy="20" r="2.8" fill={color} animate={dir === "down" ? { cy: [6, 34] } : { cy: [34, 6] }} transition={{ duration: 1.3, repeat: Infinity, ease: "linear" }} />}
    </svg>
  );
}
