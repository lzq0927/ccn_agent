// ============================================================================
// PhasePanels —— 富弹窗各相位内容 · Studio「静谧仪器」版
//   · AnomalyPanel(②检测):KPI 曲线 + 过载告警 + CHR 分布
//   · MatchPanel(③匹配):置信度 + 路由 + 为什么命中该策略
//   · ReasonPanel(④推理):推理步骤链 + 根因(左侧细竖线轨道,结论=红标线)
//   · DispatchPanel(⑤下发):3 策略(场景 D)+ 目标 + 当前轮参数
//   · EvalPanel(⑦评估):沉淀了什么 Skill / 优化什么(无真值对比)
//   卡片 = 内凹面 + 发丝线;小标题 = 衬线 + 语义色左标线;图表 1.25px 细线,无发光。
//   全部数据逻辑(含 LIVE 分支)与旧版一致。
// ============================================================================

import { useRef, useEffect, useState } from "react";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { ROUTE_COLORS, STATUS, srColor } from "../../theme";
import { getKpi, iotRegAt, sessIotAt } from "../../story/director";
import { sample } from "../../data/kpi";

/** 语义色速记(与 theme.ts 同值) */
const OK = STATUS.healthy;
const WARN = STATUS.warning;
const WARN_HI = STATUS.warningHi;
const DANGER = STATUS.fault;
const DANGER_HI = STATUS.faultHi;
const INFO = STATUS.info;
const ACCENT = "#7d8af2";
const ACCENT_HI = "#a3acf9";

/** 卡片容器:内凹面 + 发丝线 */
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-inset)", ...style }}>
      {children}
    </div>
  );
}

/** 小节标题:衬线 + 语义色左标线(替代 emoji + 等宽大写) */
function CardHead({ cn, color }: { cn: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
      <span style={{ width: 2.5, height: 11, borderRadius: 1.2, background: color, flexShrink: 0 }} />
      <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>{cn}</span>
    </div>
  );
}

/* ————————————————————— ② 异常检测:画出异常图 ————————————————————— */
export function AnomalyPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const isStorm = scenario.fault.faultType === "iot_storm";
  const live = state.liveKpi;  // LIVE 真实快照(有则优先用真实链路/KPI;无则回落 DEMO 合成)
  // 非风暴(A/B/C):无请求数突增 → 多条路径 KPI 突降 + (B/C)CHR 突增/分散
  if (!isStorm) return <NonStormAnomaly scenario={scenario} state={state} kpi={kpi} simT={simT} live={live} />;
  const graph = scenario.realGraph;
  const curI = Math.min(Math.max(Math.floor(simT) - 1, 0), 58);
  // AMF / SMF 聚合 KPI
  const agg = (type: string) => {
    const ns = graph ? graph.nodes.filter((n) => n.type === type) : [];
    if (!ns.length) return kpi.overall;
    const acc = ns.reduce<number[]>((a, n) => { const s = kpi.nodes[n.id] ?? []; s.forEach((v, i) => { a[i] = (a[i] ?? 0) + v; }); return a; }, []);
    return acc.map((v) => v / ns.length);
  };
  const amfSr = agg("AMF"), smfSr = agg("SMF");
  const regRate = Array.from({ length: 60 }, (_, i) => iotRegAt(scenario, i + 1));
  const sessRate = Array.from({ length: 60 }, (_, i) => sessIotAt(scenario, i + 1));
  const maxReg = Math.max(...regRate, 200);
  const maxSess = Math.max(...sessRate, 400);
  const visN = Math.max(3, curI + 2);
  // LIVE:KPI 用真实滚动历史(amfSrHist/smfSrHist),请求数用当前实时值铺平
  const liveAmf = live && state.amfSrHist && state.amfSrHist.length >= 2 ? state.amfSrHist : null;
  const liveSmf = live && state.smfSrHist && state.smfSrHist.length >= 2 ? state.smfSrHist : null;
  const liveReg = live ? Array.from({ length: Math.max(liveAmf?.length ?? 1, 1) }, () => live.iotRegRate + live.tocRegRate) : null;
  const liveSess = live ? Array.from({ length: Math.max(liveSmf?.length ?? 1, 1) }, () => live.iotSessRate + live.tocSessRate) : null;
  // 风暴场景:故障窗口内 KPI 合成下降(让曲线可见跌落)
  const dipSr = (arr: number[]) => {
    if (!isStorm) return arr;
    const fs = kpi.faultStart, fe = kpi.faultEnd;
    return arr.map((v, i) => {
      const t = i + 1;
      if (t < fs || t > fe) return v;
      const mid = (fs + fe) / 2;
      const dist = Math.abs(t - mid) / Math.max(1, (fe - fs) / 2);
      return Math.max(0.82, v - (1 - dist * 0.35) * 0.07);
    });
  };
  // CHR
  const chr = scenario.chrInsight;
  const related = chr?.related ?? [];
  const overloadNEs = isStorm ? scenario.fault.elements : [];

  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
      <DualCurve sr={liveAmf ?? dipSr(amfSr)} rate={liveReg ?? regRate} mx={liveReg ? Math.max(liveReg[0] ?? 1, 200) : maxReg} visN={liveAmf ? liveAmf.length : visN} srC={INFO} rateC={WARN} title="AMF 注册成功率 + 注册请求数/s" live={!!liveAmf} />
      <DualCurve sr={liveSmf ?? dipSr(smfSr)} rate={liveSess ?? sessRate} mx={liveSess ? Math.max(liveSess[0] ?? 1, 400) : maxSess} visN={liveSmf ? liveSmf.length : visN} srC={ACCENT} rateC={WARN} title="PDU 会话建立成功率 + 会话请求数/s" live={!!liveSmf} />

      {isStorm && scenario.stormMetrics && (() => {
        const m = scenario.stormMetrics;
        const isG = m.udmCpu != null;
        const bars = isG
          ? [{ id: "UDM_1", cpu: m.udmCpu as number }, { id: "AMF", cpu: m.amfCpu }, { id: "SMF", cpu: m.smfCpu }]
          : overloadNEs.map((id) => ({ id, cpu: id.replace(/_\d+$/, "") === "AMF" ? m.amfCpu : m.smfCpu }));
        return (
          <Card style={{ marginTop: 8, borderColor: WARN + "55" }}>
            <CardHead cn={`容器过载告警${isG ? " · AMF/SMF/UDM" : ""}`} color={WARN} />
            {bars.map((b) => <CpuBar key={b.id} id={b.id} cpu={b.cpu} />)}
            <div className="mono" style={{ fontSize: 10.5, color: WARN_HI, marginTop: 6 }}>注册请求 +{m.regSurge}% · PDU 会话 +{m.sessionSurge}%{isG && m.msgToUdmSurge ? ` · AMF/SMF→UDM 消息 +${m.msgToUdmSurge}%` : ""}</div>
          </Card>
        );
      })()}
    </div>
  );
}

/** 非风暴场景(A/B/C)异常检测:多条路径 KPI 突降 + (B/C)CHR 突增/分散。无请求数突增线。
 *  DEMO 画合成时序曲线;LIVE 用实时累积的每链路 KPI 时序画曲线(逐步揭示,非瞬时)。 */
function NonStormAnomaly({ scenario, state, kpi, simT, live }: { scenario: Scenario; state: StoryState; kpi: ReturnType<typeof getKpi>; simT: number; live: StoryState["liveKpi"] }) {
  const graph = scenario.realGraph;
  const isC = scenario.id === "C";
  const chr = scenario.chrInsight; // B/C 有,A 无
  const showChr = chr && (scenario.id === "B" || isC);

  // CHR 主导原因占比时序(突增曲线):故障窗内从基线 ~7% 升至 chr.share,恢复后缓降
  const chrSeries: number[] = [];
  if (chr) {
    const fs = kpi.faultStart, fe = kpi.faultEnd, peak = chr.share ?? 60;
    for (let i = 0; i < 60; i++) {
      const t = i + 1;
      if (t < fs - 1) chrSeries.push(6 + ((i * 7) % 4));                        // 基线噪声 6-9%
      else if (t < fe) chrSeries.push(6 + (peak - 6) * Math.min(1, (t - fs + 2) / 4)); // 故障窗内升至峰值
      else chrSeries.push(Math.max(6, peak - (t - fe) * 1.5));                   // 恢复缓降
    }
  }

  const PAL = [INFO, ACCENT, "#c98bb8", WARN];

  // LIVE:从 state.linkHist(每链路 KPI 时序)挑最劣化的几条画曲线 + 当前值条
  const linkHist = state.linkHist ?? {};
  const livePaths: { label: string; series: number[]; color: string }[] = live
    ? Object.entries(linkHist)
        .map(([id, series]) => ({
          label: id.replace("->", "↔"),
          series,
          min: series.length ? Math.min(...series) : 1,
          len: series.length,
        }))
        .filter((p) => p.len >= 2)
        .sort((a, b) => a.min - b.min)
        .slice(0, 4)
        .map((p, i) => ({ label: p.label, series: p.series, color: PAL[i % PAL.length] }))
    : [];
  const liveBars = live
    ? (live.linkAnomalies ?? [])
        .map((x) => ({ key: `${x.src}-${x.dst}`, a: x.src, b: x.dst, sr: x.successRate }))
        .sort((p, q) => p.sr - q.sr)
        .slice(0, 4)
    : [];
  // per-NE 实例 KPI 曲线(AMF 注册 / SMF PDU,均质化比较)—— LIVE 才有
  const regPaths = live
    ? Object.entries(state.neRegSrHist ?? {})
        .map(([id, series], i) => ({ label: id, series, color: PAL[i % PAL.length] }))
        .filter((p) => p.series.length >= 2)
    : [];
  const pduPaths = live
    ? Object.entries(state.nePduSrHist ?? {})
        .map(([id, series], i) => ({ label: id, series, color: PAL[i % PAL.length] }))
        .filter((p) => p.series.length >= 2)
    : [];

  // DEMO:挑要画的时序曲线(A/B=最劣化路径 top3;C=整网总体微跌)
  const visN = Math.max(3, Math.min(60, Math.floor(simT) + 1));
  let demoPaths: { label: string; series: number[]; color: string }[] = [];
  let noPathNote = "";
  if (!live && graph) {
    const cand = graph.flowEdges
      .map((e) => ({ label: `${e.a}↔${e.b}`, series: kpi.edges[e.id] ?? [], min: Math.min(...(kpi.edges[e.id] ?? [1])) }))
      .filter((p) => p.min < kpi.threshold)
      .sort((a, b) => a.min - b.min)
      .slice(0, 3)
      .map((p, i) => ({ label: p.label, series: p.series, color: PAL[i % PAL.length] }));
    if (cand.length) {
      demoPaths = cand;
    } else {
      demoPaths = [{ label: "整网总体 KPI", series: kpi.overall, color: PAL[0] }];
      noPathNote = "各链路均 ≥99.5% · 无明显路径异常 · 总体微跌 · 信号模糊";
    }
  }

  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
      <Card style={{ borderColor: DANGER + "44" }}>
        <CardHead cn={`多条路径 KPI 突降${isC ? " · 总体微跌" : ""}${live ? " · 实时累积" : ""}`} color={DANGER} />
        {live ? (
          livePaths.length ? (
            <>
              <MultiPathKpi paths={livePaths} threshold={kpi.threshold} visN={60} live />
              {liveBars.length > 0 && (
                <div style={{ marginTop: 7 }}>
                  {liveBars.map((r) => <SrBar key={r.key} a={r.a} b={r.b} sr={r.sr} />)}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: "var(--ink-4)" }}>实时监测中 · 等待仿真数据累积(故障未注入或信号未显现)</div>
          )
        ) : (
          <>
            <MultiPathKpi paths={demoPaths} threshold={kpi.threshold} visN={visN} />
            {noPathNote && <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 5 }}>{noPathNote}</div>}
          </>
        )}
      </Card>
      {live && regPaths.length > 0 && (
        <Card style={{ marginTop: 8 }}>
          <CardHead cn="AMF 实例注册成功率 · 均质化比较" color={INFO} />
          <MultiPathKpi paths={regPaths} threshold={kpi.threshold} visN={60} live />
        </Card>
      )}
      {live && pduPaths.length > 0 && (
        <Card style={{ marginTop: 8 }}>
          <CardHead cn="SMF 实例 PDU 会话成功率 · 均质化比较" color={ACCENT} />
          <MultiPathKpi paths={pduPaths} threshold={kpi.threshold} visN={60} live />
        </Card>
      )}
      {live && state.anomalyResult && state.anomalyResult.degradedLinks.length > 0 && (
        <Card style={{ marginTop: 8, borderColor: DANGER + "44" }}>
          <CardHead cn={`KPI 异常检测 · 工具结果${state.anomalyResult.topNe ? ` · 聚合定位 ${state.anomalyResult.topNe}` : ""}`} color={DANGER} />
          {state.anomalyResult.degradedLinks.slice(0, 4).map((l) => <SrBar key={`${l.src}-${l.dst}`} a={l.src} b={l.dst} sr={l.minSr ?? 1} />)}
        </Card>
      )}
      {showChr && (
        <Card style={{ marginTop: 8 }}>
          <CardHead cn={isC ? "CHR 原因分散 · 需聚类收敛" : "CHR 突增 · 会话原因值集中"} color={ACCENT} />
          <ChrCurve series={chrSeries} visN={visN} color={ACCENT} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Donut share={chr!.share ?? 60} label={chr!.causeCode} sub={isC ? "聚类主因" : "主导原因"} color={ACCENT} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {(chr!.related ?? []).length > 0
                ? (chr!.related ?? []).map((r, i) => <Bar key={i} label={`${r.code} ${r.cn}`} share={r.share ?? 0} color="var(--ink-4)" />)
                : <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.55 }}>{chr!.causeCn}</div>}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/** 多路径 KPI 时序曲线。DEMO:裁剪到 visN(逐步揭示,固定 60 长度);
 *  LIVE(live=true):按每条 series 自身长度铺满全宽(滚动历史可变长,逐步累积)。 */
function MultiPathKpi({ paths, threshold, visN, live }: { paths: { label: string; series: number[]; color: string }[]; threshold: number; visN: number; live?: boolean }) {
  const W = 280, H = 72;
  // y 轴下限自适应:下探到数据最小值下一格(clamp [0.80,0.95])
  const dataMin = paths.length ? Math.min(...paths.flatMap((p) => p.series)) : 0.95;
  const yMin = Math.max(0.8, Math.min(0.95, Math.floor((dataMin - 0.01) * 20) / 20));
  const xAt = (i: number, len: number) => (i / Math.max(len - 1, 1)) * W;
  const yAt = (v: number) => { const c = Math.max(yMin, Math.min(1, v)); return H - 4 - ((c - yMin) / (1 - yMin)) * (H - 8); };
  const yTh = yAt(threshold);
  return (
    <div style={{ marginTop: 4 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={yTh} y2={yTh} stroke={DANGER} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.75} vectorEffect="non-scaling-stroke" />
        {paths.map((p) => {
          const s = live ? p.series : p.series.slice(0, visN);
          return (
            <polyline key={p.label} points={s.map((v, i) => `${xAt(i, live ? s.length : 60).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ")} fill="none" stroke={p.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 9.5, color: "var(--ink-3)", marginTop: 4 }}>
        {paths.map((p) => (
          <span key={p.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-block", width: 7, height: 7, background: p.color, borderRadius: 2, opacity: 0.85 }} />{p.label}</span>
        ))}
        <span style={{ color: DANGER }}>┄ 阈值 99.5%</span>
      </div>
    </div>
  );
}

/** 链路成功率条(语义色) */
function SrBar({ a, b, sr }: { a: string; b: string; sr: number }) {
  const col = srColor(sr);
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 3 }}>
        <span className="mono" style={{ color: "var(--ink-3)" }}>{a} ↔ {b}</span>
        <span className="mono" style={{ color: col, fontWeight: 500 }}>KPI {(sr * 100).toFixed(2)}%</span>
      </div>
      <div style={{ height: 3, borderRadius: 1.5, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(2, sr * 100)}%`, background: col, opacity: 0.85 }} /></div>
    </div>
  );
}

/** 双曲线(KPI + 请求数),实时裁剪。live=true 时按数组自身长度铺满全宽 */
function DualCurve({ sr, rate, mx, visN, srC, rateC, title, live }: { sr: number[]; rate: number[]; mx: number; visN: number; srC: string; rateC: string; title: string; live?: boolean }) {
  const W = 280, H = 48;
  const n = live ? Math.max(sr.length, 2) : 60;
  const xAt = (i: number) => (i / (n - 1)) * W;
  const ySr = (v: number) => H - 3 - ((v - 0.8) / 0.2) * (H - 6);
  const yRate = (v: number) => H - 3 - (Math.min(v, mx) / mx) * (H - 6);
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ fontSize: 10, color: "var(--ink-3)", marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span>
        <span style={{ display: "flex", gap: 8 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><i style={{ width: 7, height: 2, background: srC, display: "inline-block" }} />KPI</span><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><i style={{ width: 7, height: 2, background: rateC, display: "inline-block" }} />请求</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <polyline points={sr.slice(0, visN).map((v, i) => `${xAt(i).toFixed(1)},${ySr(v).toFixed(1)}`).join(" ")} fill="none" stroke={srC} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <polyline points={rate.slice(0, visN).map((v, i) => `${xAt(i).toFixed(1)},${yRate(v).toFixed(1)}`).join(" ")} fill="none" stroke={rateC} strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" opacity={0.75} />
      </svg>
    </div>
  );
}
/** 小环图 */
function Donut({ share, label, sub, color }: { share: number; label: string; sub: string; color: string }) {
  const r = 26, rIn = 16, cx = 30, cy = 30;
  const a = (share / 100) * Math.PI * 2;
  const pt = (rad: number, ang: number): [number, number] => [cx + rad * Math.sin(ang), cy - rad * Math.cos(ang)];
  const [sx, sy] = pt(r, 0), [ex, ey] = pt(r, a), [sxi, syi] = pt(rIn, a), [exi, eyi] = pt(rIn, 0);
  const large = a > Math.PI ? 1 : 0;
  const path = `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} L ${sxi} ${syi} A ${rIn} ${rIn} 0 ${large} 0 ${exi} ${eyi} Z`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={60} height={60} viewBox="0 0 60 60">
        <circle cx={cx} cy={cy} r={(r + rIn) / 2} fill="none" stroke="var(--line)" strokeWidth={r - rIn} />
        <path d={path} fill={color} opacity={0.8} />
        <text x={cx} y={cy + 1} textAnchor="middle" fontSize={11.5} fontWeight={500} fill="var(--ink-1)" fontFamily="var(--font-mono)">{share}%</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={7} fill="var(--ink-4)" fontFamily="var(--font-sans)">{sub}</text>
      </svg>
      <span className="mono" style={{ fontSize: 9.5, fontWeight: 500, color, marginTop: 2 }}>{label}</span>
    </div>
  );
}

/** 多段环图(前后对比用):各段按 share 顺时针排布 */
function MultiDonut({ segments, center }: { segments: { label: string; share: number; color: string; dim?: boolean }[]; center?: string }) {
  const r = 27, rIn = 17.5, cx = 32, cy = 32;
  const pt = (rad: number, ang: number): [number, number] => [cx + rad * Math.sin(ang), cy - rad * Math.cos(ang)];
  let acc = 0;
  const arcs = segments
    .filter((s) => s.share > 0.5)
    .map((s) => {
      const a0 = (acc / 100) * Math.PI * 2;
      acc = Math.min(100, acc + s.share);
      const a1 = (acc / 100) * Math.PI * 2;
      return { ...s, a0, a1 };
    });
  return (
    <svg width={64} height={64} viewBox="0 0 64 64">
      <circle cx={cx} cy={cy} r={(r + rIn) / 2} fill="none" stroke="var(--line)" strokeWidth={r - rIn} />
      {arcs.map((s) => {
        const large = s.a1 - s.a0 > Math.PI ? 1 : 0;
        const [sx, sy] = pt(r, s.a0), [ex, ey] = pt(r, s.a1);
        const [sxi, syi] = pt(rIn, s.a1), [exi, eyi] = pt(rIn, s.a0);
        return <path key={s.label} d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} L ${sxi} ${syi} A ${rIn} ${rIn} 0 ${large} 0 ${exi} ${eyi} Z`} fill={s.color} opacity={s.dim ? 0.45 : 0.85} />;
      })}
      {center && <text x={cx} y={cy + 3} textAnchor="middle" fontSize={10.5} fontWeight={500} fill="var(--ink-1)" fontFamily="var(--font-mono)">{center}</text>}
    </svg>
  );
}

/** CHR 前后对比环图:排除噪声/聚类共因后,根因占比凸显(B/C 场景相位4) */
function DonutCompare({ scenario, chr }: { scenario: Scenario; chr: NonNullable<Scenario["chrInsight"]> }) {
  type CompareSeg = { label: string; share: number; color: string; dim?: boolean };
  const rel = chr.related ?? [];
  const relSum = rel.reduce((a, r) => a + (r.share ?? 0), 0);
  const isC = scenario.id === "C";
  const NOISE = "var(--ink-5)";
  const OTHER = "var(--line-2)";
  // B:排除终端噪声(5GMM:23/24 既有基线)后,网络侧原因占比抬升
  // C:初筛原因分散无主导 → 共因聚类后物联终端群体凸显
  const before: CompareSeg[] = isC
    ? [
        ...rel.map((r) => ({ label: r.code, share: r.share ?? 0, color: NOISE, dim: true })),
        { label: "其他", share: Math.max(0, 100 - relSum), color: OTHER, dim: true },
      ]
    : [
        { label: chr.causeCode, share: chr.share ?? 60, color: WARN },
        ...rel.map((r) => ({ label: r.code, share: r.share ?? 0, color: NOISE, dim: true })),
        { label: "其他", share: Math.max(0, 100 - (chr.share ?? 60) - relSum), color: OTHER, dim: true },
      ];
  const afterShare = isC ? chr.share ?? 52 : Math.round(((chr.share ?? 60) / Math.max(1, 100 - relSum)) * 100);
  const after: CompareSeg[] = [
    { label: isC ? "物联终端群体" : chr.causeCode, share: afterShare, color: DANGER },
    { label: "其他", share: 100 - afterShare, color: OTHER, dim: true },
  ];
  const excludeCn = isC ? "共因聚类 · 剔除分散噪声" : `排除终端噪声 ${rel.map((r) => r.code).join("/")}(既有基线)`;
  const conclusion = isC
    ? `聚类共因 gNB_2 物联终端 ${(chr.share ?? 52)}% → 网络健康 · 用户侧异常`
    : `${chr.causeCode} 占比 ${chr.share ?? 60}% → ${afterShare}% · 锁定 ${scenario.fault.elements[0] ?? "根因"}`;
  const Side = ({ segs, cap, hi }: { segs: CompareSeg[]; cap: string; hi?: boolean }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, minWidth: 0 }}>
      <MultiDonut segments={segs} center={hi ? `${afterShare}%` : undefined} />
      <span style={{ fontSize: 9.5, color: hi ? "var(--ink-2)" : "var(--ink-4)", fontWeight: hi ? 500 : 400, textAlign: "center", lineHeight: 1.3 }}>{cap}</span>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Side segs={before} cap={isC ? "初筛 · 原因分散无主导" : `初筛 · ${chr.causeCode} ${chr.share ?? 60}% 混杂噪声`} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <svg width="26" height="12" viewBox="0 0 26 12"><path d="M1 6 L20 6 M15 2 L21 6 L15 10" stroke={OK} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontSize: 8.5, color: OK, textAlign: "center", maxWidth: 92, lineHeight: 1.35 }}>{excludeCn}</span>
        </div>
        <Side segs={after} cap={isC ? "聚类后 · 物联群体凸显" : `降噪后 · ${chr.causeCode} ${afterShare}%`} hi />
      </div>
      <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 5 }}>
        <b style={{ color: DANGER_HI, fontWeight: 500 }}>{conclusion}</b>
      </div>
    </div>
  );
}

/** CHR 主导原因占比时序曲线(突增):故障窗内从基线升至峰值,带 30% 突增阈值线 */
function ChrCurve({ series, visN, color }: { series: number[]; visN: number; color: string }) {
  const W = 280, H = 40, yMax = 70;
  const xAt = (i: number) => (i / 59) * W;
  const yAt = (v: number) => H - 2 - (Math.min(v, yMax) / yMax) * (H - 4);
  const thY = yAt(30);
  const cur = Math.max(0, Math.min(visN, series.length) - 1);
  return (
    <div style={{ marginBottom: 7 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={thY} y2={thY} stroke={WARN} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.75} vectorEffect="non-scaling-stroke" />
        <polyline points={series.slice(0, visN).map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        {series.length > 0 && <circle cx={xAt(cur)} cy={yAt(series[cur])} r={2} fill={color} />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--ink-3)", marginTop: 2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i style={{ width: 7, height: 2, background: color, display: "inline-block" }} />主导原因占比时序</span>
        <span style={{ color: WARN_HI }}>┄ 突增阈值 30%</span>
      </div>
    </div>
  );
}

/* ————————————————————— ③ 策略匹配:为什么命中该策略 ————————————————————— */
const PATTERN_CN: Record<string, string> = {
  single_ne: "单网元故障", multi_ne: "多网元故障", all_type_ne: "同类型网元故障",
  resource_pool: "资源池故障", dc: "数据中心故障", path_level: "路径级故障",
  path_link: "链路故障", switch: "交换故障", normal: "正常",
};

export function MatchPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  // LIVE:用真 Agent 置信度评估;DEMO:用场景手设 confidence
  const lc = state.liveConfidence;
  const c = lc
    ? { score: lc.score, route: lc.route as typeof scenario.confidence.route, patternName: PATTERN_CN[lc.pattern] ?? lc.pattern ?? "—" }
    : scenario.confidence;
  const rc = ROUTE_COLORS[c.route] ?? ROUTE_COLORS[scenario.confidence.route];
  // LIVE:匹配逻辑用真实评估结果(特征→分数→路由);DEMO 用场景口语化解释
  const why = lc
    ? `实时特征评估:异常模式 ${lc.pattern ?? "—"} 得分 ${lc.score.toFixed(2)},`
      + (lc.route === "workflow"
          ? "信号确定性高(均质化铁证/已知模式)→ 确定性工作流,固定步骤直达根因。"
          : lc.route === "guided"
            ? "信号中等(KPI 微损/存在模糊)→ 技能引导 Agent Loop,注入匹配 Skill 逐步收敛。"
            : lc.route === "exploration"
              ? "KPI 模糊但 CHR 失败集中 → 多算法并行探索 + 贝叶斯融合。"
              : "信号弱 → 自主探索,完整 Agent Loop + 并行假设验证。")
    : whyMatched(scenario);
  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 5 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 500, color: rc.base }}>{c.score.toFixed(2)}</span>
        <span className="font-display" style={{ fontSize: 14, fontWeight: 600, color: rc.base }}>→ {rc.cn}</span>
        {lc && <span className="tag mono" style={{ color: INFO, borderColor: INFO + "55" }}>实时</span>}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 9 }}>{c.patternName}</div>

      <Card>
        <CardHead cn="匹配逻辑" color={rc.base} />
        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>{why}</div>
      </Card>
    </div>
  );
}

/* ————————————————————— ④ 根因推理:推理步骤 + 根因 ————————————————————— */
export function ReasonPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const all = state.reasoningSteps;
  const scrollRef = useRef<HTMLDivElement>(null);
  // 逐步揭示:打开后一条条追加,每加一条滚到底
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (all.length === 0) { setShown(0); return; }
    const id = setInterval(() => {
      setShown((s) => {
        if (s >= all.length) { clearInterval(id); return s; }
        return s + 1;
      });
    }, 360);
    return () => clearInterval(id);
  }, [all.length]);
  useEffect(() => {
    // rAF:等新步布局更新后再滚,确保滚轮稳定贴在最下方(显示最新一步)
    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [shown]);
  const steps = all.slice(0, shown);
  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)", marginBottom: 7, flexShrink: 0 }}>推理链 · AGENT LOOP — 共 {state.reasoningTotal} 步 · 已揭示 {Math.max(shown, all.length)}</div>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 3, display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.slice(-9).map((s) => {
          const concl = s.type === "conclusion";
          return (
            <div key={s.n} style={{ display: "flex", gap: 8, padding: "6px 9px", borderRadius: 6, background: concl ? DANGER + "0d" : "var(--bg-inset)", border: `1px solid ${concl ? DANGER + "3d" : "var(--line)"}`, borderLeft: `2px solid ${concl ? DANGER : "var(--line-3)"}` }}>
              <span className="mono" style={{ fontSize: 10, color: concl ? DANGER_HI : "var(--ink-4)", flexShrink: 0, paddingTop: 1 }}>#{s.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{s.text}</div>
                {s.result && <div className="mono" style={{ fontSize: 10.5, color: concl ? DANGER_HI : ACCENT_HI, marginTop: 2 }}>→ {s.result}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {/* LIVE:均质化比较(真实数据:实例级对比 + 判定,通用推导) */}
      {state.liveHomogen && state.liveHomogen.rounds.length > 0 && (
        <Card style={{ marginTop: 8, flexShrink: 0 }}>
          <CardHead cn="均质化比较 · 实时遥测" color={ACCENT} />
          {state.liveHomogen.rounds.map((r, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono" style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                  color: r.verdict === "root" ? DANGER_HI : r.verdict === "exclude" ? "var(--ink-4)" : ACCENT_HI,
                  border: `1px solid ${r.verdict === "root" ? DANGER + "66" : "var(--line)"}` }}>
                  {r.verdict === "root" ? "离群·根因" : r.verdict === "exclude" ? "共性·排除" : "部分劣化"}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{r.type}</span>
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                {r.instances.map((inst) => (
                  <span key={inst.id} className="mono" style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 3,
                    color: inst.anomalous ? DANGER_HI : "var(--ink-4)",
                    background: inst.anomalous ? DANGER + "12" : "var(--bg-inset)",
                    border: `1px solid ${inst.anomalous ? DANGER + "44" : "var(--line)"}` }}>
                    {inst.id}{inst.sr != null ? ` ${(inst.sr * 100).toFixed(1)}%` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {state.liveHomogen.anchorNe && state.liveHomogen.anchorExclusivity >= 0.5 && (
            <div style={{ fontSize: 11, color: DANGER_HI, marginTop: 4 }}>
              根因锚定 {state.liveHomogen.anchorNe}(全路径退化独占率 {state.liveHomogen.anchorExclusivity.toFixed(2)})
            </div>
          )}
        </Card>
      )}
      {/* LIVE:CHR 洞察(真实数据:原因值分布 + 共因 NF + 类别归因) */}
      {state.liveChrInsight && state.liveChrInsight.causeCode && (
        <Card style={{ marginTop: 8, flexShrink: 0 }}>
          <CardHead cn={`CHR 洞察 · 实时 · 主因 ${state.liveChrInsight.causeCode}`} color={ACCENT} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center" }}>
            <Donut share={Math.round(state.liveChrInsight.causeShare * 100)} label={state.liveChrInsight.causeCode} sub="主因占比" color={ACCENT} />
            <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.6 }}>
              <div>失败 {state.liveChrInsight.failTotal} 条 · 共因 {state.liveChrInsight.nes.slice(0, 2).join(" / ") || "—"}</div>
              {state.liveChrInsight.related.slice(0, 2).map((r) => (
                <div key={r.code}>{r.code} · {Math.round(r.share * 100)}%</div>
              ))}
              {state.liveChrInsight.dominantClass && (
                <div>类别归因 {state.liveChrInsight.dominantClass.key}(基线 {(state.liveChrInsight.dominantClass.baseShare * 100).toFixed(0)}%)</div>
              )}
            </div>
          </div>
        </Card>
      )}
      {/* 根因由推理链 conclusion 步承载 */}
      {scenario.chrInsight && (() => {
        const chr = scenario.chrInsight;
        const rel = chr.related ?? [];
        const isBC = scenario.id === "B" || scenario.id === "C";
        const showSst = !isBC && steps.some((s) => /SST/.test(s.text));
        const showDnn = !isBC && steps.some((s) => /DNN/.test(s.text));
        if (!isBC && !showSst && !showDnn) return null;
        return (
          <Card style={{ marginTop: 8, flexShrink: 0 }}>
            <CardHead cn={`CHR 前后对比${isBC ? ` · ${chr.causeCn}` : ""}`} color={ACCENT} />
            {isBC ? (
              <DonutCompare scenario={scenario} chr={chr} />
            ) : (
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                {showSst && <Donut share={chr.share ?? 60} label={chr.causeCode} sub="注册" color={ACCENT} />}
                {showDnn && rel.length > 0 && <Donut share={rel[0].share ?? 58} label={rel[0].code} sub="会话" color="var(--ink-4)" />}
              </div>
            )}
          </Card>
        );
      })()}
    </div>
  );
}

/* ————————————————————— ⑤ 策略下发:3 策略 + 目标 ————————————————————— */
export function DispatchPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const plan = scenario.recoveryPlan;
  const r = state.round;
  // LIVE:后端通用规划器已下发真实策略 → 优先展示(带推导依据)
  if (state.recoveryActions.length > 0 && (state.recoveryActions[0] as { rationale?: string }).rationale) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        <CardHead cn={`恢复策略下发 · 第 ${r} 轮 · 通用规划器`} color={OK} />
        {state.recoveryActions.map((a, i) => (
          <Card key={a.id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: ACCENT_HI }}>策略 {i + 1} · {a.cn}</span>
              {a.layer && <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)" }}>{a.layer}</span>}
            </div>
            {a.rationale && <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>{a.rationale}</div>}
          </Card>
        ))}
      </div>
    );
  }
  if (plan) {
    const values = r === 1 ? plan.strategies.map((s) => ({ layer: s.layer, value: s.initialValue })) : plan.rounds.r2Values;
    const note = r === 1 ? plan.rounds.r1Note : plan.rounds.r2Note;
    return (
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        <CardHead cn={`三策略并行下发 · 第 ${r} 轮${r === 2 ? "(排除 iPhone + 微调)" : "(全发,iPhone 忽略→放大)"}`} color={OK} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 9 }}>
          {plan.strategies.map((s, i) => {
            const v = values[i];
            const isG = scenario.stormMetrics?.udmCpu != null;
            // 策略语义:F=1 AMF+SMF通知UE / 2 AMF限流 / 3 SMF限流;G=1 回T3346/T3396 / 2 限SST=3 / 3 限DNN=MIot.xx
            const label = isG
              ? (s.layer === "UE" ? "AMF/SMF 回 T3346/T3396(10min)" : s.layer === "AMF" ? "限 SST=3 注册用户" : "限 DNN=MIot.xx 会话用户")
              : (s.layer === "UE" ? "AMF+SMF 通知 UE(back-off)" : s.layer === "AMF" ? "AMF 限流(NSSAI)" : "SMF 限流(DNN)");
            return (
              <Card key={s.layer}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: ACCENT_HI }}>策略 {i + 1} · {label}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: ACCENT_HI }}>{v.value}{s.unit}</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", margin: "3px 0 1px" }}>{s.formula}</div>
                {r === 2 && s.layer === "UE" && <div style={{ fontSize: 10, color: "#c98bb8" }}>⊘ 排除 iPhone · 仅 65% 终端</div>}
              </Card>
            );
          })}
        </div>
        <Card style={{ borderColor: (r === 1 ? WARN : OK) + "55" }}>
          <div style={{ display: "flex", gap: 7, fontSize: 11, color: r === 1 ? WARN_HI : OK, lineHeight: 1.55 }}>
            <span style={{ flexShrink: 0 }}>{r === 1 ? "△" : "✓"}</span>
            <span>{note}</span>
          </div>
        </Card>
      </div>
    );
  }
  // 非 F:通用动作列表
  const actions = state.recoveryActions;
  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
      <CardHead cn="恢复策略下发" color={OK} />
      {actions.map((a, i) => (
        <div key={a.id} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 12 }}>
          <span className="mono" style={{ color: OK, fontWeight: 500 }}>{i + 1}.</span><span>{a.cn}</span>
        </div>
      ))}
    </div>
  );
}

/** Agent3 评估未通过(首轮 phase7 round1):具体写哪些指标未恢复 */
export function EvalFailPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const sr = sample(kpi.overall, state.simT);
  const isG = scenario.stormMetrics?.udmCpu != null;
  const m = scenario.stormMetrics;
  const cpus = state.simNeCpu ?? {};
  const topCpu = (prefix: string) => Object.entries(cpus).filter(([id]) => id.startsWith(prefix)).map(([, v]) => v).sort((a, b) => b - a)[0] ?? 0;
  const udmCpu = topCpu("UDM");
  const amfCpu = topCpu("AMF");
  const smfCpu = topCpu("SMF");
  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
      <Card style={{ borderColor: WARN + "55", marginBottom: 10 }}>
        <CardHead cn="Agent 3 评估 · 未通过" color={WARN} />
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {isG ? (
            <>
              <FailRow label="UDM CPU" val={`${udmCpu.toFixed(0)}%`} detail="过载告警未消除(>70%)" />
              <FailRow label="AMF 注册 KPI" val={`${(sr * 100).toFixed(1)}%`} detail="未恢复正常" />
              <FailRow label="SMF PDU 会话 KPI" val={`${(sr * 100).toFixed(1)}%`} detail="未恢复正常" />
              {m?.msgToUdmSurge ? <FailRow label="AMF/SMF→UDM 消息" val={`仍偏高`} detail="未完全降下去" /> : null}
            </>
          ) : (
            <>
              <FailRow label="AMF CPU" val={`${amfCpu.toFixed(0)}%`} detail="过载告警未消除" />
              <FailRow label="SMF CPU" val={`${smfCpu.toFixed(0)}%`} detail="过载告警未消除" />
              <FailRow label="注册/会话 KPI" val={`${(sr * 100).toFixed(1)}%`} detail="未恢复正常" />
            </>
          )}
        </div>
      </Card>
      <Card>
        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
          → Agent3 判定未恢复,<b style={{ color: ACCENT_HI }}>回 Agent1 第二轮重新采集</b>,进一步分析终端类型 + 按差值重算参数。
        </div>
      </Card>
    </div>
  );
}

function FailRow({ label, val, detail }: { label: string; val: string; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
      <span style={{ color: "var(--ink-3)", minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span className="mono" style={{ color: WARN_HI, fontWeight: 500, minWidth: 50 }}>{val}</span>
      <span style={{ color: "var(--ink-4)", fontSize: 10.5 }}>{detail}</span>
    </div>
  );
}

/* ————————————————————— ⑦ 评估优化:沉淀 + 优化(无真值对比)————————————————————— */
export function EvalPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  // LIVE:state.evalMetrics 带 metrics 字段(后端 evaluation_report 形状)→ 显示真实恢复+P/R/F1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveRep: any = state.evalMetrics && (state.evalMetrics as any).metrics ? state.evalMetrics : null;
  if (liveRep) {
    const m = liveRep.metrics;
    const ce = liveRep.case_entry ?? {};
    const recovered: boolean = !!liveRep.recovered;
    return (
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        <Card style={{ borderColor: (recovered ? OK : WARN) + "55" }}>
          <CardHead cn={`${recovered ? "网络已恢复" : "未恢复"} · 实时评估`} color={recovered ? OK : WARN} />
          {liveRep.amf_success_rate != null && (
            <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
              AMF 注册 KPI {(liveRep.amf_success_rate * 100).toFixed(2)}% · SMF PDU KPI {(liveRep.smf_success_rate * 100).toFixed(2)}%
            </div>
          )}
          {ce.truth && (
            <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 5 }}>
              诊断 <b className="mono" style={{ color: ACCENT_HI, fontWeight: 500 }}>{(ce.predicted ?? []).join(",") || "—"}</b> · 真值 <b className="mono" style={{ color: INFO, fontWeight: 500 }}>{(ce.truth ?? []).join(",")}</b> {m.exact_match ? "✓ 命中全部根因" : "~ 部分命中"}
            </div>
          )}
          <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 5 }}>
            诊断-恢复轮次 {liveRep.rounds ?? 1}{liveRep.class_match != null && <> · 类别命中 {liveRep.class_match ? "✓" : "✗"}</>}{liveRep.max_core_cpu != null && <> · 峰值CPU {liveRep.max_core_cpu}%</>}
          </div>
          {(liveRep.liveSuggestions ?? liveRep.suggestions ?? []).length > 0 && (
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: "1px dashed var(--line-2)" }}>
              {((liveRep.liveSuggestions ?? liveRep.suggestions ?? []) as { suggestion_type: string; content: string }[]).slice(0, 3).map((sg, i) => (
                <div key={i} style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.55 }}>↩ {sg.content}</div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }
  const sk = scenario.skillEvolution;
  const rep = scenario.faultReport;
  const kpi = getKpi(scenario);
  const ev = scenario.evaluation;
  const sr = sample(kpi.overall, state.simT);
  const recovered = sr >= kpi.threshold;
  return (
    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
      {/* 评估通过:诊断命中 + 网络恢复 KPI */}
      <Card style={{ borderColor: OK + "4d" }}>
        <CardHead cn="Agent 3 评估 · 通过" color={OK} />
        {scenario.predicted.elements.length > 0 && (
          <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginBottom: 5 }}>
            诊断 <b className="mono" style={{ color: ACCENT_HI, fontWeight: 500 }}>{scenario.predicted.elements.join(",")}</b> · 真值 <b className="mono" style={{ color: INFO, fontWeight: 500 }}>{scenario.truth.elements.join(",")}</b>{" "}
            {ev?.exactMatch ? "✓ 命中全部根因" : "~ 部分命中"}
          </div>
        )}
        <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>网络恢复 · 整网 KPI <b style={{ color: srColor(sr), fontWeight: 500 }}>{(sr * 100).toFixed(2)}%</b> {recovered ? "✓ ≥99.5%" : "· 恢复中"}</div>
      </Card>
      {rep && (
        <Card style={{ marginTop: 8 }}>
          <CardHead cn="故障报告" color={INFO} />
          <RepRow k="根因" v={rep.rootCause} />
          <RepRow k="处置" v={rep.action} />
          <RepRow k="结果" v={rep.outcome} accent />
        </Card>
      )}
      {sk && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="tag" style={{ color: ACCENT_HI, borderColor: ACCENT + "55" }}>{sk.kind === "NEW" ? "新增 Skill" : "更新 Skill"}</span>
            <span className="font-display" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}>{sk.skillCn}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginBottom: 5 }}>沉淀经验 · 回流 Agent 1 / Agent 2</div>
          <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>{sk.insight ?? sk.after}</div>
        </Card>
      )}
      {!sk && scenario.confidence.route === "workflow" && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="tag" style={{ color: OK, borderColor: OK + "55" }}>确定性工作流</span>
            <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>命中已知模式 · 无需沉淀 Skill</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.55 }}>该故障匹配确定性工作流,根因定位与恢复均为固定步骤,命中已知模式,不触发 Skill 更新或沉淀。</div>
        </Card>
      )}
    </div>
  );
}

/* ————————————————————— 小件 ————————————————————— */
function CpuBar({ id, cpu }: { id: string; cpu: number }) {
  const c = cpu >= 85 ? DANGER : cpu >= 70 ? WARN : OK;
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 3 }}>
        <span className="mono" style={{ color: "var(--ink-3)" }}>{id}</span>
        <span className="mono" style={{ color: c, fontWeight: 500 }}>CPU {cpu}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${cpu}%`, background: c, opacity: 0.85 }} /></div>
    </div>
  );
}
function Bar({ label, share, color }: { label: string; share: number; color: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
        <span style={{ color: "var(--ink-3)" }}>{label}</span>
        <span className="mono" style={{ color: color === "var(--ink-4)" ? "var(--ink-3)" : color, fontWeight: 500 }}>{share}%</span>
      </div>
      <div style={{ height: 3, borderRadius: 1.5, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${share}%`, background: color, opacity: 0.75 }} /></div>
    </div>
  );
}
function RepRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ fontSize: 11.5, color: accent ? OK : "var(--ink-2)", lineHeight: 1.55, marginBottom: 3, display: "flex", gap: 6, wordBreak: "break-all", overflowWrap: "anywhere" }}>
      <span style={{ color: "var(--ink-4)", flexShrink: 0, minWidth: 30 }}>{k}</span>
      <span style={accent ? { fontWeight: 500 } : undefined}>{v}</span>
    </div>
  );
}

/** 为什么命中该策略(匹配逻辑)—— 按场景路由给出口语化解释 */
function whyMatched(s: Scenario): string {
  const c = s.confidence;
  if (c.route === "workflow") {
    if (s.fault.faultType === "iot_storm" && s.stormMetrics?.udmCpu != null) {
      return `检测到 AMF/SMF/UDM 容器 CPU 过载告警(均>85%)+ AMF/SMF→UDM 消息突增 + 注册/会话 KPI 下降 = 典型「过载」模式。模式清晰,置信度 ${c.score.toFixed(2)} > 0.7 → 命中确定性工作流:在 AMF/SMF 侧限流消除过载,不走 LLM Loop。`;
    }
    if (s.fault.faultType === "iot_storm") {
      return `检测到 AMF/SMF 容器 CPU 过载告警 + 大片 NE 同时异常 = 典型「过载风暴」模式。模式强度高、信号清晰,置信度 ${c.score.toFixed(2)} > 0.7 → 命中确定性工作流:直达根因(物联终端风暴),不走 LLM Loop。`;
    }
    return `异常模式强度高、时空清晰,置信度 ${c.score.toFixed(2)} > 0.7 → 命中确定性工作流,直达根因。`;
  }
  if (c.route === "guided") {
    return `异常存在但叠加终端噪声,信号中等。置信度 ${c.score.toFixed(2)} ∈ [0.3,0.7] → 技能引导 Loop:注入匹配 Skill,多维校验(CHR 降噪)收敛根因。`;
  }
  return `信号模糊、原因分散,置信度 ${c.score.toFixed(2)} ≤ 0.3 → 自主探索 Loop:多角度并行(CHR 聚类 + 用户分群)多轮收敛。`;
}
