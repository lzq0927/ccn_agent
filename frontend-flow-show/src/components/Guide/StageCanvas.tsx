// ============================================================================
// StageCanvas —— 统一演示画布(单 SVG,同一坐标系)
//   顶部:🧠 高稳智能体(自绘大脑,青色)
//   底部:**精简拓扑**(按 NE 类型聚合,9 个大节点,标签清晰可读;不再画 21 个小实例)
//         故障类型节点高亮 + 显示受影响实例(如 AMF_1/SMF_1)。
//   采集(相位1):各类型节点 → 智能体(清晰粗箭头 + 数据类型标注)
//   下发(相位5):智能体 → 受影响类型节点(策略标注)
//   7 圆圈(统一青/青绿/灰配色)+ 👇 引导。
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
const BRAIN = { x: 520, y: 80 };
const NR = 26; // 类型节点半径(大,标签清晰)

/** 9 类 NE 类型节点(精简拓扑布局;实例聚合到类型) */
const TYPE_NODES: { type: string; x: number; y: number }[] = [
  { type: "gNB", x: 110, y: 440 },
  { type: "AMF", x: 310, y: 440 },
  { type: "SMF", x: 520, y: 440 },
  { type: "UPF", x: 740, y: 440 },
  { type: "NRF", x: 310, y: 268 },
  { type: "AUSF", x: 420, y: 268 },
  { type: "UDM", x: 740, y: 268 },
  { type: "PCF", x: 620, y: 600 },
  { type: "NSSF", x: 920, y: 440 },
];
const TYPE_NODE_BY: Record<string, { x: number; y: number }> = Object.fromEntries(TYPE_NODES.map((t) => [t.type, { x: t.x, y: t.y }]));
const TYPE_EDGES: [string, string][] = [
  ["gNB", "AMF"], ["AMF", "SMF"], ["SMF", "UPF"], ["SMF", "UDM"], ["SMF", "PCF"], ["AMF", "NRF"], ["SMF", "AUSF"], ["AMF", "NSSF"],
];

/** 采集的数据类别(相位1,所有网元上报) */

/** 7 个故事圆圈(避开拓扑节点位置;标号与左侧方案流程一致:1采集 2检测 3匹配 4根因 5下发 6恢复 7评估) */
const CIRCLES = [
  { n: 1, phase: 1, x: 388, y: 80, cn: "数据采集", desc: "Agent 1 采集 KPI / CHR / 3GPP 信令 / 容器 CPU → 智能体" },
  { n: 2, phase: 2, x: 195, y: 560, cn: "异常检测", desc: "KPI/CHR/容器 CPU 多维检测,任一链路跌破阈值即触发" },
  { n: 3, phase: 3, x: 520, y: 168, cn: "策略匹配", desc: "多维特征加权评分 → 置信度路由分流(工作流/技能引导/自主探索)" },
  { n: 4, phase: 4, x: 870, y: 355, cn: "根因推理", desc: "Agent 2 推理链收敛,定位根因网元(防误报/漏报)" },
  { n: 5, phase: 5, x: 652, y: 80, cn: "策略下发", desc: "向 AMF/SMF 下发恢复策略(通知 UE / 限流),脑 → 目标网元" },
  { n: 6, phase: 6, x: 870, y: 545, cn: "网络恢复", desc: "恢复策略生效,成功率回升,闭环验证通过" },
  { n: 7, phase: 7, x: 760, y: 168, cn: "评估优化", desc: "Agent 3 比对、沉淀 Skill,优化建议回流 Agent 1/2" },
];

interface Props {
  scenario: Scenario;
  state: StoryState;
  graph: NetworkGraph | undefined;
  stops: WalkStop[];
  curIdx: number;
  onGoToPhase: (phase: number) => void;
}

function StageCanvasBase({ scenario, state, graph, stops, curIdx, onGoToPhase }: Props) {
  const cur = stops[curIdx];
  const nextStop = stops[curIdx + 1];
  const phase = state.phaseIndex;
  const kpi = getKpi(scenario);
  const simT = state.simT;

  const focusSet = new Set(state.affectedNe);
  const rootSet = new Set(state.rootCause.nes);
  const cordonedSet = new Set(state.cordonedNe);
  const curStepNes = new Set(state.currentStep?.highlight?.nes ?? []);
  const [hover, setHover] = useState<number | null>(null);

  const nodes = graph?.nodes ?? [];
  const typeOf = (id: string) => id.replace(/_\d+$/, "");
  const instances = (type: string) => nodes.filter((n) => n.type === type);
  /** 圆圈位置:②检测→首个受影响 NE 旁;④推理→根因 NE 旁;其余用静态位 */
  const circlePos = (c: { phase: number; x: number; y: number }): { x: number; y: number } => {
    const anchorId = c.phase === 2 ? state.affectedNe[0] : c.phase === 4 ? state.rootCause.nes[0] : null;
    const anchorType = anchorId ? typeOf(anchorId) : null;
    const anchor = anchorType ? TYPE_NODE_BY[anchorType] : null;
    if (!anchor) return { x: c.x, y: c.y };
    return { x: Math.max(60, Math.min(VW - 60, anchor.x + 56)), y: Math.max(300, Math.min(VH - 70, anchor.y + 56)) };
  };
  const typeState = (type: string) => {
    const ins = instances(type);
    const faultIds = ins.filter((n) => scenario.fault.elements.includes(n.id)).map((n) => n.id);
    const degraded = ins.some((n) => sample(kpi.nodes[n.id] ?? [0.999], simT) < kpi.threshold && state.showAnomaly);
    const root = ins.some((n) => rootSet.has(n.id));
    const cordoned = ins.some((n) => cordonedSet.has(n.id));
    const overload = ins.some((n) => state.cpuOverloadNe.includes(n.id));
    const focus = ins.some((n) => focusSet.has(n.id));
    const step = ins.some((n) => curStepNes.has(n.id) && phase === 4);
    const bad = degraded || root || overload;
    return { ins, faultIds, degraded, root, cordoned, overload, focus, step, bad };
  };

  // 采集源(相位1):9 类型节点
  // 下发目标(相位5)
  const targets = phase === 5 ? dispatchTargets(scenario, state, graph) : [];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id="sc-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <marker id="sc-arr-in" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#7dd3fc" /></marker>
        <marker id="sc-arr-out" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#5eead4" /></marker>
        <radialGradient id="sc-node-ok" cx="50%" cy="40%" r="70%"><stop offset="0%" stopColor="#3a5180" /><stop offset="100%" stopColor="#1d2d50" /></radialGradient>
        <radialGradient id="sc-node-fault" cx="50%" cy="40%" r="70%"><stop offset="0%" stopColor="#5a2030" /><stop offset="100%" stopColor="#2a0e16" /></radialGradient>
      </defs>

      {/* 区域标签 + 分隔 */}
      <text x={20} y={26} fontSize={12} fill="var(--text-faint)" fontFamily="var(--font-mono)" letterSpacing="0.12em">智能体 · AGENT</text>
      <text x={20} y={236} fontSize={12} fill="var(--text-faint)" fontFamily="var(--font-mono)" letterSpacing="0.12em">5GC 现网拓扑(按类型)· NETWORK</text>
      <line x1={20} y1={244} x2={VW - 20} y2={244} stroke="var(--border)" strokeDasharray="3 5" />

      {/* 在网用户(UE 簇,左) */}
      <UeUsers gnbs={instances("gNB")} />

      {/* 业务流主干(类型间) */}
      <g>
        {TYPE_EDGES.map(([a, b], i) => {
          const A = TYPE_NODE_BY[a], B = TYPE_NODE_BY[b];
          if (!A || !B) return null;
          const t = trim(A.x, A.y, B.x, B.y, NR, NR);
          return <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#566175" strokeWidth={1.5} opacity={0.7} />;
        })}
      </g>

      {/* 类型节点(大,清晰;故障类型高亮 + 显示受影响实例) */}
      <g>
        {TYPE_NODES.map((tn) => {
          const s = typeState(tn.type);
          const ring = s.cordoned ? "var(--text-faint)" : (s.root || s.degraded || s.overload) ? STATUS.fault : s.focus ? "#7dd3fc" : "#b8c2d0";
          const lw = (s.root || s.degraded || s.overload || s.focus) ? 2.8 : 2;
          const fill = (s.root || s.degraded || s.overload) ? "rgba(60,18,28,0.55)" : "rgba(14,22,40,0.6)";
          return (
            <g key={tn.type} transform={`translate(${tn.x} ${tn.y})`}>
              {s.bad && <circle r={NR} fill="none" stroke={STATUS.fault} strokeWidth={1.6} className="alert-ring" opacity={0.7} />}
              {s.root && <circle r={NR + 9} fill="none" stroke={STATUS.fault} strokeWidth={1.4} strokeDasharray="14 6" className="spin-slow" opacity={0.85} />}
              {s.cordoned && <rect x={-NR - 8} y={-NR - 8} width={(NR + 8) * 2} height={(NR + 8) * 2} rx={7} fill="none" stroke="var(--text-faint)" strokeWidth={1.2} strokeDasharray="4 4" />}
              <circle r={NR} fill={fill} stroke={ring} strokeWidth={lw} filter={s.bad || s.focus ? "url(#sc-glow)" : undefined} />
              <text y={5} textAnchor="middle" fontSize={16} fontWeight={800} fill={s.cordoned ? "var(--text-mid)" : "var(--text-bright)"} fontFamily="var(--font-mono)">{tn.type}</text>
              {/* 实例信息:正常=数量,故障=受影响实例 */}
              <text y={NR + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill={s.bad ? STATUS.faultGlow : "var(--text-soft)"} fontFamily="var(--font-mono)">
                {s.faultIds.length ? `⚠ ${s.faultIds.join("/")}` : `${s.ins.length} 实例`}
              </text>
              {s.overload && !s.faultIds.length && <text y={NR + 30} textAnchor="middle" fontSize={10} fill={STATUS.warning} fontFamily="var(--font-mono)">CPU 过载</text>}
              {s.step && <text y={-NR - 9} textAnchor="middle" fontSize={10} fill="#7dd3fc" fontFamily="var(--font-mono)">▶ 排查</text>}
            </g>
          );
        })}
      </g>

      {/* 采集线(相位1):所有网元 → 智能体(细箭头,不遮脑;数据类别见 InfoPanel) */}
      {phase === 1 && TYPE_NODES.map((tn, i) => {
        const t = trim(tn.x, tn.y, BRAIN.x, BRAIN.y + 32, NR + 2, 34);
        const id = `cin-${tn.type}`;
        return (
          <g key={id}>
            <path id={id} d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="none" />
            <path d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="#7dd3fc" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="6 5" className="flow-dash" opacity={0.85} markerEnd="url(#sc-arr-in)" />
            <circle r={2.6} fill="#bae6fd">
              <animateMotion dur={`${1.1 + (i % 4) * 0.18}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${id}`} /></animateMotion>
            </circle>
          </g>
        );
      })}

      {/* 下发线(相位5):智能体 → 受影响类型节点 */}
      {phase === 5 && (() => {
        // 目标类型(去重),UE 单独
        const seen = new Set<string>();
        const outs: { type: string; label: string; policy: string; color: string }[] = [];
        for (const tg of targets) {
          if (tg.id === "UE") {
            if (!seen.has("UE")) { seen.add("UE"); outs.push({ type: "UE", label: tg.label, policy: tg.policy, color: tg.color }); }
          } else {
            const ty = typeOf(tg.id);
            if (!seen.has(ty)) { seen.add(ty); outs.push({ type: ty, label: ty, policy: tg.policy, color: tg.color }); }
          }
        }
        return outs.map((o, i) => {
          const pos = o.type === "UE" ? { x: 46, y: 440 } : TYPE_NODE_BY[o.type];
          if (!pos) return null;
          const t = trim(BRAIN.x, BRAIN.y + 30, pos.x, pos.y, 6, NR + 4);
          const id = `cout-${o.type}-${i}`;
          return (
            <g key={id}>
              <path id={id} d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="none" />
              <path d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke={o.color} strokeWidth={3} strokeLinecap="round" className="flow-dash-fast" opacity={0.97} markerEnd="url(#sc-arr-out)" filter="url(#sc-glow)" />
              <circle r={3.8} fill={o.color} filter="url(#sc-glow)">
                <animateMotion dur={`${0.7 + (i % 3) * 0.16}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${id}`} /></animateMotion>
              </circle>
            </g>
          );
        });
      })()}

      {/* 🧠 高稳智能体 */}
      <AgentBrain active={phase === 1 || phase === 5} round={cur?.round ?? 1} />

      {/* 7 个故事圆圈 —— 只有「下一个要点」的亮,已完成的=✓,未到的=灰(避免不知点谁) */}
      {CIRCLES.map((c) => {
        const nextPhase = nextStop?.phase ?? 99;
        const guided = c.phase === nextPhase;          // 下一个要点:青色脉冲
        const done = !guided && c.phase < nextPhase;    // 已完成:青绿 ✓
        const far = !guided && !done;                   // 未到:灰
        const col = guided ? "#38bdf8" : done ? "#2dd4bf" : "#7e8aa3";
        const isHover = hover === c.phase;
        const pos = circlePos(c);
        return (
          <g key={c.n} transform={`translate(${pos.x} ${pos.y})`} style={{ cursor: "pointer" }} onClick={() => onGoToPhase(c.phase)} onMouseEnter={() => setHover(c.phase)} onMouseLeave={() => setHover(null)}>
            {guided && <circle r={26} fill="none" stroke={col} strokeWidth={1.5} className="alert-ring" opacity={0.5} />}
            <circle r={19} fill={far ? "rgba(100,116,139,0.1)" : done ? "rgba(45,212,191,0.16)" : col} stroke={isHover && far ? "#aab8cc" : col} strokeWidth={far ? 1.5 : 2.2} filter={guided ? "url(#sc-glow)" : undefined} opacity={far ? 0.6 : 1} />
            <text y={5} textAnchor="middle" fontSize={done ? 16 : 15} fontWeight={800} fill={done ? "#2dd4bf" : far ? "var(--text-faint)" : "#04070f"} fontFamily="var(--font-mono)">{done ? "✓" : c.n}</text>
            <text y={34} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={done ? "var(--text-soft)" : far ? "var(--text-faint)" : "var(--text-bright)"} fontFamily="var(--font-sans)">{c.cn}</text>
          </g>
        );
      })}

      {/* 鼠标悬停圆圈 → 介绍弹窗(挪走消失,AWS 风) */}
      {hover !== null && (() => {
        const c = CIRCLES.find((x) => x.phase === hover);
        if (!c) return null;
        const ph = PHASES[c.phase];
        const cp = circlePos(c);
        const placeLeft = cp.x > VW * 0.5;
        const W = 226;
        const x = Math.max(8, Math.min(VW - W - 8, placeLeft ? cp.x - 24 - W : cp.x + 24));
        const y = Math.max(36, Math.min(VH - 90, cp.y - 14));
        return (
          <g style={{ pointerEvents: "none" }}>
            <foreignObject x={x} y={y} width={W} height={86} style={{ overflow: "visible" }}>
              <div // eslint-disable-line
                style={{ width: W, background: "var(--twin-callout-bg)", border: `1.5px solid ${ph.color}`, borderRadius: 10, padding: "8px 10px", boxShadow: `0 6px 20px rgba(0,0,0,0.55), 0 0 12px ${ph.color}33`, backdropFilter: "blur(10px)", fontFamily: "var(--font-sans)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: ph.color, color: "#04070f", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)" }}>{c.n}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-bright)" }}>{c.cn}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-soft)", lineHeight: 1.45 }}>{c.desc}</div>
              </div>
            </foreignObject>
          </g>
        );
      })()}

      {/* 👇 引导下一个停靠点 */}
      {nextStop && (() => {
        const c = CIRCLES.find((x) => x.phase === nextStop.phase);
        if (!c) return null;
        const newRound = nextStop.round !== (cur?.round ?? 1);
        const gp = circlePos(c);
        return (
          <g transform={`translate(${gp.x + 26} ${gp.y - 30})`} style={{ pointerEvents: "none" }}>
            <g style={{ animation: "ptr-bob 1.2s ease-in-out infinite" }}><text y={6} fontSize={18}>👇</text></g>
            {newRound && (
              <g transform="translate(8 18)">
                <rect x={-2} y={-11} width={84} height={16} rx={4} fill="rgba(245,158,11,0.16)" stroke="#f59e0b88" />
                <text x={40} y={1} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fbbf24" fontFamily="var(--font-mono)">第{nextStop.round}轮 · 重采</text>
              </g>
            )}
          </g>
        );
      })()}

      {/* 起步提示 */}
      {curIdx === 0 && (
        <text x={420} y={50} fontSize={13} fontWeight={800} fill="#7dd3fc" fontFamily="var(--font-sans)" style={{ animation: "blink 1.4s ease-in-out infinite" }}>→ 点击 ① 号圆圈开始(播放到该步结束)</text>
      )}

      <defs>
        <radialGradient id="sc-node-ok2" cx="50%" cy="40%" r="70%"><stop offset="0%" stopColor="#3a5180" /><stop offset="100%" stopColor="#1d2d50" /></radialGradient>
      </defs>
    </svg>
  );
}

/** 🧠 高稳智能体(自绘大脑,青色) */
function AgentBrain({ active, round }: { active: boolean; round: number }) {
  const col = "#2dd4bf";
  return (
    <g transform={`translate(${BRAIN.x} ${BRAIN.y})`} opacity={active ? 1 : 0.92}>
      {active && <circle r={40} fill="none" stroke={col} strokeWidth={1.4} className="alert-ring" opacity={0.5} />}
      <circle r={32} fill={`${col}1a`} stroke={col} strokeWidth={2.2} filter="url(#sc-glow)" />
      <g stroke={col} strokeWidth={1.7} fill={`${col}26`} strokeLinecap="round" strokeLinejoin="round">
        <path d="M0,-16 C-9,-18 -17,-10 -13,-2 C-19,2 -15,12 -6,10 C-3,15 3,15 6,10 C15,12 19,2 13,-2 C17,-10 9,-18 0,-16 Z" />
      </g>
      <g stroke={col} strokeWidth={1.3} fill="none" strokeLinecap="round" opacity={0.85}>
        <line x1={0} y1={-16} x2={0} y2={12} />
        <path d="M-10,-8 C-6,-6 -6,-1 -10,1" />
        <path d="M10,-8 C6,-6 6,-1 10,1" />
        <path d="M-9,4 C-5,6 -5,10 -8,11" />
        <path d="M9,4 C5,6 5,10 8,11" />
      </g>
      <text y={54} textAnchor="middle" fontSize={16} fontWeight={800} fill={col} fontFamily="var(--font-sans)">高稳智能体</text>
      <text y={70} textAnchor="middle" fontSize={10} fill="var(--text-mid)" fontFamily="var(--font-mono)" letterSpacing="0.08em">HIGH-STABILITY AGENT{round === 2 ? " · R2" : ""}</text>
    </g>
  );
}

/** 在网用户(UE 簇) */
function UeUsers({ gnbs }: { gnbs: { id: string; type: string }[] }) {
  const gnbPos = TYPE_NODE_BY["gNB"] ?? { x: 110, y: 440 };
  const ueYs = [360, 440, 520];
  return (
    <g>
      <text x={20} y={332} fontSize={11} fontWeight={700} fill="var(--text-mid)" fontFamily="var(--font-sans)">在网用户</text>
      <text x={20} y={350} fontSize={15} fontWeight={800} fill="var(--text-soft)" fontFamily="var(--font-sans)">128万</text>
      {ueYs.map((y, i) => (
        <g key={i}>
          <circle cx={36} cy={y} r={6} fill="#9aa7bd" opacity={0.85} />
          <line x1={42} y1={y} x2={gnbPos.x - NR} y2={gnbPos.y} stroke="#566175" strokeWidth={1} opacity={0.5} />
        </g>
      ))}
    </g>
  );
}

function trim(ax: number, ay: number, bx: number, by: number, ra: number, rb: number) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  return { x1: ax + ux * ra, y1: ay + uy * ra, x2: bx - ux * rb, y2: by - uy * rb };
}

export const StageCanvas = memo(StageCanvasBase);
