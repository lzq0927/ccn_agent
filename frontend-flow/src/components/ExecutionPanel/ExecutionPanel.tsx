// ============================================================================
// ExecutionPanel —— 右侧「现网运行」(拓扑为主 + 每相位一个弹窗 + 场景选择)
//   顶部:场景选择(A/B/C,完整标题,对齐 frontend-show)+ 当前场景目标/简介
//   拓扑常驻占满(恒定尺寸);每相位只有一个浮动弹窗 PhasePopup(实时 SR + 相位关键信息
//   + 大模型分析),合并去重,不再多弹窗叠加。
// ============================================================================

import { PHASES } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { DigitalTwin } from "../DigitalTwin/DigitalTwin";
import { PhasePopup } from "./PhasePopup";

interface Props {
  scenario: Scenario;
  state: StoryState;
  scenarios: Scenario[];
  currentScenarioId: string;
  onSelectScenario: (id: string) => void;
}

export function ExecutionPanel({ scenario, state, scenarios, currentScenarioId, onSelectScenario }: Props) {
  const info = PHASES[state.phaseIndex];
  return (
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="hud-head">
        <span className="title">
          <span className="dot" />
          现网运行
        </span>
        <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 4, color: info.color, border: `1px solid ${info.color}66`, background: `${info.color}14`, fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
          PHASE {state.phaseIndex} · {info.en}
        </span>
      </div>

      {/* 场景选择 + 完整标题(右栏顶部,对齐 frontend-show) */}
      <div style={{ padding: "7px 12px", borderBottom: "1px solid var(--border)", background: "var(--accent-a12)" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
          {scenarios.map((s) => {
            const active = s.id === currentScenarioId;
            return (
              <button
                key={s.id}
                onClick={() => onSelectScenario(s.id)}
                title={s.intro ?? s.tagline}
                className={active ? "btn active" : "btn"}
                style={{ padding: "4px 9px", fontSize: 9.5, textTransform: "none", letterSpacing: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <b style={{ fontSize: 11 }}>{s.id}</b>
                <span>{s.cn}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-mid)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={scenario.intro ?? scenario.tagline}>
          {scenario.objective ?? scenario.tagline}
          {scenario.intro ? ` · ${scenario.intro}` : ""}
        </div>
      </div>

      {/* 拓扑常驻区(恒定尺寸)+ 唯一浮动弹窗 */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--twin-readout-bg)" }}>
        <DigitalTwin scenario={scenario} state={state} showCallouts={false} />
        <PhasePopup scenario={scenario} state={state} />
      </div>
    </div>
  );
}
