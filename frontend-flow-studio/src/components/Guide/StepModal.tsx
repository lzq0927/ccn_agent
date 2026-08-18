// ============================================================================
// StepModal —— 点击圆圈后弹出的浮层弹窗(定位在圆圈附近)
//   Studio:surface-2 实底 + 发丝线 + 单层暗投影;头部 = mono 步号 + eyebrow + 衬线标题;
//   连接线 = 靛蓝细虚线;入场 rise(spring 缓动)。多步内容逐步揭示并自动滚到底。
// ============================================================================

import { useEffect, useRef } from "react";
import { PHASES } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { guideCallout } from "../../guide/steps";
import { buildCoreTopo } from "./coreTopo";
import { AnomalyPanel, MatchPanel, ReasonPanel, DispatchPanel, EvalPanel, EvalFailPanel } from "./PhasePanels";

interface Props {
  scenario: Scenario;
  state: StoryState;
  round: number;
  /** 圆圈在画布中的位置(SVG viewBox 坐标) */
  circlePos: { x: number; y: number };
  /** 圆圈编号 */
  circleN: number;
  /** 全部圆圈位置(用于避开遮挡,选择最佳弹窗位置) */
  circles: { x: number; y: number }[];
  onClose: () => void;
}

export function StepModal({ scenario, state, round, circlePos, circleN, circles, onClose }: Props) {
  const phase = state.phaseIndex;
  const ph = PHASES[phase];
  const info = guideCallout(scenario, state);
  const VW = 1040, VH = 646;

  // 弹窗尺寸 + 智能定位:在 右/左/下/上 四个候选位中,选「遮挡其它圆圈 / 关键拓扑点最少」的;
  // 同分则取离点击圆圈最近的。关键拓扑点(根因 NE / 受影响 NE / 智能体枢纽)权重更高。
  const W = 300;
  const maxH = 452; // 定位用标称高度(实际高度按内容自适应,≤ maxH)
  // 关键点:根因 + 当前受影响 NE + 智能体枢纽(画布坐标,与 GuideCanvas 同布局)
  const keyPts: { x: number; y: number }[] = [{ x: 500, y: 34 }];
  {
    const core = buildCoreTopo(scenario.realGraph);
    for (const id of [...state.rootCause.nes, ...state.affectedNe]) {
      const n = core.nodeById[id];
      if (n) keyPts.push({ x: n.x, y: n.y });
    }
  }
  const clampX = (x: number) => Math.max(10, Math.min(VW - W - 10, x));
  const clampY = (y: number) => Math.max(66, Math.min(VH - 80, y));
  const raw = [
    { x: circlePos.x + 34, y: circlePos.y + 40, bias: -0.6 },        // 右(优先)
    { x: circlePos.x - W - 34, y: circlePos.y + 40, bias: 0.3 },     // 左
    { x: circlePos.x - W / 2, y: circlePos.y + 48, bias: 0 },        // 下
    { x: circlePos.x - W / 2, y: circlePos.y - maxH - 34, bias: 0.2 }, // 上
  ];
  let best = { mx: clampX(raw[0].x), my: clampY(raw[0].y), score: 99, dist: 99 };
  for (const r of raw) {
    const mx = clampX(r.x);
    const my = clampY(r.y);
    let score = r.bias ?? 0;
    for (const c of circles) {
      if (Math.abs(c.x - circlePos.x) < 4 && Math.abs(c.y - circlePos.y) < 4) continue; // 跳过被点击的圆圈
      if (c.x >= mx && c.x <= mx + W && c.y >= my && c.y <= my + maxH) score++;
    }
    // 关键信息(根因/受影响节点/枢纽)被盖 → 更重惩罚
    for (const k of keyPts) {
      if (k.x >= mx - 14 && k.x <= mx + W + 14 && k.y >= my - 14 && k.y <= my + maxH + 14) score += 2;
    }
    const dist = Math.hypot(mx + W / 2 - circlePos.x, my + maxH / 2 - circlePos.y);
    if (score < best.score || (score === best.score && dist < best.dist)) best = { mx, my, score, dist };
  }
  const modalX = best.mx;
  const modalY = best.my;
  // 连接线起点:弹窗边框上离圆圈最近的点
  const lineFromX = Math.max(modalX, Math.min(circlePos.x, modalX + W));
  const lineFromY = Math.max(modalY, Math.min(circlePos.y, modalY + maxH));

  // 内容体永远钉在最下面(显示最新信息):任何内容变化(推理链逐步揭示/图表展开)即滚到底
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const pin = () => { el.scrollTop = el.scrollHeight; };
    pin();
    const raf = requestAnimationFrame(pin);
    const mo = new MutationObserver(pin);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, []);

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* 连接线:弹窗 → 圆圈(靛蓝细虚线) */}
      <path
        d={`M ${lineFromX} ${lineFromY} Q ${(lineFromX + circlePos.x) / 2} ${(lineFromY + circlePos.y) / 2 + 14} ${circlePos.x} ${circlePos.y}`}
        fill="none" stroke="#7d8af2" strokeWidth={1} strokeDasharray="4 4" opacity={0.45}
      />
      <foreignObject x={modalX} y={modalY} width={W} height={maxH} style={{ overflow: "visible" }}>
        <div // eslint-disable-line
          className="step-modal"
          style={{
            width: W,
            maxHeight: maxH,
            padding: "14px 16px 13px",
            display: "flex",
            flexDirection: "column",
            animation: "rise var(--dur-3) var(--ease-out)",
            pointerEvents: "auto",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* 关闭按钮 */}
          <div
            onClick={onClose}
            style={{ position: "absolute", top: 9, right: 10, cursor: "pointer", color: "var(--ink-4)", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", transition: "color var(--dur-1) ease, background var(--dur-1) ease" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--ink-1)"; e.currentTarget.style.background = "var(--bg3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--ink-4)"; e.currentTarget.style.background = "transparent"; }}
            role="button"
            aria-label="关闭"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </div>

          {/* 步骤头部:mono 步号 + eyebrow + 轮次 */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7, paddingRight: 28, flexShrink: 0 }}>
            <span
              className="mono"
              style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg-inset)", border: `1px solid ${ph.color}77`, color: ph.glow, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 500, flexShrink: 0 }}
            >
              {circleN}
            </span>
            <span className="eyebrow" style={{ color: ph.glow, fontSize: 9 }}>{ph.en}</span>
            {round === 2 && <span className="tag mono" style={{ color: "#eec26b", borderColor: "#d9a13c66" }}>ROUND 2</span>}
          </div>
          <div className="font-display" style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)", lineHeight: 1.3, marginBottom: 10, flexShrink: 0 }}>{info.title}</div>

          {/* 内容:按相位委托给 PhasePanels */}
          <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
            <ModalBody scenario={scenario} state={state} phase={phase} round={round} info={info} />
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function ModalBody({ scenario, state, phase, round, info }: { scenario: Scenario; state: StoryState; phase: number; round: number; info: ReturnType<typeof guideCallout> }) {
  const ph = PHASES[phase];
  if (phase === 2) return <AnomalyPanel scenario={scenario} state={state} />;
  if (phase === 3) return <MatchPanel scenario={scenario} state={state} />;
  if (phase === 4) return <ReasonPanel scenario={scenario} state={state} />;
  if (phase === 5) return <DispatchPanel scenario={scenario} state={state} />;
  if (phase === 7 && state.loopBackKind) return <EvalFailPanel scenario={scenario} state={state} />;
  if (phase === 7) return <EvalPanel scenario={scenario} state={state} />;
  // 0/1/6:通用
  return (
    <>
      <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--ink-2)", marginBottom: 10 }}>{info.body}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {info.bullets.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: ph.color, flexShrink: 0, marginTop: 7 }} />{b}
          </div>
        ))}
      </div>
    </>
  );
}
