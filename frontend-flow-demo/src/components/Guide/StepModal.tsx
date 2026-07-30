// ============================================================================
// StepModal —— 点击圆圈后弹出的浮层弹窗(定位在圆圈附近)
//   紫色边框 + 半透明暗底 + backdrop blur;内容 = 步骤号+标题+PhasePanel。
//   有连接线从弹窗指向圆圈。关闭后回纯拓扑。
// ============================================================================

import { PHASES, STATUS } from "../../theme";
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
  onClose: () => void;
}

export function StepModal({ scenario, state, round, circlePos, circleN, onClose }: Props) {
  const phase = state.phaseIndex;
  const ph = PHASES[phase];
  const info = guideCallout(scenario, state);
  const VW = 1040, VH = 646;

  // 弹窗尺寸 + 智能定位:避开下一个圆圈和故障节点(AI平台1)
  const W = 280;
  const maxH = VH * 0.55; // 最大高度=画布55%
  // 故障点位置(AI平台1 在 960,220);下一个圆圈位置由 nextStop 决定
  const faultPoint = { x: 960, y: 220 };
  const circleRight = circlePos.x > VW * 0.45;
  // 默认放圆圈右侧;若右侧靠近故障点或右边缘,翻到左侧
  const rightBlocked = circleRight && (circlePos.x + 40 + W > VW - 20 || Math.abs(circlePos.x + 40 - faultPoint.x) < W);
  const placeLeft = !circleRight || rightBlocked;
  const modalX = placeLeft ? Math.max(10, circlePos.x - W - 35) : Math.min(VW - W - 10, circlePos.x + 35);
  // 垂直:默认偏上;如果圆圈在上半区则往下偏
  const modalY = circlePos.y < VH * 0.35 ? Math.max(10, circlePos.y + 20) : Math.max(10, circlePos.y - maxH * 0.4);
  // 连接线起点
  const lineFromX = placeLeft ? modalX + W : modalX;
  const lineFromY = modalY + 25;

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* 连接线:弹窗 → 圆圈 */}
      <path
        d={`M ${lineFromX} ${lineFromY} Q ${(lineFromX + circlePos.x) / 2} ${lineFromY + 20} ${circlePos.x + (placeLeft ? 20 : -20)} ${circlePos.y}`}
        fill="none" stroke="#7B68EE" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.5}
      />
      <foreignObject x={modalX} y={modalY} width={W} height={maxH} style={{ overflow: "visible" }}>
        <div // eslint-disable-line
          className="step-modal"
          style={{
            width: W,
            maxHeight: "100%",
            background: "rgba(10,14,26,0.96)",
            border: "1.5px solid #7B68EE",
            borderRadius: 12,
            padding: "14px 16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(123,104,238,0.2)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            fontFamily: "var(--font-sans)",
            color: "var(--text-soft)",
            overflowY: "auto",
            animation: "fpop-in 0.3s cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: "auto",
            position: "relative",
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingRight: 28 }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: ph.color, color: "#04070f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{circleN}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: ph.color, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{ph.en}</div>
            </div>
            {round === 2 && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, color: "#fbbf24", border: "1px solid #f59e0b88", background: "rgba(245,158,11,0.12)", fontFamily: "var(--font-mono)" }}>第②轮</span>}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-bright)", lineHeight: 1.2, marginBottom: 10 }}>{info.title}</div>

          {/* 内容:按相位委托给 PhasePanels */}
          <ModalBody scenario={scenario} state={state} phase={phase} round={round} info={info} />
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
