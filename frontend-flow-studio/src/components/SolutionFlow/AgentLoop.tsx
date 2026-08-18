// ============================================================================
// AgentLoop —— 高稳智能体内部闭环(3 Agent + Agent2 内部 6 步 + 置信度门 + 3 回环)
//   Studio 视觉:去辉光滤镜;层次 = 描边加重 + 语义色 + 表面提级;
//   步节点:pending=发丝线 / active=靛蓝描边+wash / done=绿描边;
//   回环线:语义色细虚线(amber=重试回路 / green=沉淀回流);粒子小而无光。
//   逻辑(推进状态机/布局常量)与旧版完全一致。
// ============================================================================

import { motion } from "framer-motion";
import { PIPELINE, GATE } from "../../data/plan";
import type { StoryState } from "../../story/types";

const W = 780;
const H = 740;

const A1 = { x: 15, y: 120, w: 170, h: 80, cx: 100, color: "#6f9fd8", cn: "Agent 1", sub: "数据采集" };
const A2 = { x: 265, y: 120, w: 200, h: 80, cx: 365, color: "#7d8af2", cn: "Agent 2", sub: "故障感知" };
const A3 = { x: 595, y: 120, w: 170, h: 80, cx: 680, color: "#35b57c", cn: "Agent 3", sub: "评估优化" };

const HW = 58;
const NH = 38;
const GHW = 36;
const GH = 40;
const R1Y = 370;
const R2Y = 590;

type SeqStep = { kind: "step"; n: number; x: number };

const GATE_X = 610;
const TOPROW: SeqStep[] = [
  { kind: "step", n: 1, x: 90 },
  { kind: "step", n: 2, x: 280 },
  { kind: "step", n: 3, x: 460 },
];
const BOTROW: SeqStep[] = [
  { kind: "step", n: 4, x: 610 },
  { kind: "step", n: 5, x: 390 },
  { kind: "step", n: 6, x: 170 },
];

const ACTIVE = "#7d8af2";   // 靛蓝:活动步
const ACTIVE_HI = "#a3acf9";
const DONE = "#35b57c";     // 绿:已完成
const RETRY = "#d9a13c";    // 琥珀:重试/回环
const SINK = "#35b57c";     // 沉淀回流(与 done 同语义)

type Status = "done" | "active" | "pending";

function stepState(phase: number, p: number): { doneUpTo: number; active: number | null; gate: Status } {
  // 两轮共用同一套 pending/active/done 推进逻辑(二轮重跑时未执行到的步保持 pending 灰)
  switch (phase) {
    case 0: return { doneUpTo: 0, active: null, gate: "pending" };
    case 1: return { doneUpTo: 0, active: null, gate: "pending" };
    case 2: return p < 0.5 ? { doneUpTo: 1, active: 2, gate: "pending" } : { doneUpTo: 2, active: 3, gate: "pending" };
    case 3: return { doneUpTo: 3, active: null, gate: "active" };
    case 4: return p < 0.6 ? { doneUpTo: 3, active: 4, gate: "done" } : { doneUpTo: 4, active: 5, gate: "done" };
    case 5: return { doneUpTo: 5, active: 6, gate: "done" };
    case 6: return { doneUpTo: 6, active: null, gate: "done" };
    default: return { doneUpTo: 6, active: null, gate: "done" };
  }
}

/** #4 状态色:pending=发丝线, active=靛蓝, done=绿 */
function statusColor(s: Status): string { return s === "pending" ? "var(--line-3)" : s === "done" ? DONE : ACTIVE; }
function statusWidth(s: Status, base: number): number { return s === "active" ? base + 0.6 : base; }
function statusMarker(s: Status): string | undefined { return s === "done" ? "url(#al-ad)" : s === "active" ? "url(#al-a)" : undefined; }

export function AgentLoop({ state }: { state: StoryState }) {
  const phase = state.phaseIndex;
  const p = state.phaseProgress;
  const round = state.round;
  const isR2 = round === 2;
  const ss = stepState(phase, p);
  const doneUpTo = ss.doneUpTo;
  const active = ss.active;
  const gate = ss.gate;
  // 两轮共用:活动步=active,已执行≤doneUpTo=done,未执行=pending
  const st = (n: number): Status => (n === active ? "active" : n <= doneUpTo ? "done" : "pending");

  // #4: phase6(Agent2恢复完成)即切换到 Agent3
  const activeAgent = phase === 1 ? 1 : phase >= 2 && phase <= 5 ? 2 : phase >= 6 ? 3 : 0;
  // 回环弧语义(director 算 loopBackKind):
  //   loop① (A2 ⑤ → A1):B/C 首轮⑤评估未通过 → 回 Agent1(走 Agent2 内部,不经 Agent3)
  //   loop② (A3 → A1):E 首轮 back-off 未收敛 → 经 Agent3 回 Agent1
  //   loop③ (A3 → A2):恢复成功 → 沉淀 skill(无回路 且 phase6+)
  const l1 = state.loopBackKind === "loop1";
  const l2 = state.loopBackKind === "loop2";
  const l3 = state.loopBackKind === null && phase >= 6;

  // ◇→④ 的状态(#3: 使用 st(4) 正确三态)
  const gateTo4 = st(4);

  return (
    <svg viewBox={"0 0 " + W + " " + H} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
      <defs>
        <marker id="al-a" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill={ACTIVE_HI} /></marker>
        <marker id="al-ad" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 Z" fill={DONE} opacity={0.85} /></marker>
        <marker id="al-ar" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill={RETRY} /></marker>
        <marker id="al-as" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill={SINK} /></marker>
      </defs>

      {/* 顶部回环弧 */}
      <LoopLine d={"M " + A3.cx + " " + A3.y + " C " + A3.cx + " 65, " + A2.cx + " 65, " + A2.cx + " " + A2.y} color={SINK} marker={"url(#al-as)"} on={l3} label={"③ 恢复成功 → 沉淀/优化 skill"} lx={(A3.cx + A2.cx) / 2} ly={55} />
      <LoopLine d={"M " + (A3.cx - 16) + " " + A3.y + " C " + (A3.cx - 16) + " 28, " + (A1.cx + 16) + " 28, " + (A1.cx + 16) + " " + A1.y} color={RETRY} marker={"url(#al-ar)"} on={l2} label={"② 恢复后未恢复 → Agent1 第二轮"} lx={(A3.cx + A1.cx) / 2} ly={18} />

      {/* Agent 盒子 */}
      <AgentBox a={A1} on={activeAgent === 1} icon={<RadarMark />} />
      <AgentBox a={A2} on={activeAgent === 2} icon={<BrainMark />} />
      <AgentBox a={A3} on={activeAgent === 3} icon={<CheckMark />} />

      {/* #2: A1→A2 lit when phase>=2; A2→A3 lit only when phase>=6 */}
      <FlowArrow x1={A1.x + A1.w} x2={A2.x} y={A1.y + A1.h / 2} label={"遥测数据"} active={phase >= 2} />
      <FlowArrow x1={A2.x + A2.w} x2={A3.x} y={A2.y + A2.h / 2} label={"结果"} active={phase >= 6} />

      {/* A2 -> pipeline (dim when A2 not active) */}
      <line x1={A2.cx} y1={A2.y + A2.h} x2={A2.cx} y2={250} stroke={activeAgent === 2 ? ACTIVE_HI : "var(--line-3)"} strokeWidth={activeAgent === 2 ? 1.8 : 1.1} strokeLinecap="round" markerEnd={activeAgent === 2 ? "url(#al-a)" : undefined} className={activeAgent === 2 ? "flow-dash" : undefined} />
      <text x={28} y={246} fontSize={12} fontWeight={600} fill="var(--ink-2)" fontFamily="var(--font-sans)">故障感知 · 内部六步</text>
      <text x={148} y={246} fontSize={8.5} fill="var(--ink-4)" fontFamily="var(--font-sans)" letterSpacing="0.06em">AGENT 2 PIPELINE</text>

      {/* 两轮徽标:首轮 / 二轮(琥珀呼应 loop②) */}
      {state.route === "autonomous" && (
        <g transform="translate(640, 244)">
          <rect x={-56} y={-11} width={112} height={20} rx={5} fill={isR2 ? RETRY + "16" : "var(--bg2)"} stroke={isR2 ? RETRY + "88" : "var(--line-2)"} strokeWidth={1} />
          <circle cx={-44} cy={-1} r={2.6} fill={isR2 ? RETRY : ACTIVE} />
          <text x={8} y={2.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={isR2 ? RETRY : "var(--ink-2)"} fontFamily="var(--font-sans)">{isR2 ? "第 ② 轮 · ROUND 2" : "第 ① 轮 · ROUND 1"}</text>
        </g>
      )}

      {/* pipeline frame */}
      <rect x={28} y={260} width={724} height={380} rx={12} fill="var(--bg-inset)" stroke="var(--line-2)" strokeWidth={1} strokeDasharray="2 6" />

      {/* nodes 先画(底层) */}
      {TOPROW.map((item) => (<Step key={"s" + item.n} x={item.x} y={R1Y} n={item.n} status={st(item.n)} />))}
      <Gate key="gate" x={GATE_X} y={R1Y} status={gate} />
      {BOTROW.map((item) => (<Step key={"s" + item.n} x={item.x} y={R2Y} n={item.n} status={st(item.n)} />))}

      {/* 连线 + 流动粒子画在节点之上 */}
      {/* Row1: ①→②→③→◇ (执行到哪亮到哪) */}
      <Trunk x1={TOPROW[0].x + HW} x2={TOPROW[1].x - HW} y={R1Y} status={st(2)} />
      <Trunk x1={TOPROW[1].x + HW} x2={TOPROW[2].x - HW} y={R1Y} status={st(3)} />
      <Trunk x1={TOPROW[2].x + HW} x2={GATE_X - GHW} y={R1Y} status={gate} />

      {/* ◇→④ 直线下行,正确三态 */}
      <line
        x1={GATE_X} y1={R1Y + GH} x2={BOTROW[0].x} y2={R2Y - NH}
        stroke={statusColor(gateTo4)} strokeWidth={statusWidth(gateTo4, 1.8)} strokeLinecap="round"
        strokeOpacity={gateTo4 === "done" ? 0.75 : 1}
        className={gateTo4 === "active" ? "flow-dash" : undefined}
        markerEnd={statusMarker(gateTo4)}
      />
      {gateTo4 === "active" && (
        <circle r={2.6} fill={ACTIVE_HI}>
          <animateMotion dur="1.3s" repeatCount="indefinite" path={`M ${GATE_X} ${R1Y + GH} L ${BOTROW[0].x} ${R2Y - NH}`} />
        </circle>
      )}

      {/* Row2 R→L: ④→⑤→⑥ */}
      <TrunkRev x1={BOTROW[0].x - HW} x2={BOTROW[1].x + HW} y={R2Y} status={st(5)} />
      <TrunkRev x1={BOTROW[1].x - HW} x2={BOTROW[2].x + HW} y={R2Y} status={st(6)} />

      {/* loop①:B/C 首轮⑤评估未通过 → 回 Agent1 补采(Agent2 内部回路) */}
      <LoopLine d={"M " + BOTROW[1].x + " " + (R2Y + NH) + " C " + BOTROW[1].x + " 680, 5 680, 5 " + (A1.y + A1.h)} color={RETRY} marker={"url(#al-ar)"} on={l1} label={"① ⑤评估未通过 → 回 Agent1 补采"} lx={(BOTROW[1].x + 5) / 2} ly={672} />
    </svg>
  );
}

/** Agent 几何记号(替代 emoji):采集=雷达弧 / 感知=脑回 / 评估=对勾圆 */
function RadarMark() {
  return (
    <g fill="none" strokeLinecap="round">
      <path d="M -6 5 A 8 8 0 0 1 6 5" strokeWidth="1.5" opacity="0.55" />
      <path d="M -3.5 5 A 5 5 0 0 1 3.5 5" strokeWidth="1.5" opacity="0.8" />
      <circle cx="0" cy="-4" r="1.8" strokeWidth="0" fill="currentColor" />
      <line x1="0" y1="-2" x2="0" y2="5" strokeWidth="1.3" />
    </g>
  );
}
function BrainMark() {
  return (
    <g fill="none" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M0,-8 C-3.4,-8 -5.6,-5.6 -5.6,-3 C-7.2,-2.2 -8,-0.6 -7.6,1.2 C-7,3.4 -4.8,4.6 -2.6,4.4 C-1.6,6 0,6.8 1.8,6.8 C3.6,6.8 5.2,6 6,4.4 C8.2,4.6 9.8,3.2 10,1.4 C10.2,-0.4 9,-2 7.4,-2.6 C7,-5.6 4.8,-8 0,-8 Z" />
      <path d="M0,-6.5 L0,5.5" strokeWidth="1" opacity="0.65" />
      <path d="M-3.6,-2.6 C-2.6,-2 -2.6,0 -3.6,0.6" strokeWidth="1" opacity="0.65" />
      <path d="M3.6,-2.6 C2.6,-2 2.6,0 3.6,0.6" strokeWidth="1" opacity="0.65" />
    </g>
  );
}
function CheckMark() {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle r="7.4" strokeWidth="1.4" />
      <path d="M-3.4 0.2 L-1 2.8 L3.6 -2.4" strokeWidth="1.6" />
    </g>
  );
}

function AgentBox({ a, on, icon }: { a: typeof A1; on: boolean; icon: React.ReactNode }) {
  return (
    <g transform={"translate(" + a.x + " " + a.y + ")"}>
      {on && <rect x={-4} y={-4} width={a.w + 8} height={a.h + 8} rx={12} fill="none" stroke={a.color} strokeWidth="1" className="breathe" opacity={0.6} />}
      <rect x={0} y={0} width={a.w} height={a.h} rx={10} fill={on ? a.color + "14" : "var(--bg2)"} stroke={on ? a.color : "var(--line-2)"} strokeWidth={on ? 1.6 : 1} />
      <g transform="translate(20 40)" color={on ? a.color : "var(--ink-4)"}>{icon}</g>
      <text x={40} y={35} fontSize={15} fontWeight={600} fill={on ? "var(--ink-1)" : "var(--ink-2)"} fontFamily="var(--font-display)">{a.cn}</text>
      <text x={40} y={56} fontSize={12} fontWeight={400} fill={on ? a.color : "var(--ink-4)"} fontFamily="var(--font-sans)">{a.sub}</text>
      {on && <motion.circle cx={a.w - 14} cy={16} r={3.4} fill={a.color} animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />}
    </g>
  );
}

/** #2: FlowArrow 支持灰/亮两种状态 */
function FlowArrow({ x1, x2, y, label, active }: { x1: number; x2: number; y: number; label: string; active: boolean }) {
  return (
    <g opacity={active ? 1 : 0.45}>
      <line x1={x1} y1={y} x2={x2 - 8} y2={y} stroke={active ? ACTIVE_HI : "var(--line-3)"} strokeWidth={active ? 1.6 : 1.1} strokeLinecap="round" className={active ? "flow-dash" : undefined} markerEnd={active ? "url(#al-a)" : undefined} />
      <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-sans)">{label}</text>
    </g>
  );
}

/** #3: Trunk 正确三态:pending=发丝线 / active=靛蓝+漂移+粒子 / done=绿静线 */
function Trunk({ x1, x2, y, status }: { x1: number; x2: number; y: number; status: Status }) {
  const active = status === "active";
  const ex = x2 - 8;
  return (
    <g>
      <line x1={x1} y1={y} x2={ex} y2={y} stroke={statusColor(status)} strokeWidth={statusWidth(status, 1.8)} strokeLinecap="round" strokeOpacity={status === "done" ? 0.75 : 1} className={active ? "flow-dash" : undefined} markerEnd={statusMarker(status)} />
      {active && (
        <circle r={2.6} fill={ACTIVE_HI}>
          <animateMotion dur="1.3s" repeatCount="indefinite" path={`M ${x1} ${y} L ${ex} ${y}`} />
        </circle>
      )}
    </g>
  );
}

function TrunkRev({ x1, x2, y, status }: { x1: number; x2: number; y: number; status: Status }) {
  const active = status === "active";
  const ex = x2 + 8;
  return (
    <g>
      <line x1={x1} y1={y} x2={ex} y2={y} stroke={statusColor(status)} strokeWidth={statusWidth(status, 1.8)} strokeLinecap="round" strokeOpacity={status === "done" ? 0.75 : 1} className={active ? "flow-dash" : undefined} markerEnd={statusMarker(status)} />
      {active && (
        <circle r={2.6} fill={ACTIVE_HI}>
          <animateMotion dur="1.3s" repeatCount="indefinite" path={`M ${x1} ${y} L ${ex} ${y}`} />
        </circle>
      )}
    </g>
  );
}

function Step({ x, y, n, status }: { x: number; y: number; n: number; status: Status }) {
  const step = PIPELINE[n - 1];
  const isActive = status === "active";
  const done = status === "done";
  const fill = isActive ? ACTIVE + "16" : done ? DONE + "0d" : "var(--bg2)";
  const stroke = isActive ? ACTIVE : done ? DONE + "88" : "var(--line-2)";
  return (
    <g transform={"translate(" + x + " " + y + ")"} opacity={status === "pending" ? 0.62 : 1}>
      {isActive && <rect x={-HW - 5} y={-NH - 5} width={(HW + 5) * 2} height={(NH + 5) * 2} rx={11} fill="none" stroke={ACTIVE} strokeWidth="1" className="breathe" opacity={0.55} />}
      <rect x={-HW} y={-NH} width={HW * 2} height={NH * 2} rx={9} fill={fill} stroke={stroke} strokeWidth={isActive ? 1.8 : 1.1} />
      <text x={-HW + 12} y={-NH + 23} fontSize={18} fontWeight={500} fill={isActive ? ACTIVE_HI : done ? DONE : "var(--ink-4)"} fontFamily="var(--font-mono)">{n}</text>
      <text x={8} y={-NH + 22} textAnchor="middle" fontSize={14} fontWeight={600} fill={isActive ? "var(--ink-1)" : done ? "var(--ink-2)" : "var(--ink-3)"} fontFamily="var(--font-display)">{step.cn}</text>
      <text x={0} y={NH - 8} textAnchor="middle" fontSize={10.5} fill={done ? DONE : "var(--ink-4)"} fontFamily="var(--font-sans)">{step.skill.cn}</text>
    </g>
  );
}

function Gate({ x, y, status }: { x: number; y: number; status: Status }) {
  const isActive = status === "active";
  const done = status === "done";
  const color = isActive ? "#d9a13c" : done ? DONE : "var(--line-2)";
  const fill = isActive ? "#d9a13c14" : done ? DONE + "0d" : "var(--bg2)";
  return (
    <g transform={"translate(" + x + " " + y + ")"}>
      {isActive && <rect x={-GHW - 7} y={-GH - 7} width={(GHW + 7) * 2} height={(GH + 7) * 2} rx={9} fill="none" stroke="#d9a13c" strokeWidth="1" className="breathe" opacity={0.55} />}
      <motion.polygon points={"0," + (-GH) + " " + GHW + ",0 0," + GH + " " + (-GHW) + ",0"} fill={fill} stroke={color} strokeWidth={isActive ? 1.8 : 1.1} animate={isActive ? { scale: [1, 1.035, 1] } : { scale: 1 }} transition={isActive ? { duration: 2.2, repeat: Infinity } : { duration: 0 }} style={{ transformOrigin: "center", transformBox: "fill-box" }} />
      <text x={0} y={-3} textAnchor="middle" fontSize={12} fontWeight={600} fill={isActive ? "#eec26b" : done ? "var(--ink-2)" : "var(--ink-3)"} fontFamily="var(--font-display)">{GATE.cn}</text>
      <text x={0} y={13} textAnchor="middle" fontSize={8.5} fill="var(--ink-4)" fontFamily="var(--font-sans)" letterSpacing="0.05em">{GATE.en}</text>
    </g>
  );
}

function LoopLine({ d, color, marker, on, label, lx, ly }: { d: string; color: string; marker: string; on: boolean; label: string; lx: number; ly: number }) {
  return (
    <g style={{ transition: "opacity var(--dur-2) ease" }} opacity={on ? 1 : 0.4}>
      <path d={d} fill="none" stroke={on ? color : "var(--line-3)"} strokeWidth={on ? 1.8 : 1.1} strokeLinecap="round" className={on ? "flow-dash" : undefined} markerEnd={on ? marker : undefined} />
      {on && (<circle r={3} fill={color}><animateMotion dur="3.6s" repeatCount="indefinite" path={d} /></circle>)}
      <g transform={"translate(" + lx + " " + ly + ")"} opacity={on ? 1 : 0.5}>
        <rect x={-150} y={-11} width={300} height={20} rx={5} fill={on ? color + "10" : "var(--bg2)"} stroke={on ? color + "44" : "var(--line)"} strokeWidth={1} />
        <text x={0} y={3.5} textAnchor="middle" fontSize={11.5} fontWeight={500} fill={on ? color : "var(--ink-4)"} fontFamily="var(--font-sans)">{label}</text>
      </g>
    </g>
  );
}
