// ============================================================================
// ReasoningTrace —— Agent Loop 推理链(竖向时间线,逐步揭示,自动滚动)
// ============================================================================

import { useEffect, useRef } from "react";
import type { StoryState } from "../../story/types";
import { HudFrame } from "../shared/HudFrame";

const TYPE_META: Record<string, { color: string; icon: string; cn: string }> = {
  thinking: { color: "#38bdf8", icon: "💭", cn: "思考" },
  tool_call: { color: "#a78bfa", icon: "🔧", cn: "工具调用" },
  tool_result: { color: "#64748b", icon: "↳", cn: "结果" },
  conclusion: { color: "#22c55e", icon: "✓", cn: "结论" },
};

export function ReasoningTrace({ state }: { state: StoryState }) {
  const steps = state.reasoningSteps;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length]);

  return (
    <HudFrame
      title="Agent 推理链 · 根因定位"
      subtitle="HERMES AGENT LOOP"
      right={
        <span style={{ fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>
          {steps.length}/{state.reasoningTotal} 步
        </span>
      }
    >
      <div ref={scrollRef} style={{ display: "flex", flexDirection: "column", gap: 7, paddingRight: 2 }}>
        {steps.length === 0 && <div style={{ fontSize: 10, color: "#5f6f87", textAlign: "center", padding: "20px 0" }}>等待 Agent Loop 启动…</div>}
        {steps.map((s, i) => {
          const m = TYPE_META[s.type] ?? TYPE_META.thinking;
          const isLast = i === steps.length - 1;
          return (
            <div key={s.n} style={{ position: "relative", paddingLeft: 22, animation: "float-up 0.4s ease" }}>
              {/* 时间线轴 + 节点 */}
              {!isLast && <div style={{ position: "absolute", left: 8, top: 18, bottom: -7, width: 1, background: "rgba(56,189,248,0.15)" }} />}
              <div
                style={{
                  position: "absolute", left: 0, top: 2, width: 16, height: 16, borderRadius: "50%",
                  background: `${m.color}1a`, border: `1px solid ${m.color}`, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, boxShadow: isLast ? `0 0 10px ${m.color}` : "none",
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  border: `1px solid ${isLast ? m.color : "rgba(56,189,248,0.12)"}`,
                  borderRadius: 7, padding: "7px 9px", background: isLast ? `${m.color}10` : "rgba(10,16,30,0.5)",
                  boxShadow: isLast ? `0 0 14px ${m.color}22` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: m.color, fontWeight: 700, letterSpacing: "0.05em" }}>
                    {m.icon} {m.cn}
                  </span>
                  {s.tool && (
                    <span style={{ fontSize: 9, color: "#cde7ff", fontFamily: "var(--font-mono)", background: "rgba(167,139,250,0.15)", padding: "0 5px", borderRadius: 3 }}>
                      {s.tool}()
                    </span>
                  )}
                  {s.args && <span style={{ fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>{s.args}</span>}
                </div>
                <div style={{ fontSize: 10.5, color: "#cdd9ea", lineHeight: 1.45 }}>{s.text}</div>
                {s.result && (
                  <div
                    style={{
                      marginTop: 5, fontSize: 9.5, color: "#9fb0c9", fontFamily: "var(--font-mono)",
                      background: "rgba(4,7,15,0.5)", borderLeft: `2px solid ${m.color}`, padding: "4px 7px", borderRadius: 3, lineHeight: 1.4,
                    }}
                  >
                    {s.result}
                  </div>
                )}
                {s.highlight?.nes && s.highlight.nes.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {s.highlight.nes.map((n) => (
                      <span key={n} style={{ fontSize: 8, color: "#fb7185", fontFamily: "var(--font-mono)", border: "1px solid rgba(251,113,133,0.3)", padding: "0 4px", borderRadius: 3 }}>
                        ◎ {n}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </HudFrame>
  );
}
