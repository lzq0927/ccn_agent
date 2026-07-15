// ============================================================================
// DigitalTwin —— 中央 SVG 网络数字孪生(用户级韧性 × 网络自治增强版)
//   节点(9 类 NE,按数据流分层) + 业务流/注册链路 + 流动数据粒子
//   健康着色由 KPI(simT) 驱动;异常脉冲 / 推理聚焦 / 根因标定 / 恢复叠加
//   ★ 用户级:UE 接入簇按 gNB 分组、CHR 原因值弹窗(场景B)
//   ★ 网络自治:误报拦截标记(场景C)、用户群体异常标记(场景C,网络保持绿)
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

function DigitalTwinBase({ scenario, state, graph, kpi: kpiProp }: Props) {
  const g: NetworkGraph = graph ?? DEMO_GRAPH;
  const kpi: KpiBundle = kpiProp ?? getKpi(scenario);
  const simT = state.simT;
  const threshold = kpi.threshold;

  const focusSet = new Set(state.affectedNe);
  const rootSet = new Set(state.rootCause.nes);
  const cordonedSet = new Set(state.cordonedNe);
  const rerouteSet = new Set(state.rerouteEdges);

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
  // 边线密度自适应:边多的场景(A,168 条)整体调浅调细,避免扎眼;边少的(B/C/D,27 条)保持原样
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
          const isUserFaultGnb = userFaultGnbs.has(n.id); // 场景 C:用户级异常(琥珀,非红)
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
              {/* 用户群体异常标记(场景 C):琥珀脉冲环 + UE 数,网络本体保持健康 */}
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
              <circle r={R} fill={fillUrl} stroke={ringColor} strokeWidth={isFocus || isRoot ? 2.6 : 1.6} filter={isFocus || isRoot || degraded ? "url(#twin-glow)" : undefined} />
              <text y={3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={isCordoned ? "var(--text-mid)" : `var(--ne-type-fill, ${tc.glow})`} fontFamily="var(--font-mono)">
                {n.type}
              </text>
              <text y={R + 13} textAnchor="middle" fontSize={8.5} fill={isRoot ? (isUserFaultGnb ? STATUS.warning : STATUS.faultGlow) : isCordoned ? "var(--text-faint)" : "var(--text-mid)"} fontFamily="var(--font-mono)">
                {n.id}
              </text>
              {/* 劣化 SR% —— 用户级异常 gNB 改显示 UE 数(上方已有),网络故障 NE 显示 SR% */}
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

      {/* CHR 用户级原因值弹窗(场景 B) */}
      {state.chrPopup && <ChrCallout neId={state.chrPopup.nes[0]} node={g.nodeById[state.chrPopup.nes[0]]} chr={state.chrPopup} />}

      {/* 均质化比较结果弹窗(场景 A/D,phase 4) */}
      {state.homogenPopup && <HomogenCallout result={state.homogenPopup} node={g.nodeById[state.homogenPopup.anchorNe]} />}

      {/* 隔离标注弹窗(场景 A/B/D,phase 5) */}
      {state.isolationPopup && <IsolationCallout note={state.isolationPopup} node={g.nodeById[state.isolationPopup.isolateNe]} />}

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

/** 环形饼图单段路径(角度从正上方顺时针,弧度制) */
function donutSeg(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const pt = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [sx0, sy0] = pt(rOut, a0);
  const [ex0, ey0] = pt(rOut, a1);
  const [sx1, sy1] = pt(rIn, a1);
  const [ex1, ey1] = pt(rIn, a0);
  return `M ${sx0} ${sy0} A ${rOut} ${rOut} 0 ${large} 1 ${ex0} ${ey0} L ${sx1} ${sy1} A ${rIn} ${rIn} 0 ${large} 0 ${ex1} ${ey1} Z`;
}

/** CHR 用户级根因弹窗(场景 B/C/D):放大版,含主导原因值、原因值分布饼图与说明 */
function ChrCallout({ neId, node, chr }: { neId: string; node: { x: number; y: number } | undefined; chr: NonNullable<StoryState["chrPopup"]> }) {
  if (!node) return null;
  const w = 344;
  const related = chr.related ?? [];
  const lines = wrap(chr.detail, 24);

  // 原因值分布段(主导 + 伴随 + 其他);share 缺省时按叙事浓度给保守默认
  const PIE_COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#2dd4bf", "#f472b6", "#facc15"];
  const relRaw = related.map((r, i) => ({ label: r.cn, code: r.code, share: r.share ?? Math.max(4, 26 - i * 7) }));
  const domShare = chr.share ?? Math.max(38, 70 - relRaw.reduce((a, r) => a + r.share, 0));
  const used = domShare + relRaw.reduce((a, r) => a + r.share, 0);
  const otherShare = Math.max(0, 100 - used);
  const segs = [
    { label: chr.causeCn, code: chr.causeCode, share: domShare, color: PIE_COLORS[0] },
    ...relRaw.map((r, i) => ({ ...r, color: PIE_COLORS[(i + 1) % PIE_COLORS.length] })),
    ...(otherShare >= 2 ? [{ label: "其他", code: "", share: otherShare, color: "#475569" }] : []),
  ];
  const segTotal = segs.reduce((a, s) => a + s.share, 0) || 1;

  // 几何(相对弹窗左上角)
  const yTitle = 19;
  const yCauseLbl = 42;
  const yCauseCn = 64;
  const yCauseCode = 84;
  const yDistLbl = 104;
  const distTop = 114;
  const pieR = 40, pieRIn = 24;
  const rowH = 17;
  const sectionH = Math.max(pieR * 2 + 10, segs.length * rowH + 12);
  const pieCx = 56;
  const pieCy = distTop + sectionH / 2;
  const legendX = 108;
  const legendY0 = distTop + 12;
  const yDetailStart = distTop + sectionH + 10;
  const h = yDetailStart + lines.length * 19 + 14;

  const cx = Math.min(node.x + 22, VIEW_W - w - 8);
  const cy = Math.max(8, node.y - h - 22);

  // 饼图角度累加
  let acc = 0;
  const arcs = segs.map((s) => {
    const a0 = (acc / segTotal) * Math.PI * 2;
    acc += s.share;
    const a1 = (acc / segTotal) * Math.PI * 2;
    return { ...s, a0, a1 };
  });

  return (
    <g style={{ animation: "float-up 0.4s ease" }} transform={`translate(${cx} ${cy})`}>
      {/* 引线 */}
      <line x1={node.x + 8 - cx} y1={node.y - 10 - cy} x2={14} y2={h} stroke={STATUS.warning} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.55} />
      <rect x={0} y={0} width={w} height={h} rx={10} fill="var(--twin-callout-bg)" stroke={STATUS.warning} strokeWidth={1} filter="url(#twin-glow-strong)" />
      {/* 标题条 */}
      <path d={`M 0 10 Q 0 0 10 0 L ${w - 10} 0 Q ${w} 0 ${w} 10 L ${w} 22 L 0 22 Z`} fill="rgba(245,158,11,0.16)" />
      <text x={12} y={yTitle} fontSize={13.5} fontWeight={700} fill="#fbbf24" fontFamily="var(--font-mono)" letterSpacing="0.06em">
        CHR · 用户级根因 @ {neId}
      </text>
      {/* 主导原因值 */}
      <text x={12} y={yCauseLbl} fontSize={13} fill="var(--text-mid)" fontFamily="var(--font-sans)" letterSpacing="0.04em">主导原因值</text>
      <text x={12} y={yCauseCn} fontSize={19} fontWeight={800} fill="var(--text-bright)" fontFamily="var(--font-sans)">{chr.causeCn}</text>
      <text x={12} y={yCauseCode} fontSize={14} fontWeight={700} fill={STATUS.warning} fontFamily="var(--font-mono)">{chr.causeCode}</text>
      {/* 原因值分布:环形饼图 + 图例 */}
      <text x={12} y={yDistLbl} fontSize={12} fill="var(--text-dim)" fontFamily="var(--font-sans)" letterSpacing="0.06em">原因值分布</text>
      <g>
        {arcs.map((s, i) => (
          <path key={i} d={donutSeg(pieCx, pieCy, pieR, pieRIn, s.a0, s.a1)} fill={s.color} opacity={0.92} stroke="var(--twin-callout-bg)" strokeWidth={0.9} />
        ))}
        <text x={pieCx} y={pieCy - 2} fontSize={20} fontWeight={800} fill="var(--text-bright)" fontFamily="var(--font-mono)" textAnchor="middle">{Math.round(domShare)}%</text>
        <text x={pieCx} y={pieCy + 14} fontSize={9} fill="var(--text-dim)" fontFamily="var(--font-sans)" textAnchor="middle" letterSpacing="0.08em">主导占比</text>
      </g>
      <g>
        {segs.map((s, i) => {
          const ry = legendY0 + i * rowH + 5;
          return (
            <g key={i}>
              <circle cx={legendX} cy={ry - 4} r={4.5} fill={s.color} />
              <text x={legendX + 11} y={ry} fontSize={12.5} fill="var(--text-soft)" fontFamily="var(--font-sans)">
                {s.label}
                {s.code && <tspan dx={6} fill="var(--text-dim)" fontFamily="var(--font-mono)" fontSize={10.5}>{s.code}</tspan>}
              </text>
              <text x={w - 12} y={ry} fontSize={12.5} fontWeight={700} fill={s.color} fontFamily="var(--font-mono)" textAnchor="end">{Math.round(s.share)}%</text>
            </g>
          );
        })}
      </g>
      {/* 说明 */}
      {lines.map((ln, i) => (
        <text key={`d${i}`} x={12} y={yDetailStart + i * 19} fontSize={13} fill="var(--text-detail)" fontFamily="var(--font-sans)">{ln}</text>
      ))}
    </g>
  );
}

/** 异常初筛弹窗(phase 2):逐链路检出多条路径异常,任意链路异常即触发检测 */
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
  // 节点偏右(UPF/UDM 列)→ 弹窗置于节点左侧,避开右上「整网聚合」读数框
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
  // 节点偏右(UPF/UDM 列)→ 弹窗置于节点左侧,避开右上「整网聚合」读数框
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
