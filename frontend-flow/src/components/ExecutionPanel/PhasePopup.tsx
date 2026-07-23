// ============================================================================
// PhasePopup —— 右侧拓扑上的浮动「关键信息 + 大模型分析」面板(内容丰富,填满右侧)
//   上半:当前相位关键指标/摘要(原 PhaseSidebar 内容,各相位切换)
//   下半:大模型分析(LLM 风格叙事:标题 + 推理要点 + 结论,场景化)
//   右侧浮层 · 自适应内容高度 · 可滚动;诊断详情(异常/CHR/均质化/隔离)仍由
//   拓扑节点锚定的 SVG 弹窗承载。
// ============================================================================

import { Gauge } from "../shared/Gauge";
import { KpiChart } from "./KpiChart";
import { SkillLibrary } from "../SkillLibrary/SkillLibrary";
import { getKpi, GENERATION_CHECKS } from "../../story/director";
import { sample } from "../../data/kpi";
import { ROUTE_COLORS, PHASES, srColor, STATUS } from "../../theme";
import { llmAnalysis, METHOD_META } from "../../data/llm";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";

export function PhasePopup({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const phase = state.phaseIndex;
  const info = PHASES[phase];
  const llm = llmAnalysis(scenario, phase);
  const meta = METHOD_META[llm.method];
  const sr = sample(getKpi(scenario).overall, state.simT);
  const accent = phase === 6 ? "accent-ok" : phase === 2 || phase === 4 || phase === 5 ? "accent-warn" : "";
  const focus = currentFocus(phase, state.phaseProgress); // 与左侧方案执行呼应

  return (
    <div className={`fpop anchor-left ${accent}`} style={{ top: 10, left: 10, width: 244, display: "flex", flexDirection: "column", maxHeight: "calc(100% - 20px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="fpop-tag" style={{ marginBottom: 0 }}>
          <span className="pulse-dot" style={{ background: info.color, boxShadow: `0 0 8px ${info.color}` }} />
          PHASE {phase} · {info.en}
        </div>
        {/* 实时整网成功率(合并原 LIVE 读数) */}
        <div style={{ textAlign: "right", lineHeight: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: srColor(sr), fontFamily: "var(--font-mono)" }}>{(sr * 100).toFixed(2)}%</div>
          <div style={{ fontSize: 7, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>SR · T{state.simT.toFixed(0)}</div>
        </div>
      </div>
      <div className="fpop-title" style={{ marginTop: 4 }}>{info.cn}</div>
      {/* 当前执行焦点(与左侧方案流程呼应) */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, padding: "3px 7px", borderRadius: 5, background: "var(--accent-a20)", border: "1px solid var(--accent-a28)" }}>
        <span style={{ fontSize: 8, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>▶</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-bright)" }}>{focus}</span>
      </div>

      <div style={{ minHeight: 0, maxHeight: "calc(100vh - 280px)", overflowY: "auto", overflowX: "hidden", marginTop: 5, paddingRight: 3 }}>
        {/* 上半:相位关键信息 */}
        {phase === 0 && <P0 scenario={scenario} state={state} />}
        {phase === 1 && <P1 state={state} />}
        {phase === 2 && <P2 scenario={scenario} state={state} />}
        {phase === 3 && <P3 state={state} />}
        {phase === 4 && <P4 state={state} />}
        {phase === 5 && <P5 state={state} />}
        {phase === 6 && <P6 scenario={scenario} state={state} />}
        {phase === 7 && <P7 scenario={scenario} state={state} />}

        {/* 下半:分析(按相位实际方法:大模型 / 规则 / 算法) */}
        <div style={{ marginTop: 8, padding: "7px 8px", borderRadius: 7, border: `1px solid ${meta.color}59`, background: `${meta.color}0d` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <span style={{ fontSize: 10 }}>{meta.icon}</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, color: meta.color, fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>{meta.label}</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-bright)", marginBottom: 3 }}>{llm.title}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {llm.insights.map((t, i) => (
              <div key={i} style={{ fontSize: 8.8, color: "var(--text-soft)", lineHeight: 1.45, display: "flex", gap: 4 }}>
                <span style={{ color: meta.color, flexShrink: 0 }}>·</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
          {llm.verdict && (
            <div style={{ marginTop: 5, paddingTop: 4, borderTop: `1px dashed ${meta.color}4d`, fontSize: 8.8, fontWeight: 700, color: meta.color, lineHeight: 1.4 }}>{llm.verdict}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-detail)", letterSpacing: "0.04em", margin: "6px 0 3px" }}>{children}</div>;
}

/** 当前执行焦点(与左侧方案流程的激活 Agent / 步骤呼应) */
function currentFocus(phase: number, p: number): string {
  const agent = phase === 1 ? "Agent 1" : phase >= 2 && phase <= 6 ? "Agent 2" : phase === 7 ? "Agent 3" : "待命";
  let step = "";
  if (phase === 0) step = "全网稳态监测";
  else if (phase === 1) step = "数据采集 · LLM 校验";
  else if (phase === 2) step = p < 0.5 ? "② 拓扑分析" : "③ 异常检测";
  else if (phase === 3) step = "◇ 置信度研判";
  else if (phase === 4) step = p < 0.6 ? "④ 根因定位" : "⑤ 输出评估";
  else if (phase === 5) step = "⑥ 恢复策略";
  else if (phase === 6) step = "恢复验证";
  else if (phase === 7) step = "评估优化 · 沉淀";
  return `${agent} · ${step}`;
}

// —— 0 稳态 ——
function P0({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const sr = sample(kpi.overall, state.simT);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
        <Gauge value={sr} display={`${(sr * 100).toFixed(2)}%`} color={srColor(sr)} size={84} label="整网成功率" sub="全网稳态 · 监测待命" />
      </div>
      <Stat k="健康网元" v={`${scenario.realGraph?.nodes.length ?? 21} / ${scenario.realGraph?.nodes.length ?? 21}`} c={STATUS.healthy} />
      <Stat k="逐链路监测" v="待命 · 阈值 99.5%" c="var(--text-detail)" />
    </>
  );
}

// —— 1 数据采集 ——
function P1({ state }: { state: StoryState }) {
  const lit = Math.ceil(state.generationChecksReveal * GENERATION_CHECKS.length);
  return (
    <>
      <div style={{ fontSize: 9.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
        采集 <b style={{ color: "var(--text-bright)" }}>KPI</b> 逐链路 · <b style={{ color: "var(--text-bright)" }}>CHR</b> 原因值 · <b style={{ color: "var(--text-bright)" }}>3GPP</b> 信令
      </div>
      <SubTitle>LLM 多维校验闭环</SubTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {GENERATION_CHECKS.map((c, i) => {
          const on = i < lit;
          return (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, color: on ? "var(--text-soft)" : "var(--text-mid)" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, fontWeight: 800, background: on ? STATUS.healthy : "rgba(148,163,184,0.15)", color: on ? "#04070f" : "var(--text-mid)", border: `1px solid ${on ? STATUS.healthy : "rgba(148,163,184,0.3)"}` }}>{on ? "✓" : ""}</span>
              <span>{c.cn}</span>
            </div>
          );
        })}
      </div>
      <Stat k="入库遥测" v={`${(state.phaseProgress * 100).toFixed(0)}%`} c="#38bdf8" />
    </>
  );
}

// —— 2 异常检测 ——
function P2({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const degraded = scenario.realGraph
    ? scenario.realGraph.flowEdges.filter((e) => kpi.edges[e.id]?.some((v) => v < kpi.threshold)).length
    : Object.values(kpi.edges).filter((es) => es.some((v) => v < kpi.threshold)).length;
  const sr = sample(kpi.overall, state.simT);
  return (
    <>
      <SubTitle>KPI + CHR 双线并行</SubTitle>
      <KpiChart scenario={scenario} state={state} compact />
      <Stat k="整网聚合 SR" v={`${(sr * 100).toFixed(2)}%`} c={srColor(sr)} />
      <Stat k="异常链路" v={`${degraded} 条跌破阈值`} c={STATUS.fault} />
      {scenario.stormMetrics && <StormMetricsCard m={scenario.stormMetrics} />}
    </>
  );
}

/** 风暴过载指标卡(场景 D/E,phase 2):AMF/SMF CPU + 注册/会话突增 + 2C 影响 */
function StormMetricsCard({ m }: { m: NonNullable<Scenario["stormMetrics"]> }) {
  return (
    <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.07)" }}>
      <div style={{ fontSize: 8.5, fontWeight: 800, color: "#fbbf24", fontFamily: "var(--font-mono)", marginBottom: 3, letterSpacing: "0.04em" }}>⚠ 容器过载告警 + 突增 KPI</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 3 }}>
        <MetricBar label="AMF CPU" v={m.amfCpu} color="#f59e0b" />
        <MetricBar label="SMF CPU" v={m.smfCpu} color="#f59e0b" />
      </div>
      <Stat k="注册请求突增" v={`+${m.regSurge}%`} c={STATUS.fault} />
      <Stat k="PDU 会话突增" v={`+${m.sessionSurge}%`} c={STATUS.fault} />
      <div style={{ fontSize: 8.8, color: "#fbbf24", marginTop: 3, lineHeight: 1.4 }}>Phones {m.impact2c}</div>
    </div>
  );
}

function MetricBar({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--text-mid)", marginBottom: 1 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", color: color, fontWeight: 700 }}>{v}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(148,163,184,0.18)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${v}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

// —— 3 置信度研判 ——
function P3({ state }: { state: StoryState }) {
  const c = state.confidence;
  const rc = state.route ? ROUTE_COLORS[state.route] : null;
  if (!c || !rc) return <Empty text="研判中…" />;
  const dims = [
    { k: "模式强度", v: c.pattern, w: 0.4 },
    { k: "异常严重", v: c.severity, w: 0.2 },
    { k: "时序清晰", v: c.temporal, w: 0.15 },
    { k: "空间清晰", v: c.spatial, w: 0.15 },
    { k: "模糊度", v: c.ambiguity, w: 0.1 },
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: rc.base, fontFamily: "var(--font-mono)", lineHeight: 1 }}>{c.score.toFixed(2)}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: rc.base }}>→ {rc.cn}</span>
      </div>
      <div style={{ fontSize: 8.5, color: "var(--text-mid)", margin: "3px 0 5px" }}>{c.patternName}</div>
      <SubTitle>多维特征加权</SubTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {dims.map((d) => (
          <div key={d.k}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: "var(--text-detail)", marginBottom: 1 }}>
              <span>{d.k} <span style={{ color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>×{d.w}</span></span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-bright)" }}>{d.v.toFixed(2)}</span>
            </div>
            <div style={{ height: 4, borderRadius: 3, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${d.v * 100}%`, background: rc.base, borderRadius: 3, transition: "width 0.4s ease" }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// —— 4 根因推理(推理链)——
function P4({ state }: { state: StoryState }) {
  const steps = state.reasoningSteps;
  if (!steps.length) return <Empty text="推理展开中…" />;
  const typeIcon: Record<string, string> = { thinking: "💭", tool_call: "🔧", tool_result: "↳", conclusion: "🎯" };
  const shown = steps.slice(-5); // 最近的 5 步,避免过长
  return (
    <>
      <SubTitle>推理链 · Agent Loop {steps.length > 5 ? `(近5/${steps.length})` : ""}</SubTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {shown.map((s, i) => {
          const isConcl = s.type === "conclusion";
          const isLatest = i === shown.length - 1 && !isConcl; // 最新一步(重点高亮)
          return (
            <div key={s.n} style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${isConcl ? STATUS.fault + "66" : isLatest ? "var(--accent)" : "rgba(148,163,184,0.18)"}`, background: isConcl ? "rgba(239,68,68,0.08)" : isLatest ? "var(--accent-a20)" : "rgba(10,16,30,0.4)", boxShadow: isLatest ? "0 0 10px var(--accent-glow)" : "none", transition: "all 0.3s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
                <span style={{ fontSize: 7.5, fontWeight: 800, color: isConcl ? STATUS.faultGlow : "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{typeIcon[s.type] ?? "·"} #{s.n}</span>
                {s.tool && <span style={{ fontSize: 7, fontFamily: "var(--font-mono)", color: "var(--text-detail)" }}>{s.tool}</span>}
              </div>
              <div style={{ fontSize: 9, color: "var(--text-soft)", lineHeight: 1.4 }}>{s.text}</div>
              {s.result && <div style={{ fontSize: 8.5, color: isConcl ? STATUS.faultGlow : "#7dd3fc", fontFamily: "var(--font-mono)", marginTop: 1 }}>→ {s.result}</div>}
            </div>
          );
        })}
      </div>
      {state.ufdrPopup && (
        <div style={{ marginTop: 7, padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(45,212,191,0.45)", background: "rgba(45,212,191,0.07)" }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: "#5eead4", fontFamily: "var(--font-mono)", marginBottom: 3, letterSpacing: "0.04em" }}>🔎 UFDR 溯源 · 流控定位</div>
          <div style={{ fontSize: 9, color: "var(--text-soft)" }}>① {state.ufdrPopup.sstLabel}: <b style={{ color: "#2dd4bf" }}>+{state.ufdrPopup.sstSurge}%</b></div>
          <div style={{ fontSize: 9, color: "var(--text-soft)" }}>② {state.ufdrPopup.dnnLabel}: <b style={{ color: "#2dd4bf" }}>+{state.ufdrPopup.dnnSurge}%</b></div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#5eead4", marginTop: 2 }}>{state.ufdrPopup.summary}</div>
        </div>
      )}
    </>
  );
}

// —— 5 恢复执行 ——
function P5({ state }: { state: StoryState }) {
  const actions = state.recoveryActions;
  const cordoned = state.cordonedNe;
  return (
    <>
      <SubTitle>恢复策略 · 网络自愈</SubTitle>
      {actions.length === 0 ? (
        <Empty text="编排恢复策略中…" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {actions.map((a, i) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, color: "var(--text-soft)" }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#f59e0b", color: "#04070f", fontSize: 8.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
              <span>{a.cn}</span>
            </div>
          ))}
        </div>
      )}
      {cordoned.length > 0 && (
        <div style={{ marginTop: 5, padding: "4px 6px", borderRadius: 6, border: `1px dashed ${STATUS.fault}88`, background: "rgba(239,68,68,0.06)" }}>
          <div style={{ fontSize: 8, color: "var(--text-mid)", fontFamily: "var(--font-mono)", marginBottom: 1 }}>隔离围栏 ISOLATION</div>
          <div style={{ fontSize: 9.5, color: STATUS.faultGlow, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{cordoned.join(" · ")}</div>
        </div>
      )}
      {state.flowControlPopup && (() => {
        const fc = state.flowControlPopup!;
        const isNet = fc.kind === "net_admission";
        const col = isNet ? "#c4b5fd" : "#fbbf24";
        return (
          <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, border: `1px solid ${isNet ? "rgba(167,139,250,0.45)" : "rgba(245,158,11,0.45)"}`, background: isNet ? "rgba(167,139,250,0.07)" : "rgba(245,158,11,0.07)" }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, color: col, fontFamily: "var(--font-mono)", marginBottom: 3, letterSpacing: "0.04em" }}>🛡 流控策略 · {isNet ? "网络侧限流" : "UE 侧 back-off"}</div>
            <div style={{ fontSize: 9, color: "var(--text-soft)" }}>溯源 ▸ {fc.target}</div>
            {fc.measures.map((m, i) => (<div key={i} style={{ fontSize: 9, color: "var(--text-soft)" }}>· {m}</div>))}
            {fc.ratio && (<div style={{ fontSize: 8.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", marginTop: 2 }}>比例 · NSSAI {fc.ratio.nssai}% / APN {fc.ratio.apn}% · {fc.ratio.algo}</div>)}
            {fc.ratio?.basis && (<div style={{ fontSize: 8.3, color: "var(--text-detail)", lineHeight: 1.4, marginTop: 2 }}>▸ {fc.ratio.basis}</div>)}
            <div style={{ fontSize: 9, fontWeight: 700, color: STATUS.healthy, marginTop: 2 }}>{fc.converged ? "✓ " : ""}{fc.summary}</div>
          </div>
        );
      })()}
    </>
  );
}

// —— 6 网络恢复 ——
function P6({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const sr = sample(kpi.overall, state.simT);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
        <Gauge value={sr} display={`${(sr * 100).toFixed(2)}%`} color={srColor(sr)} size={84} label="成功率回升" sub="闭环验证通过" />
      </div>
      <Stat k="网络状态" v={sr >= kpi.threshold ? "已自愈 · 全网健康" : "恢复中…"} c={sr >= kpi.threshold ? STATUS.healthy : STATUS.warning} />
    </>
  );
}

// —— 7 评估沉淀 ——
function P7({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const m = state.evalMetrics;
  return (
    <>
      {m && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 7.5, padding: "2px 6px", borderRadius: 4, color: STATUS.healthy, border: `1px solid ${STATUS.healthy}66`, fontFamily: "var(--font-mono)" }}>{m.category}</span>
            <div style={{ display: "flex", gap: 8, fontSize: 9.5, fontFamily: "var(--font-mono)", color: "var(--text-detail)" }}>
              <span>P<b style={{ color: "var(--text-bright)" }}>{m.precision.toFixed(2)}</b></span>
              <span>R<b style={{ color: "var(--text-bright)" }}>{m.recall.toFixed(2)}</b></span>
              <span>F1<b style={{ color: "var(--text-bright)" }}>{m.f1.toFixed(2)}</b></span>
            </div>
          </div>
          <SubTitle>推理链质析</SubTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { k: "逻辑连贯", v: m.traceAxes.logicalCoherence },
              { k: "工具效率", v: m.traceAxes.toolEfficiency },
              { k: "证据质量", v: m.traceAxes.evidenceQuality },
            ].map((a) => (
              <div key={a.k}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: "var(--text-detail)", marginBottom: 1 }}>
                  <span>{a.k}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-bright)" }}>{(a.v * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 3, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${a.v * 100}%`, background: "#2dd4bf", borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {scenario.faultReport && (
        <div style={{ marginTop: 7, padding: "7px 8px", borderRadius: 6, border: "1px solid rgba(167,139,250,0.45)", background: "rgba(167,139,250,0.07)" }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: "#c4b5fd", fontFamily: "var(--font-mono)", marginBottom: 4, letterSpacing: "0.04em" }}>🤖 大模型 · 故障报告总结</div>
          <ReportRow k="根因" v={scenario.faultReport.rootCause} />
          <ReportRow k="现象" v={scenario.faultReport.phenomenon} />
          <ReportRow k="影响" v={scenario.faultReport.impact} />
          <ReportRow k="处置" v={scenario.faultReport.action} />
          <ReportRow k="结果" v={scenario.faultReport.outcome} accent />
        </div>
      )}
      <SkillLibrary scenario={scenario} state={state} />
    </>
  );
}

function ReportRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ fontSize: 8.8, color: accent ? "#c4b5fd" : "var(--text-soft)", lineHeight: 1.45, marginBottom: 2, display: "flex", gap: 4 }}>
      <span style={{ color: "var(--text-dim)", flexShrink: 0, minWidth: 30 }}>{k}</span>
      <span style={accent ? { fontWeight: 700 } : undefined}>{v}</span>
    </div>
  );
}

function Stat({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px", borderRadius: 5, background: "rgba(10,16,30,0.4)", border: "1px solid var(--border)", marginTop: 4 }}>
      <span style={{ fontSize: 9, color: "var(--text-mid)" }}>{k}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: c, fontFamily: "var(--font-mono)" }}>{v}</span>
    </div>
  );
}

function Empty({ text = "— 无数据 —" }: { text?: string }) {
  return <div style={{ fontSize: 10, color: "var(--text-mid)", textAlign: "center", padding: "12px 0" }}>{text}</div>;
}
