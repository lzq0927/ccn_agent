// ============================================================================
// EvaluationPanel —— Agent 3 评估优化: P/R/F1 + 推理链质析 radar
//   + 案例类别 + 优化建议(回流 Agent1/Agent2)
// ============================================================================

import type { StoryState } from "../../story/types";
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
  WORKFLOW_UPDATE: { color: "#38bdf8", to: "→ Agent 2 · Workflow 更新", icon: "⚙" },
  NEW_CASE: { color: "#f59e0b", to: "→ Agent 1 · 新增难例", icon: "✚" },
};

export function EvaluationPanel({ state }: { state: StoryState }) {
  const ev = state.evalMetrics;
  if (!ev) return null;
  const cat = CAT_META[ev.category];
  const axes = [
    { label: "逻辑连贯", value: ev.traceAxes.logicalCoherence },
    { label: "工具效率", value: ev.traceAxes.toolEfficiency },
    { label: "证据质量", value: ev.traceAxes.evidenceQuality },
    { label: "信号完备", value: 1 - ev.traceAxes.missedSignals },
  ];

  return (
    <HudFrame title="评估优化 · 闭环反馈" subtitle="AGENT 3 · EVALUATION" right={<span style={{ fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>vs 真值</span>}>
      {/* 指标仪表 */}
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", marginBottom: 8 }}>
        <Gauge value={ev.precision} display={ev.precision.toFixed(2)} color="#38bdf8" size={70} label="PRECISION" />
        <Gauge value={ev.recall} display={ev.recall.toFixed(2)} color="#a78bfa" size={70} label="RECALL" />
        <Gauge value={ev.f1} display={ev.f1.toFixed(2)} color={STATUS.healthy} size={70} label="F1" />
      </div>

      {/* 类别 + exact match */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, textAlign: "center", border: `1px solid ${cat.color}55`, borderRadius: 7, padding: "6px", background: `${cat.color}12` }}>
          <div style={{ fontSize: 8.5, color: "#5f6f87", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>CASE CATEGORY</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: cat.color, marginTop: 2 }}>{ev.category}</div>
          <div style={{ fontSize: 9, color: "#9fb0c9" }}>{cat.cn}</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", border: "1px solid rgba(56,189,248,0.18)", borderRadius: 7, padding: "6px" }}>
          <div style={{ fontSize: 8.5, color: "#5f6f87", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>EXACT / TYPE MATCH</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: ev.exactMatch ? STATUS.healthy : STATUS.fault, marginTop: 2, fontFamily: "var(--font-mono)" }}>
            {ev.exactMatch ? "✓ MATCH" : "✗ MISS"}
          </div>
          <div style={{ fontSize: 9, color: ev.faultTypeMatch ? STATUS.healthy : "#7e8aa3" }}>{ev.faultTypeMatch ? "类型一致" : "类型不符"}</div>
        </div>
      </div>

      {/* 推理链质析 radar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid rgba(56,189,248,0.12)", paddingTop: 10 }}>
        <Radar axes={axes} color="#a78bfa" size={120} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#5f6f87", fontFamily: "var(--font-mono)", marginBottom: 6 }}>TRACE QUALITY</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#eaf4ff", fontFamily: "var(--font-mono)" }}>{(ev.traceAxes.overall * 100).toFixed(0)}</div>
          <div style={{ fontSize: 9, color: "#7e8aa3" }}>推理链综合评分 / 100</div>
          <div style={{ fontSize: 9, color: "#7e8aa3", marginTop: 4 }}>漏检信号:<span style={{ color: ev.traceAxes.missedSignals > 0.4 ? STATUS.fault : STATUS.warning }}>{(ev.traceAxes.missedSignals * 100).toFixed(0)}%</span></div>
        </div>
      </div>

      {/* 优化建议 / 反馈 */}
      <div style={{ marginTop: 12, fontSize: 8.5, letterSpacing: "0.1em", color: "#5f6f87", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
        OPTIMIZATION · FEEDBACK LOOP
      </div>
      {ev.suggestions.length === 0 ? (
        <div style={{ border: `1px solid ${STATUS.healthy}44`, borderRadius: 7, padding: "10px", background: `${STATUS.healthy}0c`, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: STATUS.healthy, fontWeight: 700 }}>✓ 诊断精准</div>
          <div style={{ fontSize: 9, color: "#7e8aa3", marginTop: 3 }}>exact_match 命中 · 无需优化建议</div>
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
                  <span style={{ marginLeft: "auto", fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>{sm.to}</span>
                </div>
                <div style={{ fontSize: 9.5, color: "#cdd9ea", lineHeight: 1.45, marginBottom: 5 }}>{s.content}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>PRIORITY</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(56,189,248,0.1)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${s.priority * 100}%`, background: sm.color, boxShadow: `0 0 5px ${sm.color}` }} />
                  </div>
                  <span style={{ fontSize: 8.5, color: sm.color, fontFamily: "var(--font-mono)" }}>{s.priority.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 8, color: "#475569", fontFamily: "var(--font-mono)", marginTop: 3 }}>@ {s.target}</div>
              </div>
            );
          })}
        </div>
      )}
    </HudFrame>
  );
}
