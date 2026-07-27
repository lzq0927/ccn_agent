// ============================================================================
// ExecutionPanel —— 右侧「现网运行」(拓扑为主 + 每相位一个弹窗 + 场景选择)
// ============================================================================

import { PHASES, srColor } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { DigitalTwin } from "../DigitalTwin/DigitalTwin";
import { PhasePopup } from "./PhasePopup";
import { getKpi, iotRegAt, sessIotAt } from "../../story/director";
import { sample, buildChrSeries } from "../../data/kpi";
import type { NetworkGraph } from "../../data/network";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const typeOf = (id: string) => id.replace(/_\d+$/, "");

/** 挑选正常链路做「均质化对照」:与某条劣化边共享一个端点、且对侧类型相同(参考 frontend-show)。
 *  无劣化边或挑不到时,兜底取最健康的 2 条(场景 C)。 */
function pickHealthyEdges(
  graph: NetworkGraph | undefined,
  kpi: { edges: Record<string, number[]>; threshold: number },
  degraded: { id: string; a: string; b: string; series: number[] }[],
) {
  const flows = graph?.flowEdges ?? [];
  const isDeg = (id: string) => kpi.edges[id]?.some((v) => v < kpi.threshold) ?? false;
  const out: { id: string; a: string; b: string; series: number[] }[] = [];
  for (const d of degraded) {
    for (const e of flows) {
      if (isDeg(e.id) || out.some((o) => o.id === e.id)) continue;
      const shareA = e.a === d.a || e.a === d.b;
      const shareB = e.b === d.a || e.b === d.b;
      if (shareA === shareB) continue; // 必须恰好共享一个端点
      const shared = shareA ? e.a : e.b;
      const otherD = d.a === shared ? d.b : d.a;
      const otherE = e.a === shared ? e.b : e.a;
      if (typeOf(otherD) === typeOf(otherE)) { // 对侧同类型 → 同质对照
        out.push({ id: e.id, a: e.a, b: e.b, series: kpi.edges[e.id] ?? [] });
      }
    }
    if (out.length >= 2) break;
  }
  if (out.length === 0) {
    for (const e of flows) {
      if (isDeg(e.id)) continue;
      const series = kpi.edges[e.id] ?? [];
      if (series.length && Math.min(...series) >= kpi.threshold) out.push({ id: e.id, a: e.a, b: e.b, series });
      if (out.length >= 2) break;
    }
  }
  return out;
}

/** 单条链路 sparkline 行:链路名 + 独立小折线 + 当前 SR%(参考 frontend-show LinkSpark) */
function LinkSparkRow({ a, b, series, simT, color, degraded }: {
  a: string; b: string; series: number[]; simT: number; color: string; degraded?: boolean;
}) {
  const cur = sample(series, simT);
  const SH = 16;
  const sy = (v: number) => SH - 1 - ((clamp(v, 0.8, 1) - 0.8) / 0.2) * (SH - 2);
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * 100).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const col = degraded ? srColor(cur) : color;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, height: 15 }}>
      <span title={`${a} ↔ ${b}`} style={{ fontSize: 7, color: "var(--text-mid)", fontFamily: "var(--font-mono)", width: 64, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>{a} ↔ {b}</span>
      <svg viewBox="0 0 100 16" preserveAspectRatio="none" style={{ flex: 1, height: 14 }}>
        <polyline points={pts} fill="none" stroke={col} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ fontSize: 7, color: col, fontFamily: "var(--font-mono)", fontWeight: 700, width: 30, textAlign: "right", flexShrink: 0 }}>{(cur * 100).toFixed(1)}%</span>
    </div>
  );
}

interface Props {
  scenario: Scenario;
  state: StoryState;
  scenarios: Scenario[];
  currentScenarioId: string;
  onSelectScenario: (id: string) => void;
}

export function ExecutionPanel({ scenario, state, scenarios, currentScenarioId, onSelectScenario }: Props) {
  const info = PHASES[state.phaseIndex];
  return (
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderTop: "2px solid #38bdf8", boxShadow: "inset 0 2px 0 rgba(56,189,248,0.12)" }}>
      <div className="hud-head">
        <span className="title">
          <span className="dot" style={{ background: "#38bdf8", boxShadow: "0 0 6px #38bdf8" }} />
          现网运行
          <span style={{ fontSize: 8, fontWeight: 800, color: "#38bdf8", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginLeft: 6, padding: "1px 5px", borderRadius: 3, background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.4)" }}>案例 · CASE</span>
        </span>
        <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 4, color: info.color, border: "1px solid " + info.color + "66", background: info.color + "14", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>PHASE {state.phaseIndex} · {info.en}</span>
      </div>
      <div style={{ padding: "7px 12px", borderBottom: "1px solid var(--border)", background: "var(--accent-a12)" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
          {scenarios.map((s) => {
            const active = s.id === currentScenarioId;
            return (
              <button key={s.id} onClick={() => onSelectScenario(s.id)} title={s.intro ?? s.tagline} className={active ? "btn active" : "btn"} style={{ padding: "4px 9px", fontSize: 9.5, textTransform: "none", letterSpacing: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <b style={{ fontSize: 11 }}>{s.id}</b><span>{s.cn}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-mid)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={scenario.intro ?? scenario.tagline}>{scenario.objective ?? scenario.tagline}{scenario.intro ? " · " + scenario.intro : ""}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--twin-readout-bg)", paddingLeft: 210 }}>
        <DigitalTwin scenario={scenario} state={state} showCallouts={false} />
        <PhasePopup scenario={scenario} state={state} />
      </div>
      <KpiPanel scenario={scenario} state={state} />
    </div>
  );
}

/** #1 KPI 曲线面板:AMF(注册SR+注册请求数) | SMF(会话SR+会话请求数) | NE CPU | UFDR */
function KpiPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const graph = scenario.realGraph;
  const neCpu = state.simNeCpu;
  const xAt = (i: number) => (i / 59) * 100;
  const curX = ((simT - 1) / 59) * 100;
  const fs = kpi.faultStart, fe = kpi.faultEnd;
  const showUfdr = state.phaseIndex >= 4 && scenario.ufdr;
  const ufdr = scenario.ufdr;
  const allTypes = ["AMF", "SMF", "UPF", "UDM", "AUSF", "PCF", "NRF", "NSSF"];

  // AMF 注册成功率(取 AMF 节点 KPI 均值)
  const amfNodes = graph ? graph.nodes.filter((n) => n.type === "AMF") : [];
  const amfSr = amfNodes.length ? amfNodes.reduce((acc, n) => { const s = kpi.nodes[n.id] ?? []; s.forEach((v, i) => { acc[i] = (acc[i] ?? 0) + v; }); return acc; }, [] as number[]).map((v) => v / amfNodes.length) : kpi.overall;
  const amfSrPts = amfSr.map((v, i) => xAt(i).toFixed(1) + "," + (50 - ((v - 0.8) / 0.2) * 40).toFixed(1)).join(" ");

  // SMF 会话成功率
  const smfNodes = graph ? graph.nodes.filter((n) => n.type === "SMF") : [];
  const smfSr = smfNodes.length ? smfNodes.reduce((acc, n) => { const s = kpi.nodes[n.id] ?? []; s.forEach((v, i) => { acc[i] = (acc[i] ?? 0) + v; }); return acc; }, [] as number[]).map((v) => v / smfNodes.length) : kpi.overall;
  const smfSrPts = smfSr.map((v, i) => xAt(i).toFixed(1) + "," + (50 - ((v - 0.8) / 0.2) * 40).toFixed(1)).join(" ");

  // 注册/PDU 请求数曲线(物联 vs ToC)— 与实时数值共用 iotRegAt/sessIotAt(D/E iot_storm)
  //   y 映射基于 viewBox 高 24(旧 50 基准会让整条曲线落到画框之外被裁掉 → 完全看不见)
  const isStorm = scenario.fault.faultType === "iot_storm";
  const yReg = (v: number) => 22 - (Math.min(v, 200) / 200) * 20;  // 0→底, 200→顶(上界 200 让 F 首轮反升峰 186 可见)
  const ySess = (v: number) => 22 - (Math.min(v, 450) / 450) * 20; // 0→底, 450→顶
  const regIotPts = Array.from({ length: 60 }, (_, i) =>
    xAt(i).toFixed(1) + "," + yReg(isStorm ? iotRegAt(scenario, i + 1) : 5).toFixed(1)).join(" ");
  const regTocPts = Array.from({ length: 60 }, (_, i) =>
    xAt(i).toFixed(1) + "," + yReg(15).toFixed(1)).join(" ");
  const sessIotPts = Array.from({ length: 60 }, (_, i) =>
    xAt(i).toFixed(1) + "," + ySess(isStorm ? sessIotAt(scenario, i + 1) : 40).toFixed(1)).join(" ");
  const sessTocPts = Array.from({ length: 60 }, (_, i) =>
    xAt(i).toFixed(1) + "," + ySess(300).toFixed(1)).join(" ");
  // 当前请求数(游标圆点 + 数值标注)
  const curRegIot = isStorm ? iotRegAt(scenario, simT) : 5;
  const curSessIot = isStorm ? sessIotAt(scenario, simT) : 40;

  const curAmfSr = sample(amfSr, simT);
  const curSmfSr = sample(smfSr, simT);

  // —— 非风暴(ABC)专属:路径 KPI(劣化链路 SR)+ CHR 原因值时序 ——
  // 路径 KPI:取劣化最严重的若干链路(最小 SR 跌破阈值的),画其 SR 时序
  const degradedEdges = !isStorm ? (graph?.flowEdges ?? [])
    .map((e) => ({ id: e.id, a: e.a, b: e.b, series: kpi.edges[e.id] ?? [] }))
    .map((d) => ({ ...d, min: d.series.length ? Math.min(...d.series) : 1 }))
    .filter((d) => d.min < kpi.threshold - 0.001)
    .sort((a, b) => a.min - b.min)
    .slice(0, 3) : [];
  // CHR 原因值时序(B/C 有 chrInsight 才有):主导突变 + 既有噪声
  const chrAll = buildChrSeries(scenario);
  const chrSudden = chrAll.filter((c) => c.verdict === "sudden");
  const chrChronic = chrAll.filter((c) => c.verdict === "chronic");
  const hasChr = chrAll.length > 0;
  // ABC 用 y 映射(viewBox 0 0 100 24)
  const ySr = (v: number) => 22 - ((v - 0.8) / 0.2) * 18; // SR 0.8→22, 1.0→4
  const yChrV = (v: number) => 22 - (Math.min(v, 0.6) / 0.6) * 18; // 失败占比 0→22, 0.6→4
  const ptsFrom = (arr: number[], y: (v: number) => number) => arr.map((v, i) => xAt(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const overallPts = kpi.overall.map((v, i) => xAt(i).toFixed(1) + "," + ySr(v).toFixed(1)).join(" ");
  const winX0 = ((fs - 1) / 59) * 100, winW = ((fe - fs) / 59) * 100;

  // ABC 详细化(参考 frontend-show):正常链路用「均质化对照」挑选(与劣化边共享一端·对侧同类型)
  const healthyEdges = !isStorm ? pickHealthyEdges(graph, kpi, degradedEdges) : [];
  const topDeg = degradedEdges[0];
  const curTopDeg = topDeg ? sample(topDeg.series, simT) : 0;
  const curChrSudden = chrSudden[0] ? sample(chrSudden[0].data, simT) : 0;
  const curOverall = sample(kpi.overall, simT);
  // 路径 KPI 配色:劣化红/橙系 · 正常绿系
  const DEG_COLORS = ["#ef4444", "#f59e0b", "#fb923c"];
  const OK_COLORS = ["#22c55e", "#10b981"];
  const pathLineOf = (arr: number[], y: (v: number) => number) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const pathAreaOf = (arr: number[], y: (v: number) => number) => `${pathLineOf(arr, y)} L 100 24 L 0 24 Z`;

  // CPU 象限(storm/ABC 共用,提取避免重复)
  const cpuQuadrant = (
    <div style={{ flex: "1 1 22%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: showUfdr ? "1px solid var(--border)" : "none" }}>
      <span style={{ fontSize: 8, color: "#7dd3fc", fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 2 }}>NE CPU 利用率</span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, justifyContent: "center" }}>
        {allTypes.map((t) => {
          const ns = graph ? graph.nodes.filter((n) => n.type === t) : [];
          if (!ns.length) return null;
          const avg = neCpu ? ns.reduce((s, n) => s + (neCpu[n.id] ?? 40), 0) / ns.length : 35 + (t === "AMF" || t === "SMF" ? 5 : 0);
          const c = avg >= 85 ? "#ef4444" : avg >= 70 ? "#f59e0b" : "#22c55e";
          return (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 3, height: 11 }}>
              <span style={{ fontSize: 7, color: "var(--text-mid)", fontFamily: "var(--font-mono)", width: 20 }}>{t}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: avg + "%", background: c, borderRadius: 2, transition: "width 0.3s" }} /></div>
              <span style={{ fontSize: 7, color: c, fontFamily: "var(--font-mono)", fontWeight: 700, width: 22, textAlign: "right" }}>{avg.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-panel-solid)", height: 140, display: "flex" }}>
      {isStorm ? (
        <>
          {/* AMF 区:注册成功率 + 物联/ToC 请求数(D/E iot_storm) */}
          <div style={{ flex: "1 1 28%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: "1px solid var(--border)" }}>
            <span style={{ fontSize: 8, color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 1 }}>AMF · 注册成功率</span>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ height: 26, width: "100%" }}>
              <line x1="0" y1="4" x2="100" y2="4" stroke="rgba(148,163,184,0.2)" strokeWidth="0.3" strokeDasharray="2 2" />
              <polyline points={amfSrPts} fill="none" stroke="#38bdf8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
            </svg>
            <span style={{ fontSize: 7.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", marginTop: 2 }}>注册请求数/s(物联·ToC) <b style={{ color: "#f59e0b" }}>{curRegIot.toFixed(0)}</b></span>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
              <rect x={winX0} y="0" width={winW} height="24" fill="rgba(239,68,68,0.06)" />
              <polyline points={regIotPts} fill="none" stroke="#f59e0b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <polyline points={regTocPts} fill="none" stroke="#38bdf8" strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.7" />
              <circle cx={curX} cy={yReg(curRegIot)} r={1.3} fill="#f59e0b" />
              <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
            </svg>
            <div style={{ display: "flex", gap: 6, fontSize: 7 }}>
              <span style={{ color: "#f59e0b" }}>■ 物联</span>
              <span style={{ color: "#38bdf8" }}>■ ToC</span>
            </div>
          </div>

          {/* SMF 区:会话成功率 + 物联/ToC 会话数(D/E) */}
          <div style={{ flex: "1 1 28%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: "1px solid var(--border)" }}>
            <span style={{ fontSize: 8, color: "#a78bfa", fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 1 }}>SMF · PDU 会话成功率</span>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ height: 26, width: "100%" }}>
              <line x1="0" y1="4" x2="100" y2="4" stroke="rgba(148,163,184,0.2)" strokeWidth="0.3" strokeDasharray="2 2" />
              <polyline points={smfSrPts} fill="none" stroke="#a78bfa" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
            </svg>
            <span style={{ fontSize: 7.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", marginTop: 2 }}>PDU 会话建立数/s(物联·ToC) <b style={{ color: "#f59e0b" }}>{curSessIot.toFixed(0)}</b></span>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
              <rect x={winX0} y="0" width={winW} height="24" fill="rgba(239,68,68,0.06)" />
              <polyline points={sessIotPts} fill="none" stroke="#f59e0b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <polyline points={sessTocPts} fill="none" stroke="#a78bfa" strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.7" />
              <circle cx={curX} cy={ySess(curSessIot)} r={1.3} fill="#f59e0b" />
              <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
            </svg>
            <div style={{ display: "flex", gap: 6, fontSize: 7 }}>
              <span style={{ color: "#f59e0b" }}>■ 物联 DNN</span>
              <span style={{ color: "#a78bfa" }}>■ ToC</span>
            </div>
          </div>
          {cpuQuadrant}
          {showUfdr && ufdr && (
            <div style={{ flex: "1 1 22%", display: "flex", flexDirection: "column", padding: "2px 4px" }}>
              <span style={{ fontSize: 8, color: "#2dd4bf", fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 2 }}>UFDR 溯源(SST/APN)</span>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
                <div>
                  <div style={{ fontSize: 7, color: "var(--text-mid)", marginBottom: 1 }}>SST=3(MIoT) 注册突增</div>
                  <div style={{ height: 10, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: ufdr.sstSurge + "%", background: "#2dd4bf", borderRadius: 2 }} /></div>
                  <div style={{ fontSize: 7, color: "#2dd4bf", fontFamily: "var(--font-mono)", marginTop: 1 }}>+{ufdr.sstSurge}% · {ufdr.sstLabel}</div>
                </div>
                <div>
                  <div style={{ fontSize: 7, color: "var(--text-mid)", marginBottom: 1 }}>物联 DNN/APN 会话突增</div>
                  <div style={{ height: 10, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: ufdr.dnnSurge + "%", background: "#38bdf8", borderRadius: 2 }} /></div>
                  <div style={{ fontSize: 7, color: "#38bdf8", fontFamily: "var(--font-mono)", marginTop: 1 }}>+{ufdr.dnnSurge}% · {ufdr.dnnLabel}</div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 路径 KPI(ABC):每条链路独立 sparkline(参考 frontend-show)· 劣化(红/橙)+ 正常均质化对照(绿) */}
            <div style={{ flex: "1 1 40%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 8, color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700 }}>路径 KPI · 链路对照</span>
                {topDeg && <span style={{ fontSize: 8, fontWeight: 800, color: srColor(curTopDeg), fontFamily: "var(--font-mono)" }}>最劣 {(curTopDeg * 100).toFixed(1)}%</span>}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 1, marginTop: 3, paddingRight: 2 }}>
                {degradedEdges.length === 0 && healthyEdges.length === 0 && (
                  <span style={{ fontSize: 7, color: "#38bdf8", fontFamily: "var(--font-mono)" }}>■ 整网 SR(无劣化)</span>
                )}
                {degradedEdges.map((d, i) => (
                  <LinkSparkRow key={d.id} a={d.a} b={d.b} series={d.series} simT={simT} color={DEG_COLORS[i % DEG_COLORS.length]} degraded />
                ))}
                {healthyEdges.length > 0 && (
                  <>
                    <div style={{ fontSize: 6.5, color: "#22c55e", fontFamily: "var(--font-mono)", letterSpacing: "0.06em", borderTop: "1px dashed rgba(34,197,94,0.25)", paddingTop: 1, marginTop: 1 }}>正常 · 均质化对照</div>
                    {healthyEdges.map((d, i) => (
                      <LinkSparkRow key={d.id} a={d.a} b={d.b} series={d.series} simT={simT} color={OK_COLORS[i % OK_COLORS.length]} />
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* CHR 原因值时序(B/C)或整网 SR(A) */}
            <div style={{ flex: "1 1 34%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: "1px solid var(--border)" }}>
              {hasChr ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 8, color: "#a78bfa", fontFamily: "var(--font-mono)", fontWeight: 700 }}>CHR · 原因值时序(降噪→聚类)</span>
                    <span style={{ fontSize: 8, fontWeight: 800, color: "#a78bfa", fontFamily: "var(--font-mono)" }}>{(curChrSudden * 100).toFixed(0)}%</span>
                  </div>
                  <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
                    <rect x={winX0} y="0" width={winW} height="24" fill="rgba(239,68,68,0.06)" />
                    {chrChronic.map((c) => (
                      <polyline key={c.key} points={ptsFrom(c.data, yChrV)} fill="none" stroke="#64748b" strokeWidth="0.7" vectorEffect="non-scaling-stroke" opacity={0.55} />
                    ))}
                    {chrSudden.map((c) => (
                      <path key={"a" + c.key} d={pathAreaOf(c.data, yChrV)} fill="rgba(167,139,250,0.14)" />
                    ))}
                    {chrSudden.map((c) => (
                      <polyline key={c.key} points={ptsFrom(c.data, yChrV)} fill="none" stroke="#a78bfa" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                    ))}
                    <circle cx={curX} cy={yChrV(curChrSudden)} r={1.4} fill="#a78bfa" />
                    <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
                  </svg>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {chrSudden.map((c) => (
                      <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 7, fontFamily: "var(--font-mono)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 1, background: "#a78bfa", flexShrink: 0 }} />
                        <span style={{ color: "var(--text-mid)", width: 42 }}>{c.key}</span>
                        <span style={{ color: "#a78bfa", fontSize: 6.5, marginLeft: "auto" }}>▲ 突变</span>
                      </div>
                    ))}
                    {chrChronic.length > 0 && <span style={{ fontSize: 7, color: "#64748b", fontFamily: "var(--font-mono)" }}>■ 既有噪声 ×{chrChronic.length}(降噪剔除)</span>}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 8, color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700 }}>整网成功率</span>
                    <span style={{ fontSize: 8, fontWeight: 800, color: srColor(curOverall), fontFamily: "var(--font-mono)" }}>{(curOverall * 100).toFixed(2)}%</span>
                  </div>
                  <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
                    <rect x={winX0} y="0" width={winW} height="24" fill="rgba(239,68,68,0.06)" />
                    <line x1="0" y1={ySr(kpi.threshold)} x2="100" y2={ySr(kpi.threshold)} stroke="rgba(245,158,11,0.5)" strokeWidth="0.3" strokeDasharray="2 2" />
                    <path d={pathAreaOf(kpi.overall, ySr)} fill="rgba(56,189,248,0.12)" />
                    <polyline points={overallPts} fill="none" stroke="#38bdf8" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
                    <circle cx={curX} cy={ySr(curOverall)} r={1.5} fill={srColor(curOverall)} />
                    <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
                  </svg>
                </>
              )}
            </div>

            {cpuQuadrant}
        </>
      )}
    </div>
  );
}
