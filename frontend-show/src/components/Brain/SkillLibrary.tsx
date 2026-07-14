// ============================================================================
// SkillLibrary —— 常驻技能库(能力沉淀,痛点3)
//   Brain 底部条:展示当前场景探索后形成/优化的 Skill,随相位揭示;
//   C 场景点亮「新沉淀」,并显示「下次命中率↑」。跨循环累计复用计数。
//   无 skillEvolution 的场景(如 A 确定性工作流)显示「无需沉淀」。
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";

interface Props {
  scenario: Scenario;
  state: StoryState;
}

export function SkillLibrary({ scenario, state }: Props) {
  const se = scenario.skillEvolution;
  const reveal = state.skillReveal; // phase7 揭示 0..1
  const formed = reveal > 0.05;
  const reused = state.loop; // loop≥1 表示已复用
  const accent = se?.kind === "NEW" ? "#34d399" : "#38bdf8";

  return (
    <div
      style={{
        marginTop: 8,
        padding: "7px 9px",
        borderRadius: 7,
        border: `1px solid ${formed ? accent + "66" : "var(--accent-a20)"}`,
        background: formed ? `${accent}10` : "transparent",
        transition: "all 0.5s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>技能库 · SKILL LIBRARY</span>
        <span style={{ marginLeft: "auto", fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          {se ? (formed ? (reused > 0 ? `累计复用 ${reused} 次` : "首次沉淀") : "探索中 · 待沉淀") : "0 skills"}
        </span>
      </div>

      {se ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7, opacity: 0.35 + 0.65 * reveal, transition: "opacity 0.5s ease" }}>
          <span
            style={{
              fontSize: 9.5,
              padding: "3px 8px",
              borderRadius: 4,
              fontFamily: "var(--font-mono)",
              color: formed ? accent : "var(--text-mid)",
              border: `1px solid ${formed ? accent + "88" : "rgba(71,85,105,0.4)"}`,
              background: formed ? `${accent}14` : "transparent",
              boxShadow: formed ? `0 0 8px ${accent}44` : "none",
              whiteSpace: "nowrap",
            }}
          >
            ⚡ {se.kind === "NEW" ? "新沉淀" : "已优化"} · {se.skillCn}
          </span>
          {formed && (
            <span style={{ fontSize: 9, color: accent, fontFamily: "var(--font-mono)" }}>
              下次命中率 ↑ {(se.nextHitRate * 100).toFixed(0)}%
            </span>
          )}
          <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            @{se.skillId}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 9, color: "var(--text-faint)", textAlign: "center", padding: "2px 0" }}>
          确定性工作流直达根因 · 置信度足够 · 无需沉淀技能
        </div>
      )}
    </div>
  );
}
