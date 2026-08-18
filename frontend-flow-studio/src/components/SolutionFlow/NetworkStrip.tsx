// ============================================================================
// NetworkStrip —— 方案图「抽象网络架构」(纯架构速写,不写具体案例)
//   UE ──→ gNB(接入) ──→ 核心网 DC1(NE 按控制/用户/数据/支撑面分组 · 主备冗余)
//   Studio:网元统一中性小胶囊(发丝线),不五颜六色;箭头细线。
// ============================================================================

import type { Scenario } from "../../data/types";

// 核心网 NE 类型(扁平展示,不按面分组)
const CORE_TYPES = ["AMF", "SMF", "UPF", "UDM", "PCF", "AUSF", "NRF", "NSSF"];

export function NetworkStrip({ scenario }: { scenario: Scenario }) {
  const poolCount = new Set((scenario.realGraph?.nodes ?? []).map((n) => n.pool)).size || 4;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* UE */}
      <Endpoint cn="UE" sub="在网 128万" />
      <MiniArrow />
      {/* gNB 接入(基站图标) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: "var(--radius-ctl)",
            border: "1px solid var(--line-2)",
            background: "var(--bg2)",
          }}
        >
          <BaseStationIcon />
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 500, color: "var(--ink-2)", marginTop: 2 }}>gNB</span>
        </div>
        <span style={{ fontSize: 9, color: "var(--ink-4)" }}>RAN 接入</span>
      </div>
      <MiniArrow />
      {/* 核心网容器 */}
      <div style={{ flex: 1, minWidth: 0, borderRadius: "var(--radius-ctl)", border: "1px solid var(--line)", background: "var(--bg-inset)", padding: "6px 10px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.02em" }}>核心网</span>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "var(--ink-4)" }}>{poolCount} POOL · 主备冗余</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {CORE_TYPES.map((t) => (
            <NeChip key={t} type={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Endpoint({ cn: cnT, sub }: { cn: string; sub: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "4px 9px",
        borderRadius: "var(--radius-ctl)",
        border: "1px solid var(--line-2)",
        background: "var(--bg2)",
      }}
    >
      <DeviceIcon />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-1)" }}>{cnT}</span>
        <span className="mono" style={{ fontSize: 8.5, color: "var(--ink-4)" }}>{sub}</span>
      </div>
    </div>
  );
}

function NeChip({ type }: { type: string }) {
  return (
    <div
      className="mono"
      style={{
        padding: "2px 6px",
        minWidth: 30,
        textAlign: "center",
        borderRadius: 4,
        border: "1px solid var(--line-2)",
        background: "var(--bg1)",
        fontSize: 9.5,
        fontWeight: 500,
        color: "var(--ink-3)",
      }}
    >
      {type}
    </div>
  );
}

/** 手机记号(细线) */
function DeviceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="3.5" y="1.5" width="7" height="11" rx="1.6" stroke="var(--ink-3)" strokeWidth="1.1" />
      <line x1="5.8" y1="10.6" x2="8.2" y2="10.6" stroke="var(--ink-3)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** 基站塔记号(细线) */
function BaseStationIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 40 40" fill="none" aria-hidden style={{ overflow: "visible" }}>
      <path d="M 7 15 Q 20 3 33 15" stroke="var(--ink-3)" strokeWidth="1.4" strokeLinecap="round" opacity="0.75" fill="none" />
      <path d="M 12 18 Q 20 10 28 18" stroke="var(--ink-3)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" fill="none" />
      <circle cx="20" cy="11.5" r="1.8" fill="var(--ink-3)" />
      <path d="M 14 35 L 20 14 L 26 35" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="16" y1="27" x2="24" y2="27" stroke="var(--ink-3)" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="17.4" y1="21.5" x2="22.6" y2="21.5" stroke="var(--ink-3)" strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

function MiniArrow() {
  return (
    <svg width={18} height={14} style={{ flexShrink: 0, overflow: "visible" }} aria-hidden>
      <line x1={2} y1={7} x2={11} y2={7} stroke="var(--ink-4)" strokeWidth={1.2} strokeLinecap="round" />
      <polygon points="11,4 17,7 11,10" fill="var(--ink-4)" />
    </svg>
  );
}
