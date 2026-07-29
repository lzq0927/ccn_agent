// ============================================================================
// GuidedStage —— 右侧交互式拓扑演示(AWS 风:图上点圆圈,有引导)
//   管理「走查停靠点」(stops):轮次感知 —— 两轮场景轮1 跑完(含恢复失败)再到轮2。
//   点圆圈 = playUntil 该步结束(从当前时刻播放到该相位停靠点后自动暂停,不从头到尾自播)。
//   场景条 → [左 InfoPanel(步骤完整内容,窄)| 右 StageCanvas(脑+拓扑+圆圈+引导)]
//        → 底部 KPI 条 → footer。
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { PHASES, srColor } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { StageCanvas } from "./StageCanvas";
import { InfoPanel } from "./InfoPanel";
import { KpiStrip } from "./KpiStrip";
import { walkStops, getKpi } from "../../story/director";
import { sample } from "../../data/kpi";

interface Props {
  scenario: Scenario;
  state: StoryState;
  scenarios: Scenario[];
  currentScenarioId: string;
  onSelectScenario: (id: string) => void;
  /** 播放到目标时刻后自动暂停(点圆圈用) */
  onPlayUntil: (t: number) => void;
  /** 瞬时定位(重置/后退用) */
  onSeekTime: (t: number) => void;
}

export function GuidedStage({ scenario, state, scenarios, currentScenarioId, onSelectScenario, onPlayUntil, onSeekTime }: Props) {
  const stops = useMemo(() => walkStops(scenario), [scenario.id]);
  const [idx, setIdx] = useState(0);

  // 切场景 → 回到第 0 步(时钟自身会复位到 0)
  useEffect(() => { setIdx(0); }, [scenario.id]);

  // 推进到停靠点 i:播放到该步结束(不瞬时跳)
  const advanceTo = (i: number) => {
    const t = Math.max(0, Math.min(stops.length - 1, i));
    setIdx(t);
    onPlayUntil(stops[t].time);
  };

  // 键盘 ←/→
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") advanceTo(idx + 1);
      else if (e.key === "ArrowLeft") {
        const t = Math.max(0, idx - 1);
        setIdx(t);
        onSeekTime(stops[t].time);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cur = stops[idx];
  const phase = state.phaseIndex;
  const info = PHASES[phase];
  const sr = sample(getKpi(scenario).overall, state.simT);

  // 点圆圈 = 播放到该相位下一个停靠点的末尾(只播到这步结束)
  const goToPhase = (p: number) => {
    let i = idx + 1;
    while (i < stops.length && stops[i].phase !== p) i++;
    if (i < stops.length) { advanceTo(i); return; }
    // 已是该相位最后停靠点 → 回到该相位首个停靠点(重温,瞬时)
    const first = stops.findIndex((s) => s.phase === p);
    if (first >= 0) { setIdx(first); onSeekTime(stops[first].time); }
  };
  const reset = () => { setIdx(0); onSeekTime(0); };

  return (
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderTop: `2px solid ${info.color}`, boxShadow: `inset 0 2px 0 ${info.color}1f`, transition: "border-color 0.4s ease" }}>
      {/* 标题 + 场景条 */}
      <div style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", background: "var(--accent-a12)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>案例演示</span>
        <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>CASE</span>
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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {cur?.round === 2 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: "#fbbf24", border: "1px solid #f59e0b88", background: "rgba(245,158,11,0.12)", fontFamily: "var(--font-mono)" }}>第②轮</span>}
          <span style={{ fontSize: 11, color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>整网 SR <b style={{ color: srColor(sr) }}>{(sr * 100).toFixed(2)}%</b></span>
        </div>
      </div>

      {/* 主体:左 InfoPanel(窄) | 右 拓扑画布(界面的一部分) */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: "0 0 296px", minWidth: 260, maxWidth: 340 }}>
          <InfoPanel scenario={scenario} state={state} round={cur?.round ?? 1} />
        </div>
        <div style={{ flex: "1 1 auto", minWidth: 0, position: "relative", background: "var(--twin-readout-bg)" }}>
          <StageCanvas scenario={scenario} state={state} graph={scenario.realGraph} stops={stops} curIdx={idx} onGoToPhase={goToPhase} />
        </div>
      </div>

      {/* 底部 KPI 条 */}
      <KpiStrip scenario={scenario} state={state} />

      {/* footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel-solid)" }}>
        <button onClick={reset} className="btn" style={{ padding: "5px 12px", fontSize: 11 }}>↻ 重新开始</button>
        <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
          STEP {phase >= 1 && phase <= 7 ? phase : 0} · 停靠 {idx + 1}/{stops.length}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-mid)" }}>
          {idx === 0 ? "👉 点击图中闪烁的 ① 号圆圈开始(播放到该步结束)" : idx >= stops.length - 1 ? "🎉 演示完成,可点击圆圈重温" : "👉 点击 👇 指向的下一个圆圈继续"}
        </span>
      </div>
    </div>
  );
}
