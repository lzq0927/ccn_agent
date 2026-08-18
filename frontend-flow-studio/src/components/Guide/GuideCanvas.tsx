// ============================================================================
// GuideCanvas —— 引导画布(全场景统一)· Studio「静谧仪器」版
//   核心:6 类网元(gNB/AMF/SMF/UDM/PCF/UPF)列流拓扑,各场景自身 fault 高亮(相位门控)。
//   场景 D:叠加左侧 3 类 UE + 右侧 AI平台1/2,UE→UPF、UPF→AI 上行连线。
//   顶部空白带:智能体枢纽 + 7 圆圈;点圆圈 → 弹窗。
//   视觉:网元统一中性(表面+发丝线),状态才着色(故障=红/根因=红虚线环/隔离=灰虚线框);
//   采集线=钢蓝细虚线,下发线=靛蓝实线;去辉光滤镜、去旋转环、去 emoji。
// ============================================================================

import { memo, useState } from "react";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { PHASES, STATUS, srColor } from "../../theme";
import { dispatchTargets } from "../../guide/steps";
import { getKpi, type WalkStop } from "../../story/director";
import { sample } from "../../data/kpi";
import { buildCoreTopo } from "./coreTopo";

const VW = 1040;
const VH = 646;
const NR = 20;

/** 采集/下发连线用色:数据=钢蓝 · 策略=靛蓝(与 Bridge 同语义) */
const COLLECT = "#6f9fd8";
const COLLECT_HI = "#9dc0e8";
const DISPATCH = "#7d8af2";
const DISPATCH_HI = "#a3acf9";

/**
 * 7 圆圈 + 智能体枢纽 单行顶带(y≈34,核心拓扑从 y≈140 起 → 顶带无节点,不遮挡)。
 * 弹窗 Always 取「下方」候选位,从根上避免「弹窗挡圆圈」。
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

/** D 专用叠加:3 类 UE(左)+ AI 平台(右) */
const UE_GROUPS = [
  { label: "Agent A", desc: "→gNB_1/2", x: 46, y: 232, fault: true, gnbs: ["gNB_1", "gNB_2"] },
  { label: "Agent B", desc: "→gNB_1/2", x: 46, y: 362, fault: false, gnbs: ["gNB_1", "gNB_2"] },
  { label: "普通手机", desc: "→gNB_1/2/3", x: 46, y: 492, fault: false, gnbs: ["gNB_1", "gNB_2", "gNB_3"] },
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
  /** false=当前步执行中/停顿,安静停在当前步、不显示引导箭头;true=停顿后引导下一步 */
  guideNext?: boolean;
}

function GuideCanvasBase({ scenario, state, stops, curIdx, onCircleClick, guideNext }: Props) {
  const cur = stops[curIdx];
  const nextStop = stops[curIdx + 1];
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
        <marker id="gc-arr-in" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill={COLLECT_HI} /></marker>
        <marker id="gc-arr-out" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M0,0 L9,5.5 L0,11 Z" fill={DISPATCH_HI} /></marker>
      </defs>

      {/* DC 框(仅核心网;UE/AI 平台在框外)—— 静止发丝线框 */}
      <rect x={70} y={150} width={880} height={420} rx={14} fill="transparent" stroke="var(--line)" strokeWidth={1} />
      <text x={82} y={143} fill="var(--ink-4)" fontSize={10.5} fontFamily="var(--font-sans)" fontWeight={500} letterSpacing="0.02em">DC1 · 5GC SA 核心网 — {scenario.cn}</text>

      {/* 核心业务流边(发丝线底纹;劣化/根因边语义着色) */}
      <g>
        {core.edges.map((e) => {
          const A = core.nodeById[e.a], B = core.nodeById[e.b];
          if (!A || !B) return null;
          const ll = trim(A.x, A.y, B.x, B.y, NR, NR);
          const ek = [e.a, e.b].sort().join("__");
          const sr = sample(kpi.edges[ek] ?? [0.999], simT);
          const degraded = sr < threshold && state.showAnomaly;
          const isFocus = focusSet.has(e.a) || focusSet.has(e.b) || rootSet.has(e.a) || rootSet.has(e.b);
          const color = degraded ? srColor(sr) : isFocus ? "var(--accent)" : "var(--line-2)";
          const w = degraded ? 1.6 : isFocus ? 1.4 : 1;
          const op = degraded ? 0.75 : isFocus ? 0.5 : 0.22;
          return <line key={e.id} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke={color} strokeWidth={w} strokeLinecap="round" opacity={op} />;
        })}
      </g>

      {/* D 叠加:UE→gNB 接入连线(AgentA 故障时红虚线) */}
      {isD && UE_GROUPS.flatMap((g) => g.gnbs.map((gid) => {
        const gn = core.nodeById[gid];
        if (!gn) return null;
        const faultLink = g.fault && reveal;
        const t = trim(g.x, g.y, gn.x, gn.y, 16, NR);
        return <line key={`ue-${g.label}-${gid}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={faultLink ? STATUS.fault : "var(--ink-5)"} strokeWidth={faultLink ? 1.3 : 0.9} opacity={faultLink ? 0.75 : 0.4} strokeDasharray={faultLink ? "5 4" : undefined} />;
      }))}

      {/* D 叠加:gNB→AMF 接入(gNB_1/2→AMF_1/2,gNB_3→AMF_3) */}
      {isD && GNB_AMF_D.flatMap(({ gnb, amfs }) => amfs.map((aid) => {
        const g = core.nodeById[gnb], a = core.nodeById[aid];
        if (!g || !a) return null;
        const t = trim(g.x, g.y, a.x, a.y, NR, NR);
        return <line key={`ga-${gnb}-${aid}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--line-2)" strokeWidth={1} opacity={0.5} />;
      }))}

      {/* D 叠加:UPF_1→AI 平台上行连线(AI1 故障时红虚线) */}
      {isD && (() => {
        const u = core.nodeById.UPF_1;
        if (!u) return null;
        return PLATFORMS.map((p) => {
          const faultLink = p.fault && reveal;
          const t = trim(u.x, u.y, p.x - 50, p.y, NR, 22);
          return <line key={`ai-${p.id}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={faultLink ? STATUS.fault : "var(--ink-5)"} strokeWidth={faultLink ? 1.5 : 1} opacity={faultLink ? 0.8 : 0.45} strokeDasharray={faultLink ? "5 4" : undefined} />;
        });
      })()}

      {/* 核心节点:中性表面 + 发丝线;状态才着色 */}
      <g fontFamily="var(--font-mono)">
        {core.nodes.map((n) => {
          const s = nodeState(n.id);
          const isFalseAlarm = falseAlarmNe === n.id;
          const ring = s.cordoned ? "var(--ink-4)" : s.bad ? STATUS.fault : isFalseAlarm ? STATUS.warning : s.focus ? "var(--accent)" : "var(--line-2)";
          const lw = s.bad || s.root ? 2 : s.focus ? 1.7 : 1.1;
          const fill = s.bad ? STATUS.fault + "12" : "var(--bg2)";
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              {s.bad && <circle r={NR} fill="none" stroke={STATUS.fault} strokeWidth={1.2} className="breathe" opacity={0.55} />}
              {s.root && <circle r={NR + 7} fill="none" stroke={STATUS.fault} strokeWidth={1.1} strokeDasharray="12 5" opacity={0.7} />}
              {isFalseAlarm && state.falseAlarmActive && (
                <g opacity={state.falseAlarmIntercepted ? 0.45 : 0.95}>
                  <circle r={NR + 6} fill="none" stroke={state.falseAlarmIntercepted ? STATUS.fault : STATUS.warning} strokeWidth={1.1} strokeDasharray="3 4" />
                  <text y={-NR - 11} textAnchor="middle" fontSize={8} fontWeight={500} fill={state.falseAlarmIntercepted ? STATUS.faultHi : STATUS.warningHi} fontFamily="var(--font-sans)">{state.falseAlarmIntercepted ? "✗ 误报拦截" : "? 误报嫌疑"}</text>
                </g>
              )}
              {s.cordoned && <rect x={-NR - 6} y={-NR - 6} width={(NR + 6) * 2} height={(NR + 6) * 2} rx={6} fill="none" stroke="var(--ink-4)" strokeWidth={1} strokeDasharray="3 3" />}
              <circle r={NR} fill={fill} stroke={ring} strokeWidth={lw} />
              <text y={3} textAnchor="middle" fontSize={9.5} fontWeight={500} fill={s.cordoned ? "var(--ink-4)" : "var(--ink-1)"}>{n.type}</text>
              <text y={NR + 13} textAnchor="middle" fontSize={9} fontWeight={400} fill={s.root ? STATUS.faultHi : s.cordoned ? "var(--ink-5)" : "var(--ink-3)"}>{n.id}</text>
              {s.overload && <text y={-NR - 6} textAnchor="middle" fontSize={8} fontWeight={500} fill={STATUS.faultHi} fontFamily="var(--font-sans)">过载</text>}
              {n.role !== "lb" && (
                <g transform={`translate(${NR - 1} ${-NR + 3})`}>
                  <circle r={5} fill={n.role === "master" ? "var(--accent)" : "transparent"} stroke={n.role === "master" ? "var(--accent)" : "var(--ink-4)"} strokeWidth={1.1} />
                  <text y={2.2} textAnchor="middle" fontSize={7} fontWeight={600} fill={n.role === "master" ? "var(--on-accent)" : "var(--ink-3)"} fontFamily="var(--font-sans)">{n.role === "master" ? "主" : "备"}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* D 叠加:UE 分组(左)—— 中性小圆,故障态红 */}
      {isD && UE_GROUPS.map((g) => {
        const faultShown = g.fault && reveal;
        return (
          <g key={g.label} transform={`translate(${g.x} ${g.y})`}>
            <circle r={16} fill={faultShown ? STATUS.fault + "14" : "var(--bg2)"} stroke={faultShown ? STATUS.fault : "var(--line-2)"} strokeWidth={faultShown ? 1.6 : 1.1} />
            <DeviceMark kind={g.label} fault={faultShown} />
            <text y={31} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={faultShown ? STATUS.faultHi : "var(--ink-2)"} fontFamily="var(--font-sans)">{g.label}</text>
            <text y={43} textAnchor="middle" fontSize={8} fill="var(--ink-4)">{g.desc}</text>
          </g>
        );
      })}

      {/* D 叠加:AI 平台(右)—— 中性框,故障态红 */}
      {isD && PLATFORMS.map((p) => {
        const faultShown = p.fault && reveal;
        return (
          <g key={p.id} transform={`translate(${p.x} ${p.y})`}>
            {faultShown && <rect x={-50} y={-25} width={100} height={50} rx={9} fill="none" stroke={STATUS.fault} strokeWidth={1.2} className="breathe" opacity={0.5} />}
            <rect x={-46} y={-21} width={92} height={42} rx={9} fill={faultShown ? STATUS.fault + "12" : "var(--bg2)"} stroke={faultShown ? STATUS.fault : "var(--line-2)"} strokeWidth={faultShown ? 1.8 : 1.1} />
            <text y={-2} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={faultShown ? STATUS.faultHi : "var(--ink-1)"} fontFamily="var(--font-display)">{p.label}</text>
            <text y={13} textAnchor="middle" fontSize={9} fontWeight={500} fill={faultShown ? STATUS.fault : STATUS.healthy} fontFamily="var(--font-sans)">{faultShown ? "故障 · 仅上行" : "正常"}</text>
          </g>
        );
      })}

      {/* 采集线(相位1):代表网元 → 智能体(钢蓝细虚线漂移) */}
      {phase === 1 && ["gNB_1", "AMF_1", "SMF_1", "UDM_1", "PCF_1", "UPF_1"].map((id, i) => {
        const n = core.nodeById[id];
        if (!n) return null;
        const t = trim(n.x, n.y, BRAIN.x, BRAIN.y + 28, NR + 2, 30);
        const pid = `cin-${id}`;
        return (
          <g key={pid}>
            <path id={pid} d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke="none" />
            <path d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} fill="none" stroke={COLLECT} strokeWidth={1.2} strokeLinecap="round" strokeDasharray="5 5" className="flow-dash" opacity={0.75} markerEnd="url(#gc-arr-in)" />
            <circle r={1.9} fill={COLLECT_HI}><animateMotion dur={`${1.4 + (i % 4) * 0.22}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${pid}`} /></animateMotion></circle>
          </g>
        );
      })}

      {/* 下发线(相位5):智能体 → 目标网元(靛蓝实线 + 漂移) */}
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
            <path d={d} fill="none" stroke={DISPATCH} strokeWidth={1.8} strokeLinecap="round" className="flow-dash-fast" opacity={0.9} markerEnd="url(#gc-arr-out)" />
            <circle r={2.6} fill={DISPATCH_HI}><animateMotion dur={`${0.9 + (i % 3) * 0.2}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${pid}`} /></animateMotion></circle>
          </g>
        );
      })}

      {/* 智能体枢纽 */}
      <AgentBrain active={phase === 1 || phase === 5} round={cur?.round ?? 1} />

      {/* 7 圆圈:pending=发丝线 / done=绿勾 / 当前=靛蓝实心 */}
      {CIRCLES.map((c) => {
        const guided = c.phase === guidePhase;
        const done = !guided && c.phase < guidePhase;
        const far = !guided && !done;
        const isHover = hover === c.phase;
        return (
          <g key={c.n} transform={`translate(${c.x} ${c.y})`} style={{ cursor: "pointer" }} onClick={() => onCircleClick(c.phase, { x: c.x, y: c.y }, c.n)} onMouseEnter={() => setHover(c.phase)} onMouseLeave={() => setHover(null)}>
            {guided && <circle r={25} fill="none" stroke={DISPATCH} strokeWidth={1.1} className="breathe" opacity={0.5} />}
            <circle data-testid={`circle-${c.n}`} r={18} fill={guided ? DISPATCH : far ? "var(--bg2)" : STATUS.healthy + "14"} stroke={isHover && far ? "var(--ink-3)" : guided ? DISPATCH : done ? STATUS.healthy : "var(--line-2)"} strokeWidth={guided ? 2 : 1.2} opacity={far ? 0.75 : 1} />
            <text y={5} textAnchor="middle" fontSize={done ? 13 : 14} fontWeight={500} fill={done ? STATUS.healthy : far ? "var(--ink-4)" : "var(--on-accent)"} fontFamily="var(--font-mono)">{done ? "✓" : c.n}</text>
            <text y={33} textAnchor="middle" fontSize={11.5} fontWeight={guided ? 600 : 500} fill={done ? "var(--ink-3)" : far ? "var(--ink-4)" : "var(--ink-1)"} fontFamily="var(--font-sans)">{c.cn}</text>
          </g>
        );
      })}

      {/* 悬停提示:bg3 实底 + 发丝线 */}
      {hover !== null && (() => {
        const c = CIRCLES.find((x) => x.phase === hover);
        if (!c) return null;
        const placeLeft = c.x > VW * 0.5;
        const W = 210;
        const x = Math.max(8, Math.min(VW - W - 8, placeLeft ? c.x - 24 - W : c.x + 24));
        const y = Math.max(36, Math.min(VH - 80, c.y - 14));
        return (
          <foreignObject x={x} y={y} width={W} height={70} style={{ overflow: "visible", pointerEvents: "none" }}>
            <div className="fpop" style={{ width: W }}>
              <div className="fpop-title">{c.cn}</div>
              <div className="fpop-sub">{c.desc}</div>
            </div>
          </foreignObject>
        );
      })()}

      {/* 引导箭头(仅停顿后、引导下一步时显示;细线下箭头呼吸) */}
      {!holding && nextStop && (() => {
        const c = CIRCLES.find((x) => x.phase === nextStop.phase);
        if (!c) return null;
        return (
          <g transform={`translate(${c.x + 27} ${c.y - 30})`} style={{ pointerEvents: "none" }} className="breathe">
            <path d="M6 0 L6 12 M2 8 L6 13 L10 8" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        );
      })()}

      {/* 起步提示(安静一行) */}
      {curIdx === 0 && (
        <text x={92} y={76} fontSize={11.5} fontWeight={500} fill="var(--ink-3)" fontFamily="var(--font-sans)">点击 ① 号圆圈开始 · ←/→ 步进 · Esc 关闭弹窗</text>
      )}
    </svg>
  );
}

/** UE 分组记号(细线设备图形,替代 emoji) */
function DeviceMark({ kind, fault }: { kind: string; fault: boolean }) {
  const col = fault ? STATUS.fault : "var(--ink-3)";
  if (kind === "Agent A") {
    return (
      <g fill="none" stroke={col} strokeWidth="1.3" strokeLinecap="round">
        <rect x="-5" y="-7" width="10" height="14" rx="2.2" />
        <path d="M-2.4 -1 A2.6 2.6 0 0 1 2.4 -1" />
        <circle cx="0" cy="3.4" r="0.9" fill={col} strokeWidth="0" />
      </g>
    );
  }
  if (kind === "Agent B") {
    return (
      <g fill="none" stroke={col} strokeWidth="1.3" strokeLinecap="round">
        <rect x="-6" y="-5" width="12" height="10" rx="1.8" />
        <path d="M6 -1 L9 -1" />
        <circle cx="0" cy="0" r="2.2" />
      </g>
    );
  }
  return (
    <g fill="none" stroke={col} strokeWidth="1.3" strokeLinecap="round">
      <rect x="-4.5" y="-8" width="9" height="16" rx="2" />
      <line x1="-1.8" y1="5.4" x2="1.8" y2="5.4" />
    </g>
  );
}

function AgentBrain({ active, round }: { active: boolean; round: number }) {
  const col = "var(--accent)";
  return (
    <g transform={`translate(${BRAIN.x} ${BRAIN.y})`} opacity={active ? 1 : 0.92}>
      {active && <circle r={37} fill="none" stroke={col} strokeWidth={1.1} className="breathe" opacity={0.45} />}
      <circle r={27} fill="var(--accent-wash)" stroke={col} strokeWidth={1.6} />
      <g stroke={col} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M0,-13.5 C-6.5,-15.5 -14,-7.5 -10.5,-2 C-16,2 -12.5,9.5 -5,8 C-3,12.5 3,12.5 5,8 C12.5,9.5 16,2 10.5,-2 C14,-7.5 6.5,-15.5 0,-13.5 Z" />
        <line x1={0} y1={-13.5} x2={0} y2={9.5} strokeWidth={1.1} opacity={0.8} />
        <path d="M-7.5,-5.5 C-3.8,-3.8 -3.8,0 -7.5,1.8" strokeWidth={1.1} opacity={0.8} />
        <path d="M7.5,-5.5 C3.8,-3.8 3.8,0 7.5,1.8" strokeWidth={1.1} opacity={0.8} />
      </g>
      <text y={45} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="var(--ink-1)" fontFamily="var(--font-display)">高稳智能体</text>
      {round === 2 && <text y={58} textAnchor="middle" fontSize={8.5} fill={STATUS.warningHi}>ROUND 2</text>}
    </g>
  );
}

export const GuideCanvas = memo(GuideCanvasBase);
