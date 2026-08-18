// ============================================================================
// KpiStrip —— 右栏底部 KPI 条 · Studio:无框列 + hairline 分隔 + mono tabular 数值
//   实时:曲线只画到当前 simT(游标=现在,右侧未来不展示)。
//   整网KPI · AMF/SMF KPI · NE CPU(过载)· 注册/会话请求数(storm)· 异常链路/过载网元。
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
      <polyline points={visiblePts(arr)} fill="none" stroke={color} strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={0.85} />
      <circle cx={curX} cy={ySr(sample(arr, simT))} r={1.5} fill={color} />
      <line x1={curX} y1={0} x2={curX} y2={H} stroke="var(--ink-4)" strokeWidth={0.5} opacity={0.4} />
    </svg>
  );
  // LIVE 滚动历史:数组长度可变,按自身长度铺满全宽,游标落在最新点
  const sparkLive = (arr: number[], color: string) => {
    const n = arr.length;
    if (n < 2) return spark(arr, color);
    const x = (i: number) => (i / (n - 1)) * W;
    const pts = arr.map((v, i) => `${x(i).toFixed(1)},${ySr(v).toFixed(1)}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={0.85} />
        <circle cx={x(n - 1)} cy={ySr(arr[n - 1])} r={1.5} fill={color} />
        <line x1={x(n - 1)} y1={0} x2={x(n - 1)} y2={H} stroke="var(--ink-4)" strokeWidth={0.5} opacity={0.4} />
      </svg>
    );
  };
  const sparkOf = (arr: number[], color: string) => (live ? sparkLive(arr, color) : spark(arr, color));

  const neCpu = state.simNeCpu;
  const cpuOf = (type: string) => {
    const ns = graph ? graph.nodes.filter((n) => n.type === type) : [];
    if (!ns.length) return 0;
    if (neCpu) return ns.reduce((s, n) => s + (neCpu[n.id] ?? 40), 0) / ns.length;
    return 35 + (type === "AMF" || type === "SMF" ? 5 : 0);
  };

  const degradedCount = (graph?.flowEdges ?? []).filter((e) => kpi.edges[e.id]?.some((v) => v < kpi.threshold)).length;
  const overloadCount = isStorm ? scenario.fault.elements.length : 0;

  // LIVE 真实快照优先;否则回落 DEMO 合成曲线
  const live = state.liveKpi;
  const amfArr = live && state.amfSrHist && state.amfSrHist.length >= 2 ? state.amfSrHist : agg("AMF");
  const smfArr = live && state.smfSrHist && state.smfSrHist.length >= 2 ? state.smfSrHist : agg("SMF");
  const amfSr = live ? live.amfSuccessRate : sample(agg("AMF"), simT);
  const smfSr = live ? live.smfSuccessRate : sample(agg("SMF"), simT);
  const regRate = live ? (live.iotRegRate + live.tocRegRate) : (isStorm ? iotRegAt(scenario, simT) : 0);
  const sessRate = live ? (live.iotSessRate + live.tocSessRate) : (isStorm ? sessIotAt(scenario, simT) : 0);

  return (
    <div style={{ borderTop: "1px solid var(--line)", background: "var(--bg1)", padding: "7px 14px", display: "flex", gap: 12, alignItems: "stretch" }}>
      <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)", alignSelf: "center", whiteSpace: "nowrap" }}>T{simT.toFixed(0)}</span>
      {/* AMF注册成功率 / PDU会话建立成功率 */}
      <KpiCard title="AMF 注册成功率" value={`${(amfSr * 100).toFixed(2)}%`} color="#6f9fd8">{sparkOf(amfArr, "#6f9fd8")}</KpiCard>
      <KpiCard title="PDU 会话建立成功率" value={`${(smfSr * 100).toFixed(2)}%`} color="#7d8af2">{sparkOf(smfArr, "#7d8af2")}</KpiCard>
      {/* NE CPU —— D 场景过载点在 UDM(AMF/SMF 正常);其余展示 AMF/SMF/UPF */}
      <div style={{ flex: "1 1 20%", display: "flex", flexDirection: "column", padding: "2px 0 0 12px", borderLeft: "1px solid var(--line)" }}>
        <span style={{ fontSize: 9, color: "var(--ink-4)", fontWeight: 500 }}>NE CPU{isStorm ? " · 过载" : ""}</span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, justifyContent: "center" }}>
          {(scenario.stormMetrics?.udmCpu != null ? ["UDM", "AMF", "SMF"] : ["AMF", "SMF", "UPF"]).map((t) => {
            const v = cpuOf(t);
            const c = v >= 85 ? STATUS.fault : v >= 70 ? STATUS.warning : STATUS.healthy;
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 5, height: 11 }}>
                <span className="mono" style={{ fontSize: 7.5, color: "var(--ink-4)", width: 22 }}>{t}</span>
                <div style={{ flex: 1, height: 3, borderRadius: 1.5, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${v}%`, background: c, opacity: 0.85 }} /></div>
                <span className="mono" style={{ fontSize: 7.5, color: c, fontWeight: 500, width: 24, textAlign: "right" }}>{v.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* 请求数(storm) / 异常 */}
      {isStorm ? (
        <KpiCard title="注册 · 会话请求/s" value={`${regRate.toFixed(0)} / ${sessRate.toFixed(0)}`} color={regRate > 50 ? STATUS.fault : STATUS.warning} wide>
          <div style={{ fontSize: 8.5, color: "var(--ink-4)", lineHeight: 1.5, marginTop: 2 }}>
            注册 <b className="mono" style={{ color: regRate > 50 ? STATUS.fault : STATUS.warning, fontWeight: 500 }}>{regRate.toFixed(0)}</b> · 会话 <b className="mono" style={{ color: sessRate > 60 ? STATUS.fault : "#7d8af2", fontWeight: 500 }}>{sessRate.toFixed(0)}</b>
          </div>
        </KpiCard>
      ) : null}
      {/* 异常链路 / 过载网元 */}
      <KpiCard title={isStorm ? "过载网元 / 异常链路" : "异常链路 · 动态检出"} value={isStorm ? `${overloadCount} / ${degradedCount}` : `${degradedCount} 条`} color={overloadCount > 0 || degradedCount > 0 ? STATUS.fault : STATUS.healthy} wide>
        <div style={{ fontSize: 8.5, color: "var(--ink-4)", lineHeight: 1.5, marginTop: 2 }}>
          {isStorm ? <>过载 <b className="mono" style={{ color: overloadCount ? STATUS.fault : STATUS.healthy, fontWeight: 500 }}>{overloadCount} NE</b> · 异常链路 <b className="mono" style={{ color: degradedCount ? STATUS.fault : STATUS.healthy, fontWeight: 500 }}>{degradedCount}</b></> : <>{degradedCount > 0 ? "多维检测已检出异常" : "多维检测 · 全网正常"}</>}
        </div>
      </KpiCard>
    </div>
  );
}

function KpiCard({ title, value, color, children, wide }: { title: string; value: string; color: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ flex: wide ? "1.2 1 22%" : "1 1 18%", display: "flex", flexDirection: "column", padding: "2px 0 0 12px", borderLeft: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 9, color: "var(--ink-4)", fontWeight: 500 }}>{title}</span>
        <span className="mono" style={{ fontSize: 11, fontWeight: 500, color }}>{value}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, marginTop: 2 }}>{children}</div>
    </div>
  );
}
