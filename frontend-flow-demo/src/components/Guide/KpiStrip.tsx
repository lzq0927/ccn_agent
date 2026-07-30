// ============================================================================
// KpiStrip —— 右栏底部 KPI 条(参考 frontend-flow,精简)
//   实时:曲线只画到当前 simT(游标=现在,右侧未来不展示)。
//   整网SR · AMF/SMF SR · NE CPU(过载)· 注册/会话请求数(storm)· 异常链路/过载网元。
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { getKpi, iotRegAt, sessIotAt } from "../../story/director";
import { sample } from "../../data/kpi";
import { srColor, STATUS } from "../../theme";

const W = 100, H = 26;

export function KpiStrip({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const graph = scenario.realGraph;
  const isStorm = scenario.fault.faultType === "iot_storm";
  const curIdx = Math.min(Math.max(Math.floor(simT) - 1, 0), 58);

  const overall = kpi.overall;
  const curOverall = sample(overall, simT);
  const xAt = (i: number) => (i / (overall.length - 1)) * W;
  const ySr = (v: number) => H - 2 - ((v - 0.8) / 0.2) * (H - 4);
  const curX = xAt(curIdx);
  const fs = kpi.faultStart, fe = kpi.faultEnd;
  const winX0 = ((fs - 1) / 59) * W, winW = ((fe - fs) / 59) * W;

  // 实时裁剪:只画到当前 simT 的点(未来不展示)
  const visiblePts = (arr: number[]) => arr.slice(0, Math.max(2, curIdx + 2)).map((v, i) => `${xAt(i).toFixed(1)},${ySr(v).toFixed(1)}`).join(" ");

  const agg = (type: string) => {
    const ns = graph ? graph.nodes.filter((n) => n.type === type) : [];
    if (!ns.length) return kpi.overall;
    const acc = ns.reduce((a, n) => { const s = kpi.nodes[n.id] ?? []; s.forEach((v, i) => { a[i] = (a[i] ?? 0) + v; }); return a; }, [] as number[]);
    return acc.map((v) => v / ns.length);
  };

  const spark = (arr: number[], color: string) => (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <polyline points={visiblePts(arr)} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={curX} cy={ySr(sample(arr, simT))} r={1.6} fill={color} />
      <line x1={curX} y1={0} x2={curX} y2={H} stroke="var(--text-bright)" strokeWidth={0.5} opacity={0.5} />
    </svg>
  );

  const neCpu = state.simNeCpu;
  const cpuOf = (type: string) => {
    const ns = graph ? graph.nodes.filter((n) => n.type === type) : [];
    if (!ns.length) return 0;
    if (neCpu) return ns.reduce((s, n) => s + (neCpu[n.id] ?? 40), 0) / ns.length;
    return 35 + (type === "AMF" || type === "SMF" ? 5 : 0);
  };

  const degradedCount = (graph?.flowEdges ?? []).filter((e) => kpi.edges[e.id]?.some((v) => v < kpi.threshold)).length;
  const overloadCount = isStorm ? scenario.fault.elements.length : 0;
  const regRate = isStorm ? iotRegAt(scenario, simT) : 0;
  const sessRate = isStorm ? sessIotAt(scenario, simT) : 0;

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-panel-solid)", padding: "6px 12px", display: "flex", gap: 10, alignItems: "stretch" }}>
      <span style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-soft)", fontFamily: "var(--font-mono)", alignSelf: "center", whiteSpace: "nowrap" }}>KPI T{simT.toFixed(0)}</span>
      {/* AMF注册成功率 / PDU会话建立成功率 */}
      <KpiCard title="AMF注册成功率" value={`${(sample(agg("AMF"), simT) * 100).toFixed(2)}%`} color="#60a5fa">{spark(agg("AMF"), "#60a5fa")}</KpiCard>
      <KpiCard title="PDU会话建立成功率" value={`${(sample(agg("SMF"), simT) * 100).toFixed(2)}%`} color="#a78bfa">{spark(agg("SMF"), "#a78bfa")}</KpiCard>
      {/* NE CPU —— G 场景过载点在 UDM(AMF/SMF 正常);其余展示 AMF/SMF/UPF */}
      <div style={{ flex: "1 1 20%", display: "flex", flexDirection: "column", padding: "3px 6px", borderLeft: "1px solid var(--border)" }}>
        <span style={{ fontSize: 8.5, color: "#7dd3fc", fontFamily: "var(--font-mono)", fontWeight: 700 }}>NE CPU{isStorm ? "(过载)" : ""}</span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.5, justifyContent: "center" }}>
          {(scenario.stormMetrics?.udmCpu != null ? ["UDM", "AMF", "SMF"] : ["AMF", "SMF", "UPF"]).map((t) => {
            const v = cpuOf(t);
            const c = v >= 85 ? STATUS.fault : v >= 70 ? STATUS.warning : STATUS.healthy;
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, height: 11 }}>
                <span style={{ fontSize: 7.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", width: 20 }}>{t}</span>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: `${v}%`, background: c }} /></div>
                <span style={{ fontSize: 7.5, color: c, fontFamily: "var(--font-mono)", fontWeight: 700, width: 22, textAlign: "right" }}>{v.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* 请求数(storm) / 异常 */}
      {isStorm ? (
        <KpiCard title="注册·会话请求/s" value={`${regRate.toFixed(0)} / ${sessRate.toFixed(0)}`} color={regRate > 50 ? STATUS.fault : "#f59e0b"} wide>
          <div style={{ fontSize: 8.5, color: "var(--text-mid)", lineHeight: 1.5, marginTop: 2 }}>
            注册 <b style={{ color: regRate > 50 ? STATUS.fault : "#f59e0b" }}>{regRate.toFixed(0)}</b> · 会话 <b style={{ color: sessRate > 60 ? STATUS.fault : "#a78bfa" }}>{sessRate.toFixed(0)}</b>
          </div>
        </KpiCard>
      ) : null}
      {/* 异常链路 / 过载网元 */}
      <KpiCard title={isStorm ? "过载网元 / 异常链路" : "异常链路(跌破阈值)"} value={isStorm ? `${overloadCount} / ${degradedCount}` : `${degradedCount} 条`} color={overloadCount > 0 || degradedCount > 0 ? STATUS.fault : STATUS.healthy} wide>
        <div style={{ fontSize: 8.5, color: "var(--text-mid)", lineHeight: 1.5, marginTop: 2 }}>
          {isStorm ? <>过载 <b style={{ color: overloadCount ? STATUS.fault : STATUS.healthy }}>{overloadCount} NE</b> · 异常链路 <b style={{ color: degradedCount ? STATUS.fault : STATUS.healthy }}>{degradedCount}</b></> : <>{degradedCount > 0 ? "多维检测已检出异常" : "多维检测 · 全网正常"}</>}
        </div>
      </KpiCard>
    </div>
  );
}

function KpiCard({ title, value, color, children, wide }: { title: string; value: string; color: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ flex: wide ? "1.2 1 22%" : "1 1 18%", display: "flex", flexDirection: "column", padding: "3px 6px", borderLeft: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 8.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color, fontFamily: "var(--font-mono)" }}>{value}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, marginTop: 2 }}>{children}</div>
    </div>
  );
}
