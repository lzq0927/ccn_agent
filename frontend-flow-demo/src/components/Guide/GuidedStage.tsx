// ============================================================================
// GuidedStage —— 右侧交互式拓扑演示(弹窗式,去掉固定 InfoPanel)
//   场景条 → StageCanvas(全宽,拓扑+圆圈+采集/下发,右上角浮「重新开始」) → 弹窗(点击圆圈弹出) → KPI条
//   点击圆圈 = playUntil 该步结束 + 弹出 StepModal(内容在圆圈附近)
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { PHASES, srColor } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { GuideCanvas, CIRCLES } from "./GuideCanvas";
import { StepModal } from "./StepModal";
import { KpiStrip } from "./KpiStrip";
import { walkStops, getKpi } from "../../story/director";
import { sample } from "../../data/kpi";

interface Props {
  scenario: Scenario;
  state: StoryState;
  scenarios: Scenario[];
  currentScenarioId: string;
  onSelectScenario: (id: string) => void;
  onPlayUntil: (t: number) => void;
  onSeekTime: (t: number) => void;
  /** LIVE 模式:圆圈点击触发后端阶段动作(DEMO 模式 undefined) */
  onPhaseTrigger?: (phase: number) => void;
  /** LIVE 模式开启:圆圈点击改为「定位+触发后端」,不再动画推进 DEMO 时间线 */
  isLive?: boolean;
  /** DEMO 时钟是否正在播放(playUntil 动画中)—— 用于「当前步执行完再引导下一步」 */
  playing?: boolean;
}

export function GuidedStage({ scenario, state, scenarios, currentScenarioId, onSelectScenario, onPlayUntil, onSeekTime, onPhaseTrigger, isLive, playing }: Props) {
  const stops = useMemo(() => walkStops(scenario), [scenario.id]);
  const [idx, setIdx] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCirclePos, setModalCirclePos] = useState({ x: 400, y: 80 });
  const [modalCircleN, setModalCircleN] = useState(1);

  useEffect(() => { setIdx(0); setModalOpen(false); }, [scenario.id]);

  // 引导时机:播放中 → 闪烁停在当前步(不显示 👇);播放结束 + 700ms 停顿后才引导下一步
  const [guideNext, setGuideNext] = useState(true);
  useEffect(() => {
    if (playing) { setGuideNext(false); return; }
    const id = setTimeout(() => setGuideNext(true), 700);
    return () => clearTimeout(id);
  }, [playing, scenario.id]);

  const advanceTo = (i: number) => {
    const t = Math.max(0, Math.min(stops.length - 1, i));
    setIdx(t);
    onPlayUntil(stops[t].time);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") advanceTo(idx + 1);
      else if (e.key === "ArrowLeft") {
        const t = Math.max(0, idx - 1);
        setIdx(t);
        onSeekTime(stops[t].time);
      } else if (e.key === "Escape") {
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cur = stops[idx];
  const phase = state.phaseIndex;
  const info = PHASES[phase];
  const sr = sample(getKpi(scenario).overall, state.simT);

  // 点圆圈:DEMO=playUntil 动画推进;LIVE=定位(snap)+ 触发后端阶段(不动画,逐步生成/消费)
  const onCircleClick = (p: number, pos: { x: number; y: number }, n: number) => {
    setModalCirclePos(pos);
    setModalCircleN(n);
    if (isLive) {
      // LIVE:直接定位到该相位(不动画穿过其他相位)+ 触发后端
      const first = stops.findIndex((s) => s.phase === p);
      const target = first >= 0 ? first : idx;
      setIdx(target);
      if (first >= 0) onSeekTime(stops[first].time);
      onPhaseTrigger?.(p);
      setModalOpen(true);
      return;
    }
    let i = idx + 1;
    while (i < stops.length && stops[i].phase !== p) i++;
    if (i < stops.length) {
      advanceTo(i);
    } else {
      const first = stops.findIndex((s) => s.phase === p);
      if (first >= 0) { setIdx(first); onSeekTime(stops[first].time); }
    }
    onPhaseTrigger?.(p);
    setModalOpen(true);
  };

  const reset = () => { setIdx(0); setModalOpen(false); onSeekTime(0); };

  return (
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderTop: `2px solid ${info.color}`, boxShadow: `inset 0 2px 0 ${info.color}1f`, transition: "border-color 0.4s ease" }}>
      {/* 案例条 */}
      <div style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", background: "var(--accent-a12)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-bright)", whiteSpace: "nowrap" }}>案例演示</span>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {scenarios.map((s) => {
            const active = s.id === currentScenarioId;
            return (
              <button key={s.id} onClick={() => onSelectScenario(s.id)} title={s.intro ?? s.tagline} className={active ? "btn active" : "btn"} style={{ padding: "5px 11px", fontSize: 11.5, textTransform: "none", letterSpacing: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <b style={{ fontSize: 13 }}>{s.id}</b><span>{s.cn.length > 10 ? s.cn.slice(0, 10) + "…" : s.cn}</span>
              </button>
            );
          })}
        </div>
        {/* 当前场景一句话目标 —— 填充按钮与整网 KPI 之间的空白 */}
        <div style={{ flex: 1, minWidth: 0, marginLeft: 10, fontSize: 11, color: "var(--text-mid)", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={scenario.intro ?? scenario.tagline}>
          {scenario.objective ?? scenario.tagline}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {cur?.round === 2 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: "#fbbf24", border: "1px solid #f59e0b88", background: "rgba(245,158,11,0.12)", fontFamily: "var(--font-mono)" }}>第②轮</span>}
          <span style={{ fontSize: 11, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>整网 KPI <b style={{ color: srColor(sr) }}>{(sr * 100).toFixed(2)}%</b></span>
        </div>
      </div>

      {/* 主体:全宽拓扑画布 + 弹窗 overlay(全场景统一 GuideCanvas;D 叠加 UE/AI 平台) */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--twin-readout-bg)" }}>
        {/* 重新开始:浮在画布(案例演示条下方框)右上角 */}
        <button onClick={reset} title="重新开始" className="btn" style={{ position: "absolute", top: 8, right: 8, zIndex: 6, padding: "4px 10px", fontSize: 11, background: "rgba(10,14,26,0.7)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}>↻ 重新开始</button>
        <GuideCanvas scenario={scenario} state={state} stops={stops} curIdx={idx} onCircleClick={onCircleClick} guideNext={guideNext} />
        {/* 弹窗 overlay */}
        {modalOpen && (
          <svg viewBox="0 0 1040 646" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
            <StepModal
              scenario={scenario}
              state={state}
              round={cur?.round ?? 1}
              circlePos={modalCirclePos}
              circleN={modalCircleN}
              circles={CIRCLES.map((c) => ({ x: c.x, y: c.y }))}
              onClose={() => setModalOpen(false)}
            />
          </svg>
        )}
      </div>

      {/* KPI 条 */}
      <KpiStrip scenario={scenario} state={state} />
    </div>
  );
}
