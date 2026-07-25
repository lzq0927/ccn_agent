// ============================================================================
// NetworkStrip —— 方案图「抽象网络架构」(纯架构速写,不写具体案例)
//   UE ──→ gNB(接入) ──→ 核心网 DC1(NE 按控制/用户/数据/支撑面分组 · 主备冗余)
//   抽象层:不渲染故障/根因/隔离等案例状态(那些→右侧拓扑弹窗)。仅展示架构与 NE 类型。
// ============================================================================

import type { Scenario } from "../../data/types";

// 方案层网元统一单色(不五颜六色)
const NE_COLOR = "#38bdf8";

// 核心网 NE 类型(扁平展示,不按面分组)
const CORE_TYPES = ["AMF", "SMF", "UPF", "UDM", "PCF", "AUSF", "NRF", "NSSF"];

export function NetworkStrip({ scenario }: { scenario: Scenario }) {
  const poolCount = new Set((scenario.realGraph?.nodes ?? []).map((n) => n.pool)).size || 4;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      {/* UE */}
      <Endpoint icon="📱" cn="UE" sub="在网 128万" />
      <MiniArrow />
      {/* gNB 接入(基站图标) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", padding: "3px 6px", borderRadius: 8, border: `1px solid ${NE_COLOR}55`, background: `${NE_COLOR}14` }}>
          <BaseStationIcon color={NE_COLOR} />
          <span style={{ fontSize: 10, fontWeight: 800, color: NE_COLOR, fontFamily: "var(--font-mono)", marginTop: 1 }}>gNB 基站</span>
        </div>
        <span style={{ fontSize: 9, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>RAN 接入</span>
      </div>
      <MiniArrow />
      {/* 核心网容器 */}
      <div style={{ flex: 1, minWidth: 0, borderRadius: 8, border: "1px dashed rgba(56,189,248,0.35)", background: "var(--accent-a12)", padding: "6px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "0.04em" }}>核心网</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{poolCount} ResourcePool · 主备冗余</span>
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

function Endpoint({ icon, cn: cnT, sub }: { icon: string; cn: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-panel-solid)" }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-bright)" }}>{cnT}</span>
        <span style={{ fontSize: 9, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{sub}</span>
      </div>
    </div>
  );
}

function NeChip({ type }: { type: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3px 5px", minWidth: 30, borderRadius: 6, border: `1px solid ${NE_COLOR}55`, background: `${NE_COLOR}14` }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: NE_COLOR, fontFamily: "var(--font-mono)" }}>{type}</span>
    </div>
  );
}

/** 基站塔图标(信号弧 + 塔 + 天线) */
function BaseStationIcon({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 40 40" style={{ overflow: "visible" }}>
      {/* 信号弧 */}
      <path d="M 6 16 Q 20 2 34 16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      <path d="M 11 19 Q 20 9 29 19" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
      {/* 天线顶 */}
      <circle cx="20" cy="11" r="2.2" fill={color} />
      {/* 塔身(A 形) */}
      <path d="M 13 36 L 20 13 L 27 36" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* 横梁 */}
      <line x1="15.5" y1="27" x2="24.5" y2="27" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="17" y1="21" x2="23" y2="21" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

function MiniArrow() {
  return (
    <svg width={18} height={14} style={{ flexShrink: 0, overflow: "visible" }}>
      <line x1={2} y1={7} x2={12} y2={7} stroke="var(--text-detail)" strokeWidth={1.5} strokeLinecap="round" className="flow-dash" />
      <polygon points="12,3 18,7 12,11" fill="var(--text-detail)" />
    </svg>
  );
}
