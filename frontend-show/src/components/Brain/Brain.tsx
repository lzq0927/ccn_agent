// ============================================================================
// Brain —— 高稳智能体「大脑架构」(左栏)
//   三 Agent 闭环管线(生成→感知→评估)+ 反馈回环;Agent2 内部展开
//   置信度路由(三档阈值)+ Agent Loop + Skill/Tools;激活路径点亮。
// ============================================================================

import { ROUTE_COLORS } from "../../theme";
import type { StoryState } from "../../story/types";
import type { Scenario } from "../../data/types";
import { HudFrame } from "../shared/HudFrame";
import { SkillLibrary } from "./SkillLibrary";

const AGENTS = [
  { id: 1, cn: "数据生成", en: "AGENT 1 · DATA GENERATION", role: "设计态 · 仿真 + LLM 自校验闭环", color: "#38bdf8" },
  { id: 2, cn: "故障感知", en: "AGENT 2 · FAULT PERCEPTION", role: "运行态 · 置信度路由 + 推理(系统核心)", color: "#a78bfa", core: true },
  { id: 3, cn: "评估优化", en: "AGENT 3 · EVALUATION", role: "设计态 · 真值比对 + 优化建议", color: "#2dd4bf" },
];

const ROUTERS = [
  { key: "workflow", cn: "确定性工作流", cond: "score > 0.7", iter: "≤ 5 步 · 无 LLM" },
  { key: "guided", cn: "技能引导 Loop", cond: "0.3 ~ 0.7", iter: "≤ 15 次迭代" },
  { key: "autonomous", cn: "自主探索 Loop", cond: "score ≤ 0.3", iter: "≤ 30 次迭代" },
] as const;

export function Brain({ state, scenario }: { state: StoryState; scenario: Scenario }) {
  const active = state.activeAgent;
  const route = state.route;
  const conf = state.confidence;
  const feedbackOn = state.phaseIndex === 7;

  return (
    <HudFrame title="高稳智能体 · 大脑架构" subtitle="RESILIENT AGENT · 3-LOOP BRAIN" tall>
      {/* 神经脑动机 */}
      <BrainMotif active={active !== 0} color={active ? AGENTS[active - 1].color : "#38bdf8"} />

      {/* 三 Agent 管线 */}
      <div style={styles.pipeWrap}>
        <div style={styles.pipe}>
          {AGENTS.map((a, i) => {
            const isActive = active === a.id;
            const done =
              (a.id === 1 && state.phaseIndex >= 2) ||
              (a.id === 2 && state.phaseIndex >= 7) ||
              (a.id === 3 && state.phaseIndex >= 8);
            return (
              <div key={a.id} style={{ position: "relative" }}>
                <div
                  style={{
                    ...styles.agent,
                    borderColor: isActive ? a.color : "rgba(56,189,248,0.16)",
                    background: isActive ? `${a.color}14` : "rgba(10,16,30,0.5)",
                    boxShadow: isActive ? `0 0 18px ${a.color}40, inset 0 0 16px ${a.color}10` : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ ...styles.agentIdx, color: a.color, borderColor: a.color }}>{a.id}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? "#eaf4ff" : "#9fb0c9" }}>
                        {a.cn}
                        {a.core && <span style={styles.coreTag}>核心</span>}
                      </div>
                      <div style={{ fontSize: 8.5, letterSpacing: "0.08em", color: "#5f6f87", fontFamily: "var(--font-mono)" }}>{a.en}</div>
                    </div>
                    <StatusDot active={isActive} done={done} color={a.color} />
                  </div>
                  <div style={{ fontSize: 9.5, color: "#7e8aa3", marginTop: 5 }}>{a.role}</div>
                  {/* Agent 2 内部:展开路由 + Loop */}
                  {a.id === 2 && (
                    <Agent2Internals state={state} route={route} conf={conf} active={isActive} />
                  )}
                </div>
                {i < AGENTS.length - 1 && <Connector color={isActive ? a.color : "rgba(56,189,248,0.3)"} />}
              </div>
            );
          })}
        </div>

        {/* 优化反馈回环(Agent3 → Agent1/Agent2) */}
        <FeedbackBar on={feedbackOn} />
      </div>

      {/* 认知状态读数 */}
      <div style={styles.readout}>
        <Readout label="激活智能体" value={active === 0 ? "待命" : `AGENT ${active}`} color={active ? AGENTS[active - 1].color : "#7e8aa3"} />
        <Readout label="路由策略" value={route ? ROUTE_COLORS[route].label : "—"} color={route ? ROUTE_COLORS[route].base : "#7e8aa3"} />
        <Readout label="置信度" value={conf ? conf.score.toFixed(2) : "—"} color={conf ? (conf.score > 0.7 ? "#22c55e" : conf.score > 0.3 ? "#38bdf8" : "#a78bfa") : "#7e8aa3"} />
      </div>

      {/* 常驻技能库(能力沉淀) */}
      <SkillLibrary scenario={scenario} state={state} />
    </HudFrame>
  );
}

function Agent2Internals({ state, route, conf, active }: { state: StoryState; route: StoryState["route"]; conf: StoryState["confidence"]; active: boolean }) {
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed rgba(167,139,250,0.2)", opacity: active ? 1 : 0.55 }}>
      {/* 置信度路由三分支 */}
      <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#5f6f87", marginBottom: 4, fontFamily: "var(--font-mono)" }}>CONFIDENCE ROUTER</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {ROUTERS.map((r) => {
          const on = route === r.key;
          const rc = ROUTE_COLORS[r.key];
          return (
            <div key={r.key} style={{ ...styles.routerRow, borderColor: on ? rc.base : "rgba(56,189,248,0.1)", background: on ? `${rc.base}18` : "transparent" }}>
              <span style={{ ...styles.routerDot, background: on ? rc.base : "transparent", borderColor: rc.base, boxShadow: on ? `0 0 8px ${rc.base}` : "none" }} />
              <span style={{ fontSize: 9.5, color: on ? "#eaf4ff" : "#8a9bb5", fontWeight: on ? 700 : 400 }}>{r.cn}</span>
              <span style={{ marginLeft: "auto", fontSize: 8.5, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>{r.cond}</span>
              <span style={{ fontSize: 8, color: "#475569", fontFamily: "var(--font-mono)", width: 64, textAlign: "right" }}>{r.iter}</span>
            </div>
          );
        })}
        <div style={{ ...styles.routerRow, borderColor: route === "exploration" ? ROUTE_COLORS.exploration.base : "rgba(244,114,182,0.12)", background: route === "exploration" ? `${ROUTE_COLORS.exploration.base}18` : "transparent" }}>
          <span style={{ ...styles.routerDot, borderColor: ROUTE_COLORS.exploration.base, background: route === "exploration" ? ROUTE_COLORS.exploration.base : "transparent" }} />
          <span style={{ fontSize: 9.5, color: route === "exploration" ? "#eaf4ff" : "#8a9bb5" }}>多算法探索(EXPLORATION)</span>
          <span style={{ marginLeft: "auto", fontSize: 8.5, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>CHR 触发</span>
        </div>
      </div>

      {/* Agent Loop 迭代进度 */}
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#5f6f87", fontFamily: "var(--font-mono)" }}>AGENT LOOP</span>
        <div style={{ flex: 1, display: "flex", gap: 3 }}>
          {Array.from({ length: Math.min(state.reasoningTotal, 12) }).map((_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 2,
                background: i < state.reasoningSteps.length ? "#a78bfa" : "rgba(167,139,250,0.16)",
                boxShadow: i < state.reasoningSteps.length ? "0 0 6px #a78bfa" : "none",
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 9, color: "#9fb0c9", fontFamily: "var(--font-mono)" }}>
          {state.reasoningSteps.length}/{state.reasoningTotal}
        </span>
      </div>

      {/* Skill / Tools 标签 */}
      <div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", gap: 3 }}>
        {(conf?.matchedSkills ?? []).map((s) => (
          <span key={s} style={styles.chip}>
            ⚡ {s}
          </span>
        ))}
        <span style={styles.chip}>🛠 analyze_kpi</span>
        <span style={styles.chip}>🛠 find_common_ne</span>
        <span style={styles.chip}>🛠 temporal_pattern</span>
      </div>
    </div>
  );
}

function BrainMotif({ active, color }: { active: boolean; color: string }) {
  const nodes = [
    [50, 12], [28, 30], [72, 30], [16, 52], [50, 40], [84, 52], [30, 70], [70, 70], [50, 88],
  ];
  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", height: 84, opacity: active ? 1 : 0.6 }}>
      {nodes.slice(1).map((_, i) => {
        const a = nodes[4];
        const b = nodes[(i + 1) % nodes.length];
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={0.4} opacity={0.25} />;
      })}
      {nodes.map((n, i) => (
        <circle key={i} cx={n[0]} cy={n[1]} r={i === 4 ? 4 : 2.4} fill={color} opacity={i === 4 ? 0.95 : 0.55}>
          {active && <animate attributeName="opacity" values="0.3;0.9;0.3" dur={`${1.2 + (i % 4) * 0.3}s`} repeatCount="indefinite" />}
        </circle>
      ))}
    </svg>
  );
}

function StatusDot({ active, done, color }: { active: boolean; done: boolean; color: string }) {
  const c = active ? color : done ? "#22c55e" : "#475569";
  return (
    <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, boxShadow: active ? `0 0 10px ${c}` : "none", animation: active ? "blink 1.4s infinite" : undefined, flexShrink: 0 }} />
  );
}

function Connector({ color }: { color: string }) {
  return (
    <div style={{ height: 14, display: "flex", justifyContent: "center", alignItems: "center" }}>
      <svg width="14" height="14">
        <line x1="7" y1="0" x2="7" y2="14" stroke={color} strokeWidth="1.4" className="flow-dash" />
        <path d="M3 9 L7 13 L11 9" fill="none" stroke={color} strokeWidth="1.4" />
      </svg>
    </div>
  );
}

function FeedbackBar({ on }: { on: boolean }) {
  const c = on ? "#2dd4bf" : "rgba(45,212,191,0.4)";
  return (
    <div
      style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 9px",
        borderRadius: 7,
        border: `1px solid ${on ? "#2dd4bf66" : "rgba(45,212,191,0.16)"}`,
        background: on ? "rgba(45,212,191,0.08)" : "transparent",
        transition: "all 0.3s",
      }}
    >
      <svg width="24" height="18" viewBox="0 0 24 18">
        <path d="M 20 4 L 4 4" fill="none" stroke={c} strokeWidth="1.2" strokeDasharray="3 3" className={on ? "flow-dash-fast" : undefined} />
        <path d="M 4 4 L 4 14 L 20 14" fill="none" stroke={c} strokeWidth="1.2" strokeDasharray="3 3" className={on ? "flow-dash-fast" : undefined} />
        <path d="M 20 14 L 16 11 M 20 14 L 16 17" fill="none" stroke={c} strokeWidth="1.2" />
      </svg>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: on ? "#5eead4" : "#7e8aa3" }}>优化反馈回环</div>
        <div style={{ fontSize: 8, letterSpacing: "0.06em", color: "#5f6f87", fontFamily: "var(--font-mono)" }}>Agent 3 → Agent 1 + 2 · FEEDBACK</div>
      </div>
      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, fontFamily: "var(--font-mono)", color: on ? "#5eead4" : "#475569", border: `1px solid ${on ? "#2dd4bf55" : "#334155"}` }}>
        {on ? "● FLOWING" : "○ IDLE"}
      </span>
    </div>
  );
}

function Readout({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 8.5, letterSpacing: "0.08em", color: "#5f6f87", fontFamily: "var(--font-mono)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "var(--font-mono)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pipeWrap: { position: "relative", marginTop: 4 },
  pipe: { display: "flex", flexDirection: "column" },
  agent: {
    border: "1px solid", borderRadius: 8, padding: "8px 10px",
    transition: "all 0.4s ease",
  },
  agentIdx: { width: 22, height: 22, borderRadius: 6, border: "1px solid", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, fontFamily: "var(--font-mono)" },
  coreTag: { fontSize: 8, marginLeft: 6, padding: "1px 5px", borderRadius: 3, background: "rgba(167,139,250,0.2)", color: "#c4b5fd", border: "1px solid rgba(167,139,250,0.4)", verticalAlign: "middle" },
  routerRow: { display: "flex", alignItems: "center", gap: 6, border: "1px solid", borderRadius: 5, padding: "3px 6px", transition: "all 0.3s" },
  routerDot: { width: 7, height: 7, borderRadius: "50%", border: "1px solid", flexShrink: 0 },
  chip: { fontSize: 8.5, padding: "1px 6px", borderRadius: 3, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.18)", color: "#9fc3e0", fontFamily: "var(--font-mono)" },
  readout: { display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(56,189,248,0.14)" },
};
