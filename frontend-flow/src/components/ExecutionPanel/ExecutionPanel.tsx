// ============================================================================
// ExecutionPanel —— 右侧「现网运行」(拓扑为主 + 每相位一个弹窗 + 场景选择)
// ============================================================================

import { PHASES, srColor } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { DigitalTwin } from "../DigitalTwin/DigitalTwin";
import { PhasePopup } from "./PhasePopup";
import { getKpi, iotRegAt, sessIotAt } from "../../story/director";
import { sample } from "../../data/kpi";

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
  const isStorm = scenario.fault.faultType === "iot_storm";
  const regIotPts = Array.from({ length: 60 }, (_, i) => {
    const v = isStorm ? iotRegAt(scenario, i + 1) : 5;
    return xAt(i).toFixed(1) + "," + (50 - Math.min(45, v / 8)).toFixed(1);
  }).join(" ");
  const regTocPts = Array.from({ length: 60 }, (_, i) => { const v = 15; return xAt(i).toFixed(1) + "," + (50 - Math.min(45, v / 8)).toFixed(1); }).join(" ");
  const sessIotPts = Array.from({ length: 60 }, (_, i) => {
    const v = isStorm ? sessIotAt(scenario, i + 1) : 40;
    return xAt(i).toFixed(1) + "," + (50 - Math.min(45, v / 20)).toFixed(1);
  }).join(" ");
  const sessTocPts = Array.from({ length: 60 }, (_, i) => { const t = i + 1; let v = 300; return xAt(i).toFixed(1) + "," + (50 - Math.min(45, v / 20)).toFixed(1); }).join(" ");

  const curAmfSr = sample(amfSr, simT);
  const curSmfSr = sample(smfSr, simT);

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-panel-solid)", height: 140, display: "flex" }}>
      {/* AMF 区:注册成功率(+ 物联/ToC 请求数,仅 iot_storm) */}
      <div style={{ flex: "1 1 28%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 8, color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 1 }}>AMF · 注册成功率</span>
        <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ height: isStorm ? 26 : undefined, flex: isStorm ? undefined : 1, width: "100%" }}>
          <line x1="0" y1="4" x2="100" y2="4" stroke="rgba(148,163,184,0.2)" strokeWidth="0.3" strokeDasharray="2 2" />
          <polyline points={amfSrPts} fill="none" stroke="#38bdf8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
        </svg>
        {isStorm && (
          <>
            <span style={{ fontSize: 7.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", marginTop: 2 }}>注册请求数/s(物联·ToC)</span>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
              <rect x={((fs - 1) / 59) * 100} y="0" width={((fe - fs) / 59) * 100} height="24" fill="rgba(239,68,68,0.06)" />
              <polyline points={regIotPts} fill="none" stroke="#f59e0b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <polyline points={regTocPts} fill="none" stroke="#38bdf8" strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.7" />
              <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
            </svg>
            <div style={{ display: "flex", gap: 6, fontSize: 7 }}>
              <span style={{ color: "#f59e0b" }}>■ 物联</span>
              <span style={{ color: "#38bdf8" }}>■ ToC</span>
            </div>
          </>
        )}
      </div>

      {/* SMF 区:会话成功率(+ 物联/ToC 会话数,仅 iot_storm) */}
      <div style={{ flex: "1 1 28%", display: "flex", flexDirection: "column", padding: "2px 4px", borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 8, color: "#a78bfa", fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 1 }}>SMF · PDU 会话成功率</span>
        <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ height: isStorm ? 26 : undefined, flex: isStorm ? undefined : 1, width: "100%" }}>
          <line x1="0" y1="4" x2="100" y2="4" stroke="rgba(148,163,184,0.2)" strokeWidth="0.3" strokeDasharray="2 2" />
          <polyline points={smfSrPts} fill="none" stroke="#a78bfa" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
        </svg>
        {isStorm && (
          <>
            <span style={{ fontSize: 7.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", marginTop: 2 }}>PDU 会话建立数/s(物联·ToC)</span>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
              <rect x={((fs - 1) / 59) * 100} y="0" width={((fe - fs) / 59) * 100} height="24" fill="rgba(239,68,68,0.06)" />
              <polyline points={sessIotPts} fill="none" stroke="#f59e0b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <polyline points={sessTocPts} fill="none" stroke="#a78bfa" strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.7" />
              <line x1={curX} y1="0" x2={curX} y2="24" stroke="var(--text-bright)" strokeWidth="0.4" opacity="0.5" />
            </svg>
            <div style={{ display: "flex", gap: 6, fontSize: 7 }}>
              <span style={{ color: "#f59e0b" }}>■ 物联 DNN</span>
              <span style={{ color: "#a78bfa" }}>■ ToC</span>
            </div>
          </>
        )}
      </div>

      {/* NE CPU 热力 */}
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

      {/* UFDR 柱状(SST=3 + 物联 DNN, phase4+) */}
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
    </div>
  );
}
