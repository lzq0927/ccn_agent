// ============================================================================
// StepAxis —— 闭环步骤长轴(页面底部全宽 · 单行紧凑版,参考 frontend-show Timeline)
//   按当前场景的实际步骤数(walkStops:A=8 · B/C=12 · D=14)画出一行步骤,
//   每格按时长比例分布 → rAF 驱动的竖型 playhead(光标)与格边界对齐,看清运行到哪。
//   每格:步号 + 阶段名 + 超短结论;当前步高亮;轮1→轮2 画 ↻ 回路分隔。
// ============================================================================

import { Fragment, memo, useMemo } from "react";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { walkStops } from "../../story/director";
import { PHASES } from "../../theme";

/** 2 字阶段短标(与 guide/steps 的 shortLabel 一致) */
const SHORT_LABEL = ["稳态", "采集", "检测", "匹配", "推理", "恢复", "验证", "评估"];

/** 各相位通用超短结论(≤5 字) */
const PHASE_BRIEF: Record<number, string> = {
  0: "全网健康",
  1: "遥测就绪",
  2: "检出异常",
  3: "路由分流",
  4: "锁定根因",
  5: "执行恢复",
  6: "KPI 回升",
  7: "评估反馈",
};

/** 相位 4(根因)场景化超短结论 */
const REASON_BRIEF: Record<string, string> = {
  A: "锁定 UPF_1",
  B: "锁定 SMF_1",
  C: "锁定用户群",
  D: "锁定 UDM_1",
};
/** 相位 5(恢复)场景化超短结论 */
const RECOV_BRIEF: Record<string, string> = {
  A: "切换 UPF POOL",
  B: "切换健康 SMF",
  C: "通知 UE 换路",
  D: "AMF/SMF 限流",
};

/** 每步超短结论(评估相位区分轮次:轮1 未通过回灌 / 轮2 通过沉淀) */
function stepBrief(s: Scenario, phase: number, round: 1 | 2, twoRound: boolean): string {
  if (phase === 7) {
    if (twoRound) return round === 1 ? "未通过·回灌" : "通过·沉淀";
    return "通过·沉淀";
  }
  if (phase === 4) return REASON_BRIEF[s.id] ?? "锁定根因";
  if (phase === 5) {
    if (twoRound && round === 1) return s.id === "D" ? "未收敛" : "—";
    return RECOV_BRIEF[s.id] ?? "执行恢复";
  }
  return PHASE_BRIEF[phase] ?? "";
}

interface Props {
  scenario: Scenario;
  state: StoryState;
  /** rAF 驱动的播放头 div(useStoryClock 维护,left 由时钟直写) */
  playheadRef?: { current: HTMLDivElement | null };
}

function StepAxisBase({ scenario, state, playheadRef }: Props) {
  const stops = useMemo(() => walkStops(scenario), [scenario]);
  const twoRound = useMemo(() => stops.some((s) => s.round === 2), [stops]);
  const r2Start = useMemo(() => stops.findIndex((s) => s.round === 2), [stops]);
  const curIdx = Math.max(
    0,
    stops.findIndex((s) => s.phase === state.phaseIndex && s.round === state.round),
  );
  const total = stops.length;

  // 每段时长(由相邻停靠点时间差近似)→ 用于按比例分配格宽,playhead 才能与格对齐
  const segDurs = useMemo(
    () => stops.map((s, i) => (i === 0 ? s.time + 0.05 : Math.max(0.05, s.time - stops[i - 1].time))),
    [stops],
  );
  const totalDur = useMemo(() => segDurs.reduce((a, b) => a + b, 0) || 1, [segDurs]);
  // 轮1→轮2 分隔位置(占 totalDur 的百分比)—— 不占格宽,避免 playhead 错位
  const boundaryPct = twoRound && r2Start > 0 ? (stops[r2Start - 1].time / totalDur) * 100 : null;

  return (
    <div className="hud" style={{ padding: "5px 10px", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", flexShrink: 0 }}>
        闭环步骤轴
      </span>
      <div style={{ flex: 1, display: "flex", gap: 3, height: 32, minWidth: 0, position: "relative" }}>
        {stops.map((stop, i) => {
          const ph = PHASES[stop.phase];
          const status: "done" | "cur" | "future" = i < curIdx ? "done" : i === curIdx ? "cur" : "future";
          const isR2 = stop.round === 2;
          const brief = stepBrief(scenario, stop.phase, stop.round, twoRound);
          return (
            <Fragment key={`${stop.phase}-${stop.round}-${i}`}>
              <div
                title={`${i + 1}. ${ph.cn}${isR2 ? " · 第②轮" : ""} — ${brief}`}
                style={{
                  flex: `${Math.max(1, segDurs[i])} 1 0`,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: 5,
                  padding: "1px 3px",
                  background: status === "cur" ? `${ph.color}26` : status === "done" ? `${ph.color}12` : "transparent",
                  border: `1px solid ${status === "cur" ? ph.color : status === "done" ? `${ph.color}55` : "var(--border)"}`,
                  boxShadow: status === "cur" ? `0 0 8px ${ph.color}55` : "none",
                  opacity: status === "future" ? 0.5 : 1,
                  transition: "all 0.25s ease",
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 800, lineHeight: 1.15, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", color: status === "future" ? "var(--text-faint)" : status === "cur" ? "var(--text-bright)" : "var(--text-soft)" }}>
                  <span style={{ color: status === "future" ? "var(--text-faint)" : ph.glow, fontFamily: "var(--font-mono)", marginRight: 3 }}>{i + 1}</span>
                  {SHORT_LABEL[stop.phase]}
                  {isR2 && <span style={{ fontSize: 6.5, color: "#fbbf24", marginLeft: 2, fontWeight: 700 }}>R2</span>}
                </div>
                <div style={{ fontSize: 7, lineHeight: 1.15, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", color: status === "future" ? "var(--text-faint)" : status === "cur" ? ph.glow : "var(--text-mid)" }}>
                  {brief}
                </div>
              </div>
            </Fragment>
          );
        })}

        {/* 轮1 → 轮2 回路分隔(不占格宽) */}
        {boundaryPct !== null && (
          <div title="loop② 回 Agent1" style={{ position: "absolute", top: -2, bottom: -2, left: `${boundaryPct}%`, width: 0, borderLeft: "1.5px dashed #f59e0b", pointerEvents: "none" }}>
            <span style={{ position: "absolute", top: -10, left: -6, fontSize: 10, color: "#fbbf24" }}>↻</span>
          </div>
        )}

        {/* 竖型光标(rAF 直驱 left) */}
        <div ref={playheadRef} style={{ position: "absolute", top: -4, bottom: -4, left: 0, width: 2, background: "var(--text-bright)", boxShadow: "0 0 8px var(--text-bright)", pointerEvents: "none", zIndex: 4 }}>
          <div style={{ position: "absolute", top: -3, left: -3, width: 8, height: 8, borderRadius: "50%", background: "var(--text-bright)", boxShadow: "0 0 8px var(--text-bright)" }} />
        </div>
      </div>
      <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", flexShrink: 0 }}>
        {curIdx + 1}/{total}
      </span>
    </div>
  );
}

export const StepAxis = memo(StepAxisBase);
