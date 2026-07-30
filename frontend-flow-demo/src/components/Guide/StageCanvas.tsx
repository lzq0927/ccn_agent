// ============================================================================
// StageCanvas —— 场景G专用拓扑画布
//   左:3组 UE(Agent A / Agent B / 普通手机)
//   中:AMF / SMF / UPF / UDM / PCF(无 NRF/AUSF/NSSF)
//   右:AI平台1(故障) / AI平台2(正常)
//   顶部:🧠 高稳智能体 + 7 圆圈 + 采集/下发箭头
// ============================================================================

import { memo, useState } from "react";
import type { NetworkGraph } from "../../data/network";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { PHASES, STATUS } from "../../theme";
import { dispatchTargets } from "../../guide/steps";
import { getKpi, type WalkStop } from "../../story/director";
import { sample } from "../../data/kpi";

const VW = 1040;
const VH = 646;
const BRAIN = { x: 400, y: 70 };
const NR = 24;

/** G 专用拓扑节点 */
const TOPO_NODES: { id: string; label: string; x: number; y: number; isPlatform?: boolean; platformFault?: boolean }[] = [
  { id: "AMF", label: "AMF", x: 340, y: 380 },
  { id: "SMF", label: "SMF", x: 540, y: 340 },
  { id: "UPF", label: "UPF", x: 760, y: 340 },
  { id: "UDM", label: "UDM", x: 540, y: 190 },
  { id: "PCF", label: "PCF", x: 540, y: 510 },
  { id: "AI1", label: "AI平台1", x: 960, y: 220, isPlatform: true, platformFault: true },
  { id: "AI2", label: "AI平台2", x: 960, y: 470, isPlatform: true, platformFault: false },
];
const NODE_BY: Record<string, { x: number; y: number }> = Object.fromEntries(TOPO_NODES.map((t) => [t.id, { x: t.x, y: t.y }]));
const TOPO_EDGES: [string, string][] = [
  ["AMF", "SMF"], ["SMF", "UPF"], ["SMF", "UDM"], ["SMF", "PCF"], ["UPF", "AI1"], ["UPF", "AI2"],
];

/** 3 组 UE */
const UE_GROUPS = [
  { label: "Agent A", desc: "→ AMF_1/AMF_2 → AI平台1", x: 70, y: 250, color: "#f59e0b", fault: true },
  { label: "Agent B", desc: "→ 3 AMF → AI平台2", x: 70, y: 380, color: "#38bdf8", fault: false },
  { label: "普通手机", desc: "→ 3 AMF → AI平台2", x: 70, y: 500, color: "#94a3b8", fault: false },
];

/** 7 圆圈 */
const CIRCLES = [
  { n: 1, phase: 1, x: 280, y: 70, cn: "数据采集", desc: "Agent 1 采集 KPI / CHR / 3GPP 信令 / 容器 CPU" },
  { n: 2, phase: 2, x: 250, y: 190, cn: "异常检测", desc: "KPI/CHR/CPU 多维检测,任一异常即触发" },
  { n: 3, phase: 3, x: 470, y: 135, cn: "策略匹配", desc: "置信度路由分流(工作流/技能引导/自主探索)" },
  { n: 4, phase: 4, x: 660, y: 240, cn: "根因推理", desc: "Agent 2 推理链收敛,定位根因" },
  { n: 5, phase: 5, x: 520, y: 70, cn: "策略下发", desc: "向 AMF/SMF 下发策略(限流+Timer)" },
  { n: 6, phase: 6, x: 660, y: 420, cn: "网络恢复", desc: "恢复策略生效,成功率回升" },
  { n: 7, phase: 7, x: 400, y: 22, cn: "评估优化", desc: "Agent 3 评估:通过→沉淀;未通过→回Agent1" },
];

interface Props {
  scenario: Scenario;
  state: StoryState;
  graph: NetworkGraph | undefined;
  stops: WalkStop[];
  curIdx: number;
  onCircleClick: (phase: number, pos: { x: number; y: number }, n: number) => void;
}

function StageCanvasBase({ scenario, state, graph, stops, curIdx, onCircleClick }: Props) {
  const cur = stops[curIdx];
  const nextStop = stops[curIdx + 1];
  const phase = state.phaseIndex;
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const [hover, setHover] = useState<number | null>(null);

  const nodes = graph?.nodes ?? [];
  const typeOf = (id: string) => id.replace(/_\d+$/, "");
  const instances = (type: string) => nodes.filter((n) => n.type === type);
  const focusSet = new Set(state.affectedNe);
  const rootSet = new Set(state.rootCause.nes);
  const cordonedSet = new Set(state.cordonedNe);

  const typeState = (type: string) => {
    const ins = instances(type);
    const faultIds = ins.filter((n) => scenario.fault.elements.includes(n.id)).map((n) => n.id);
    const degraded = ins.some((n) => sample(kpi.nodes[n.id] ?? [0.999], simT) < kpi.threshold && state.showAnomaly);
    const root = ins.some((n) => rootSet.has(n.id));
    const cordoned = ins.some((n) => cordonedSet.has(n.id));
    const overload = ins.some((n) => state.cpuOverloadNe.includes(n.id));
    const focus = ins.some((n) => focusSet.has(n.id));
    const bad = degraded || root || overload;
    return { ins, faultIds, degraded, root, cordoned, overload, focus, bad };
  };

  const targets = phase === 5 ? dispatchTargets(scenario, state, graph) : [];

  const circlePos = (c: { phase: number; x: number; y: number }): { x: number; y: number } => {
    const anchorId = c.phase === 2 ? state.affectedNe[0] : (c.phase === 4 || c.phase === 6) ? (state.rootCause.nes[0] || state.affectedNe[0]) : null;
    const anchorType = anchorId ? typeOf(anchorId) : null;
    const anchor = anchorType ? NODE_BY[anchorType] : null;
    if (!anchor) return { x: c.x, y: c.y };
    if (c.phase === 2) return { x: Math.max(60, anchor.x - 80), y: anchor.y };
    if (c.phase === 4) return { x: Math.min(VW - 60, anchor.x + 90), y: anchor.y };
    if (c.phase === 6) return { x: anchor.x + 60, y: Math.min(VH - 60, anchor.y + 80) };
    return { x: c.x, y: c.y };
  };

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id="sc-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <marker id="sc-arr-in" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#7dd3fc" /></marker>
        <marker id="sc-arr-out" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#a78bfa" /></marker>
      </defs>

      {/* UE 分组(左) */}
      {UE_GROUPS.map((g) => (
        <g key={g.label} transform={`translate(${g.x} ${g.y})`}>
          <circle r={16} fill={g.fault ? "rgba(239,68,68,0.15)" : "rgba(56,189,248,0.08)"} stroke={g.fault ? STATUS.fault : g.color} strokeWidth={1.5} />
          <text y={3} textAnchor="middle" fontSize={9} fontWeight={700} fill={g.fault ? STATUS.faultGlow : g.color} fontFamily="var(--font-sans)">{g.label === "普通手机" ? "📱" : g.label === "Agent A" ? "🅰" : "🅱"}</text>
          <text y={30} textAnchor="middle" fontSize={10} fontWeight={700} fill={g.fault ? STATUS.faultGlow : "var(--text-soft)"} fontFamily="var(--font-sans)">{g.label}</text>
          <text y={42} textAnchor="middle" fontSize={8} fill="var(--text-dim)" fontFamily="var(--font-mono)">{g.desc}</text>
          {/* 连线到 AMF */}
          <line x1={16} y1={0} x2={NODE_BY.AMF.x - NR} y2={NODE_BY.AMF.y - g.y} stroke={g.fault ? "rgba(239,68,68,0.35)" : "#566175"} strokeWidth={g.fault ? 1.5 : 1} opacity={0.6} strokeDasharray={g.fault ? "4 3" : undefined} />
        </g>
      ))}

      {/* 拓扑边 */}
      <g>
        {TOPO_EDGES.map(([a, b], i) => {
          const A = NODE_BY[a], B = NODE_BY[b];
          if (!A || !B) return null;
          const t = trim(A.x, A.y, B.x, B.y, NR, NR);
          return <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#566175" strokeWidth={1.5} opacity={0.7} />;
        })}
      </g>

      {/* 拓扑节点 */}
      <g>
        {TOPO_NODES.map((tn) => {
          if (tn.isPlatform) {
            // AI 平台:方框 + 故障/正常状态
            const fault = tn.platformFault;
            return (
              <g key={tn.id} transform={`translate(${tn.x} ${tn.y})`}>
                {fault && <rect x={-52} y={-26} width={104} height={52} rx={8} fill="none" stroke={STATUS.fault} strokeWidth={1.5} className="alert-ring" opacity={0.6} />}
                <rect x={-48} y={-22} width={96} height={44} rx={8} fill={fault ? "rgba(60,18,28,0.6)" : "rgba(14,22,40,0.6)"} stroke={fault ? STATUS.fault : "#b8c2d0"} strokeWidth={fault ? 2.5 : 2} filter={fault ? "url(#sc-glow)" : undefined} />
                <text y={-3} textAnchor="middle" fontSize={13} fontWeight={800} fill={fault ? STATUS.faultGlow : "var(--text-bright)"} fontFamily="var(--font-sans)">{tn.label}</text>
                <text y={12} textAnchor="middle" fontSize={9} fontWeight={700} fill={fault ? STATUS.fault : "#22c55e"} fontFamily="var(--font-mono)">{fault ? "⚠ 故障" : "✓ 正常"}</text>
              </g>
            );
          }
          // NE 节点(AMF/SMF/UPF/UDM/PCF)
          const s = typeState(tn.id);
          const ring = s.cordoned ? "var(--text-faint)" : (s.root || s.degraded || s.overload) ? STATUS.fault : s.focus ? "#7dd3fc" : "#b8c2d0";
          const lw = (s.root || s.degraded || s.overload || s.focus) ? 2.8 : 2;
          const fill = (s.root || s.degraded || s.overload) ? "rgba(60,18,28,0.55)" : "rgba(14,22,40,0.6)";
          return (
            <g key={tn.id} transform={`translate(${tn.x} ${tn.y})`}>
              {s.bad && <circle r={NR} fill="none" stroke={STATUS.fault} strokeWidth={1.6} className="alert-ring" opacity={0.7} />}
              {s.root && <circle r={NR + 9} fill="none" stroke={STATUS.fault} strokeWidth={1.4} strokeDasharray="14 6" className="spin-slow" opacity={0.85} />}
              <circle r={NR} fill={fill} stroke={ring} strokeWidth={lw} filter={s.bad || s.focus ? "url(#sc-glow)" : undefined} />
              <text y={5} textAnchor="middle" fontSize={14} fontWeight={800} fill={s.cordoned ? "var(--text-mid)" : "var(--text-bright)"} fontFamily="var(--font-mono)">{tn.label}</text>
              <text y={NR + 15} textAnchor="middle" fontSize={10} fontWeight={700} fill={s.bad ? STATUS.faultGlow : "var(--text-soft)"} fontFamily="var(--font-mono)">
                {s.faultIds.length ? `⚠ ${s.faultIds.join("/")}` : `${s.ins.length} 实例`}
              </text>
            </g>
          );
        })}
      </g>

      {/* 采集线(相位1):NE 节点 → 智能体 */}
      {phase === 1 && TOPO_NODES.filter((tn) => !tn.isPlatform).map((tn, i) => {
        const t = trim(tn.x, tn.y, BRAIN.x, BRAIN.y + 32, NR + 2, 34);
        const id = `cin-${tn.id}`;
        return (
          <g key={id}>
            <path id={id} d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="none" />
            <path d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="#7dd3fc" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="6 5" className="flow-dash" opacity={0.85} markerEnd="url(#sc-arr-in)" />
            <circle r={2.6} fill="#bae6fd"><animateMotion dur={`${1.1 + (i % 4) * 0.18}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${id}`} /></animateMotion></circle>
          </g>
        );
      })}

      {/* 下发线(相位5):智能体 → AMF/SMF(统一紫色) */}
      {phase === 5 && (() => {
        const seen = new Set<string>();
        const outs: { type: string }[] = [];
        for (const tg of targets) {
          if (tg.id === "UE") continue;
          const ty = typeOf(tg.id);
          if (!seen.has(ty)) { seen.add(ty); outs.push({ type: ty }); }
        }
        return outs.map((o, i) => {
          const pos = NODE_BY[o.type];
          if (!pos) return null;
          const t = trim(BRAIN.x, BRAIN.y + 30, pos.x, pos.y, 6, NR + 4);
          const id = `cout-${o.type}-${i}`;
          const cx = (t.x1 + t.x2) / 2 + 35;
          const cy = (t.y1 + t.y2) / 2;
          const d = `M ${t.x1} ${t.y1} Q ${cx} ${cy} ${t.x2} ${t.y2}`;
          return (
            <g key={id}>
              <path id={id} d={d} fill="none" stroke="none" />
              <path d={d} fill="none" stroke="#a78bfa" strokeWidth={3} strokeLinecap="round" className="flow-dash-fast" opacity={0.97} markerEnd="url(#sc-arr-out)" filter="url(#sc-glow)" />
              <circle r={3.8} fill="#a78bfa" filter="url(#sc-glow)"><animateMotion dur={`${0.7 + (i % 3) * 0.16}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${id}`} /></animateMotion></circle>
            </g>
          );
        });
      })()}

      {/* 🧠 高稳智能体 */}
      <AgentBrain active={phase === 1 || phase === 5} round={cur?.round ?? 1} />

      {/* 7 圆圈 */}
      {CIRCLES.map((c) => {
        const nextPhase = nextStop?.phase ?? 99;
        const guided = c.phase === nextPhase;
        const done = !guided && c.phase < nextPhase;
        const far = !guided && !done;
        const col = guided ? "#38bdf8" : done ? "#2dd4bf" : "#7e8aa3";
        const isHover = hover === c.phase;
        const pos = circlePos(c);
        return (
          <g key={c.n} transform={`translate(${pos.x} ${pos.y})`} style={{ cursor: "pointer" }} onClick={() => onCircleClick(c.phase, pos, c.n)} onMouseEnter={() => setHover(c.phase)} onMouseLeave={() => setHover(null)}>
            {guided && <circle r={26} fill="none" stroke={col} strokeWidth={1.5} className="alert-ring" opacity={0.5} />}
            <circle r={19} fill={far ? "rgba(100,116,139,0.1)" : done ? "rgba(45,212,191,0.16)" : col} stroke={isHover && far ? "#aab8cc" : col} strokeWidth={far ? 1.5 : 2.2} filter={guided ? "url(#sc-glow)" : undefined} opacity={far ? 0.6 : 1} />
            <text y={5} textAnchor="middle" fontSize={done ? 16 : 15} fontWeight={800} fill={done ? "#2dd4bf" : far ? "var(--text-faint)" : "#04070f"} fontFamily="var(--font-mono)">{done ? "✓" : c.n}</text>
            <text y={34} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={done ? "var(--text-soft)" : far ? "var(--text-faint)" : "var(--text-bright)"} fontFamily="var(--font-sans)">{c.cn}</text>
          </g>
        );
      })}

      {/* 悬停提示 */}
      {hover !== null && (() => {
        const c = CIRCLES.find((x) => x.phase === hover);
        if (!c) return null;
        const cp = circlePos(c);
        const placeLeft = cp.x > VW * 0.5;
        const W = 210;
        const x = Math.max(8, Math.min(VW - W - 8, placeLeft ? cp.x - 24 - W : cp.x + 24));
        const y = Math.max(36, Math.min(VH - 80, cp.y - 14));
        return (
          <foreignObject x={x} y={y} width={W} height={70} style={{ overflow: "visible", pointerEvents: "none" }}>
            <div style={{ width: W, background: "rgba(10,14,26,0.95)", border: `1.5px solid ${PHASES[c.phase].color}`, borderRadius: 8, padding: "6px 8px", fontFamily: "var(--font-sans)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-bright)" }}>{c.cn}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-soft)", lineHeight: 1.4, marginTop: 2 }}>{c.desc}</div>
            </div>
          </foreignObject>
        );
      })()}

      {/* 👇 引导 */}
      {nextStop && (() => {
        const c = CIRCLES.find((x) => x.phase === nextStop.phase);
        if (!c) return null;
        const gp = circlePos(c);
        return (
          <g transform={`translate(${gp.x + 26} ${gp.y - 30})`} style={{ pointerEvents: "none" }}>
            <g style={{ animation: "ptr-bob 1.2s ease-in-out infinite" }}><text y={6} fontSize={18}>👇</text></g>
          </g>
        );
      })()}

      {/* 起步提示 */}
      {curIdx === 0 && (
        <text x={150} y={40} fontSize={13} fontWeight={800} fill="#7dd3fc" fontFamily="var(--font-sans)" style={{ animation: "blink 1.4s ease-in-out infinite" }}>→ 点击 ① 号圆圈开始</text>
      )}
    </svg>
  );
}

function AgentBrain({ active, round }: { active: boolean; round: number }) {
  const col = "#2dd4bf";
  return (
    <g transform={`translate(${BRAIN.x} ${BRAIN.y})`} opacity={active ? 1 : 0.92}>
      {active && <circle r={40} fill="none" stroke={col} strokeWidth={1.4} className="alert-ring" opacity={0.5} />}
      <circle r={30} fill={`${col}1a`} stroke={col} strokeWidth={2.2} filter="url(#sc-glow)" />
      <g stroke={col} strokeWidth={1.7} fill={`${col}26`} strokeLinecap="round" strokeLinejoin="round">
        <path d="M0,-15 C-8,-17 -16,-9 -12,-2 C-18,2 -14,11 -5,9 C-3,14 3,14 5,9 C14,11 18,2 12,-2 C16,-9 8,-17 0,-15 Z" />
      </g>
      <g stroke={col} strokeWidth={1.3} fill="none" strokeLinecap="round" opacity={0.85}>
        <line x1={0} y1={-15} x2={0} y2={11} />
        <path d="M-9,-7 C-5,-5 -5,-1 -9,1" /><path d="M9,-7 C5,-5 5,-1 9,1" />
        <path d="M-8,4 C-4,6 -4,9 -7,10" /><path d="M8,4 C4,6 4,9 7,10" />
      </g>
      <text y={50} textAnchor="middle" fontSize={14} fontWeight={800} fill={col} fontFamily="var(--font-sans)">高稳智能体</text>
      {round === 2 && <text y={64} textAnchor="middle" fontSize={9} fill="#fbbf24" fontFamily="var(--font-mono)">· R2</text>}
    </g>
  );
}

function trim(ax: number, ay: number, bx: number, by: number, ra: number, rb: number) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  return { x1: ax + ux * ra, y1: ay + uy * ra, x2: bx - ux * rb, y2: by - uy * rb };
}

export const StageCanvas = memo(StageCanvasBase);
