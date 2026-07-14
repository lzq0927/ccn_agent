// ============================================================================
// ReasoningTrace —— Agent Loop 推理链(竖向时间线,逐步揭示,自动滚动)
// ============================================================================

import { useEffect, useRef } from "react";
import type { StoryState } from "../../story/types";
import { HudFrame } from "../shared/HudFrame";

const TYPE_META: Record<string, { color: string; icon: string; cn: string }> = {
  thinking: { color: "#38bdf8", icon: "💭", cn: "分析" },
  tool_call: { color: "#a78bfa", icon: "🔍", cn: "探测" },
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
        <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          {steps.length}/{state.reasoningTotal} 步
        </span>
      }
    >
      <div ref={scrollRef} style={{ display: "flex", flexDirection: "column", gap: 5, paddingRight: 2 }}>
        {steps.length === 0 && <div style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center", padding: "20px 0" }}>等待 Agent Loop 启动…</div>}
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
                  border: `1px solid ${isLast ? m.color : "rgba(56,189,248,0.1)"}`,
                  borderRadius: 7, padding: isLast ? "7px 9px" : "4px 9px", background: isLast ? `${m.color}10` : "rgba(10,16,30,0.4)",
                  boxShadow: isLast ? `0 0 14px ${m.color}22` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: isLast ? 11 : 9.5, color: m.color, fontWeight: 700, letterSpacing: "0.05em" }}>
                    {m.icon} {m.cn}
                  </span>
                  {isLast && (
                    <span style={{ marginLeft: "auto", fontSize: 8.5, padding: "1px 6px", borderRadius: 3, color: m.color, border: `1px solid ${m.color}88`, background: `${m.color}14`, fontFamily: "var(--font-mono)", animation: "blink 1.3s infinite", whiteSpace: "nowrap" }}>
                      ▶ 执行中
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: isLast ? 12 : 10,
                    color: isLast ? "var(--text-bright)" : "var(--text-detail)",
                    lineHeight: 1.4,
                    fontWeight: isLast ? 600 : 400,
                    ...(isLast ? {} : { display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }),
                  }}
                >
                  {s.text}
                </div>
                {s.result && isLast && (
                  <div
                    style={{
                      marginTop: 4, fontSize: 9, color: "var(--text-mid)", fontFamily: "var(--font-mono)",
                      background: "var(--twin-readout-bg)", borderLeft: `2px solid ${m.color}`, padding: "3px 7px", borderRadius: 3, lineHeight: 1.4,
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
