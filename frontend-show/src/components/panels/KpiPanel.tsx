// ============================================================================
// KpiPanel —— 网络总体 KPI 时序 + 故障窗阴影 + 当前游标 + 代表性链路 sparkline
// ============================================================================

import { getKpi } from "../../story/director";
import { sample, type KpiBundle } from "../../data/kpi";
import { DEMO_GRAPH, type NetworkGraph } from "../../data/network";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { STATUS, srColor } from "../../theme";
import { HudFrame } from "../shared/HudFrame";

const CW = 320;
const CH = 116;
const SR_LO = 0.8;
const SR_HI = 1.0;

function yOf(sr: number) {
  const v = Math.max(SR_LO, Math.min(SR_HI, sr));
  return CH - ((v - SR_LO) / (SR_HI - SR_LO)) * CH;
}

export function KpiPanel({
  scenario,
  state,
  graph,
  kpi: kpiProp,
}: {
  scenario: Scenario;
  state: StoryState;
  graph?: NetworkGraph;
  kpi?: KpiBundle;
}) {
  const g = graph ?? DEMO_GRAPH;
  const kpi = kpiProp ?? getKpi(scenario);
  const series = kpi.overall;
  const steps = series.length;
  const cur = sample(series, state.simT);
  const min = Math.min(...series);
  const xOf = (i: number) => (i / (steps - 1)) * CW;
  const linePath = series.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${CW} ${CH} L 0 ${CH} Z`;
  const winX0 = xOf(kpi.faultStart - 1);
  const winX1 = xOf(kpi.faultEnd - 1);
  const curX = xOf(Math.max(0, Math.min(steps - 1, state.simT - 1)));

  // 代表性劣化链路 sparkline
  // 按劣化严重度(窗内最低点)排序后取前 5 —— 让根因直连链路(如 SMF↔UDM)优先于轻度传播链路(AMF↔SMF)显现
  const degradedEdges = g.flowEdges
    .filter((e) => kpi.edges[e.id]?.some((v) => v < kpi.threshold))
    .sort((a, b) => Math.min(...kpi.edges[a.id]) - Math.min(...kpi.edges[b.id]))
    .slice(0, 5);

  return (
    <HudFrame title="网络 KPI · 实时遥测" subtitle="OVERALL SUCCESS RATE" right={<LiveTag on={state.showAnomaly} />}>
      <div style={{ fontSize: 11, color: "#9fb0c9", marginBottom: 6 }}>
        全网 <b style={{ color: "#eaf4ff" }}>{g.flowEdges.length}</b> 条业务链路聚合成功率 · <span style={{ color: STATUS.warning }}>动态阈值</span>
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" height={CH} style={{ display: "block" }}>
        {/* 故障窗阴影 */}
        <rect x={winX0} y={0} width={Math.max(2, winX1 - winX0)} height={CH} fill="rgba(239,68,68,0.1)" />
        <line x1={winX0} y1={0} x2={winX0} y2={CH} stroke="rgba(239,68,68,0.3)" strokeDasharray="2 3" />
        <line x1={winX1} y1={0} x2={winX1} y2={CH} stroke="rgba(239,68,68,0.3)" strokeDasharray="2 3" />
        {/* 阈值线 */}
        <line x1={0} y1={yOf(kpi.threshold)} x2={CW} y2={yOf(kpi.threshold)} stroke="rgba(245,158,11,0.4)" strokeDasharray="3 4" />
        <text x={4} y={yOf(kpi.threshold) - 3} fontSize={8} fill="rgba(245,158,11,0.75)" fontFamily="var(--font-mono)">动态阈值</text>
        {/* 面积+线 */}
        <path d={areaPath} fill={`${srColor(cur)}22`} />
        <path d={linePath} fill="none" stroke={srColor(cur)} strokeWidth={1.8} style={{ filter: `drop-shadow(0 0 4px ${srColor(cur)})` }} />
        {/* 当前游标 */}
        <line x1={curX} y1={0} x2={curX} y2={CH} stroke={srColor(cur)} strokeWidth={1} opacity={0.6} />
        <circle cx={curX} cy={yOf(cur)} r={3.2} fill={srColor(cur)} style={{ filter: `drop-shadow(0 0 5px ${srColor(cur)})` }} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, gap: 6 }}>
        <Stat label="当前" value={`${(cur * 100).toFixed(2)}%`} color={srColor(cur)} />
        <Stat label="最低" value={`${(min * 100).toFixed(2)}%`} color={STATUS.fault} />
        <Stat label="故障窗" value={`T${kpi.faultStart}-${kpi.faultEnd}`} color={STATUS.warning} />
        <Stat label="游标" value={`T${state.simT.toFixed(0)}`} color="#38bdf8" />
      </div>

      {/* 代表链路 sparkline */}
      {degradedEdges.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid rgba(56,189,248,0.12)", paddingTop: 8 }}>
          <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#5f6f87", fontFamily: "var(--font-mono)", marginBottom: 6 }}>DEGRADED LINKS · SPARKLINE</div>
          {degradedEdges.map((e) => {
            const es = kpi.edges[e.id];
            const ecv = sample(es, state.simT);
            const SW = 200;
            const SH = 20;
            const sy = (v: number) => SH - ((Math.max(SR_LO, Math.min(SR_HI, v)) - SR_LO) / (SR_HI - SR_LO)) * SH;
            const sPath = es.map((v, i) => `${i === 0 ? "M" : "L"} ${((i / (es.length - 1)) * SW).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ width: 96, fontSize: 9, color: "#8a9bb5", fontFamily: "var(--font-mono)" }}>
                  {g.nodeById[e.a]?.id}↔{g.nodeById[e.b]?.id}
                </span>
                <svg style={{ flex: 1 }} height={SH} viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none">
                  <path d={sPath} fill="none" stroke={srColor(ecv)} strokeWidth={1.4} />
                </svg>
                <span style={{ fontSize: 9, color: srColor(ecv), fontFamily: "var(--font-mono)", width: 44, textAlign: "right" }}>{(ecv * 100).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </HudFrame>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 8, letterSpacing: "0.08em", color: "#5f6f87", fontFamily: "var(--font-mono)" }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "var(--font-mono)", marginTop: 1 }}>{value}</div>
    </div>
  );
}

function LiveTag({ on }: { on: boolean }) {
  return (
    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: on ? "rgba(239,68,68,0.18)" : "rgba(34,197,94,0.15)", color: on ? STATUS.faultGlow : STATUS.healthy, border: `1px solid ${on ? "rgba(239,68,68,0.4)" : "rgba(34,197,94,0.35)"}`, fontFamily: "var(--font-mono)" }}>
      {on ? "● ANOMALY" : "● NOMINAL"}
    </span>
  );
}
