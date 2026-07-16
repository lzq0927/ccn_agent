// ============================================================================
// KpiPanel —— 异常检测 · CHR + KPI 双线监测
//   CHR曲线(上):原因值多维时序(降噪→聚类)—— 既有噪声(慢性)排除 / 突变即异常
//   KPI曲线(下):逐链路成功率时序(异常检测→时空求解)+ 代表链路曲线
// ============================================================================

import { getKpi } from "../../story/director";
import { buildChrSeries, sample, TIMESTEPS, type ChrSeries, type KpiBundle } from "../../data/kpi";
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
  // 检测前(phase<2):不显示异常 —— 全时段曲线，但故障窗内拉平为健康基线(完整时间段、无异常);
  // 检测后(phase≥2，含网络恢复):显示真实曲线(含异常与恢复)
  const showDetails = state.phaseIndex >= 2;
  const inWin = (i: number) => {
    const t = i + 1;
    return t >= kpi.faultStart && t < kpi.faultEnd;
  };
  const displaySeries = showDetails ? series : series.map((v, i) => (inWin(i) ? 0.998 : v));
  const cur = sample(displaySeries, state.simT);
  const min = Math.min(...displaySeries);
  const xOf = (i: number) => (i / (steps - 1)) * CW;
  const linePath = displaySeries.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${CW} ${CH} L 0 ${CH} Z`;
  const winX0 = xOf(kpi.faultStart - 1);
  const winX1 = xOf(kpi.faultEnd - 1);
  const curX = xOf(Math.max(0, Math.min(steps - 1, state.simT - 1)));

  // 代表性链路曲线 —— 劣化 + 正常(均质化对照)
  const degradedEdges = g.flowEdges
    .filter((e) => kpi.edges[e.id]?.some((v) => v < kpi.threshold))
    .sort((a, b) => Math.min(...kpi.edges[a.id]) - Math.min(...kpi.edges[b.id]));
  const typeOf = (id: string) => id.replace(/_\d+$/, "");
  const isDegradedEdge = (id: string) => !!kpi.edges[id]?.some((v) => v < kpi.threshold);
  const healthyEdges: typeof g.flowEdges = [];
  for (const d of degradedEdges) {
    for (const e of g.flowEdges) {
      if (isDegradedEdge(e.id) || healthyEdges.includes(e)) continue;
      const shareA = e.a === d.a || e.a === d.b;
      const shareB = e.b === d.a || e.b === d.b;
      if (shareA === shareB) continue;
      const shared = shareA ? e.a : e.b;
      const otherD = d.a === shared ? d.b : d.a;
      const otherE = e.a === shared ? e.b : e.a;
      if (typeOf(otherD) === typeOf(otherE)) healthyEdges.push(e);
    }
    if (healthyEdges.length >= 3) break;
  }

  return (
    <HudFrame title="双线监测 · CHR + KPI" subtitle="DUAL-LINE MONITOR" right={<LiveTag on={state.showAnomaly} />}>
      <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 4 }}>
        <b style={{ color: "var(--text-bright)" }}>{g.flowEdges.length}</b> 条业务链路 · <span style={{ color: STATUS.warning }}>CHR+KPI 双线并行检测</span> · 任一检出异常即触发根因分析
      </div>
      <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginBottom: 6, fontFamily: "var(--font-mono)", letterSpacing: "0.02em" }}>
        CHR曲线 → 降噪·聚类 · KPI曲线 → 时空求解 · 双线并行
      </div>

      {/* CHR曲线 —— 原因值多维时序(降噪→聚类):既有噪声(慢性)排除 / 突变即异常 */}
      {showDetails && <ChrBlock scenario={scenario} kpi={kpi} state={state} />}

      {/* KPI曲线 —— 逐链路成功率时序(异常检测→时空求解) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: showDetails ? 10 : 0, marginBottom: 4, fontSize: 10.5, fontWeight: 700, color: "var(--text-bright)", fontFamily: "var(--font-sans)", letterSpacing: "0.04em" }}>
        <span style={{ width: 3, height: 12, borderRadius: 2, background: STATUS.notice, boxShadow: `0 0 6px ${STATUS.notice}` }} />
        KPI曲线 · 异常检测→时空求解
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" height={CH} style={{ display: "block" }}>
        {/* 故障窗阴影(检测后显现) */}
        {showDetails && (
          <>
            <rect x={winX0} y={0} width={Math.max(2, winX1 - winX0)} height={CH} fill="rgba(239,68,68,0.1)" />
            <line x1={winX0} y1={0} x2={winX0} y2={CH} stroke="rgba(239,68,68,0.3)" strokeDasharray="2 3" />
            <line x1={winX1} y1={0} x2={winX1} y2={CH} stroke="rgba(239,68,68,0.3)" strokeDasharray="2 3" />
          </>
        )}
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
        <Stat label={showDetails ? "故障窗" : "状态"} value={showDetails ? `T${kpi.faultStart}-${kpi.faultEnd}` : "正常"} color={showDetails ? STATUS.warning : STATUS.healthy} />
        <Stat label="游标" value={`T${state.simT.toFixed(0)}`} color="var(--accent)" />
      </div>

      {/* KPI曲线 · 逐链路:劣化 + 正常(均质化对照)—— 检测后展示(含网络恢复) */}
      {showDetails && (degradedEdges.length > 0 || healthyEdges.length > 0) && (
        <div style={{ marginTop: 10, borderTop: "1px solid rgba(56,189,248,0.12)", paddingTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, fontWeight: 700, color: "var(--text-soft)", fontFamily: "var(--font-sans)", letterSpacing: "0.04em", marginBottom: 6 }}>
            <span style={{ width: 3, height: 10, borderRadius: 2, background: STATUS.notice }} />
            KPI曲线 · 劣化 / 正常对照
          </div>
          {degradedEdges.map((e) => (
            <LinkSpark key={e.id} a={g.nodeById[e.a]?.id} b={g.nodeById[e.b]?.id} es={kpi.edges[e.id]} simT={state.simT} />
          ))}
          {healthyEdges.length > 0 && (
            <>
              <div style={{ fontSize: 8, color: STATUS.healthy, margin: "5px 0 3px", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
                正常链路 · 均质化对照
              </div>
              {healthyEdges.map((e) => (
                <LinkSpark key={e.id} a={g.nodeById[e.a]?.id} b={g.nodeById[e.b]?.id} es={kpi.edges[e.id]} simT={state.simT} />
              ))}
            </>
          )}
        </div>
      )}
    </HudFrame>
  );
}

/** CHR 多维时序区块:按原因值画曲线,慢性(既有噪声)置底灰显,突变(本次异常)置顶高亮 */
function ChrBlock({ scenario, kpi, state }: { scenario: Scenario; kpi: KpiBundle; state: StoryState }) {
  const all: ChrSeries[] = buildChrSeries(scenario);
  if (!all.length) return null;
  const W = 320;
  const H = 84;
  const xOf = (i: number) => (i / (TIMESTEPS - 1)) * W;
  const maxV = Math.max(...all.flatMap((s) => s.data), 0.1) * 1.15;
  const yOf = (v: number) => H - (v / maxV) * H;
  const winX0 = xOf(kpi.faultStart - 1);
  const winX1 = xOf(kpi.faultEnd - 1);
  const curX = xOf(Math.max(0, Math.min(TIMESTEPS - 1, state.simT - 1)));
  const pathFor = (d: number[]) => d.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const chronic = all.filter((s) => s.verdict === "chronic");
  const sudden = all.filter((s) => s.verdict === "sudden");
  return (
    <div style={{ borderTop: "1px solid rgba(56,189,248,0.12)", paddingTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: "var(--text-bright)", fontFamily: "var(--font-sans)", letterSpacing: "0.04em" }}>
          <span style={{ width: 3, height: 12, borderRadius: 2, background: STATUS.faultGlow, boxShadow: `0 0 6px ${STATUS.faultGlow}` }} />
          CHR曲线 · 降噪→聚类 · 原因值多维时序
        </span>
        <span style={{ fontSize: 8.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>既有噪声·降噪 / 突变·异常</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        {/* 故障窗 */}
        <rect x={winX0} y={0} width={Math.max(2, winX1 - winX0)} height={H} fill="rgba(239,68,68,0.08)" />
        {/* 终端侧既有噪声:置底灰显(全程周期性偏高,窗内无变化) */}
        {chronic.map((s) => (
          <path key={s.key} d={pathFor(s.data)} fill="none" stroke="rgba(148,163,184,0.6)" strokeWidth={1.2} />
        ))}
        {/* 主导原因:置顶高亮(低基线 + 故障窗突变尖峰) */}
        {sudden.map((s) => (
          <path key={s.key} d={pathFor(s.data)} fill="none" stroke={STATUS.faultGlow} strokeWidth={1.9} style={{ filter: "drop-shadow(0 0 4px rgba(239,68,68,0.55))" }} />
        ))}
        {/* 当前游标 */}
        <line x1={curX} y1={0} x2={curX} y2={H} stroke="var(--accent)" strokeWidth={0.8} opacity={0.5} />
      </svg>
      <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2 }}>
        {all.map((s) => {
          const isSudden = s.verdict === "sudden";
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontFamily: "var(--font-mono)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: isSudden ? STATUS.faultGlow : "rgba(148,163,184,0.7)", flexShrink: 0 }} />
              <span style={{ color: "var(--text-mid)", width: 58 }}>{s.key}</span>
              <span style={{ color: "var(--text-detail)", flex: 1 }}>{s.cn}</span>
              <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap", color: isSudden ? STATUS.faultGlow : "var(--text-faint)", border: `1px solid ${isSudden ? "rgba(239,68,68,0.4)" : "rgba(148,163,184,0.3)"}` }}>
                {isSudden ? "▲ 突变·异常" : "既有噪声·降噪"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinkSpark({ a, b, es, simT }: { a?: string; b?: string; es: number[]; simT: number }) {
  const ecv = sample(es, simT);
  const SW = 200;
  const SH = 20;
  const sy = (v: number) => SH - ((Math.max(SR_LO, Math.min(SR_HI, v)) - SR_LO) / (SR_HI - SR_LO)) * SH;
  const sPath = es.map((v, i) => `${i === 0 ? "M" : "L"} ${((i / (es.length - 1)) * SW).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
  const col = srColor(ecv);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <span style={{ width: 122, fontSize: 9, color: "var(--text-mid)", fontFamily: "var(--font-mono)", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
        {a} ↔ {b}
      </span>
      <svg style={{ flex: 1 }} height={SH} viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none">
        <path d={sPath} fill="none" stroke={col} strokeWidth={1.4} />
      </svg>
      <span style={{ fontSize: 9, color: col, fontFamily: "var(--font-mono)", width: 44, textAlign: "right" }}>{(ecv * 100).toFixed(1)}%</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 8, letterSpacing: "0.08em", color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{label}</div>
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
