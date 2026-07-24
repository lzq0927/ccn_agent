// ============================================================================
// DigitalTwin —— 中央 SVG 网络数字孪生(用户级韧性 × 网络自治增强版)
//   节点(9 类 NE，按数据流分层) + 业务流/注册链路 + 流动数据粒子
//   健康着色由 KPI(simT) 驱动;异常脉冲 / 推理聚焦 / 根因标定 / 恢复叠加
//   ★ 用户级:UE 接入簇按 gNB 分组、CHR 原因值弹窗(场景B)
//   ★ 网络自治:误报拦截标记(场景C)、用户群体异常标记(场景C，网络保持绿)
//   ★ 步骤-拓扑联动:当前执行步的高亮 NE 加「当前排查」脉冲标记
//   graph / kpi 可由 LIVE 模式注入真实数据;缺省用内置 DEMO 网络。
// ============================================================================

import { memo } from "react";
import { DEMO_GRAPH, VIEW_H, VIEW_W, type NetworkGraph } from "../../data/network";
import { sample, type KpiBundle } from "../../data/kpi";
import type { Scenario } from "../../data/types";
import { getKpi } from "../../story/director";
import type { StoryState } from "../../story/types";
import { NE_COLORS, STATUS, srColor } from "../../theme";

const R = 18; // 节点半径

function lineBetween(ax: number, ay: number, bx: number, by: number, r: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { x1: ax + ux * r, y1: ay + uy * r, x2: bx - ux * r, y2: by - uy * r };
}

/** 简单字符宽度折行(SVG 文本无自动换行) */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if (ch === "，" || ch === "," || cur.length >= max) {
      out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 3);
}

interface Props {
  scenario: Scenario;
  state: StoryState;
  graph?: NetworkGraph;
  kpi?: KpiBundle;
}

/** SIM 模式:节点 CPU% 文本(绿/琥珀/红) */
function cpuText(cpu: number, radius: number) {
  const c = cpu >= 85 ? STATUS.fault : cpu >= 70 ? STATUS.warning : STATUS.healthy;
  return <text y={radius + 24} textAnchor="middle" fontSize={7.5} fontWeight={700} fill={c} fontFamily="var(--font-mono)">CPU {cpu}%</text>;
}

function DigitalTwinBase({ scenario, state, graph, kpi: kpiProp }: Props) {
  const g: NetworkGraph = graph ?? DEMO_GRAPH;
  const kpi: KpiBundle = kpiProp ?? getKpi(scenario);
  const simT = state.simT;
  const threshold = kpi.threshold;

  const focusSet = new Set(state.affectedNe);
  const rootSet = new Set(state.rootCause.nes);
  const cordonedSet = new Set(state.cordonedNe);
  const rerouteSet = new Set(state.rerouteEdges);
  const cpuOverloadSet = new Set(state.cpuOverloadNe); // 场景 D/E:AMF/SMF CPU 过载

  // ★ 扩展派生态集合
  const userFaultGnbs = state.userLevelActive && state.userLevel ? new Set(state.userLevel.gnbs) : new Set<string>();
  const currentStepNes = new Set(state.currentStep?.highlight?.nes ?? []);
  const falseAlarmNe = state.falseAlarmActive && scenario.falseAlarm ? scenario.falseAlarm.naiveNe : null;
  const userFault = state.userLevelActive ? state.userLevel : null;

  function edgeLine(a: string, b: string) {
    const A = g.nodeById[a];
    const B = g.nodeById[b];
    if (!A || !B) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    const [from, to] = A.layer <= B.layer ? [A, B] : [B, A];
    return lineBetween(from.x, from.y, to.x, to.y, R);
  }

  const overallSr = sample(kpi.overall, simT);
  const degradedCount = g.nodes.filter((n) => sample(kpi.nodes[n.id] ?? [0.999], simT) < threshold).length;
  // 边线密度自适应:边多的场景(A,168 条)整体调浅调细，避免扎眼;边少的(B/C/D,27 条)保持原样
  const dense = g.flowEdges.length > 60;

  // 异常初筛:逐链路检出跌破阈值的链路(phase 2 弹窗用)——任意链路异常即触发
  const degradedP2 = g.flowEdges
    .filter((e) => kpi.edges[e.id]?.some((v) => v < threshold))
    .sort((a, b) => Math.min(...kpi.edges[a.id]) - Math.min(...kpi.edges[b.id]));

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="twin-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="twin-glow-strong" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="node-healthy" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="var(--twin-node-bg-1)" />
          <stop offset="100%" stopColor="var(--twin-node-bg-2)" />
        </radialGradient>
        <radialGradient id="node-fault" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="var(--twin-fault-bg-1)" />
          <stop offset="100%" stopColor="var(--twin-fault-bg-2)" />
        </radialGradient>
        {g.flowEdges.map((e) => {
          const L = edgeLine(e.a, e.b);
          return <path key={`p-${e.id}`} id={`p-${e.id}`} d={`M ${L.x1} ${L.y1} L ${L.x2} ${L.y2}`} fill="none" stroke="none" />;
        })}
      </defs>

      {/* DC 容器 */}
      <rect x={56} y={46} width={968} height={568} rx={14} fill="var(--accent-a12)" stroke="var(--twin-edge)" strokeDasharray="2 6" />
      <text x={66} y={40} fill="var(--text-dim)" fontSize={11} fontFamily="var(--font-mono)" letterSpacing="0.18em">
        DC1 · 5GC SA CORE · DIGITAL TWIN
      </text>

      {/* UE 接入簇(左)—— 用户级:受影响 gNB 的接入线染琥珀 */}
      <UeCluster nodes={g.nodes} active={state.twinMode !== "healed" || state.phaseIndex <= 1} anomaly={state.showAnomaly} userFaultGnbs={userFaultGnbs} />

      {/* 注册链路(弱) */}
      <g opacity={0.9}>
        {g.registryEdges.map((e) => {
          const L = edgeLine(e.a, e.b);
          return <line key={e.id} x1={L.x1} y1={L.y1} x2={L.x2} y2={L.y2} stroke="var(--twin-registry)" strokeWidth={0.8} />;
        })}
      </g>

      {/* 业务流链路 */}
      <g>
        {g.flowEdges.map((e) => {
          const ll = edgeLine(e.a, e.b);
          const sr = sample(kpi.edges[e.id] ?? [0.999], simT);
          const degraded = sr < threshold;
          const isReroute = rerouteSet.has(e.id);
          const isFocus = focusSet.has(e.a) || focusSet.has(e.b) || rootSet.has(e.a) || rootSet.has(e.b);
          const baseColor = dense ? "var(--accent-a20)" : "var(--accent-a28)";
          const color = isReroute ? STATUS.recovered : degraded ? srColor(sr) : baseColor;
          const dashClass = isReroute ? "flow-dash-fast" : "flow-dash";
          const width = isReroute ? 3.4 : isFocus ? 2.2 : dense ? 0.8 + e.weight * 0.25 : 1.3 + e.weight * 0.5;
          const opacity = isReroute ? 1 : degraded ? (dense ? 0.6 : 0.95) : dense ? 0.22 : 0.5;
          return (
            <g key={e.id}>
              <line
                x1={ll.x1}
                y1={ll.y1}
                x2={ll.x2}
                y2={ll.y2}
                stroke={color}
                strokeWidth={width}
                strokeLinecap="round"
                className={state.phaseIndex >= 1 ? dashClass : undefined}
                opacity={opacity}
                filter={degraded || isReroute ? "url(#twin-glow)" : undefined}
              />
              {(isFocus || isReroute) && state.phaseIndex >= 1 && (
                <circle r={isReroute ? 3.2 : 2.4} fill={isReroute ? "#bbf7d0" : "#7dd3fc"} filter="url(#twin-glow)">
                  <animateMotion dur={isReroute ? "0.9s" : "1.5s"} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#p-${e.id}`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          );
        })}
      </g>

      {/* 节点 */}
      <g>
        {g.nodes.map((n) => {
          const sr = sample(kpi.nodes[n.id] ?? [0.999], simT);
          const degraded = sr < threshold && state.showAnomaly;
          const isUserFaultGnb = userFaultGnbs.has(n.id); // 场景 C:用户级异常(琥珀，非红)
          const isFocus = focusSet.has(n.id);
          const isRoot = rootSet.has(n.id);
          const isCordoned = cordonedSet.has(n.id);
          const isCurrentStep = currentStepNes.has(n.id) && state.phaseIndex === 4; // 步骤-拓扑联动
          const isFalseAlarm = falseAlarmNe === n.id; // 场景 C:误报标记
          const tc = NE_COLORS[n.type] ?? { base: "#38bdf8", glow: "#7dd3fc" };
          const ringColor = isCordoned ? "var(--text-faint)" : isUserFaultGnb ? STATUS.warning : degraded ? STATUS.fault : isFocus ? tc.glow : tc.base;
          const fillUrl = degraded && !isUserFaultGnb ? "url(#node-fault)" : "url(#node-healthy)";
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              {/* 网络故障告警脉冲(用户级异常的 gNB 不走红色告警) */}
              {degraded && !isUserFaultGnb && <circle r={R} fill="none" stroke={STATUS.fault} strokeWidth={1.5} className="alert-ring" opacity={0.8} />}
              {/* 用户群体异常标记(场景 C):琥珀脉冲环 + UE 数，网络本体保持健康 */}
              {isUserFaultGnb && (
                <g filter="url(#twin-glow)">
                  <circle r={R + 6} fill="none" stroke={STATUS.warning} strokeWidth={1.6} strokeDasharray="5 4" className="alert-ring" opacity={0.9} />
                  <text y={-R - 11} textAnchor="middle" fontSize={9} fontWeight={700} fill={STATUS.warning} fontFamily="var(--font-mono)">
                    {userFault?.affectedUe ?? 0} UE 群体异常
                  </text>
                </g>
              )}
              {/* 误报标记(场景 C):朴素网络视角误判的 NE;phase≥3 被置信度拦截 */}
              {isFalseAlarm && (
                <g opacity={state.falseAlarmIntercepted ? 0.55 : 0.95}>
                  <circle r={R + 8} fill="none" stroke={state.falseAlarmIntercepted ? STATUS.fault : STATUS.warning} strokeWidth={1.3} strokeDasharray="3 4" />
                  <text y={-R - 12} textAnchor="middle" fontSize={9} fontWeight={700} fill={state.falseAlarmIntercepted ? STATUS.faultGlow : STATUS.warning} fontFamily="var(--font-mono)">
                    {state.falseAlarmIntercepted ? "✗ 已拦截·误报" : "？ 误报嫌疑"}
                  </text>
                  {state.falseAlarmIntercepted && (
                    <line x1={-R - 6} y1={-R - 14} x2={R + 6} y2={-R - 8} stroke={STATUS.fault} strokeWidth={1.4} opacity={0.8} />
                  )}
                </g>
              )}
              {/* 当前排查标记(步骤-拓扑联动):执行中步骤的高亮 NE */}
              {isCurrentStep && (
                <g>
                  <circle r={R + 5} fill="none" stroke={tc.glow} strokeWidth={1.1} className="alert-ring" opacity={0.7} />
                  <text y={R + 26} textAnchor="middle" fontSize={8} fontWeight={700} fill={`var(--ne-type-fill, ${tc.glow})`} fontFamily="var(--font-mono)">▶ 当前排查</text>
                </g>
              )}
              {isRoot && (
                <g className="spin-slow" filter="url(#twin-glow-strong)">
                  <circle r={R + 9} fill="none" stroke={isUserFaultGnb ? STATUS.warning : STATUS.fault} strokeWidth={1.4} strokeDasharray="14 6" opacity={0.9} />
                </g>
              )}
              {isCordoned && (
                <rect x={-R - 7} y={-R - 7} width={(R + 7) * 2} height={(R + 7) * 2} rx={6} fill="none" stroke="var(--text-faint)" strokeWidth={1.2} strokeDasharray="3 3" />
              )}
              {/* CPU 过载角标(场景 D/E):AMF/SMF 被冲击 */}
              {cpuOverloadSet.has(n.id) && (
                <g transform={`translate(${R + 8} ${-R - 8})`} filter="url(#twin-glow)">
                  <rect x={-28} y={-9} width={56} height={18} rx={5} fill={STATUS.warning} stroke="#04070f" strokeWidth={0.8} />
                  <text x={0} y={3.5} textAnchor="middle" fontSize={8.5} fontWeight={800} fill="#04070f" fontFamily="var(--font-mono)">CPU 过载</text>
                </g>
              )}
              <circle r={R} fill={fillUrl} stroke={ringColor} strokeWidth={isFocus || isRoot ? 2.6 : 1.6} filter={isFocus || isRoot || degraded ? "url(#twin-glow)" : undefined} />
              <text y={3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={isCordoned ? "var(--text-mid)" : `var(--ne-type-fill, ${tc.glow})`} fontFamily="var(--font-mono)">
                {n.type}
              </text>
              <text y={R + 13} textAnchor="middle" fontSize={8.5} fill={isRoot ? (isUserFaultGnb ? STATUS.warning : STATUS.faultGlow) : isCordoned ? "var(--text-faint)" : "var(--text-mid)"} fontFamily="var(--font-mono)">
                {n.id}
              </text>
              {/* SIM 模式:全网 CPU% 显示 */}
              {state.simNeCpu && state.simNeCpu[n.id] != null && cpuText(state.simNeCpu[n.id], R)}
              {/* 劣化 SR% —— 用户级异常 gNB 改显示 UE 数(上方已有)，网络故障 NE 显示 SR% */}
              {degraded && !isUserFaultGnb && (
                <text y={-R - 8} textAnchor="middle" fontSize={8} fill={STATUS.faultGlow} fontFamily="var(--font-mono)">
                  {(sr * 100).toFixed(1)}%
                </text>
              )}
              {n.role !== "lb" && (
                <g transform={`translate(${R - 1} ${-R + 1})`}>
                  <circle r={8} fill={n.role === "master" ? "#facc15" : "#64748b"} stroke="#04070f" strokeWidth={1.2} filter="url(#twin-glow)" />
                  <text y={3} textAnchor="middle" fontSize={9.5} fontWeight={800} fill={n.role === "master" ? "#3a2a00" : "#e8eefb"} fontFamily="var(--font-sans)">
                    {n.role === "master" ? "主" : "备"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* 异常初筛弹窗(phase 2):逐链路检出多条路径异常 */}
      {state.phaseIndex === 2 && degradedP2.length > 0 && <AnomalyCallout edges={degradedP2} kpi={kpi} simT={simT} />}
      {scenario.stormMetrics && state.phaseIndex === 2 && <StormMetricsCallout m={scenario.stormMetrics} node={g.nodeById["AMF_1"]} />}

      {/* CHR 用户级原因值弹窗(场景 B) */}
      {state.chrPopup && <ChrCallout neId={state.chrPopup.nes[0]} node={g.nodeById[state.chrPopup.nes[0]]} chr={state.chrPopup} />}

      {/* 均质化比较结果弹窗(场景 A/D,phase 4) */}
      {state.homogenPopup && <HomogenCallout result={state.homogenPopup} node={g.nodeById[state.homogenPopup.anchorNe]} />}

      {/* 隔离标注弹窗(场景 A/B/D,phase 5) */}
      {state.isolationPopup && <IsolationCallout note={state.isolationPopup} node={g.nodeById[state.isolationPopup.isolateNe]} />}
      {state.ufdrPopup && <UfdrCallout report={state.ufdrPopup} node={g.nodeById[state.ufdrPopup.nes[0]]} />}
      {state.flowControlPopup && <FlowControlCallout fc={state.flowControlPopup} node={g.nodeById[state.flowControlPopup.anchorNe]} />}

      {/* 实时读数 */}
      <g transform={`translate(${VIEW_W - 188} 60)`}>
        <rect x={0} y={0} width={178} height={74} rx={8} fill="var(--twin-readout-bg)" stroke="var(--accent-a28)" />
        <text x={12} y={20} fontSize={9} fill="var(--text-dim)" fontFamily="var(--font-mono)" letterSpacing="0.1em">
          LIVE · T={simT.toFixed(0)}s
        </text>
        <text x={12} y={42} fontSize={20} fontWeight={700} fill={srColor(overallSr)} fontFamily="var(--font-mono)">
          {(overallSr * 100).toFixed(2)}%
        </text>
        <text x={104} y={42} fontSize={9} fill="var(--text-dim)" fontFamily="var(--font-mono)">
          整网聚合
        </text>
        <text x={12} y={62} fontSize={9} fill={userFault ? STATUS.warning : degradedCount > 0 ? STATUS.fault : STATUS.healthy} fontFamily="var(--font-mono)">
          {userFault ? `▲ 用户级异常 · ${userFault.affectedUe} UE` : degradedCount > 0 ? `▲ ${degradedCount} NE degraded` : "● all NE nominal"}
        </text>
      </g>
    </svg>
  );
}

/** 环形饼图单段路径(角度从正上方顺时针，弧度制) */
function donutSeg(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const pt = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [sx0, sy0] = pt(rOut, a0);
  const [ex0, ey0] = pt(rOut, a1);
  const [sx1, sy1] = pt(rIn, a1);
  const [ex1, ey1] = pt(rIn, a0);
  return `M ${sx0} ${sy0} A ${rOut} ${rOut} 0 ${large} 1 ${ex0} ${ey0} L ${sx1} ${sy1} A ${rIn} ${rIn} 0 ${large} 0 ${ex1} ${ey1} Z`;
}

/** CHR 用户级根因弹窗(场景 B/C,根因推理阶段):降噪→聚类→根因 三步图文并茂
 *  降噪卡=降噪前饼图(终端噪声干扰)、聚类卡=降噪后饼图(终端噪声已剔除,比例不变,仅置灰删除线),
 *  两饼图同基准对照体现降噪作用;每个原因值独立配色,图例列出全部(含已剔除项)。根因卡=靶心。 */
function ChrCallout({ neId, node, chr }: { neId: string; node: { x: number; y: number } | undefined; chr: NonNullable<StoryState["chrPopup"]> }) {
  if (!node) return null;
  const w = 344;
  const related = chr.related ?? [];
  const NOISE_COLORS = ["#38bdf8", "#f472b6", "#2dd4bf", "#facc15", "#fb923c"];
  const relRaw = related.map((r, i) => ({ code: r.code, cn: r.cn, share: r.share ?? 8, color: NOISE_COLORS[i % NOISE_COLORS.length] }));
  const domShare = chr.share ?? Math.max(40, 70 - relRaw.reduce((a, r) => a + r.share, 0));
  const noiseShare = relRaw.reduce((a, r) => a + r.share, 0);
  const otherShare = Math.max(0, 100 - domShare - noiseShare);

  // 全部原因值(同基准,不重新归一):主导(紫) + 各终端噪声(各独立色) + 其他(灰)
  const allSegs = [
    { code: chr.causeCode, cn: chr.causeCn, share: domShare, color: "#a78bfa", removed: false },
    ...relRaw.map((r) => ({ code: r.code, cn: r.cn, share: r.share, color: r.color, removed: true })),
    ...(otherShare >= 2 ? [{ code: "", cn: "其他", share: otherShare, color: "#64748b", removed: false }] : []),
  ];
  const total = allSegs.reduce((a, s) => a + s.share, 0) || 1;
  let aAcc = 0;
  const allArcs = allSegs.map((s) => {
    const a0 = (aAcc / total) * Math.PI * 2;
    aAcc += s.share;
    return { ...s, a0, a1: (aAcc / total) * Math.PI * 2 };
  });

  // 卡片几何
  const c1y = 30, c1h = 120;
  const c2y = 158, c2h = 120;
  const c3y = 286, c3h = 62;
  const h = 358;
  const pieR = 18, pieRIn = 12, pieCx = 46;
  const pieCy1 = c1y + 88, pieCy2 = c2y + 88;
  const legX = 80, pctX = w - 12;
  const targetCx = w - 16 - 14, targetCy = c3y + c3h / 2;
  const C = { denoise: "#2dd4bf", cluster: "#a78bfa", root: STATUS.warning };

  const cx = Math.min(node.x + 22, VIEW_W - w - 8);
  const cy = Math.max(8, node.y - h - 22);

  const legendRows = (rows: typeof allSegs, startY: number, keyPrefix: string, after: boolean) =>
    rows.map((s, i) => {
      const ry = startY + i * 11;
      const removed = after && s.removed;
      return (
        <g key={`${keyPrefix}${i}`}>
          <circle cx={legX} cy={ry - 3} r={3.5} fill={removed ? "#64748b" : s.color} opacity={removed ? 0.6 : 1} />
          <text x={legX + 9} y={ry} fontSize={9} fill={removed ? "var(--text-faint)" : "var(--text-soft)"} fontFamily="var(--font-sans)" textDecoration={removed ? "line-through" : "none"}>
            {s.code || s.cn}
            <tspan dx={5} fill="var(--text-dim)" fontSize={8.5} textDecoration="none">{s.code ? s.cn : ""}</tspan>
          </text>
          <text x={pctX} y={ry} fontSize={9.5} fontWeight={700} fill={removed ? "var(--text-faint)" : s.color} fontFamily="var(--font-mono)" textAnchor="end">{Math.round(s.share)}%</text>
        </g>
      );
    });

  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <line x1={node.x + 8 - cx} y1={node.y - 10 - cy} x2={14} y2={h} stroke={STATUS.warning} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.55} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={STATUS.warning} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(245,158,11,0.16)" />
      <text x={12} y={18} fontSize={13.5} fontWeight={700} fill="#fbbf24" fontFamily="var(--font-mono)" letterSpacing="0.06em">CHR · 用户级根因 @ {neId}</text>

      {/* ① 降噪 —— 降噪前饼图:主导被多原因值干扰(全部彩色) */}
      <rect x={8} y={c1y} width={w - 16} height={c1h} rx={8} fill={`${C.denoise}14`} stroke={`${C.denoise}55`} strokeWidth={1} />
      <rect x={8} y={c1y} width={3} height={c1h} fill={C.denoise} />
      <text x={24} y={c1y + 19} fontSize={13} fontWeight={800} fill={C.denoise} fontFamily="var(--font-mono)">①</text>
      <text x={40} y={c1y + 18} fontSize={13} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">降噪 · 排除既有噪声</text>
      <text x={24} y={c1y + 36} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">推理 · 统计终端原因值的持续 / 周期性历史基线</text>
      <text x={24} y={c1y + 52} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">结果 · 降噪前终端噪声 {Math.round(noiseShare)}% 干扰,主导仅 {Math.round(domShare)}%</text>
      <g>
        {allArcs.map((s, i) => (
          <path key={`b${i}`} d={donutSeg(pieCx, pieCy1, pieR, pieRIn, s.a0, s.a1)} fill={s.color} opacity={0.92} stroke="var(--twin-callout-bg)" strokeWidth={0.9} />
        ))}
        <text x={pieCx} y={pieCy1} fontSize={11} fontWeight={800} fill="var(--text-bright)" fontFamily="var(--font-mono)" textAnchor="middle">{Math.round(domShare)}%</text>
        <text x={pieCx} y={pieCy1 + 10} fontSize={6} fill="var(--text-dim)" fontFamily="var(--font-sans)" textAnchor="middle">降噪前</text>
      </g>
      {legendRows(allSegs, c1y + 72, "bl", false)}

      {/* ② 聚类 —— 降噪后饼图:终端噪声置灰+删除线(比例不变),主导收敛 */}
      <rect x={8} y={c2y} width={w - 16} height={c2h} rx={8} fill={`${C.cluster}14`} stroke={`${C.cluster}55`} strokeWidth={1} />
      <rect x={8} y={c2y} width={3} height={c2h} fill={C.cluster} />
      <text x={24} y={c2y + 19} fontSize={13} fontWeight={800} fill={C.cluster} fontFamily="var(--font-mono)">②</text>
      <text x={40} y={c2y + 18} fontSize={13} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">聚类 · 收敛主导原因</text>
      <text x={24} y={c2y + 36} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">推理 · 剔除终端噪声后,对剩余原因值按共因聚类收敛</text>
      <text x={24} y={c2y + 52} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">结果 · 终端噪声 {Math.round(noiseShare)}% 已剔除,主导 {Math.round(domShare)}% 收敛于 {chr.causeCode}</text>
      <g>
        {allArcs.map((s, i) => (
          <path key={`a${i}`} d={donutSeg(pieCx, pieCy2, pieR, pieRIn, s.a0, s.a1)} fill={s.removed ? "#475569" : s.color} opacity={s.removed ? 0.3 : 0.92} stroke="var(--twin-callout-bg)" strokeWidth={0.9} />
        ))}
        <text x={pieCx} y={pieCy2} fontSize={11} fontWeight={800} fill="var(--text-bright)" fontFamily="var(--font-mono)" textAnchor="middle">{Math.round(domShare)}%</text>
        <text x={pieCx} y={pieCy2 + 10} fontSize={6} fill="var(--text-dim)" fontFamily="var(--font-sans)" textAnchor="middle">降噪后</text>
      </g>
      {legendRows(allSegs, c2y + 72, "al", true)}

      {/* ③ 根因 —— 中性措辞(B 网络根因 / C 用户侧根因均适用) */}
      <rect x={8} y={c3y} width={w - 16} height={c3h} rx={8} fill={`${C.root}14`} stroke={`${C.root}55`} strokeWidth={1} />
      <rect x={8} y={c3y} width={3} height={c3h} fill={C.root} />
      <text x={24} y={c3y + 19} fontSize={13} fontWeight={800} fill={C.root} fontFamily="var(--font-mono)">③</text>
      <text x={40} y={c3y + 18} fontSize={13} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">根因 · 锁定主导根因</text>
      <text x={24} y={c3y + 37} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">推理 · 结合多维证据确认主导原因</text>
      <text x={24} y={c3y + 53} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">结果 · 锁定 <tspan fontWeight={800} fill={STATUS.warning} fontFamily="var(--font-mono)">{neId}</tspan> · {chr.causeCn}</text>
      <g>
        <circle cx={targetCx} cy={targetCy} r={13} fill={`${C.root}1a`} stroke={`${C.root}88`} />
        <circle cx={targetCx} cy={targetCy} r={8} fill="none" stroke={C.root} strokeWidth={1.2} />
        <circle cx={targetCx} cy={targetCy} r={3} fill={C.root} />
      </g>
    </g>
  );
}

/** 异常初筛弹窗(phase 2):逐链路检出多条路径异常，任意链路异常即触发检测 */
function AnomalyCallout({ edges, kpi, simT }: { edges: NetworkGraph["flowEdges"]; kpi: KpiBundle; simT: number }) {
  const w = 286;
  const show = edges.slice(0, 5);
  const rowH = 17;
  const listY0 = 58;
  const noteY = listY0 + show.length * rowH + 14;
  const h = noteY + 16;
  const cx = 68;
  const cy = 52;
  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={STATUS.fault} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(239,68,68,0.16)" />
      <rect x={12} y={9} width={8} height={8} rx={2} fill={STATUS.fault} />
      <text x={26} y={18} fontSize={12.5} fontWeight={700} fill={STATUS.faultGlow} fontFamily="var(--font-mono)" letterSpacing="0.05em">
        异常初筛 · 多条路径异常
      </text>
      <text x={12} y={42} fontSize={11.5} fill="var(--text-mid)" fontFamily="var(--font-sans)">
        检出 <tspan fontWeight={800} fill={STATUS.fault}>{edges.length}</tspan> 条链路异常 · 任意链路异常即触发
      </text>
      {show.map((e, i) => {
        const sr = sample(kpi.edges[e.id], simT);
        const col = srColor(sr);
        const y = listY0 + i * rowH;
        return (
          <g key={e.id}>
            <circle cx={17} cy={y - 4} r={3.5} fill={col} />
            <text x={28} y={y} fontSize={11} fill="var(--text-soft)" fontFamily="var(--font-mono)">{e.a} ↔ {e.b}</text>
            <text x={w - 12} y={y} fontSize={11} fontWeight={700} fill={col} textAnchor="end" fontFamily="var(--font-mono)">{(sr * 100).toFixed(1)}%</text>
          </g>
        );
      })}
      <text x={12} y={noteY} fontSize={10} fill="var(--text-faint)" fontFamily="var(--font-sans)">
        整网聚合对微损近乎无感 · 逐链路全面初筛方见异常
      </text>
    </g>
  );
}

/** 均质化比较结果弹窗(场景 A/D,phase 4):按轮次展示实例异常分布 + 排除/根因结论 */
function HomogenCallout({ result, node }: { result: NonNullable<StoryState["homogenPopup"]>; node: { x: number; y: number } | undefined }) {
  if (!node) return null;
  const w = 300;
  const top = 30; // 内容起始 y
  const roundH = 90; // 每轮:类型行 + 原则 + chips + note(轮内紧凑、轮间留白)
  const principlesY0 = top + result.rounds.length * roundH + (result.principles.length ? 8 : 0);
  const pRows = Math.ceil(result.principles.length / 2);
  const principlesH = result.principles.length ? 22 + pRows * 19 + 6 : 0;
  const h = principlesY0 + principlesH + 4;
  // 节点偏右(UPF/UDM 列)→ 弹窗置于节点左侧，避开右上「整网聚合」读数框
  const placeLeft = node.x > VIEW_W * 0.6;
  const cx = placeLeft ? Math.max(8, node.x - w - 48) : Math.max(8, Math.min(VIEW_W - w - 8, node.x - w / 2));
  const cy = placeLeft ? Math.max(8, Math.min(VIEW_H - h - 8, node.y - h / 2)) : Math.max(8, node.y - h - 24);
  const lx = placeLeft ? w : Math.max(20, Math.min(w - 20, node.x - cx));
  const ly = placeLeft ? Math.max(20, Math.min(h - 20, node.y - cy)) : h;
  const chipW = 46, chipH = 17, chipGap = 5;
  const pChipW = 134, pChipH = 15;

  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <line x1={node.x - cx} y1={node.y - cy} x2={lx} y2={ly} stroke={STATUS.warning} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.5} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={STATUS.warning} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(245,158,11,0.16)" />
      <text x={12} y={19} fontSize={13} fontWeight={700} fill="#fbbf24" fontFamily="var(--font-mono)" letterSpacing="0.05em">
        故障推理 · FAULT REASONING
      </text>
      {result.rounds.map((r, ri) => {
        const base = top + ri * roundH;
        const typeY = base + 12;
        const chipsY = base + 36;
        const noteY = base + 70;
        const isRoot = r.verdict === "root";
        const isNormal = r.verdict === "normal";
        const tagFill = isRoot ? "rgba(245,158,11,0.18)" : isNormal ? "rgba(34,197,94,0.16)" : "rgba(148,163,184,0.14)";
        const tagStroke = isRoot ? STATUS.warning : isNormal ? STATUS.healthy : "rgba(148,163,184,0.7)";
        const tagColor = isRoot ? STATUS.warning : isNormal ? STATUS.healthy : "var(--text-mid)";
        const tagText = isRoot ? "离群 · 根因" : isNormal ? "正常 · 排除" : "共性 · 排除";
        return (
          <g key={ri}>
            {/* 轮间分隔线(实线、更醒目) */}
            {ri > 0 && <line x1={12} y1={base - 8} x2={w - 12} y2={base - 8} stroke="rgba(148,163,184,0.75)" strokeWidth={1.4} />}
            <text x={12} y={typeY} fontSize={12} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">{r.type}</text>
            {/* 结论标签 */}
            <g transform={`translate(${w - 12 - 92} ${typeY - 11})`}>
              <rect width={92} height={15} rx={4} fill={tagFill} stroke={tagStroke} strokeWidth={0.8} />
              <text x={46} y={11} fontSize={10} fontWeight={700} fill={tagColor} textAnchor="middle" fontFamily="var(--font-mono)">
                {tagText}
              </text>
            </g>
            {/* 本轮应用的推理原则(醒目明亮) */}
            {r.principle && (
              <g>
                <rect x={12} y={base + 16} width={116} height={16} rx={4} fill="rgba(167,139,250,0.28)" stroke="rgba(196,181,253,0.85)" strokeWidth={0.9} />
                <text x={18} y={base + 28} fontSize={10} fontWeight={700} fill="#f5f3ff" fontFamily="var(--font-sans)">▸ {r.principle}</text>
              </g>
            )}
            {/* 实例 chip 行:异常红 / 正常绿 */}
            {r.instances.map((ins, j) => {
              const ix = 12 + j * (chipW + chipGap);
              const col = ins.anomalous ? STATUS.fault : STATUS.healthy;
              return (
                <g key={ins.id}>
                  <rect x={ix} y={chipsY} width={chipW} height={chipH} rx={4} fill={col} fillOpacity={ins.anomalous ? 0.85 : 0.3} stroke={col} strokeOpacity={ins.anomalous ? 1 : 0.6} />
                  <text x={ix + chipW / 2} y={chipsY + 12} fontSize={8.5} fontWeight={700} fill={ins.anomalous ? "#fff" : "var(--text-soft)"} textAnchor="middle" fontFamily="var(--font-mono)">{ins.id}</text>
                </g>
              );
            })}
            <text x={12} y={noteY} fontSize={10.5} fill="var(--text-mid)" fontFamily="var(--font-sans)">{r.note}</text>
          </g>
        );
      })}
      {/* 推理原则/算法 */}
      {result.principles.length > 0 && (
        <g>
          <line x1={12} y1={principlesY0} x2={w - 12} y2={principlesY0} stroke="rgba(56,189,248,0.18)" strokeWidth={1} />
          <text x={12} y={principlesY0 + 13} fontSize={9.5} fontWeight={700} fill="#c4b5fd" fontFamily="var(--font-mono)" letterSpacing="0.1em">推理原则 · REASONING RULES</text>
          {result.principles.map((p, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const px = 12 + col * (pChipW + 6);
            const py = principlesY0 + 22 + row * (pChipH + 4);
            return (
              <g key={p}>
                <rect x={px} y={py} width={pChipW} height={pChipH} rx={4} fill="rgba(167,139,250,0.12)" stroke="rgba(167,139,250,0.55)" strokeWidth={0.7} />
                <text x={px + 7} y={py + 11} fontSize={9} fontWeight={700} fill="#c4b5fd" fontFamily="var(--font-sans)">{p}</text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

/** 隔离标注弹窗(场景 A/B/D,phase 5):标注被隔离 NE + 流量切换目标 */
function IsolationCallout({ note, node }: { note: NonNullable<StoryState["isolationPopup"]>; node: { x: number; y: number } | undefined }) {
  if (!node) return null;
  const w = 252;
  const h = 92;
  // 节点偏右(UPF/UDM 列)→ 弹窗置于节点左侧，避开右上「整网聚合」读数框
  const placeLeft = node.x > VIEW_W * 0.6;
  const cx = placeLeft ? Math.max(8, node.x - w - 48) : Math.max(8, Math.min(VIEW_W - w - 8, node.x - w / 2));
  const cy = placeLeft ? Math.max(8, Math.min(VIEW_H - h - 8, node.y - h / 2)) : Math.max(8, node.y - h - 24);
  const lx = placeLeft ? w : Math.max(20, Math.min(w - 20, node.x - cx));
  const ly = placeLeft ? Math.max(20, Math.min(h - 20, node.y - cy)) : h;
  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <line x1={node.x - cx} y1={node.y - cy} x2={lx} y2={ly} stroke={STATUS.fault} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.5} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={STATUS.fault} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(239,68,68,0.16)" />
      <rect x={12} y={9} width={8} height={8} rx={2} fill={STATUS.fault} />
      <text x={26} y={18} fontSize={12.5} fontWeight={700} fill={STATUS.faultGlow} fontFamily="var(--font-mono)" letterSpacing="0.06em">
        隔离 ISOLATION
      </text>
      <text x={12} y={44} fontSize={16} fontWeight={800} fill="var(--text-bright)" fontFamily="var(--font-sans)">{note.isolateNe}</text>
      <text x={12} y={66} fontSize={12.5} fontWeight={700} fill={STATUS.healthy} fontFamily="var(--font-sans)">
        → 流量切至 {note.failoverTo.join(" / ")}
      </text>
      <text x={12} y={84} fontSize={10.5} fill="var(--text-mid)" fontFamily="var(--font-sans)">{note.summary}</text>
    </g>
  );
}

/** UPF UFDR 溯源弹窗(场景 D/E,phase 4):SST=3 注册突增 + 物联 DNN 会话突增 → 溯源到物联终端 */
function UfdrCallout({ report, node }: { report: NonNullable<StoryState["ufdrPopup"]>; node: { x: number; y: number } | undefined }) {
  if (!node) return null;
  const w = 268;
  const h = 150;
  const cx = Math.max(8, Math.min(VIEW_W - w - 8, node.x - w / 2));
  const cy = Math.max(8, node.y - h - 24);
  const C = "#2dd4bf";
  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <line x1={node.x - cx} y1={node.y - cy} x2={w / 2} y2={h} stroke={C} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.5} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={C} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(45,212,191,0.16)" />
      <text x={12} y={15} fontSize={12} fontWeight={700} fill="#5eead4" fontFamily="var(--font-mono)" letterSpacing="0.04em">UFDR 溯源 · 流控定位</text>
      {/* 证据① SST=3 注册突增 */}
      <text x={12} y={44} fontSize={10} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">① {report.sstLabel}</text>
      <rect x={12} y={50} width={w - 24} height={8} rx={4} fill="rgba(148,163,184,0.18)" />
      <rect x={12} y={50} width={((w - 24) * report.sstSurge) / 100} height={8} rx={4} fill={C} />
      <text x={w - 12} y={57} textAnchor="end" fontSize={9} fontWeight={700} fill={C} fontFamily="var(--font-mono)">+{report.sstSurge}%</text>
      {/* 证据② 物联 DNN 会话突增 */}
      <text x={12} y={80} fontSize={10} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">② {report.dnnLabel}</text>
      <rect x={12} y={86} width={w - 24} height={8} rx={4} fill="rgba(148,163,184,0.18)" />
      <rect x={12} y={86} width={((w - 24) * report.dnnSurge) / 100} height={8} rx={4} fill={C} />
      <text x={w - 12} y={93} textAnchor="end" fontSize={9} fontWeight={700} fill={C} fontFamily="var(--font-mono)">+{report.dnnSurge}%</text>
      <text x={12} y={120} fontSize={9.5} fill="var(--text-mid)" fontFamily="var(--font-sans)">▸ 切片 SST=3(MIoT) + 物联 DNN 双突增</text>
      <text x={12} y={138} fontSize={10.5} fontWeight={700} fill="#5eead4" fontFamily="var(--font-sans)">{report.summary}</text>
    </g>
  );
}

/** 流控策略弹窗(场景 D/E,phase 5):D=UE 侧 back-off;E=网络侧 NSSAI/APN 限流 + 比例算法 */
function FlowControlCallout({ fc, node }: { fc: NonNullable<StoryState["flowControlPopup"]>; node: { x: number; y: number } | undefined }) {
  if (!node) return null;
  const w = 286;
  const isNet = fc.kind === "net_admission";
  const measuresH = fc.measures.length * 18;
  const ratioH = isNet && fc.ratio ? (fc.ratio.basis ? 86 : 58) : 0;
  const h = 70 + measuresH + ratioH + 20;
  const cx = Math.max(8, Math.min(VIEW_W - w - 8, node.x - w / 2));
  const cy = Math.max(8, node.y - h - 24);
  const C = isNet ? "#a78bfa" : "#f59e0b";
  const ratio = fc.ratio;
  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <line x1={node.x - cx} y1={node.y - cy} x2={w / 2} y2={h} stroke={C} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.5} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={C} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill={`${C}29`} />
      <text x={12} y={15} fontSize={12} fontWeight={700} fill={C} fontFamily="var(--font-mono)" letterSpacing="0.04em">流控策略 · {isNet ? "网络侧限流" : "UE 侧 back-off"} @ {fc.anchorNe}</text>
      <text x={12} y={40} fontSize={10} fontWeight={700} fill="var(--text-bright)" fontFamily="var(--font-sans)">溯源对象 ▸ {fc.target}</text>
      <text x={12} y={56} fontSize={8.5} fill="var(--text-dim)" fontFamily="var(--font-mono)">流控措施</text>
      {fc.measures.map((m, i) => (
        <g key={i} transform={`translate(12 ${68 + i * 18})`}>
          <circle cx={4} cy={-3} r={3} fill={C} />
          <text x={14} y={0} fontSize={10} fill="var(--text-soft)" fontFamily="var(--font-sans)">{m}</text>
        </g>
      ))}
      {isNet && ratio && (
        <g transform={`translate(12 ${68 + measuresH + 8})`}>
          <text x={0} y={0} fontSize={8.5} fill="var(--text-dim)" fontFamily="var(--font-mono)">限流比例 · {ratio.algo}</text>
          <text x={0} y={18} fontSize={9} fill="var(--text-mid)" fontFamily="var(--font-sans)">AMF NSSAI</text>
          <rect x={92} y={10} width={120} height={8} rx={4} fill="rgba(148,163,184,0.18)" />
          <rect x={92} y={10} width={(120 * ratio.nssai) / 100} height={8} rx={4} fill="#a78bfa" />
          <text x={w - 24} y={17} textAnchor="end" fontSize={9} fontWeight={700} fill="#a78bfa" fontFamily="var(--font-mono)">{ratio.nssai}%</text>
          <text x={0} y={36} fontSize={9} fill="var(--text-mid)" fontFamily="var(--font-sans)">SMF APN</text>
          <rect x={92} y={28} width={120} height={8} rx={4} fill="rgba(148,163,184,0.18)" />
          <rect x={92} y={28} width={(120 * ratio.apn) / 100} height={8} rx={4} fill="#38bdf8" />
          <text x={w - 24} y={35} textAnchor="end" fontSize={9} fontWeight={700} fill="#38bdf8" fontFamily="var(--font-mono)">{ratio.apn}%</text>
          {ratio.basis && (
            <g transform="translate(0 52)">
              <rect x={0} y={-9} width={w - 24} height={28} rx={4} fill="rgba(167,139,250,0.08)" stroke="rgba(167,139,250,0.3)" strokeWidth={0.7} />
              <text x={4} y={0} fontSize={7.5} fontWeight={700} fill="#c4b5fd" fontFamily="var(--font-mono)">▸ 计算依据(反压/自保)</text>
              <text fontSize={7.8} fill="var(--text-detail)" fontFamily="var(--font-sans)">
                <tspan x={4} y={11}>{ratio.basis.slice(0, 30)}</tspan>
                <tspan x={4} y={21}>{ratio.basis.slice(30)}</tspan>
              </text>
            </g>
          )}
        </g>
      )}
      <text x={12} y={h - 8} fontSize={10.5} fontWeight={700} fill={STATUS.healthy} fontFamily="var(--font-sans)">{fc.converged ? "✓ 冲击收敛 · " : ""}{fc.summary}</text>
    </g>
  );
}

/** 风暴冲击指标弹窗(场景 D/E,phase 2):AMF/SMF CPU + 注册/会话突增 + 2C 影响 */
function StormMetricsCallout({ m, node }: { m: NonNullable<Scenario["stormMetrics"]>; node: { x: number; y: number } | undefined }) {
  if (!node) return null;
  const w = 250;
  const h = 158;
  const cx = Math.max(8, Math.min(VIEW_W - w - 8, node.x - w - 40));
  const cy = Math.max(8, node.y - h / 2);
  const C = "#f59e0b";
  const bar = (v: number) => Math.min(140, (140 * v) / 100);
  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      <line x1={node.x - cx} y1={node.y - cy} x2={w} y2={h / 2} stroke={C} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.5} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={C} strokeWidth={1} filter="url(#twin-glow-strong)" />
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(245,158,11,0.16)" />
      <text x={12} y={15} fontSize={12} fontWeight={700} fill="#fbbf24" fontFamily="var(--font-mono)" letterSpacing="0.04em">⚠ 容器过载 + 突增 KPI</text>
      <text x={12} y={42} fontSize={9} fill="var(--text-mid)" fontFamily="var(--font-sans)">AMF CPU</text>
      <rect x={70} y={35} width={140} height={8} rx={4} fill="rgba(148,163,184,0.18)" />
      <rect x={70} y={35} width={bar(m.amfCpu)} height={8} rx={4} fill={C} />
      <text x={w - 12} y={42} textAnchor="end" fontSize={9} fontWeight={700} fill={C} fontFamily="var(--font-mono)">{m.amfCpu}%</text>
      <text x={12} y={60} fontSize={9} fill="var(--text-mid)" fontFamily="var(--font-sans)">SMF CPU</text>
      <rect x={70} y={53} width={140} height={8} rx={4} fill="rgba(148,163,184,0.18)" />
      <rect x={70} y={53} width={bar(m.smfCpu)} height={8} rx={4} fill={C} />
      <text x={w - 12} y={60} textAnchor="end" fontSize={9} fontWeight={700} fill={C} fontFamily="var(--font-mono)">{m.smfCpu}%</text>
      <text x={12} y={82} fontSize={9.5} fill="var(--text-soft)" fontFamily="var(--font-sans)">注册请求突增 <tspan fontWeight={800} fill={STATUS.fault}>+{m.regSurge}%</tspan></text>
      <text x={12} y={98} fontSize={9.5} fill="var(--text-soft)" fontFamily="var(--font-sans)">PDU 会话突增 <tspan fontWeight={800} fill={STATUS.fault}>+{m.sessionSurge}%</tspan></text>
      <rect x={12} y={108} width={w - 24} height={40} rx={6} fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.3)" strokeWidth={0.8} />
      <text x={18} y={121} fontSize={7.5} fontWeight={700} fill={STATUS.faultGlow} fontFamily="var(--font-mono)">流控扩散 · 2C 影响</text>
      <text fontSize={8} fill="var(--text-soft)" fontFamily="var(--font-sans)">
        <tspan x={18} y={133}>{m.impact2c.slice(0, 22)}</tspan>
        <tspan x={18} y={143}>{m.impact2c.slice(22)}</tspan>
      </text>
    </g>
  );
}

/** UE 接入簇 + 到 gNB 的弱流动(用户级:受影响 gNB 接入线染琥珀) */
function UeCluster({ nodes, active, anomaly, userFaultGnbs }: { nodes: NetworkGraph["nodes"]; active: boolean; anomaly: boolean; userFaultGnbs: Set<string> }) {
  const gnbs = nodes.filter((n) => n.type === "gNB");
  const ueYs = [300, 340, 380];
  return (
    <g>
      <text x={4} y={252} fontSize={11.5} fontWeight={700} fill="var(--text-mid)" fontFamily="var(--font-sans)" letterSpacing="0.04em">
        在网用户
      </text>
      <text x={4} y={273} fontSize={16} fontWeight={800} fill="var(--text-soft)" fontFamily="var(--font-sans)" letterSpacing="0.02em">
        128万
      </text>
      {ueYs.map((y, i) => (
        <g key={i}>
          <circle cx={26} cy={y} r={5} fill={anomaly ? STATUS.fault : "var(--accent)"} opacity={0.9} filter="url(#twin-glow)" />
          {gnbs.map((nd, j) => {
            const ug = userFaultGnbs.has(nd.id);
            return (
              <line
                key={j}
                x1={31}
                y1={y}
                x2={nd.x - R}
                y2={nd.y}
                stroke={ug ? "rgba(245,158,11,0.45)" : anomaly && j === 0 ? "rgba(239,68,68,0.3)" : "var(--accent-medium)"}
                strokeWidth={ug ? 1.1 : 0.8}
                className={active ? "flow-dash" : undefined}
              />
            );
          })}
        </g>
      ))}
    </g>
  );
}

export const DigitalTwin = memo(DigitalTwinBase);
