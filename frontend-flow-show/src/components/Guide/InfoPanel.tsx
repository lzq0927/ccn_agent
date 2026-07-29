// ============================================================================
// InfoPanel —— 右侧步骤解说面板(不遮挡画布圆圈)
//   顶部:相位标题 + 轮次/回环标记;主体:该相位的富内容(异常图/匹配/推理/下发/评估)。
//   与画布中当前高亮圆圈联动 —— 即「圈圈的弹窗解释」,只是稳定放在右侧不挡图。
// ============================================================================

import { PHASES, STATUS } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { guideCallout } from "../../guide/steps";
import { getKpi } from "../../story/director";
import { sample } from "../../data/kpi";
import { AnomalyPanel, MatchPanel, ReasonPanel, DispatchPanel, EvalPanel, EvalFailPanel } from "./PhasePanels";

interface Props {
  scenario: Scenario;
  state: StoryState;
  round: number;
}

export function InfoPanel({ scenario, state, round }: Props) {
  const phase = state.phaseIndex;
  const ph = PHASES[phase];
  const info = guideCallout(scenario, state);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-panel-solid)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "11px 14px 9px", borderBottom: `2px solid ${ph.color}`, background: `${ph.color}0d` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
          <span style={{ width: 26, height: 26, borderRadius: "50%", background: ph.color, color: "#04070f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{phase >= 1 && phase <= 7 ? phase : "·"}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: ph.color, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{ph.en}</div>
            <div style={{ fontSize: 12, color: "var(--text-mid)" }}>{agentLabel(phase)}</div>
          </div>
          {round === 2 && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, color: "#fbbf24", border: "1px solid #f59e0b88", background: "rgba(245,158,11,0.12)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>第②轮</span>}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-bright)", lineHeight: 1.2 }}>{info.title}</div>
      </div>
      <div key={`${phase}-${round}`} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", animation: "fpop-in 0.3s cubic-bezier(0.22,1,0.36,1)" }}>
        {phase === 2 ? <AnomalyPanel scenario={scenario} state={state} />
          : phase === 3 ? <MatchPanel scenario={scenario} />
            : phase === 4 ? <ReasonPanel scenario={scenario} state={state} />
              : phase === 5 ? <DispatchPanel scenario={scenario} state={state} />
                : phase === 7 && round === 1 ? <EvalFailPanel scenario={scenario} state={state} />
                  : phase === 7 ? <EvalPanel scenario={scenario} />
                    : <GenericBody info={info} color={ph.color} />}
      </div>
    </div>
  );
}

function GenericBody({ info, color }: { info: ReturnType<typeof guideCallout>; color: string }) {
  return (
    <>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-soft)", marginBottom: 12 }}>{info.body}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {info.bullets.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 13.5, color: "var(--text-detail)", lineHeight: 1.5 }}>
            <span style={{ color, fontWeight: 800, flexShrink: 0 }}>▸</span><span>{b}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function agentLabel(ph: number): string {
  if (ph === 1) return "Agent 1 · 数据采集";
  if (ph >= 2 && ph <= 5) return "Agent 2 · 故障感知";
  if (ph === 7) return "Agent 3 · 评估优化";
  return "待命监测";
}

/** 评估未通过卡片:写清为什么(与 KPI 联动 —— 网络未恢复) */
function EvalFailCard({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const sr = sample(kpi.overall, state.simT);
  // 具体原因(场景化)
  const reason = scenario.id === "F"
    ? "首轮 3 策略全下,但 iPhone 不支持 back-off timer → 收到 Reg Reject 立即重试,失败数反升"
    : scenario.id === "E"
      ? "首轮 UE back-off 仅约 20% 终端支持 → 冲击下降但未消除,过载未解除"
      : "首轮恢复策略执行后,异常未完全消除";
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 7, border: `1px solid ${STATUS.warning}88`, background: `${STATUS.warning}12` }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24", fontFamily: "var(--font-mono)", marginBottom: 4 }}>⚠ 评估未通过 · 网络未恢复</div>
      <div style={{ fontSize: 12, color: "var(--text-soft)", lineHeight: 1.55, marginBottom: 5 }}>{reason}</div>
      <div style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: "var(--font-mono)" }}>
        <span style={{ color: "var(--text-mid)" }}>KPI 联动:</span>
        <span style={{ color: sr < kpi.threshold ? STATUS.fault : STATUS.warning, fontWeight: 700 }}>整网 SR {(sr * 100).toFixed(2)}% &lt; {kpi.threshold * 100}%</span>
        <span style={{ color: "var(--text-mid)", marginLeft: "auto" }}>→ loop② 回 Agent1 补采 → 第二轮</span>
      </div>
    </div>
  );
}
