// ============================================================================
// GuideCanvas —— 引导画布(全场景统一)
//   核心:6 类网元(gNB/AMF/SMF/UDM/PCF/UPF)列流拓扑,各场景自身 fault 高亮(相位门控)。
//   场景 D:在核心基础上叠加左侧 3 类 UE(AgentA/B/普通手机)+ 右侧 AI平台1/2,
//           核心连线不变,加 UE→UPF、UPF→AI 上行连线;AI平台1/AgentA 故障 phase>=2 才显现。
//   顶部空白带:🧠 高稳智能体 + 7 圆圈(不遮挡节点);点圆圈 → 弹窗。
// ============================================================================

import { memo, useState } from "react";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { NE_COLORS, PHASES, STATUS, srColor } from "../../theme";
import { dispatchTargets } from "../../guide/steps";
import { getKpi, type WalkStop } from "../../story/director";
import { sample } from "../../data/kpi";
import { buildCoreTopo } from "./coreTopo";

const VW = 1040;
const VH = 646;
const NR = 20;

/**
 * 7 圆圈 + 🧠 单行顶带布局(y≈34,核心拓扑从 y≈140 起 → 顶带无节点,不遮挡)。
 * 单行的关键好处:弹窗 Always 取「下方」候选位(y≈68+),圆圈都在 y34 行 → 弹窗覆盖 0 个圆圈,
 * 从根上避免「①弹窗挡住②」类问题。弹窗向下覆盖部分拓扑(可关闭查看)。
 */
export const BRAIN = { x: 500, y: 34 };
export const CIRCLES = [
  { n: 1, phase: 1, x: 60, y: 34, cn: "数据采集", desc: "Agent 1 采集 KPI / CHR / 3GPP 信令 / 容器 CPU" },
  { n: 2, phase: 2, x: 175, y: 34, cn: "异常检测", desc: "KPI/CHR/CPU 多维检测,任一异常即触发" },
  { n: 3, phase: 3, x: 290, y: 34, cn: "策略匹配", desc: "置信度路由分流(工作流/技能引导/自主探索)" },
  { n: 4, phase: 4, x: 405, y: 34, cn: "根因推理", desc: "Agent 2 推理链收敛,定位根因" },
  { n: 5, phase: 5, x: 595, y: 34, cn: "策略下发", desc: "向目标网元下发恢复/流控策略" },
  { n: 6, phase: 6, x: 710, y: 34, cn: "网络恢复", desc: "恢复策略生效,成功率回升" },
  { n: 7, phase: 7, x: 825, y: 34, cn: "评估优化", desc: "Agent 3 评估:通过→沉淀;未通过→回Agent1" },
];

/** D 专用叠加:3 类 UE(左,各自接入指定 gNB)+ AI 平台(右) */
const UE_GROUPS = [
  { label: "Agent A", desc: "→gNB_1/2", x: 46, y: 232, color: "#f59e0b", fault: true, gnbs: ["gNB_1", "gNB_2"] },
  { label: "Agent B", desc: "→gNB_1/2", x: 46, y: 362, color: "#38bdf8", fault: false, gnbs: ["gNB_1", "gNB_2"] },
  { label: "普通手机", desc: "→gNB_1/2/3", x: 46, y: 492, color: "#94a3b8", fault: false, gnbs: ["gNB_1", "gNB_2", "gNB_3"] },
];
const PLATFORMS = [
  { id: "AI1", label: "AI平台1", x: 980, y: 292, fault: true },
  { id: "AI2", label: "AI平台2", x: 980, y: 452, fault: false },
];
/** D 专用:gNB→AMF 接入关系(gNB_1/2→AMF_1/2,gNB_3→AMF_3) */
const GNB_AMF_D: { gnb: string; amfs: string[] }[] = [
  { gnb: "gNB_1", amfs: ["AMF_1", "AMF_2"] },
  { gnb: "gNB_2", amfs: ["AMF_1", "AMF_2"] },
  { gnb: "gNB_3", amfs: ["AMF_3"] },
];

interface Props {
  scenario: Scenario;
  state: StoryState;
  stops: WalkStop[];
  curIdx: number;
  onCircleClick: (phase: number, pos: { x: number; y: number }, n: number) => void;
  /** false=当前步执行中/停顿,闪烁停在当前步、不显示 👇;true/undefined=停顿后引导下一步 */
  guideNext?: boolean;
}

function GuideCanvasBase({ scenario, state, stops, curIdx, onCircleClick, guideNext }: Props) {
  const cur = stops[curIdx];
  const nextStop = stops[curIdx + 1];
  // 引导时机:holding(当前步执行中/刚完成停顿)→ 闪烁停在当前步、不显示👇;
  //   停顿后才把闪烁/👇 移到下一步,避免「点完立刻跳到下一步」的错觉
  const holding = guideNext === false;
  const guidePhase = holding ? (cur?.phase ?? state.phaseIndex) : (nextStop?.phase ?? 99);
  const phase = state.phaseIndex;
  const [hover, setHover] = useState<number | null>(null);

  const isD = scenario.id === "D";
  const core0 = buildCoreTopo(scenario.realGraph);
  // D 只画 1 个 UPF(UPF_1),去掉 UPF_2/UPF_3 节点与相关边
  const core = isD
    ? {
        ...core0,
        nodes: core0.nodes.filter((n) => n.type !== "UPF" || n.id === "UPF_1"),
        nodeById: Object.fromEntries(Object.entries(core0.nodeById).filter(([id]) => id !== "UPF_2" && id !== "UPF_3")) as typeof core0.nodeById,
        edges: core0.edges.filter((e) => {
          if (e.id.includes("UPF_2") || e.id.includes("UPF_3")) return false;
          // D 的 gNB→AMF 接入关系由叠加层按指定配对画,去掉核心层默认 gNB-AMF 边避免重复
          const a = core0.nodeById[e.a], b = core0.nodeById[e.b];
          if (a && b && ((a.type === "gNB" && b.type === "AMF") || (a.type === "AMF" && b.type === "gNB"))) return false;
          return true;
        }),
      }
    : core0;
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const threshold = kpi.threshold;

  const focusSet = new Set(state.affectedNe);
  const rootSet = new Set(state.rootCause.nes);
  const cordonedSet = new Set(state.cordonedNe);
  const cpuOverloadSet = new Set(state.cpuOverloadNe);
  const falseAlarmNe = state.falseAlarmActive && scenario.falseAlarm ? scenario.falseAlarm.naiveNe : null;
  // 故障显现门控:异常检测阶段(②,phase>=2)才发现;稳态/采集一切正常
  const reveal = state.phaseIndex >= 2;

  const targets = phase === 5 ? dispatchTargets(scenario, state, scenario.realGraph) : [];

  const trim = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    return { x1: ax + ux * ra, y1: ay + uy * ra, x2: bx - ux * rb, y2: by - uy * rb };
  };

  /** 核心节点状态 */
  const nodeState = (id: string) => {
    const isFaultEl = scenario.fault.elements.includes(id);
    const degraded = isFaultEl && state.showAnomaly && sample(kpi.nodes[id] ?? [0.999], simT) < threshold;
    const overload = cpuOverloadSet.has(id);
    const focus = focusSet.has(id);
    const root = rootSet.has(id);
    const cordoned = cordonedSet.has(id);
    const bad = degraded || overload;
    return { isFaultEl, degraded, overload, focus, root, cordoned, bad };
  };

  // 下发目标位置(核心坐标;UE 用左侧点)
  const targetPos = (id: string) => {
    if (id === "UE") return { x: 40, y: 392 };
    return core.nodeById[id] ? { x: core.nodeById[id].x, y: core.nodeById[id].y } : null;
  };

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id="gc-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <marker id="gc-arr-in" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#7dd3fc" /></marker>
        <marker id="gc-arr-out" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#a78bfa" /></marker>
      </defs>

      {/* DC 框(仅核心网;UE/AI 平台在框外) */}
      <rect x={70} y={150} width={880} height={420} rx={14} fill="var(--accent-a12)" stroke="var(--twin-edge)" strokeDasharray="2 6" />
      <text x={80} y={144} fill="var(--text-dim)" fontSize={11} fontFamily="var(--font-mono)" letterSpacing="0.16em">DC1 · 5GC SA CORE · {scenario.cn}</text>

      {/* 核心业务流边(淡底纹;劣化/根因边强调) */}
      <g>
        {core.edges.map((e) => {
          const A = core.nodeById[e.a], B = core.nodeById[e.b];
          if (!A || !B) return null;
          const ll = trim(A.x, A.y, B.x, B.y, NR, NR);
          const ek = [e.a, e.b].sort().join("__");
          const sr = sample(kpi.edges[ek] ?? [0.999], simT);
          const degraded = sr < threshold && state.showAnomaly;
          const isFocus = focusSet.has(e.a) || focusSet.has(e.b) || rootSet.has(e.a) || rootSet.has(e.b);
          const color = degraded ? srColor(sr) : isFocus ? "var(--accent-a28)" : "var(--accent-a20)";
          const w = degraded ? 1.8 : isFocus ? 1.5 : 1;
          const op = degraded ? 0.7 : isFocus ? 0.35 : 0.16;
          return <line key={e.id} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke={color} strokeWidth={w} strokeLinecap="round" opacity={op} />;
        })}
      </g>

      {/* D 叠加:UE→gNB 接入连线(AgentA/B→gNB_1/2,普通手机→gNB_1/2/3;AgentA 故障时红虚线) */}
      {isD && UE_GROUPS.flatMap((g) => g.gnbs.map((gid) => {
        const gn = core.nodeById[gid];
        if (!gn) return null;
        const faultLink = g.fault && reveal;
        const t = trim(g.x, g.y, gn.x, gn.y, 16, NR);
        return <line key={`ue-${g.label}-${gid}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={faultLink ? "rgba(239,68,68,0.55)" : "#566175"} strokeWidth={faultLink ? 1.4 : 0.9} opacity={faultLink ? 0.8 : 0.4} strokeDasharray={faultLink ? "5 4" : undefined} />;
      }))}

      {/* D 叠加:gNB→AMF 接入(gNB_1/2→AMF_1/2,gNB_3→AMF_3) */}
      {isD && GNB_AMF_D.flatMap(({ gnb, amfs }) => amfs.map((aid) => {
        const g = core.nodeById[gnb], a = core.nodeById[aid];
        if (!g || !a) return null;
        const t = trim(g.x, g.y, a.x, a.y, NR, NR);
        return <line key={`ga-${gnb}-${aid}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--accent-a28)" strokeWidth={1.1} opacity={0.45} />;
      }))}

      {/* D 叠加:UPF_1→AI 平台上行连线(AI1 故障时红虚线) */}
      {isD && (() => {
        const u = core.nodeById.UPF_1;
        if (!u) return null;
        return PLATFORMS.map((p) => {
          const faultLink = p.fault && reveal;
          const t = trim(u.x, u.y, p.x - 50, p.y, NR, 22);
          return <line key={`ai-${p.id}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={faultLink ? "rgba(239,68,68,0.6)" : "#566175"} strokeWidth={faultLink ? 1.8 : 1.2} opacity={faultLink ? 0.85 : 0.45} strokeDasharray={faultLink ? "5 4" : undefined} />;
        });
      })()}

      {/* 核心节点 */}
      <g>
        {core.nodes.map((n) => {
          const s = nodeState(n.id);
          const tc = NE_COLORS[n.type] ?? { base: "#38bdf8", glow: "#7dd3fc" };
          const isFalseAlarm = falseAlarmNe === n.id;
          const ring = s.cordoned ? "var(--text-faint)" : s.bad ? STATUS.fault : isFalseAlarm ? STATUS.warning : s.focus ? tc.glow : tc.base;
          const lw = s.bad || s.focus || s.root ? 2.6 : 1.8;
          const fill = s.bad ? "rgba(60,18,28,0.6)" : "rgba(14,22,40,0.62)";
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              {s.bad && <circle r={NR} fill="none" stroke={STATUS.fault} strokeWidth={1.5} className="alert-ring" opacity={0.7} />}
              {s.root && <circle r={NR + 8} fill="none" stroke={STATUS.fault} strokeWidth={1.3} strokeDasharray="14 6" className="spin-slow" opacity={0.8} />}
              {isFalseAlarm && state.falseAlarmActive && (
                <g opacity={state.falseAlarmIntercepted ? 0.5 : 0.95}>
                  <circle r={NR + 7} fill="none" stroke={state.falseAlarmIntercepted ? STATUS.fault : STATUS.warning} strokeWidth={1.2} strokeDasharray="3 4" />
                  <text y={-NR - 10} textAnchor="middle" fontSize={8} fontWeight={700} fill={state.falseAlarmIntercepted ? STATUS.faultGlow : STATUS.warning} fontFamily="var(--font-mono)">{state.falseAlarmIntercepted ? "✗ 误报拦截" : "？ 误报嫌疑"}</text>
                </g>
              )}
              {s.cordoned && <rect x={-NR - 6} y={-NR - 6} width={(NR + 6) * 2} height={(NR + 6) * 2} rx={6} fill="none" stroke="var(--text-faint)" strokeWidth={1.1} strokeDasharray="3 3" />}
              <circle r={NR} fill={fill} stroke={ring} strokeWidth={lw} filter={s.bad || s.focus || s.root ? "url(#gc-glow)" : undefined} />
              <text y={3} textAnchor="middle" fontSize={10} fontWeight={800} fill={s.cordoned ? "var(--text-mid)" : "var(--text-bright)"} fontFamily="var(--font-mono)">{n.type}</text>
              <text y={NR + 14} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={s.root ? STATUS.faultGlow : s.cordoned ? "var(--text-faint)" : "var(--text-soft)"} fontFamily="var(--font-mono)">{n.id}</text>
              {s.overload && <text y={-NR - 6} textAnchor="middle" fontSize={8} fontWeight={800} fill={STATUS.faultGlow} fontFamily="var(--font-mono)">⚠ 过载</text>}
              {n.role !== "lb" && (
                <g transform={`translate(${NR - 2} ${-NR + 2})`}>
                  <circle r={6.5} fill={n.role === "master" ? "#facc15" : "#64748b"} stroke="#04070f" strokeWidth={1} />
                  <text y={2.5} textAnchor="middle" fontSize={8} fontWeight={800} fill={n.role === "master" ? "#3a2a00" : "#e8eefb"} fontFamily="var(--font-sans)">{n.role === "master" ? "主" : "备"}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* D 叠加:UE 分组(左) */}
      {isD && UE_GROUPS.map((g) => {
        const faultShown = g.fault && reveal;
        return (
          <g key={g.label} transform={`translate(${g.x} ${g.y})`}>
            <circle r={16} fill={faultShown ? "rgba(239,68,68,0.16)" : "rgba(56,189,248,0.08)"} stroke={faultShown ? STATUS.fault : g.color} strokeWidth={1.5} />
            <text y={3} textAnchor="middle" fontSize={9} fontWeight={700} fill={faultShown ? STATUS.faultGlow : g.color} fontFamily="var(--font-sans)">{g.label === "普通手机" ? "📱" : g.label === "Agent A" ? "🅰" : "🅱"}</text>
            <text y={30} textAnchor="middle" fontSize={10} fontWeight={700} fill={faultShown ? STATUS.faultGlow : "var(--text-soft)"} fontFamily="var(--font-sans)">{g.label}</text>
            <text y={42} textAnchor="middle" fontSize={8} fill="var(--text-dim)" fontFamily="var(--font-mono)">{g.desc}</text>
          </g>
        );
      })}

      {/* D 叠加:AI 平台(右) */}
      {isD && PLATFORMS.map((p) => {
        const faultShown = p.fault && reveal;
        return (
          <g key={p.id} transform={`translate(${p.x} ${p.y})`}>
            {faultShown && <rect x={-50} y={-25} width={100} height={50} rx={8} fill="none" stroke={STATUS.fault} strokeWidth={1.5} className="alert-ring" opacity={0.6} />}
            <rect x={-46} y={-21} width={92} height={42} rx={8} fill={faultShown ? "rgba(60,18,28,0.62)" : "rgba(14,22,40,0.6)"} stroke={faultShown ? STATUS.fault : "#b8c2d0"} strokeWidth={faultShown ? 2.4 : 1.8} filter={faultShown ? "url(#gc-glow)" : undefined} />
            <text y={-3} textAnchor="middle" fontSize={13} fontWeight={800} fill={faultShown ? STATUS.faultGlow : "var(--text-bright)"} fontFamily="var(--font-sans)">{p.label}</text>
            <text y={12} textAnchor="middle" fontSize={9} fontWeight={700} fill={faultShown ? STATUS.fault : "#22c55e"} fontFamily="var(--font-mono)">{faultShown ? "⚠ 故障·仅上行" : "✓ 正常"}</text>
          </g>
        );
      })}

      {/* 采集线(相位1):代表网元 → 智能体 */}
      {phase === 1 && ["gNB_1", "AMF_1", "SMF_1", "UDM_1", "PCF_1", "UPF_1"].map((id, i) => {
        const n = core.nodeById[id];
        if (!n) return null;
        const t = trim(n.x, n.y, BRAIN.x, BRAIN.y + 28, NR + 2, 30);
        const pid = `cin-${id}`;
        return (
          <g key={pid}>
            <path id={pid} d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="none" />
            <path d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="#7dd3fc" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="6 5" className="flow-dash" opacity={0.8} markerEnd="url(#gc-arr-in)" />
            <circle r={2.3} fill="#bae6fd"><animateMotion dur={`${1.1 + (i % 4) * 0.18}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${pid}`} /></animateMotion></circle>
          </g>
        );
      })}

      {/* 下发线(相位5):智能体 → 目标网元(统一紫色) */}
      {phase === 5 && targets.map((tg, i) => {
        const tp = targetPos(tg.id);
        if (!tp) return null;
        const t = trim(BRAIN.x, BRAIN.y + 26, tp.x, tp.y, 6, NR + 4);
        const pid = `cout-${tg.id}-${i}`;
        const cx = (t.x1 + t.x2) / 2 + (tg.id === "UE" ? -20 : 26);
        const cy = (t.y1 + t.y2) / 2;
        const d = `M ${t.x1} ${t.y1} Q ${cx} ${cy} ${t.x2} ${t.y2}`;
        return (
          <g key={pid}>
            <path id={pid} d={d} fill="none" stroke="none" />
            <path d={d} fill="none" stroke="#a78bfa" strokeWidth={2.6} strokeLinecap="round" className="flow-dash-fast" opacity={0.95} markerEnd="url(#gc-arr-out)" filter="url(#gc-glow)" />
            <circle r={3.4} fill="#a78bfa" filter="url(#gc-glow)"><animateMotion dur={`${0.7 + (i % 3) * 0.16}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${pid}`} /></animateMotion></circle>
          </g>
        );
      })}

      {/* 🧠 高稳智能体 */}
      <AgentBrain active={phase === 1 || phase === 5} round={cur?.round ?? 1} />

      {/* 7 圆圈 */}
      {CIRCLES.map((c) => {
        const guided = c.phase === guidePhase;
        const done = !guided && c.phase < guidePhase;
        const far = !guided && !done;
        const col = guided ? "#38bdf8" : done ? "#2dd4bf" : "#7e8aa3";
        const isHover = hover === c.phase;
        return (
          <g key={c.n} transform={`translate(${c.x} ${c.y})`} style={{ cursor: "pointer" }} onClick={() => onCircleClick(c.phase, { x: c.x, y: c.y }, c.n)} onMouseEnter={() => setHover(c.phase)} onMouseLeave={() => setHover(null)}>
            {guided && <circle r={26} fill="none" stroke={col} strokeWidth={1.5} className="alert-ring" opacity={0.5} />}
            <circle r={19} fill={far ? "rgba(100,116,139,0.1)" : done ? "rgba(45,212,191,0.16)" : col} stroke={isHover && far ? "#aab8cc" : col} strokeWidth={far ? 1.5 : 2.2} filter={guided ? "url(#gc-glow)" : undefined} opacity={far ? 0.6 : 1} />
            <text y={5} textAnchor="middle" fontSize={done ? 16 : 15} fontWeight={800} fill={done ? "#2dd4bf" : far ? "var(--text-faint)" : "#04070f"} fontFamily="var(--font-mono)">{done ? "✓" : c.n}</text>
            <text y={34} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={done ? "var(--text-soft)" : far ? "var(--text-faint)" : "var(--text-bright)"} fontFamily="var(--font-sans)">{c.cn}</text>
          </g>
        );
      })}

      {/* 悬停提示 */}
      {hover !== null && (() => {
        const c = CIRCLES.find((x) => x.phase === hover);
        if (!c) return null;
        const placeLeft = c.x > VW * 0.5;
        const W = 210;
        const x = Math.max(8, Math.min(VW - W - 8, placeLeft ? c.x - 24 - W : c.x + 24));
        const y = Math.max(36, Math.min(VH - 80, c.y - 14));
        return (
          <foreignObject x={x} y={y} width={W} height={70} style={{ overflow: "visible", pointerEvents: "none" }}>
            <div style={{ width: W, background: "rgba(10,14,26,0.95)", border: `1.5px solid ${PHASES[c.phase].color}`, borderRadius: 8, padding: "6px 8px", fontFamily: "var(--font-sans)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-bright)" }}>{c.cn}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-soft)", lineHeight: 1.4, marginTop: 2 }}>{c.desc}</div>
            </div>
          </foreignObject>
        );
      })()}

      {/* 👇 引导(仅停顿后、引导下一步时显示) */}
      {!holding && nextStop && (() => {
        const c = CIRCLES.find((x) => x.phase === nextStop.phase);
        if (!c) return null;
        return (
          <g transform={`translate(${c.x + 26} ${c.y - 30})`} style={{ pointerEvents: "none" }}>
            <g style={{ animation: "ptr-bob 1.2s ease-in-out infinite" }}><text y={6} fontSize={18}>👇</text></g>
          </g>
        );
      })()}

      {/* 起步提示 */}
      {curIdx === 0 && (
        <text x={140} y={76} fontSize={13} fontWeight={800} fill="#7dd3fc" fontFamily="var(--font-sans)" style={{ animation: "blink 1.4s ease-in-out infinite" }}>→ 点击 ① 号圆圈开始</text>
      )}
    </svg>
  );
}

function AgentBrain({ active, round }: { active: boolean; round: number }) {
  const col = "#2dd4bf";
  return (
    <g transform={`translate(${BRAIN.x} ${BRAIN.y})`} opacity={active ? 1 : 0.92}>
      {active && <circle r={38} fill="none" stroke={col} strokeWidth={1.4} className="alert-ring" opacity={0.5} />}
      <circle r={28} fill={`${col}1a`} stroke={col} strokeWidth={2.2} filter="url(#gc-glow)" />
      <g stroke={col} strokeWidth={1.7} fill={`${col}26`} strokeLinecap="round" strokeLinejoin="round">
        <path d="M0,-14 C-7,-16 -15,-8 -11,-2 C-17,2 -13,10 -5,8 C-3,13 3,13 5,8 C13,10 17,2 11,-2 C15,-8 7,-16 0,-14 Z" />
      </g>
      <g stroke={col} strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.85}>
        <line x1={0} y1={-14} x2={0} y2={10} />
        <path d="M-8,-6 C-4,-4 -4,0 -8,2" /><path d="M8,-6 C4,-4 4,0 8,2" />
      </g>
      <text y={47} textAnchor="middle" fontSize={13} fontWeight={800} fill={col} fontFamily="var(--font-sans)">高稳智能体</text>
      {round === 2 && <text y={60} textAnchor="middle" fontSize={9} fill="#fbbf24" fontFamily="var(--font-mono)">· R2</text>}
    </g>
  );
}

export const GuideCanvas = memo(GuideCanvasBase);
