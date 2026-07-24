// ============================================================================
// ExecutionPanel —— 右侧「现网运行」(拓扑为主 + 每相位一个弹窗 + 场景选择)
// ============================================================================

import { PHASES, srColor } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { DigitalTwin } from "../DigitalTwin/DigitalTwin";
import { PhasePopup } from "./PhasePopup";
import { getKpi } from "../../story/director";
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
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="hud-head">
        <span className="title"><span className="dot" />现网运行</span>
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

/** #5 KPI 曲线面板:SR 曲线 + 请求数曲线 + NE CPU 热力 + UFDR */
function KpiPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const sim = state.simRates;
  const graph = scenario.realGraph;
  const amfNodes = graph ? graph.nodes.filter((n) => n.type === "AMF") : [];
  const smfNodes = graph ? graph.nodes.filter((n) => n.type === "SMF") : [];
  const allTypes = ["gNB", "AMF", "SMF", "UPF", "UDM", "AUSF", "PCF", "NRF", "NSSF"];
  const neCpu = state.simNeCpu;
  const xAt = (i: number) => (i / 59) * 100;
  const amfSrPts = amfNodes.length ? amfNodes.reduce((acc, n) => { const s = kpi.nodes[n.id] ?? []; s.forEach((v, i) => { acc[i] = (acc[i] ?? 0) + v; }); return acc; }, [] as number[]).map((v) => v / amfNodes.length).map((v, i) => xAt(i).toFixed(1) + "," + (50 - ((v - 0.8) / 0.2) * 40).toFixed(1)).join(" ") : "";
  const smfSrPts = smfNodes.length ? smfNodes.reduce((acc, n) => { const s = kpi.nodes[n.id] ?? []; s.forEach((v, i) => { acc[i] = (acc[i] ?? 0) + v; }); return acc; }, [] as number[]).map((v) => v / smfNodes.length).map((v, i) => xAt(i).toFixed(1) + "," + (50 - ((v - 0.8) / 0.2) * 40).toFixed(1)).join(" ") : "";
  const overallPts = kpi.overall.map((v, i) => xAt(i).toFixed(1) + "," + (50 - ((v - 0.8) / 0.2) * 40).toFixed(1)).join(" ");
  const curSr = sample(kpi.overall, simT);
  const curX = ((simT - 1) / 59) * 100;
  const fs = kpi.faultStart, fe = kpi.faultEnd;
  const regReqPts = Array.from({ length: 60 }, (_, i) => { const t = i + 1; let v = 20; if (t >= fs && t < fe) v = 200; if (sim) v = sim.regRate; return xAt(i).toFixed(1) + "," + (50 - Math.min(45, v / 10)).toFixed(1); }).join(" ");
  const sessReqPts = Array.from({ length: 60 }, (_, i) => { const t = i + 1; let v = 340; if (t >= fs && t < fe) v = 1000; if (sim) v = sim.sessionRate; return xAt(i).toFixed(1) + "," + (50 - Math.min(45, v / 25)).toFixed(1); }).join(" ");
  const showUfdr = state.phaseIndex >= 4 && scenario.ufdr;
  const ufdr = scenario.ufdr;
  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-panel-solid)", height: 130, display: "flex" }}>
      <div style={{ flex: "1 1 28%", display: "flex", flexDirection: "column", padding: "3px 5px", borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 8, color: "#7dd3fc", fontFamily: "var(--font-mono)", fontWeight: 700 }}>SR(整网/AMF/SMF)</span>
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
          <line x1="0" y1="10" x2="100" y2="10" stroke="rgba(148,163,184,0.25)" strokeWidth="0.3" strokeDasharray="2 2" />
          {overallPts && <polyline points={overallPts} fill="none" stroke={srColor(curSr)} strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.9" />}
          {amfSrPts && <polyline points={amfSrPts} fill="none" stroke="#38bdf8" strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.7" />}
          {smfSrPts && <polyline points={smfSrPts} fill="none" stroke="#a78bfa" strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.7" />}
          <line x1={curX} y1="0" x2={curX} y2="50" stroke="var(--text-bright)" strokeWidth="0.5" opacity="0.5" />
        </svg>
      </div>
      <div style={{ flex: "1 1 28%", display: "flex", flexDirection: "column", padding: "3px 5px", borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 8, color: "#7dd3fc", fontFamily: "var(--font-mono)", fontWeight: 700 }}>请求数(注册/s · 会话/s)</span>
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ flex: 1, width: "100%" }}>
          <rect x={((fs - 1) / 59) * 100} y="0" width={((fe - fs) / 59) * 100} height="50" fill="rgba(239,68,68,0.06)" />
          <polyline points={regReqPts} fill="none" stroke="#38bdf8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline points={sessReqPts} fill="none" stroke="#a78bfa" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={curX} y1="0" x2={curX} y2="50" stroke="var(--text-bright)" strokeWidth="0.5" opacity="0.5" />
        </svg>
      </div>
      <div style={{ flex: "1 1 24%", display: "flex", flexDirection: "column", padding: "3px 5px", borderRight: showUfdr ? "1px solid var(--border)" : "none" }}>
        <span style={{ fontSize: 8, color: "#7dd3fc", fontFamily: "var(--font-mono)", fontWeight: 700 }}>NE CPU</span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, justifyContent: "center" }}>
          {allTypes.map((t) => {
            const ns = graph ? graph.nodes.filter((n) => n.type === t) : [];
            if (!ns.length) return null;
            const avg = neCpu ? ns.reduce((s, n) => s + (neCpu[n.id] ?? 40), 0) / ns.length : 35 + (t === "AMF" || t === "SMF" ? 5 : 0);
            const c = avg >= 85 ? "#ef4444" : avg >= 70 ? "#f59e0b" : "#22c55e";
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 3, height: 10 }}>
                <span style={{ fontSize: 7, color: "var(--text-mid)", fontFamily: "var(--font-mono)", width: 22 }}>{t}</span>
                <div style={{ flex: 1, height: 5, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: avg + "%", background: c, borderRadius: 2, transition: "width 0.3s" }} /></div>
                <span style={{ fontSize: 7, color: c, fontFamily: "var(--font-mono)", fontWeight: 700, width: 24, textAlign: "right" }}>{avg.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
      {showUfdr && ufdr && (
        <div style={{ flex: "1 1 20%", display: "flex", flexDirection: "column", padding: "3px 5px" }}>
          <span style={{ fontSize: 8, color: "#2dd4bf", fontFamily: "var(--font-mono)", fontWeight: 700 }}>UFDR SST=3 / DNN</span>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
            <div>
              <div style={{ fontSize: 7, color: "var(--text-mid)", marginBottom: 2 }}>SST=3 注册 +{ufdr.sstSurge}%</div>
              <div style={{ height: 10, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: ufdr.sstSurge + "%", background: "#2dd4bf", borderRadius: 2 }} /></div>
            </div>
            <div>
              <div style={{ fontSize: 7, color: "var(--text-mid)", marginBottom: 2 }}>物联 DNN 会话 +{ufdr.dnnSurge}%</div>
              <div style={{ height: 10, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: ufdr.dnnSurge + "%", background: "#38bdf8", borderRadius: 2 }} /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
