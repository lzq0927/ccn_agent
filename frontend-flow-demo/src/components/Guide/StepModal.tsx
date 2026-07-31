// ============================================================================
// StepModal —— 点击圆圈后弹出的浮层弹窗(定位在圆圈附近)
//   紫色边框 + 半透明暗底 + backdrop blur;内容 = 步骤号+标题+PhasePanel。
//   有连接线从弹窗指向圆圈。关闭后回纯拓扑。
//   加高弹窗 + 多步内容(推理链)逐步揭示并自动滚到底,内容不一次性全出。
// ============================================================================

import { useEffect, useRef } from "react";
import { PHASES } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { guideCallout } from "../../guide/steps";
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

  // 弹窗尺寸 + 智能定位:在 右/左/下/上 四个候选位中,选「遮挡其它圆圈最少」的;
  // 同分则取离点击圆圈最近的。保证弹窗不挡住其它圆圈按钮。
  const W = 300;
  const maxH = 452; // 加高(原 VH*0.55≈355),内容尽量完整
  const clampX = (x: number) => Math.max(10, Math.min(VW - W - 10, x));
  const clampY = (y: number) => Math.max(8, Math.min(VH - maxH + 30, y));
  const raw = [
    { x: circlePos.x + 34, y: circlePos.y - maxH / 2 },       // 右
    { x: circlePos.x - W - 34, y: circlePos.y - maxH / 2 },    // 左
    { x: circlePos.x - W / 2, y: circlePos.y + 34 },           // 下
    { x: circlePos.x - W / 2, y: circlePos.y - maxH - 34 },    // 上
  ];
  let best = { mx: clampX(raw[0].x), my: clampY(raw[0].y), score: 99, dist: 99 };
  for (const r of raw) {
    const mx = clampX(r.x);
    const my = clampY(r.y);
    let score = 0;
    for (const c of circles) {
      if (Math.abs(c.x - circlePos.x) < 4 && Math.abs(c.y - circlePos.y) < 4) continue; // 跳过被点击的圆圈
      if (c.x >= mx && c.x <= mx + W && c.y >= my && c.y <= my + maxH) score++;
    }
    const dist = Math.hypot(mx + W / 2 - circlePos.x, my + maxH / 2 - circlePos.y);
    if (score < best.score || (score === best.score && dist < best.dist)) best = { mx, my, score, dist };
  }
  const modalX = best.mx;
  const modalY = best.my;
  // 连接线起点:弹窗边框上离圆圈最近的点
  const lineFromX = Math.max(modalX, Math.min(circlePos.x, modalX + W));
  const lineFromY = Math.max(modalY, Math.min(circlePos.y, modalY + maxH));

  // 多步面板打开时滚到底(显示最新一步)
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* 连接线:弹窗 → 圆圈 */}
      <path
        d={`M ${lineFromX} ${lineFromY} Q ${(lineFromX + circlePos.x) / 2} ${(lineFromY + circlePos.y) / 2 + 14} ${circlePos.x} ${circlePos.y}`}
        fill="none" stroke="#7B68EE" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.5}
      />
      <foreignObject x={modalX} y={modalY} width={W} height={maxH} style={{ overflow: "visible" }}>
        <div // eslint-disable-line
          className="step-modal"
          style={{
            width: W,
            height: maxH,
            background: "rgba(10,14,26,0.96)",
            border: "1.5px solid #7B68EE",
            borderRadius: 12,
            padding: "13px 15px 12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(123,104,238,0.2)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            fontFamily: "var(--font-sans)",
            color: "var(--text-soft)",
            display: "flex",
            flexDirection: "column",
            animation: "fpop-in 0.3s cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: "auto",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* 关闭按钮 */}
          <div
            onClick={onClose}
            style={{ position: "absolute", top: 8, right: 10, cursor: "pointer", fontSize: 16, color: "#7B68EE", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(123,104,238,0.1)" }}
          >
            ✕
          </div>

          {/* 步骤头部 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, paddingRight: 28, flexShrink: 0 }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: ph.color, color: "#04070f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{circleN}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: ph.color, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{ph.en}</div>
            </div>
            {round === 2 && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, color: "#fbbf24", border: "1px solid #f59e0b88", background: "rgba(245,158,11,0.12)", fontFamily: "var(--font-mono)" }}>第②轮</span>}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-bright)", lineHeight: 1.2, marginBottom: 9, flexShrink: 0 }}>{info.title}</div>

          {/* 内容:按相位委托给 PhasePanels */}
          <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 3 }}>
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
  if (phase === 3) return <MatchPanel scenario={scenario} />;
  if (phase === 4) return <ReasonPanel scenario={scenario} state={state} />;
  if (phase === 5) return <DispatchPanel scenario={scenario} state={state} />;
  if (phase === 7 && round === 1) return <EvalFailPanel scenario={scenario} state={state} />;
  if (phase === 7) return <EvalPanel scenario={scenario} />;
  // 0/1/6:通用
  return (
    <>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-soft)", marginBottom: 10 }}>{info.body}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {info.bullets.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--text-detail)", lineHeight: 1.45 }}>
            <span style={{ color: ph.color, fontWeight: 800, flexShrink: 0 }}>▸</span><span>{b}</span>
          </div>
        ))}
      </div>
    </>
  );
}
