// ============================================================================
// AgentLoop —— 高稳智能体「3 Agent + Agent2 内部 6 步(两行)+ 3 个回环连线」
//   6 步两行蛇形:上排 ①②③◇(→),◇ 下行换行,下排 ④⑤⑥(←)。
//   3 个回环连线弧(不新增框),分区不交叉、不压步骤:
//     ② A3→A1 恢复后未恢复 → Agent1        (顶部弧, phase 5-6 亮)
//     ③ A3→A2 恢复成功 → 沉淀 Agent2 skill (顶部弧, phase 7 亮)
//     ① ⑤→A1 输出评估不通过 → Agent1       (左下弧,沿左缘上行不压步骤, phase 4 亮)
//   字号加大、纵向拉宽填满;仅当前相位回环点亮。抽象方案,不绑场景。
// ============================================================================

import { motion } from "framer-motion";
import { PIPELINE, GATE } from "../../data/plan";
import type { StoryState } from "../../story/types";

const W = 880;
const H = 920; // 纵向大幅拉宽,匹配偏"高"的脑盒容器(宽高比≈0.96),填满不留白

const A1 = { x: 30, y: 110, w: 150, h: 64, cx: 105, color: "#38bdf8", cn: "Agent 1 · 数据采集", sub: "采集 · LLM 校验" };
const A2 = { x: 330, y: 110, w: 180, h: 64, cx: 420, color: "#2dd4bf", cn: "Agent 2 · 故障感知", sub: "6 步内部流程" };
const A3 = { x: 700, y: 110, w: 150, h: 64, cx: 775, color: "#22c55e", cn: "Agent 3 · 评估优化", sub: "比对 · 沉淀" };

const HW = 62;
const NH = 40;
const GHW = 38;
const GH = 42;
const R1Y = 330; // 上排节点 y
const R2Y = 530; // 下排节点 y
const TOPROW = [
  { kind: "step" as const, n: 1, x: 140 },
  { kind: "step" as const, n: 2, x: 310 },
  { kind: "step" as const, n: 3, x: 480 },
  { kind: "gate" as const, x: 640 },
];
const BOTROW = [
  { kind: "step" as const, n: 4, x: 640 },
  { kind: "step" as const, n: 5, x: 460 },
  { kind: "step" as const, n: 6, x: 280 },
];

const ACTIVE = "#38bdf8";
const DONE = "#22c55e";
const RETRY = "#f59e0b";
const SED = "#2dd4bf";

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

export function AgentLoop({ state }: { state: StoryState }) {
  const phase = state.phaseIndex;
  const p = state.phaseProgress;
  const { doneUpTo, active, gate } = stepState(phase, p);
  const st = (n: number): Status => (n === active ? "active" : n <= doneUpTo ? "done" : "pending");
  const activeAgent = phase === 1 ? 1 : phase >= 2 && phase <= 6 ? 2 : phase === 7 ? 3 : 0;
  // 回环仅在执行"到达"对应判定点时点亮:① 输出评估(step⑤)激活时;② 恢复后核验(phase5-6);③ 评估沉淀(phase7)
  const l1 = active === 5;
  const l2 = phase === 5 || phase === 6;
  const l3 = phase === 7;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
      <defs>
        <filter id="al-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <marker id="al-a" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill="#7dd3fc" /></marker>
        <marker id="al-ad" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10 Z" fill={DONE} opacity="0.9" /></marker>
        <marker id="al-ar" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill={RETRY} /></marker>
        <marker id="al-as" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill={SED} /></marker>
      </defs>

      {/* 顶部回环弧(在 Agent 行之上) */}
      <LoopLine d={`M ${A3.cx} ${A3.y} C ${A3.cx} 56, ${A2.cx} 56, ${A2.cx} ${A2.y}`} color={SED} marker="url(#al-as)" on={l3} label="③ 恢复成功 → 沉淀/优化 故障感知 skill" lx={(A3.cx + A2.cx) / 2} ly={48} />
      <LoopLine d={`M ${A3.cx - 18} ${A3.y} C ${A3.cx - 18} 24, ${A1.cx + 18} 24, ${A1.cx + 18} ${A1.y}`} color={RETRY} marker="url(#al-ar)" on={l2} label="② 恢复后未达预期 → 调整策略 / 重新采集" lx={(A3.cx + A1.cx) / 2} ly={16} />

      {/* Agent 盒子 + 正向流 */}
      <FlowArrow x1={A1.x + A1.w} x2={A2.x} y={A1.y + A1.h / 2} label="遥测数据" />
      <FlowArrow x1={A2.x + A2.w} x2={A3.x} y={A2.y + A2.h / 2} label="恢复指令+结果" />
      <AgentBox a={A1} on={activeAgent === 1} icon="📡" />
      <AgentBox a={A2} on={activeAgent === 2} icon="🧠" />
      <AgentBox a={A3} on={activeAgent === 3} icon="✅" />

      {/* Agent2 → 6 步 连接箭头 */}
      <line x1={A2.cx} y1={A2.y + A2.h} x2={A2.cx} y2={230} stroke="#7dd3fc" strokeWidth="2.4" strokeLinecap="round" markerEnd="url(#al-a)" />
      <text x={42} y={226} fontSize={11} fontWeight={700} fill="#5eead4" fontFamily="var(--font-mono)" letterSpacing="0.06em">故障感知 Agent · 内部 6 步流程</text>

      {/* 6 步主干框(两行蛇形整体包裹) */}
      <rect x={56} y={262} width={668} height={340} rx={12} fill="rgba(45,212,191,0.04)" stroke="rgba(45,212,191,0.35)" strokeWidth="1.4" strokeDasharray="3 6" />

      {/* 上排主干 ①→②→③→◇(L→R) */}
      <Trunk x1={TOPROW[0].x + HW} x2={TOPROW[1].x - HW} y={R1Y} status={st(2)} />
      <Trunk x1={TOPROW[1].x + HW} x2={TOPROW[2].x - HW} y={R1Y} status={st(3)} />
      <Trunk x1={TOPROW[2].x + HW} x2={(TOPROW[3] as { x: number }).x - GHW} y={R1Y} status={gate} />
      {/* ◇ → ④ 下行(蛇形换行) */}
      <line x1={TOPROW[3].x} y1={R1Y + GH} x2={BOTROW[0].x} y2={R2Y - NH} stroke={st(4) === "pending" ? "rgba(148,163,184,0.32)" : ACTIVE} strokeWidth={active === 4 ? 3 : 2.4} strokeLinecap="round" className={st(4) !== "pending" ? "flow-dash" : undefined} markerEnd="url(#al-a)" />
      {/* 下排主干 ④→⑤→⑥(R→L) */}
      <TrunkL x1={BOTROW[0].x - HW} x2={BOTROW[1].x + HW} y={R2Y} status={st(5)} />
      <TrunkL x1={BOTROW[1].x - HW} x2={BOTROW[2].x + HW} y={R2Y} status={st(6)} />

      {/* 节点 */}
      {TOPROW.map((it) => (it.kind === "gate" ? <Gate key="gate" x={it.x} y={R1Y} status={gate} /> : <Step key={`s${it.n}`} x={it.x} y={R1Y} n={it.n} status={st(it.n)} />))}
      {BOTROW.map((it) => <Step key={`s${it.n}`} x={it.x} y={R2Y} n={it.n} status={st(it.n)} />)}

      {/* 左下回环弧 ① ⑤→A1(沿左缘 x=70 上行,不压步骤) */}
      <LoopLine d={`M ${BOTROW[1].x} ${R2Y + NH} C ${BOTROW[1].x} 740, 70 740, 70 ${A1.y + A1.h}`} color={RETRY} marker="url(#al-ar)" on={l1} label="① 策略/评估未收敛 → 换策略或补采数据" lx={(BOTROW[1].x + 70) / 2} ly={732} />

      {/* Storage */}
      <g transform={`translate(${W - 156} ${H - 30})`}>
        <rect x={0} y={-15} width={140} height={26} rx={6} fill="rgba(10,16,30,0.5)" stroke="rgba(148,163,184,0.3)" />
        <text x={10} y={3} fontSize={11}>🗄</text>
        <text x={28} y={3} fontSize={9} fontWeight={700} fill="var(--text-detail)" fontFamily="var(--font-mono)">Storage · 共享</text>
      </g>
    </svg>
  );
}

function AgentBox({ a, on, icon }: { a: typeof A1; on: boolean; icon: string }) {
  return (
    <g transform={`translate(${a.x} ${a.y})`}>
      {on && <rect x={-4} y={-4} width={a.w + 8} height={a.h + 8} rx={12} fill="none" stroke={a.color} strokeWidth="1.2" className="alert-ring" opacity={0.6} />}
      <rect x={0} y={0} width={a.w} height={a.h} rx={10} fill={on ? `${a.color}1f` : "rgba(10,16,30,0.45)"} stroke={on ? a.color : "rgba(148,163,184,0.3)"} strokeWidth={on ? 2 : 1.4} filter={on ? "url(#al-glow)" : undefined} />
      <text x={12} y={28} fontSize={18}>{icon}</text>
      <text x={36} y={27} fontSize={13.5} fontWeight={800} fill={on ? "var(--text-bright)" : "var(--text-soft)"} fontFamily="var(--font-sans)">{a.cn}</text>
      <text x={36} y={45} fontSize={10} fill={on ? a.color : "var(--text-mid)"} fontFamily="var(--font-mono)">{a.sub}</text>
      {on && <motion.circle cx={a.w - 12} cy={14} r={4} fill={a.color} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />}
    </g>
  );
}

function FlowArrow({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2 - 10} y2={y} stroke="#7dd3fc" strokeWidth="2.6" strokeLinecap="round" className="flow-dash" markerEnd="url(#al-a)" />
      <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fontSize={9.5} fill="var(--text-mid)" fontFamily="var(--font-mono)">{label}</text>
    </g>
  );
}

function Trunk({ x1, x2, y, status }: { x1: number; x2: number; y: number; status: Status }) {
  const color = status === "pending" ? "rgba(148,163,184,0.3)" : status === "done" ? DONE : ACTIVE;
  return <line x1={x1} y1={y} x2={x2 - 8} y2={y} stroke={color} strokeWidth={status === "active" ? 3.2 : 2.6} strokeLinecap="round" strokeOpacity={status === "done" ? 0.8 : 1} className={status !== "pending" ? "flow-dash" : undefined} markerEnd={status === "done" ? "url(#al-ad)" : status === "active" ? "url(#al-a)" : undefined} filter={status === "active" ? "url(#al-glow)" : undefined} />;
}
function TrunkL({ x1, x2, y, status }: { x1: number; x2: number; y: number; status: Status }) {
  const color = status === "pending" ? "rgba(148,163,184,0.3)" : status === "done" ? DONE : ACTIVE;
  return <line x1={x1} y1={y} x2={x2 + 8} y2={y} stroke={color} strokeWidth={status === "active" ? 3.2 : 2.6} strokeLinecap="round" strokeOpacity={status === "done" ? 0.8 : 1} className={status !== "pending" ? "flow-dash" : undefined} markerEnd={status === "done" ? "url(#al-ad)" : status === "active" ? "url(#al-a)" : undefined} filter={status === "active" ? "url(#al-glow)" : undefined} />;
}

function Step({ x, y, n, status }: { x: number; y: number; n: number; status: Status }) {
  const step = PIPELINE[n - 1];
  const active = status === "active";
  const done = status === "done";
  const fill = active ? ACTIVE : done ? `${DONE}1a` : "transparent";
  const stroke = active ? ACTIVE : done ? `${DONE}88` : "rgba(148,163,184,0.32)";
  return (
    <g transform={`translate(${x} ${y})`} opacity={status === "pending" ? 0.6 : 1}>
      {active && <rect x={-HW - 5} y={-NH - 5} width={(HW + 5) * 2} height={(NH + 5) * 2} rx={11} fill="none" stroke={ACTIVE} strokeWidth="1.2" className="alert-ring" opacity={0.6} />}
      <rect x={-HW} y={-NH} width={HW * 2} height={NH * 2} rx={9} fill={fill} stroke={stroke} strokeWidth={active ? 2.4 : 1.6} filter={active ? "url(#al-glow)" : undefined} />
      <text x={-HW + 12} y={-NH + 22} fontSize={20} fontWeight={800} fill={active ? "#04070f" : done ? DONE : "var(--text-mid)"} fontFamily="var(--font-mono)">{n}</text>
      <text x={6} y={-NH + 21} textAnchor="middle" fontSize={15.5} fontWeight={700} fill={active ? "#04070f" : done ? "var(--text-bright)" : "var(--text-soft)"} fontFamily="var(--font-sans)">{step.cn}</text>
      <text x={0} y={NH - 9} textAnchor="middle" fontSize={9.5} fill={active ? "#04070f" : done ? DONE : "var(--text-mid)"} fontFamily="var(--font-mono)">⚡{step.skill.cn}</text>
    </g>
  );
}

function Gate({ x, y, status }: { x: number; y: number; status: Status }) {
  const active = status === "active";
  const done = status === "done";
  const color = active ? "#f59e0b" : done ? DONE : "rgba(148,163,184,0.34)";
  const fill = active ? "#f59e0b" : done ? `${DONE}1f` : "transparent";
  return (
    <g transform={`translate(${x} ${y})`}>
      {active && <rect x={-GHW - 7} y={-GH - 7} width={(GHW + 7) * 2} height={(GH + 7) * 2} rx={9} fill="none" stroke="#f59e0b" strokeWidth="1.2" className="alert-ring" opacity={0.6} />}
      <motion.polygon points={`0,${-GH} ${GHW},0 0,${GH} ${-GHW},0`} fill={fill} stroke={color} strokeWidth={active ? 2.4 : 1.6} filter={active ? "url(#al-glow)" : undefined} animate={active ? { scale: [1, 1.06, 1] } : { scale: 1 }} transition={active ? { duration: 1.6, repeat: Infinity } : { duration: 0 }} style={{ transformOrigin: "center", transformBox: "fill-box" }} />
      <text x={0} y={-3} textAnchor="middle" fontSize={11} fontWeight={800} fill={active ? "#04070f" : done ? "var(--text-bright)" : "var(--text-soft)"} fontFamily="var(--font-sans)">{GATE.cn}</text>
      <text x={0} y={12} textAnchor="middle" fontSize={7.5} fill={active ? "#04070f" : "var(--text-mid)"} fontFamily="var(--font-mono)">{GATE.en}</text>
    </g>
  );
}

function LoopLine({ d, color, marker, on, label, lx, ly }: { d: string; color: string; marker: string; on: boolean; label: string; lx: number; ly: number }) {
  return (
    <g style={{ transition: "opacity 0.4s ease" }} opacity={on ? 1 : 0.5}>
      <path d={d} fill="none" stroke={on ? color : "rgba(148,163,184,0.5)"} strokeWidth={on ? 2.8 : 1.8} strokeLinecap="round" className={on ? "flow-dash" : undefined} markerEnd={on ? marker : undefined} filter={on ? "url(#al-glow)" : undefined} />
      {on && (
        <circle r={3.8} fill={color} filter="url(#al-glow)">
          <animateMotion dur="3.4s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      <g transform={`translate(${lx} ${ly})`} opacity={on ? 1 : 0.7}>
        <rect x={-132} y={-10} width={264} height={19} rx={5} fill={on ? `${color}1a` : "rgba(10,16,30,0.4)"} stroke={on ? `${color}66` : "rgba(148,163,184,0.25)"} strokeWidth={0.9} />
        <text x={0} y={3} textAnchor="middle" fontSize={10} fontWeight={700} fill={on ? color : "var(--text-mid)"} fontFamily="var(--font-sans)">{label}</text>
      </g>
    </g>
  );
}
