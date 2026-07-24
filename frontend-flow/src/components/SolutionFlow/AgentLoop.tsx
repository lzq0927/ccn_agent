import { motion } from "framer-motion";
import { PIPELINE, GATE } from "../../data/plan";
import type { StoryState } from "../../story/types";

const W = 780;
const H = 880;

const A1 = { x: 15, y: 120, w: 170, h: 80, cx: 100, color: "#38bdf8", cn: "Agent 1", sub: "数据采集" };
const A2 = { x: 265, y: 120, w: 200, h: 80, cx: 365, color: "#2dd4bf", cn: "Agent 2", sub: "故障感知" };
const A3 = { x: 595, y: 120, w: 170, h: 80, cx: 680, color: "#22c55e", cn: "Agent 3", sub: "评估优化" };

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

const ACTIVE = "#38bdf8";
const DONE = "#22c55e";
const RETRY = "#f59e0b";
const SED = "#2dd4bf";
const GRAY = "rgba(148,163,184,0.35)";

type Status = "done" | "active" | "pending";

function stepState(phase: number, p: number): { doneUpTo: number; active: number | null; gate: Status } {
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

/** #4 状态色:pending=灰, active=蓝, done=绿 */
function statusColor(s: Status): string { return s === "pending" ? GRAY : s === "done" ? DONE : ACTIVE; }
function statusWidth(s: Status, base: number): number { return s === "active" ? base + 0.8 : base; }
function statusMarker(s: Status): string | undefined { return s === "done" ? "url(#al-ad)" : s === "active" ? "url(#al-a)" : undefined; }

export function AgentLoop({ state }: { state: StoryState }) {
  const phase = state.phaseIndex;
  const p = state.phaseProgress;
  const ss = stepState(phase, p);
  const doneUpTo = ss.doneUpTo;
  const active = ss.active;
  const gate = ss.gate;
  const st = (n: number): Status => (n === active ? "active" : n <= doneUpTo ? "done" : "pending");

  // #4: phase6(Agent2恢复完成)即切换到 Agent3
  const activeAgent = phase === 1 ? 1 : phase >= 2 && phase <= 5 ? 2 : phase >= 6 ? 3 : 0;
  // #1/#3: D(guided)恢复成功→loop③亮(phase7); E(autonomous)恢复后未恢复→loop②亮(phase5-6)
  const l1 = false;
  const l2 = (phase === 5 || phase === 6) && state.route === "autonomous";
  const l3 = phase === 7;

  // ◇→④ 的状态(#3: 使用 st(4) 正确三态)
  const gateTo4 = st(4);

  return (
    <svg viewBox={"0 0 " + W + " " + H} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
      <defs>
        <filter id="al-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <marker id="al-a" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill="#7dd3fc" /></marker>
        <marker id="al-ad" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 Z" fill={DONE} opacity={0.9} /></marker>
        <marker id="al-ar" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill={RETRY} /></marker>
        <marker id="al-as" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill={SED} /></marker>
        <marker id="al-up" markerWidth="10" markerHeight="10" refX="5" refY="2" orient="auto"><path d="M0,10 L5,2 L10,10 Z" fill="#fb7185" /></marker>
      </defs>

      {/* #1: 恢复策略的红线去掉,策略反映到指令上行(Bridge 的指令↑箭头) */}

      {/* 顶部回环弧 */}
      <LoopLine d={"M " + A3.cx + " " + A3.y + " C " + A3.cx + " 65, " + A2.cx + " 65, " + A2.cx + " " + A2.y} color={SED} marker={"url(#al-as)"} on={l3} label={"③ 恢复成功 -> 沉淀/优化 skill"} lx={(A3.cx + A2.cx) / 2} ly={55} />
      <LoopLine d={"M " + (A3.cx - 16) + " " + A3.y + " C " + (A3.cx - 16) + " 28, " + (A1.cx + 16) + " 28, " + (A1.cx + 16) + " " + A1.y} color={RETRY} marker={"url(#al-ar)"} on={l2} label={"② 恢复后未恢复 -> Agent1 第二轮"} lx={(A3.cx + A1.cx) / 2} ly={18} />

      {/* Agent 盒子 */}
      <AgentBox a={A1} on={activeAgent === 1} icon={"📡"} />
      <AgentBox a={A2} on={activeAgent === 2} icon={"🧠"} />
      <AgentBox a={A3} on={activeAgent === 3} icon={"✅"} />

      {/* #2: A1→A2 lit when phase>=2; A2→A3 lit only when phase>=6 */}
      <FlowArrow x1={A1.x + A1.w} x2={A2.x} y={A1.y + A1.h / 2} label={"遥测数据"} active={phase >= 2} />
      <FlowArrow x1={A2.x + A2.w} x2={A3.x} y={A2.y + A2.h / 2} label={"结果"} active={phase >= 6} />

      {/* A2 -> pipeline (dim when A2 not active) */}
      <line x1={A2.cx} y1={A2.y + A2.h} x2={A2.cx} y2={250} stroke={activeAgent === 2 ? "#7dd3fc" : GRAY} strokeWidth={activeAgent === 2 ? 2.2 : 1.4} strokeLinecap="round" markerEnd={activeAgent === 2 ? "url(#al-a)" : undefined} className={activeAgent === 2 ? "flow-dash" : undefined} />
      <text x={28} y={246} fontSize={11} fontWeight={700} fill={activeAgent === 2 ? "#5eead4" : "var(--text-faint)"} fontFamily="var(--font-mono)" letterSpacing="0.05em">{"故障感知 Agent · 内部 6 步流程"}</text>

      {/* pipeline frame */}
      <rect x={28} y={260} width={724} height={380} rx={12} fill="rgba(45,212,191,0.04)" stroke="rgba(45,212,191,0.28)" strokeWidth={1.3} strokeDasharray="3 7" />

      {/* Row1: ①→②→③→◇ (#3: 全部使用 st() 三态,执行到哪亮到哪) */}
      <Trunk x1={TOPROW[0].x + HW} x2={TOPROW[1].x - HW} y={R1Y} status={st(2)} />
      <Trunk x1={TOPROW[1].x + HW} x2={TOPROW[2].x - HW} y={R1Y} status={st(3)} />
      <Trunk x1={TOPROW[2].x + HW} x2={GATE_X - GHW} y={R1Y} status={gate} />

      {/* #3: ◇→④ 直线下行,正确三态(pending=灰/done=绿/active=蓝) */}
      <line
        x1={GATE_X} y1={R1Y + GH} x2={BOTROW[0].x} y2={R2Y - NH}
        stroke={statusColor(gateTo4)} strokeWidth={statusWidth(gateTo4, 2.4)} strokeLinecap="round"
        strokeOpacity={gateTo4 === "done" ? 0.8 : 1}
        className={gateTo4 !== "pending" ? "flow-dash" : undefined}
        markerEnd={statusMarker(gateTo4)}
        filter={gateTo4 === "active" ? "url(#al-glow)" : undefined}
      />

      {/* Row2 R→L: ④→⑤→⑥ */}
      <TrunkRev x1={BOTROW[0].x - HW} x2={BOTROW[1].x + HW} y={R2Y} status={st(5)} />
      <TrunkRev x1={BOTROW[1].x - HW} x2={BOTROW[2].x + HW} y={R2Y} status={st(6)} />

      {/* nodes */}
      {TOPROW.map((item) => (<Step key={"s" + item.n} x={item.x} y={R1Y} n={item.n} status={st(item.n)} />))}
      <Gate key="gate" x={GATE_X} y={R1Y} status={gate} />
      {BOTROW.map((item) => (<Step key={"s" + item.n} x={item.x} y={R2Y} n={item.n} status={st(item.n)} />))}

      {/* #1: loop① 永不亮(D/E 的 ⑤始终通过),弧度加大 */}
      <LoopLine d={"M " + BOTROW[1].x + " " + (R2Y + NH) + " C " + BOTROW[1].x + " 830, 5 830, 5 " + (A1.y + A1.h)} color={RETRY} marker={"url(#al-ar)"} on={l1} label={"① 策略探索 / 换策略补采数据"} lx={(BOTROW[1].x + 5) / 2} ly={822} />
    </svg>
  );
}

function AgentBox({ a, on, icon }: { a: typeof A1; on: boolean; icon: string }) {
  return (
    <g transform={"translate(" + a.x + " " + a.y + ")"}>
      {on && <rect x={-4} y={-4} width={a.w + 8} height={a.h + 8} rx={12} fill="none" stroke={a.color} strokeWidth="1.1" className="alert-ring" opacity={0.55} />}
      <rect x={0} y={0} width={a.w} height={a.h} rx={10} fill={on ? a.color + "1f" : "rgba(10,16,30,0.45)"} stroke={on ? a.color : "rgba(148,163,184,0.3)"} strokeWidth={on ? 2 : 1.4} filter={on ? "url(#al-glow)" : undefined} />
      <text x={14} y={36} fontSize={20}>{icon}</text>
      <text x={40} y={35} fontSize={15} fontWeight={800} fill={on ? "var(--text-bright)" : "var(--text-soft)"} fontFamily="var(--font-sans)">{a.cn}</text>
      <text x={40} y={55} fontSize={11.5} fontWeight={600} fill={on ? a.color : "var(--text-mid)"} fontFamily="var(--font-sans)">{a.sub}</text>
      {on && <motion.circle cx={a.w - 14} cy={16} r={5} fill={a.color} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />}
    </g>
  );
}

/** #2: FlowArrow 支持灰/亮两种状态 */
function FlowArrow({ x1, x2, y, label, active }: { x1: number; x2: number; y: number; label: string; active: boolean }) {
  return (
    <g opacity={active ? 1 : 0.4}>
      <line x1={x1} y1={y} x2={x2 - 8} y2={y} stroke={active ? "#7dd3fc" : GRAY} strokeWidth={active ? 2 : 1.3} strokeLinecap="round" className={active ? "flow-dash" : undefined} markerEnd={active ? "url(#al-a)" : undefined} />
      <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fontSize={9.5} fill={active ? "var(--text-mid)" : "var(--text-faint)"} fontFamily="var(--font-mono)">{label}</text>
    </g>
  );
}

/** #3: Trunk 正确三态:pending=灰 / active=蓝+脉冲 / done=绿 */
function Trunk({ x1, x2, y, status }: { x1: number; x2: number; y: number; status: Status }) {
  return <line x1={x1} y1={y} x2={x2 - 8} y2={y} stroke={statusColor(status)} strokeWidth={statusWidth(status, 2.4)} strokeLinecap="round" strokeOpacity={status === "done" ? 0.8 : 1} className={status !== "pending" ? "flow-dash" : undefined} markerEnd={statusMarker(status)} filter={status === "active" ? "url(#al-glow)" : undefined} />;
}

function TrunkRev({ x1, x2, y, status }: { x1: number; x2: number; y: number; status: Status }) {
  return <line x1={x1} y1={y} x2={x2 + 8} y2={y} stroke={statusColor(status)} strokeWidth={statusWidth(status, 2.4)} strokeLinecap="round" strokeOpacity={status === "done" ? 0.8 : 1} className={status !== "pending" ? "flow-dash" : undefined} markerEnd={statusMarker(status)} filter={status === "active" ? "url(#al-glow)" : undefined} />;
}

function Step({ x, y, n, status }: { x: number; y: number; n: number; status: Status }) {
  const step = PIPELINE[n - 1];
  const isActive = status === "active";
  const done = status === "done";
  const fill = isActive ? ACTIVE : done ? DONE + "1a" : "transparent";
  const stroke = isActive ? ACTIVE : done ? DONE + "88" : "rgba(148,163,184,0.32)";
  return (
    <g transform={"translate(" + x + " " + y + ")"} opacity={status === "pending" ? 0.6 : 1}>
      {isActive && <rect x={-HW - 5} y={-NH - 5} width={(HW + 5) * 2} height={(NH + 5) * 2} rx={11} fill="none" stroke={ACTIVE} strokeWidth="1.1" className="alert-ring" opacity={0.55} />}
      <rect x={-HW} y={-NH} width={HW * 2} height={NH * 2} rx={9} fill={fill} stroke={stroke} strokeWidth={isActive ? 2.3 : 1.5} filter={isActive ? "url(#al-glow)" : undefined} />
      <text x={-HW + 12} y={-NH + 23} fontSize={20} fontWeight={800} fill={isActive ? "#04070f" : done ? DONE : "var(--text-mid)"} fontFamily="var(--font-mono)">{n}</text>
      <text x={6} y={-NH + 22} textAnchor="middle" fontSize={14} fontWeight={700} fill={isActive ? "#04070f" : done ? "var(--text-bright)" : "var(--text-soft)"} fontFamily="var(--font-sans)">{step.cn}</text>
      <text x={0} y={NH - 9} textAnchor="middle" fontSize={9} fill={isActive ? "#04070f" : done ? DONE : "var(--text-mid)"} fontFamily="var(--font-mono)">{step.skill.cn}</text>
    </g>
  );
}

function Gate({ x, y, status }: { x: number; y: number; status: Status }) {
  const isActive = status === "active";
  const done = status === "done";
  const color = isActive ? "#f59e0b" : done ? DONE : "rgba(148,163,184,0.34)";
  const fill = isActive ? "#f59e0b" : done ? DONE + "1f" : "transparent";
  return (
    <g transform={"translate(" + x + " " + y + ")"}>
      {isActive && <rect x={-GHW - 7} y={-GH - 7} width={(GHW + 7) * 2} height={(GH + 7) * 2} rx={9} fill="none" stroke="#f59e0b" strokeWidth="1.1" className="alert-ring" opacity={0.55} />}
      <motion.polygon points={"0," + (-GH) + " " + GHW + ",0 0," + GH + " " + (-GHW) + ",0"} fill={fill} stroke={color} strokeWidth={isActive ? 2.3 : 1.5} filter={isActive ? "url(#al-glow)" : undefined} animate={isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }} transition={isActive ? { duration: 1.6, repeat: Infinity } : { duration: 0 }} style={{ transformOrigin: "center", transformBox: "fill-box" }} />
      <text x={0} y={-3} textAnchor="middle" fontSize={11} fontWeight={800} fill={isActive ? "#04070f" : done ? "var(--text-bright)" : "var(--text-soft)"} fontFamily="var(--font-sans)">{GATE.cn}</text>
      <text x={0} y={12} textAnchor="middle" fontSize={7.5} fill={isActive ? "#04070f" : "var(--text-mid)"} fontFamily="var(--font-mono)">{GATE.en}</text>
    </g>
  );
}

function LoopLine({ d, color, marker, on, label, lx, ly }: { d: string; color: string; marker: string; on: boolean; label: string; lx: number; ly: number }) {
  return (
    <g style={{ transition: "opacity 0.4s ease" }} opacity={on ? 1 : 0.4}>
      <path d={d} fill="none" stroke={on ? color : GRAY} strokeWidth={on ? 2.8 : 1.4} strokeLinecap="round" className={on ? "flow-dash" : undefined} markerEnd={on ? marker : undefined} filter={on ? "url(#al-glow)" : undefined} />
      {on && (<circle r={4.5} fill={color} filter="url(#al-glow)"><animateMotion dur="3.4s" repeatCount="indefinite" path={d} /></circle>)}
      <g transform={"translate(" + lx + " " + ly + ")"} opacity={on ? 1 : 0.55}>
        <rect x={-150} y={-12} width={300} height={22} rx={6} fill={on ? color + "1a" : "rgba(10,16,30,0.3)"} stroke={on ? color + "66" : "rgba(148,163,184,0.15)"} strokeWidth={0.8} />
        <text x={0} y={4} textAnchor="middle" fontSize={13} fontWeight={700} fill={on ? color : "var(--text-faint)"} fontFamily="var(--font-sans)">{label}</text>
      </g>
    </g>
  );
}
