// ============================================================================
// ScenarioTags —— 中列顶部场景标签条(建议1)
//   三个场景标签(点击切换)+ 双主题徽标(按当前场景 pillars 点亮)
//   + 当前场景「目标 / 简介」常驻(讲清「在看什么」)。替换 TopBar 内的场景按钮。
// ============================================================================

import type { Scenario } from "../../data/types";

interface Props {
  scenarios: Scenario[];
  scenario: Scenario;
  onSelect: (id: string) => void;
}

export function ScenarioTags({ scenarios, scenario, onSelect }: Props) {
  return (
    <div className="hud" style={{ borderRadius: 10, padding: "7px 11px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 9, letterSpacing: "0.14em", color: "#5f6f87", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>场景</span>
        <div style={{ display: "flex", gap: 5 }}>
          {scenarios.map((s) => {
            const active = s.id === scenario.id;
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={active ? "btn active" : "btn"}
                title={s.intro ?? s.tagline}
                style={{ padding: "4px 10px", fontSize: 10.5, textTransform: "none", letterSpacing: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <b style={{ fontSize: 11.5 }}>{s.id}</b>
                <span>{s.cn}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 当前场景目标 + 简介(常驻,给观者上下文) */}
      <div style={{ marginTop: 5, fontSize: 10.5, color: "#cde7ff", lineHeight: 1.4 }} title={scenario.intro}>
        ▸ {scenario.objective ?? scenario.tagline}
      </div>
      {scenario.intro && (
        <div
          style={{
            marginTop: 2,
            fontSize: 9.5,
            color: "#7e8aa3",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {scenario.intro}
        </div>
      )}
    </div>
  );
}
