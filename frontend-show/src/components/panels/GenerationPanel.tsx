// ============================================================================
// GenerationPanel —— Agent 1 数据生成:仿真参数 + 5 项 LLM 校验灯(逐项点亮)
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { STATUS } from "../../theme";
import { HudFrame } from "../shared/HudFrame";

export function GenerationPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const f = scenario.fault;
  const reveal = state.generationChecksReveal;
  const checks = state.generationChecks;

  return (
    <HudFrame title="数据生成 · 仿真自校验" subtitle="AGENT 1 · SIMULATION" right={<span style={{ fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)" }}>case_{scenario.id}</span>}>
      <div style={{ fontSize: 10, color: "#9fb0c9", marginBottom: 8, lineHeight: 1.5 }}>
        离散事件仿真器生成故障用例,LLM 校验器从 5 个维度检查;不通过则调参重试(自校验闭环)。
      </div>

      {/* 用例参数 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Meta k="故障类型" v={f.faultType} />
        <Meta k="故障模式" v={f.faultMode} />
        <Meta k="难度" v={f.difficulty} />
        <Meta k="UE 数" v={String(f.ueCount)} />
        <Meta k="loss_rate" v={f.lossRate.toFixed(4)} />
        <Meta k="故障窗" v={`T${f.faultStart}-${f.faultStart + f.faultDuration}`} />
      </div>

      {/* 校验灯 */}
      <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#5f6f87", fontFamily: "var(--font-mono)", marginBottom: 6 }}>LLM VALIDATOR · 5 CHECKS</div>
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
              <span style={{ fontSize: 10, color: lit ? "#cde7ff" : "#7e8aa3", flex: 1 }}>{c.cn}</span>
              <span style={{ fontSize: 8, color: lit ? STATUS.healthy : "#475569", fontFamily: "var(--font-mono)" }}>{lit ? "PASS" : "····"}</span>
            </div>
          );
        })}
      </div>

      {/* 进度 */}
      <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: "rgba(56,189,248,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${reveal * 100}%`, background: STATUS.notice, boxShadow: `0 0 8px ${STATUS.notice}`, transition: "width 0.4s ease" }} className="shimmer" />
      </div>
      <div style={{ fontSize: 9, color: "#5f6f87", marginTop: 5, fontFamily: "var(--font-mono)" }}>{reveal >= 1 ? "✓ 校验通过 · 用例入库" : "校验中…"}</div>
    </HudFrame>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ border: "1px solid rgba(56,189,248,0.12)", borderRadius: 5, padding: "4px 7px", background: "rgba(10,16,30,0.5)" }}>
      <div style={{ fontSize: 8, color: "#5f6f87", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{k}</div>
      <div style={{ fontSize: 10.5, color: "#cde7ff", fontFamily: "var(--font-mono)", marginTop: 1 }}>{v}</div>
    </div>
  );
}
