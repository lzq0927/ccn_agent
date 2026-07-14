// ============================================================================
// ComparisonPanel —— 拓扑下方对比区(建议2)
//   左:仅网络聚合 KPI 的朴素视角(漏判 / 误报)
//   右:多维探索后的准确识别
//   左侧在 phase≥2 出现,右侧随 comparisonReveal(phase4+)揭示。
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { STATUS } from "../../theme";

interface Props {
  scenario: Scenario;
  state: StoryState;
}

const KIND: Record<string, { color: string; tag: string }> = {
  miss: { color: STATUS.warning, tag: "漏判" },
  falsealarm: { color: STATUS.fault, tag: "误报" },
  hit: { color: "var(--accent)", tag: "可定位" },
};

export function ComparisonPanel({ scenario, state }: Props) {
  const cmp = scenario.comparison;
  if (!cmp) return null;

  const phase = state.phaseIndex;
  const leftOn = phase >= 2;
  const rev = state.comparisonReveal; // 右侧揭示 0..1
  const k = KIND[cmp.naive.kind ?? "miss"] ?? KIND.miss;

  return (
    <div className="hud" style={{ borderRadius: 10, padding: "7px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>诊断对比</span>
        <span style={{ fontSize: 9.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>NAIVE NETWORK VIEW ↔ MULTI-DIM EXPLORATION</span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        {/* 左:朴素网络视角 */}
        <Card
          title={cmp.naive.title}
          verdict={cmp.naive.verdict}
          detail={cmp.naive.detail}
          color={k.color}
          tag={k.tag}
          opacity={leftOn ? 1 : 0.3}
          dim={!leftOn}
        />

        {/* 中:探索箭头 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 64, opacity: 0.4 + 0.6 * rev }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginBottom: 3 }}>多维探索</div>
          <svg width="54" height="20" viewBox="0 0 54 20">
            <line x1="2" y1="10" x2="44" y2="10" stroke={STATUS.healthy} strokeWidth="1.4" strokeDasharray="3 3" className={rev > 0.05 ? "flow-dash-fast" : undefined} opacity={0.5 + 0.5 * rev} />
            <path d="M40 5 L48 10 L40 15" fill="none" stroke={STATUS.healthy} strokeWidth="1.6" opacity={0.6 + 0.4 * rev} />
          </svg>
          <div style={{ fontSize: 9.5, color: STATUS.healthy, fontFamily: "var(--font-mono)", marginTop: 2 }}>{rev > 0.5 ? "已收敛" : "探索中"}</div>
        </div>

        {/* 右:多维探索后 */}
        <Card
          title={cmp.explored.title}
          verdict={cmp.explored.verdict}
          detail={cmp.explored.detail}
          color={STATUS.healthy}
          tag={rev > 0.6 ? "精准命中" : "推理中"}
          opacity={0.25 + 0.75 * rev}
          dim={rev < 0.05}
          done={rev > 0.9}
        />
      </div>
    </div>
  );
}

function Card({
  title,
  verdict,
  detail,
  color,
  tag,
  opacity,
  dim,
  done,
}: {
  title: string;
  verdict: string;
  detail: string;
  color: string;
  tag: string;
  opacity: number;
  dim?: boolean;
  done?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        borderRadius: 8,
        padding: "7px 9px",
        border: `1px solid ${color}${dim ? "33" : "66"}`,
        background: `${color}${dim ? "08" : "12"}`,
        opacity,
        transition: "opacity 0.5s ease, border-color 0.5s ease",
        boxShadow: done ? `0 0 14px ${color}33` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, padding: "2px 7px", borderRadius: 3, color, border: `1px solid ${color}66`, fontFamily: "var(--font-mono)" }}>
          {done ? "✓ " : ""}
          {tag}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: done || !dim ? "var(--text-bright)" : "var(--text-mid)", lineHeight: 1.3 }}>{verdict}</div>
      <div style={{ fontSize: 11, color: "var(--text-detail)", marginTop: 4, lineHeight: 1.45 }}>{detail}</div>
    </div>
  );
}
