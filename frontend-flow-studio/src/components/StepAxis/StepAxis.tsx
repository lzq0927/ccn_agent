// ============================================================================
// StepAxis —— 闭环步骤长轴(页面底部全宽)· Studio「轨道式进度」
//   旧版「彩色格子墙」改为:一条发丝线轨道 + 各步刻度点(完成=绿实心/当前=靛蓝环/
//   未来=空心),当前步上方浮衬线步名 + 超短结论;轮1→轮2 画细虚线 ↻ 分隔;
//   播放头 = 1.5px 靛蓝垂线(rAF 直驱,与旧版同机制)。按段时长比例布点,播放头与点对齐。
// ============================================================================

import { memo, useMemo } from "react";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { walkStops } from "../../story/director";
import { PHASES } from "../../theme";

/** 2 字阶段短标 */
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

const OK = "#35b57c";
const ACCENT = "#7d8af2";
const WARN = "#d9a13c";

function StepAxisBase({ scenario, state, playheadRef }: Props) {
  const stops = useMemo(() => walkStops(scenario), [scenario]);
  const twoRound = useMemo(() => stops.some((s) => s.round === 2), [stops]);
  const r2Start = useMemo(() => stops.findIndex((s) => s.round === 2), [stops]);
  const curIdx = Math.max(
    0,
    stops.findIndex((s) => s.phase === state.phaseIndex && s.round === state.round),
  );
  const total = stops.length;

  // 每段时长(由相邻停靠点时间差近似)→ 按比例布点,播放头与点对齐
  const segDurs = useMemo(
    () => stops.map((s, i) => (i === 0 ? s.time + 0.05 : Math.max(0.05, s.time - stops[i - 1].time))),
    [stops],
  );
  const totalDur = useMemo(() => segDurs.reduce((a, b) => a + b, 0) || 1, [segDurs]);
  /** 第 i 步起点(占 totalDur 的百分比) */
  const startPct = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < stops.length; i++) {
      out.push((acc / totalDur) * 100);
      acc += segDurs[i];
    }
    return out;
  }, [stops, segDurs, totalDur]);
  // 轮1→轮2 分隔位置(不占点位)
  const boundaryPct = twoRound && r2Start > 0 ? startPct[r2Start] : null;

  const curStop = stops[curIdx];
  const curBrief = stepBrief(scenario, curStop.phase, curStop.round, twoRound);
  // 当前步标签位置:贴当前步起点,clamp 防溢出
  const labelPct = Math.max(6, Math.min(94, (startPct[curIdx] ?? 0) + 3));

  return (
    <div className="panel" style={{ padding: "7px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, flexShrink: 0, minWidth: 64 }}>
        <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>闭环步骤轴</span>
        <span className="mono" style={{ fontSize: 9, color: "var(--ink-4)", marginTop: 1 }}>
          {String(curIdx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>

      <div style={{ flex: 1, height: 46, minWidth: 0, position: "relative" }}>
        {/* 当前步浮标:衬线步名 + 超短结论 */}
        <div style={{ position: "absolute", left: `${labelPct}%`, top: 0, transform: "translateX(0)", whiteSpace: "nowrap", pointerEvents: "none", transition: "left 0.3s var(--ease-out)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span className="mono" style={{ fontSize: 9, color: ACCENT }}>{String(curIdx + 1).padStart(2, "0")}</span>
            <span className="font-display" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}>
              {PHASES[curStop.phase].cn}
              {curStop.round === 2 && <span style={{ color: WARN, fontSize: 10, marginLeft: 4 }}>R2</span>}
            </span>
            <span style={{ fontSize: 10, color: "var(--ink-4)" }}>{curBrief}</span>
          </div>
        </div>

        {/* 轨道 */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 30, height: 2, background: "var(--line-2)", borderRadius: 1 }} />

        {/* 各步刻度点 */}
        {stops.map((stop, i) => {
          const status: "done" | "cur" | "future" = i < curIdx ? "done" : i === curIdx ? "cur" : "future";
          const ph = PHASES[stop.phase];
          const isR2 = stop.round === 2;
          return (
            <div
              key={`${stop.phase}-${stop.round}-${i}`}
              title={`${i + 1}. ${ph.cn}${isR2 ? " · 第②轮" : ""} — ${stepBrief(scenario, stop.phase, stop.round, twoRound)}`}
              style={{
                position: "absolute",
                left: `${startPct[i]}%`,
                top: 31,
                width: status === "cur" ? 11 : 7,
                height: status === "cur" ? 11 : 7,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                background: status === "done" ? OK : status === "cur" ? ACCENT : "var(--bg1)",
                border: status === "future" ? "1.2px solid var(--line-3)" : status === "done" ? "1.2px solid " + OK : "2px solid " + ACCENT,
                boxShadow: status === "cur" ? `0 0 0 3px ${ACCENT}22` : "none",
                opacity: status === "future" ? 0.8 : 1,
                transition: "all 0.25s var(--ease-out)",
              }}
            />
          );
        })}

        {/* 轮1 → 轮2 回路分隔(细虚线 + ↻) */}
        {boundaryPct !== null && (
          <div title="loop② 回 Agent1" style={{ position: "absolute", top: 22, bottom: 2, left: `${boundaryPct}%`, width: 0, borderLeft: "1px dashed " + WARN + "99", pointerEvents: "none" }}>
            <span style={{ position: "absolute", top: -3, left: -4.5, fontSize: 10, color: WARN }}>↻</span>
          </div>
        )}

        {/* 播放头:细垂线 + 顶端小三角(rAF 直驱 left) */}
        <div ref={playheadRef} style={{ position: "absolute", top: 20, bottom: 2, left: 0, width: 1.5, background: ACCENT, pointerEvents: "none", zIndex: 4 }}>
          <div style={{ position: "absolute", top: -5, left: -3.25, width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `5px solid ${ACCENT}` }} />
        </div>
      </div>
    </div>
  );
}

export const StepAxis = memo(StepAxisBase);
