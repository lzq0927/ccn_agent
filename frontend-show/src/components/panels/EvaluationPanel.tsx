// ============================================================================
// EvaluationPanel —— Agent 3 评估优化: P/R/F1 + 推理链质析 radar
//   + 案例类别 + 优化建议(回流 Agent1/Agent2)
// ============================================================================

import type { StoryState } from "../../story/types";
import type { Scenario } from "../../data/types";
import { STATUS } from "../../theme";
import { Gauge } from "../shared/Gauge";
import { Radar } from "../shared/Radar";
import { HudFrame } from "../shared/HudFrame";

const CAT_META: Record<string, { color: string; cn: string }> = {
  SUCCESS: { color: STATUS.healthy, cn: "精准命中" },
  PARTIAL_SUCCESS: { color: STATUS.warning, cn: "部分匹配" },
  FAILURE: { color: STATUS.fault, cn: "诊断失败" },
  FALSE_POSITIVE: { color: "#a78bfa", cn: "误报" },
};

const SUG_META: Record<string, { color: string; to: string; icon: string }> = {
  SKILL_UPDATE: { color: "#a78bfa", to: "→ Agent 2 · Skill 更新", icon: "⚡" },
  WORKFLOW_UPDATE: { color: "var(--accent)", to: "→ Agent 2 · Workflow 更新", icon: "⚙" },
  NEW_CASE: { color: "#f59e0b", to: "→ Agent 1 · 新增难例", icon: "✚" },
};

export function EvaluationPanel({ state, scenario }: { state: StoryState; scenario: Scenario }) {
  const ev = state.evalMetrics;
  if (!ev) return null;
  const cat = CAT_META[ev.category];
  // P/R/F1 为单用例级指标:本例预测根因集 vs 真值集
  const predictedEls = scenario.predicted.elements.join("、") || "—";
  const truthEls = scenario.truth.elements.join("、") || "无网络根因";
  // 4 维评估(LLM TraceAnalyzer 评判):分值 + 评判标准
  const dims = [
    { label: "逻辑连贯", value: ev.traceAxes.logicalCoherence, crit: "步骤合逻辑、前后自洽" },
    { label: "工具效率", value: ev.traceAxes.toolEfficiency, crit: "用对工具、无冗余调用" },
    { label: "证据质量", value: ev.traceAxes.evidenceQuality, crit: "结论有强证据支撑" },
    { label: "信号覆盖", value: 1 - ev.traceAxes.missedSignals, crit: "未遗漏重要异常信号" },
  ];
  const axes = dims.map((d) => ({ label: d.label, value: d.value }));

  return (
    <HudFrame title="评估优化 · 闭环反馈" subtitle="AGENT 3 · EVALUATION" right={<span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>vs 真值</span>}>
      {/* 指标仪表 */}
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", marginBottom: 4 }}>
        <Gauge value={ev.precision} display={ev.precision.toFixed(2)} color="var(--accent)" size={70} label="PRECISION" />
        <Gauge value={ev.recall} display={ev.recall.toFixed(2)} color="#a78bfa" size={70} label="RECALL" />
        <Gauge value={ev.f1} display={ev.f1.toFixed(2)} color={STATUS.healthy} size={70} label="F1" />
      </div>
      {/* 指标口径:单用例级，预测根因集 vs 真值集 */}
      <div style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "center", marginBottom: 10, lineHeight: 1.5 }}>
        <div>单用例级指标 · 预测根因集 vs 真值集</div>
        <div style={{ fontFamily: "var(--font-mono)", marginTop: 2 }}>
          预测 <span style={{ color: "var(--text-soft)" }}>{predictedEls}</span> ↔ 真值 <span style={{ color: "var(--text-soft)" }}>{truthEls}</span>
        </div>
      </div>

      {/* 类别 + exact match */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, textAlign: "center", border: `1px solid ${cat.color}55`, borderRadius: 7, padding: "6px", background: `${cat.color}12` }}>
          <div style={{ fontSize: 8.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>CASE CATEGORY</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: cat.color, marginTop: 2 }}>{ev.category}</div>
          <div style={{ fontSize: 9, color: "var(--text-mid)" }}>{cat.cn}</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", border: "1px solid var(--border)", borderRadius: 7, padding: "6px" }}>
          <div style={{ fontSize: 8.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>EXACT / TYPE MATCH</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: ev.exactMatch ? STATUS.healthy : STATUS.fault, marginTop: 2, fontFamily: "var(--font-mono)" }}>
            {ev.exactMatch ? "✓ MATCH" : "✗ MISS"}
          </div>
          <div style={{ fontSize: 9, color: ev.faultTypeMatch ? STATUS.healthy : "var(--text-dim)" }}>{ev.faultTypeMatch ? "类型一致" : "类型不符"}</div>
        </div>
      </div>

      {/* 推理链质析 radar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid rgba(56,189,248,0.12)", paddingTop: 10 }}>
        <Radar axes={axes} color="#a78bfa" size={120} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>TRACE QUALITY</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-bright)", fontFamily: "var(--font-mono)" }}>{(ev.traceAxes.overall * 100).toFixed(0)}</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 4 }}>推理链综合评分 / 100(4 维加权平均)</div>
          {dims.map((d) => (
            <div key={d.label} style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
              <span style={{ width: 52, fontSize: 9, fontWeight: 700, color: "#a78bfa" }}>{d.label}</span>
              <span style={{ width: 20, fontSize: 10, fontWeight: 700, color: "var(--text-bright)", fontFamily: "var(--font-mono)" }}>{(d.value * 100).toFixed(0)}</span>
              <span style={{ flex: 1, fontSize: 8.5, color: "var(--text-faint)" }}>{d.crit}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 优化建议 / 反馈 */}
      <div style={{ marginTop: 12, fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
        OPTIMIZATION · FEEDBACK LOOP
      </div>
      {ev.suggestions.length === 0 ? (
        <div style={{ border: `1px solid ${STATUS.healthy}44`, borderRadius: 7, padding: "10px", background: `${STATUS.healthy}0c`, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: STATUS.healthy, fontWeight: 700 }}>✓ 诊断精准</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 3 }}>exact_match 命中 · 无需优化建议</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {ev.suggestions.map((s, i) => {
            const sm = SUG_META[s.type];
            return (
              <div key={i} style={{ border: `1px solid ${sm.color}44`, borderRadius: 7, padding: "8px 9px", background: `${sm.color}0a`, animation: "float-up 0.4s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: sm.color, fontFamily: "var(--font-mono)" }}>
                    {sm.icon} {s.type}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{sm.to}</span>
                </div>
                <div style={{ fontSize: 9.5, color: "var(--text-detail)", lineHeight: 1.45, marginBottom: 5 }}>{s.content}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>PRIORITY</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(56,189,248,0.1)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${s.priority * 100}%`, background: sm.color, boxShadow: `0 0 5px ${sm.color}` }} />
                  </div>
                  <span style={{ fontSize: 8.5, color: sm.color, fontFamily: "var(--font-mono)" }}>{s.priority.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginTop: 3 }}>@ {s.target}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 能力沉淀 · 闭环学习(场景 B/C) */}
      <Consolidation scenario={scenario} reveal={state.skillReveal} />
    </HudFrame>
  );
}

function Consolidation({ scenario, reveal }: { scenario: Scenario; reveal: number }) {
  const se = scenario.skillEvolution;
  const accent = se?.kind === "NEW" ? "#34d399" : "var(--accent)";
  if (!se) {
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)", textAlign: "center" }}>
        <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>能力沉淀 · CAPABILITY CONSOLIDATION</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>本场景确定性命中 · 置信度足够 · 无需沉淀技能</div>
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 12,
        opacity: 0.25 + 0.75 * reveal,
        transition: "opacity 0.5s ease",
        border: `1px solid ${accent}55`,
        borderRadius: 8,
        padding: "9px 10px",
        background: `${accent}0e`,
        boxShadow: reveal > 0.5 ? `0 0 14px ${accent}22` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>能力沉淀 · CAPABILITY CONSOLIDATION</span>
        <span style={{ marginLeft: "auto", fontSize: 8, padding: "1px 6px", borderRadius: 3, color: accent, border: `1px solid ${accent}66`, fontFamily: "var(--font-mono)" }}>{se.kind === "NEW" ? "✚ NEW SKILL" : "↻ UPDATE SKILL"}</span>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--text-detail)", lineHeight: 1.45, marginBottom: 6 }}>
        <span style={{ color: accent }}>💡 洞察</span> {se.insight}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span style={{ fontSize: 9.5, padding: "2px 8px", borderRadius: 4, color: accent, border: `1px solid ${accent}88`, background: `${accent}14`, fontFamily: "var(--font-mono)" }}>⚡ {se.skillCn}</span>
        <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>@{se.skillId}</span>
      </div>
      {se.before && (
        <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 6, lineHeight: 1.4 }}>
          <span style={{ color: STATUS.fault }}>前:</span> {se.before}
          <br />
          <span style={{ color: STATUS.healthy }}>后:</span> {se.after}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 9, color: "var(--text-dim)" }}>下次命中率</span>
        <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(56,189,248,0.1)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${se.nextHitRate * 100 * reveal}%`, background: accent, boxShadow: `0 0 6px ${accent}`, transition: "width 0.6s ease" }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, fontFamily: "var(--font-mono)" }}>↑ {(se.nextHitRate * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
