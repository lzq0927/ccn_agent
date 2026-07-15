// ============================================================================
// GenerationPanel —— Agent 1 数据采集:现网采集校验 + 5 项 LLM 校验灯(逐项点亮)
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { STATUS } from "../../theme";
import { HudFrame } from "../shared/HudFrame";

export function GenerationPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const f = scenario.fault;
  const reveal = state.generationChecksReveal;
  const checks = state.generationChecks;
  const nodes = scenario.realGraph?.nodes.length ?? 0;

  return (
    <HudFrame title="数据采集 · 多维校验" subtitle="AGENT 1 · DATA COLLECTION" right={<span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>case_{scenario.id}</span>}>
      <div style={{ fontSize: 10, color: "var(--text-mid)", marginBottom: 8, lineHeight: 1.5 }}>
        现网实时采集网络遥测(KPI / 拓扑 / 业务流 / CHR),LLM 校验器从 5 个维度检查数据质量;不通过则重新采集(自校验闭环)。
      </div>

      {/* 采集数据(校验前) */}
      <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>采集数据 · COLLECTED TELEMETRY</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Collected k="KPI 时序" v="链路·会话·追踪" />
        <Collected k="网络拓扑" v={`${nodes} 网元`} />
        <Collected k="业务流程" v={`${f.ueCount} UE`} />
        <Collected k="CHR 记录" v="呼叫历史" />
      </div>

      {/* 校验灯 */}
      <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>LLM VALIDATOR · 5 CHECKS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {checks.map((c, i) => {
          const lit = reveal > (i + 0.2) / checks.length;
          return (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, border: `1px solid ${lit ? STATUS.healthy + "44" : "rgba(56,189,248,0.1)"}`, background: lit ? `${STATUS.healthy}0a` : "transparent", opacity: lit ? 1 : 0.5 }}>
              <span
                style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: lit ? STATUS.healthy : "#1e293b", border: `1px solid ${lit ? STATUS.healthy : "#334155"}`,
                  boxShadow: lit ? `0 0 8px ${STATUS.healthy}` : "none", animation: lit && i === Math.floor(reveal * checks.length) - 1 ? "blink 0.8s 2" : undefined,
                }}
              />
              <span style={{ fontSize: 10, color: lit ? "var(--text-soft)" : "var(--text-dim)", flex: 1 }}>{c.cn}</span>
              <span style={{ fontSize: 8, color: lit ? STATUS.healthy : "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{lit ? "PASS" : "····"}</span>
            </div>
          );
        })}
      </div>

      {/* 进度 */}
      <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: "var(--accent-soft)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${reveal * 100}%`, background: STATUS.notice, boxShadow: `0 0 8px ${STATUS.notice}`, transition: "width 0.4s ease" }} className="shimmer" />
      </div>
      <div style={{ fontSize: 9, color: "var(--text-faint)", marginTop: 5, fontFamily: "var(--font-mono)" }}>{reveal >= 1 ? "✓ 校验通过 · 用例入库" : "校验中…"}</div>
    </HudFrame>
  );
}

function Collected({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ border: "1px solid rgba(34,197,94,0.25)", borderRadius: 5, padding: "4px 7px", background: "rgba(34,197,94,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS.healthy, boxShadow: `0 0 5px ${STATUS.healthy}` }} />
        <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{k}</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-soft)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{v}</div>
    </div>
  );
}
