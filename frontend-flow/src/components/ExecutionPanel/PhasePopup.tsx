// ============================================================================
// PhasePopup —— 右侧拓扑上的浮动「关键信息 + 大模型分析」面板(内容丰富,填满右侧)
//   上半:当前相位关键指标/摘要(原 PhaseSidebar 内容,各相位切换)
//   下半:大模型分析(LLM 风格叙事:标题 + 推理要点 + 结论,场景化)
//   右侧浮层 · 自适应内容高度 · 可滚动;诊断详情(异常/CHR/均质化/隔离)仍由
//   拓扑节点锚定的 SVG 弹窗承载。
// ============================================================================

import { useEffect, useRef, Fragment } from "react";
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
  // 分析步逐步揭示数(随相位进度);相位≥6 后序阶段直接全显
  const aStepsVisible = phase >= 6 ? llm.steps.length : Math.max(0, Math.ceil((state.phaseProgress - 0.15) * llm.steps.length));
  const showAnalysis = state.phaseProgress > 0.15 || phase >= 6;
  const showVerdict = state.phaseProgress > 0.85 || phase >= 6;

  // 内容区自动滚动:内容增多(推理步/恢复动作/分析步揭示)→ 滚到底保持新增可见;相位切换重置 → 回顶部
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const len = state.reasoningSteps.length + state.recoveryActions.length + Math.max(0, aStepsVisible);
    if (len >= prevLenRef.current) el.scrollTop = el.scrollHeight;
    else el.scrollTop = 0;
    prevLenRef.current = len;
  }, [state.reasoningSteps.length, state.recoveryActions.length, aStepsVisible]);

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

      {/* 评估未通过 → 进入循环探索(B/C ⑤评估未通过=loop① / E Agent3未恢复=loop②)*/}
      {state.loopBackKind && (
        <div className="alert-ring" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, padding: "5px 8px", borderRadius: 6, background: "rgba(245,158,11,0.12)", border: "1px solid #f59e0b", boxShadow: "0 0 12px rgba(245,158,11,0.25)" }}>
          <span style={{ fontSize: 12 }}>⚠</span>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: "#fbbf24", fontFamily: "var(--font-mono)" }}>
              {state.loopBackKind === "loop1" ? "⑤ 输出评估未通过 · 置信度不足" : "Agent3 评估 · 网络未恢复"}
            </div>
            <div style={{ fontSize: 8.5, color: "var(--text-soft)" }}>
              {state.loopBackKind === "loop1" ? "loop① 回 Agent1 补采 → 第二轮重新执行" : "loop② 回 Agent1 → 第二轮重新执行"}
            </div>
          </div>
        </div>
      )}

      {/* SIM 模式:实时仿真指标(全网 CPU 概览 + 注册/会话速率 + 2C 限流) */}
      {state.simRates && (
        <div style={{ marginTop: 4, padding: "5px 7px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.05)", display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
          <SimStat label="AMF" v={`${state.simRates.amfCpu.toFixed(0)}%`} c={state.simRates.amfCpu >= 85 ? STATUS.fault : state.simRates.amfCpu >= 70 ? STATUS.warning : STATUS.healthy} />
          <SimStat label="SMF" v={`${state.simRates.smfCpu.toFixed(0)}%`} c={state.simRates.smfCpu >= 85 ? STATUS.fault : state.simRates.smfCpu >= 70 ? STATUS.warning : STATUS.healthy} />
          <SimStat label="注册" v={`${state.simRates.regRate.toFixed(0)}/s`} c="#38bdf8" />
          <SimStat label="会话" v={`${state.simRates.sessionRate.toFixed(0)}/s`} c="#a78bfa" />
          <SimStat label="物联重注" v={`${state.simRates.iotRegRate.toFixed(0)}/s`} c="#f59e0b" />
          <SimStat label="2C限流" v={`${(state.simRates.twoCThrottle * 100).toFixed(0)}%`} c={state.simRates.twoCThrottle > 0.1 ? STATUS.fault : "var(--text-mid)"} />
        </div>
      )}

      <div ref={scrollRef} style={{ minHeight: 0, maxHeight: "calc(100vh - 320px)", overflowY: "auto", overflowX: "hidden", marginTop: 5, paddingRight: 3 }}>
        {/* 分析引导(非推理相位4/报告相位7:方法步在顶部融入流程,不再固定底部)*/}
        {phase !== 4 && phase !== 7 && showAnalysis && (
          <>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 9 }}>{meta.icon}</span>
              <span style={{ fontSize: 8, fontWeight: 800, color: meta.color, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{meta.label}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-bright)" }}>{llm.title}</span>
              {llm.principle && (
                <span style={{ fontSize: 7.5, fontWeight: 700, color: meta.color, fontFamily: "var(--font-mono)", padding: "1px 5px", borderRadius: 3, background: `${meta.color}14`, border: `1px solid ${meta.color}33`, letterSpacing: "0.02em" }}>📐 {llm.principle}</span>
              )}
            </div>
            {llm.steps.slice(0, Math.max(1, aStepsVisible)).map((st, i) => {
              const mm = METHOD_META[st.method ?? llm.method];
              return (
                <div key={i} style={{ fontSize: 8.8, color: "var(--text-soft)", lineHeight: 1.45, display: "flex", gap: 5, alignItems: "flex-start", marginBottom: 3, animation: "float-up 0.3s ease" }}>
                  <span style={{ fontSize: 8.5, flexShrink: 0, marginTop: 1 }}>{mm.icon}</span>
                  <span>
                    <span style={{ fontSize: 8, fontWeight: 800, color: mm.color, fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>{st.label}</span>
                    <span style={{ display: "block", marginTop: 1 }}>{st.text}</span>
                  </span>
                </div>
              );
            })}
            {showVerdict && llm.verdict && (
              <div style={{ marginTop: 4, marginBottom: 4, fontSize: 8.8, fontWeight: 700, color: meta.color, lineHeight: 1.4, padding: "4px 6px", borderRadius: 5, background: `${meta.color}0d`, borderLeft: `2px solid ${meta.color}` }}>→ {llm.verdict}</div>
            )}
          </>
        )}

        {/* 相位关键信息(phase4 推理链内嵌分析,phase7 故障报告)*/}
        {phase === 0 && <P0 scenario={scenario} state={state} />}
        {phase === 1 && <P1 state={state} />}
        {phase === 2 && <P2 scenario={scenario} state={state} />}
        {phase === 3 && <P3 state={state} />}
        {phase === 4 && <P4 scenario={scenario} state={state} />}
        {phase === 5 && <P5 state={state} />}
        {phase === 6 && <P6 scenario={scenario} state={state} />}
        {phase === 7 && <P7 scenario={scenario} state={state} />}
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

// —— 4 根因推理(推理链 + 内嵌 CHR/算法/大模型分析,逐步往下,不再固定底部)——
function P4({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const steps = state.reasoningSteps;
  const analysis = llmAnalysis(scenario, 4);
  const meta = METHOD_META[analysis.method];
  const p = state.phaseProgress;
  const aVisible = Math.max(0, Math.ceil((p - 0.15) * analysis.steps.length));
  const showVerdict = p > 0.85;
  const shown = steps.slice(-10); // 最近 10 步
  const typeIcon: Record<string, string> = { thinking: "💭", tool_call: "🔧", tool_result: "↳", conclusion: "🎯" };
  // 推理步在 mid 处插入分析块(根因点),让 CHR/算法/大模型嵌入推理链中段
  const mid = Math.max(1, Math.ceil(shown.length / 2));
  if (!shown.length && aVisible <= 0) return <Empty text="推理展开中…" />;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
        <span style={{ fontSize: 9 }}>{meta.icon}</span>
        <span style={{ fontSize: 8, fontWeight: 800, color: meta.color, fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>{meta.label}</span>
        {analysis.principle && <span style={{ fontSize: 7.5, fontWeight: 700, color: meta.color, fontFamily: "var(--font-mono)", padding: "1px 5px", borderRadius: 3, background: `${meta.color}14`, border: `1px solid ${meta.color}33` }}>📐 {analysis.principle}</span>}
      </div>
      <SubTitle>推理链 · Agent Loop {steps.length > 5 ? `(${shown.length}/${steps.length})` : ""}</SubTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {shown.map((s, i) => {
          const isConcl = s.type === "conclusion";
          const isLatest = i === shown.length - 1 && !isConcl;
          return (
            <Fragment key={s.n}>
              <div style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${isConcl ? STATUS.fault + "66" : isLatest ? "var(--accent)" : "rgba(148,163,184,0.18)"}`, background: isConcl ? "rgba(239,68,68,0.08)" : isLatest ? "var(--accent-a20)" : "rgba(10,16,30,0.4)", boxShadow: isLatest ? "0 0 10px var(--accent-glow)" : "none", transition: "all 0.3s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
                  <span style={{ fontSize: 7.5, fontWeight: 800, color: isConcl ? STATUS.faultGlow : "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{typeIcon[s.type] ?? "·"} #{s.n}</span>
                  {s.tool && <span style={{ fontSize: 7, fontFamily: "var(--font-mono)", color: "var(--text-detail)" }}>{s.tool}</span>}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-soft)", lineHeight: 1.4 }}>{s.text}</div>
                {s.result && <div style={{ fontSize: 8.5, color: isConcl ? STATUS.faultGlow : "#7dd3fc", fontFamily: "var(--font-mono)", marginTop: 1 }}>→ {s.result}</div>}
              </div>
              {/* 在中段(根因点)嵌入分析步 + 饼图,逐步揭示 */}
              {i === mid - 1 && aVisible > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "5px 6px", borderRadius: 6, border: `1px solid ${meta.color}33`, background: `${meta.color}0a` }}>
                  {analysis.steps.slice(0, aVisible).map((st, j) => {
                    const mm = METHOD_META[st.method ?? analysis.method];
                    return (
                      <div key={j} style={{ fontSize: 8.8, color: "var(--text-soft)", lineHeight: 1.45, display: "flex", gap: 5, alignItems: "flex-start", animation: "float-up 0.3s ease" }}>
                        <span style={{ fontSize: 8.5, flexShrink: 0, marginTop: 1 }}>{mm.icon}</span>
                        <span>
                          <span style={{ fontSize: 8, fontWeight: 800, color: mm.color, fontFamily: "var(--font-mono)" }}>{st.label}</span>
                          <span style={{ display: "block", marginTop: 1 }}>{st.text}</span>
                        </span>
                      </div>
                    );
                  })}
                  {state.chrPopup && <ChrPie chr={state.chrPopup} />}
                </div>
              )}
            </Fragment>
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
      {showVerdict && analysis.verdict && (
        <div style={{ marginTop: 4, fontSize: 8.8, fontWeight: 700, color: meta.color, lineHeight: 1.4, padding: "4px 6px", borderRadius: 5, background: `${meta.color}0d`, borderLeft: `2px solid ${meta.color}` }}>→ {analysis.verdict}</div>
      )}
    </>
  );
}

// —— 5 恢复执行 ——
function P5({ state }: { state: StoryState }) {
  const actions = state.recoveryActions;
  const cordoned = state.cordonedNe;
  // B/C 首轮:评估未通过,不执行恢复,loop② 回 Agent1 补采
  const evalFailedLoop = (state.scenarioId === "B" || state.scenarioId === "C") && state.round === 1 && actions.length === 0;
  return (
    <>
      <SubTitle>恢复策略 · 网络自愈</SubTitle>
      {actions.length === 0 ? (
        evalFailedLoop ? (
          <div style={{ padding: "6px 8px", borderRadius: 6, border: "1px dashed #f59e0b88", background: "rgba(245,158,11,0.07)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#fbbf24", fontFamily: "var(--font-mono)" }}>🤖 评估未通过 · 置信度不足</div>
            <div style={{ fontSize: 8.5, color: "var(--text-soft)", marginTop: 2 }}>loop② 回 Agent1 补采数据 → Agent2 第二轮重新执行</div>
          </div>
        ) : (
          <Empty text="编排恢复策略中…" />
        )
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
  return (
    <>
      {scenario.faultReport && (
        <div style={{ marginTop: 4, padding: "7px 8px", borderRadius: 6, border: "1px solid rgba(167,139,250,0.45)", background: "rgba(167,139,250,0.07)" }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#c4b5fd", fontFamily: "var(--font-mono)", marginBottom: 4, letterSpacing: "0.04em" }}>🤖 Agent3 · 大模型故障报告</div>
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

/** SIM 实时指标小标签(label + value) */
function SimStat({ label, v, c }: { label: string; v: string; c: string }) {
  return (
    <span style={{ fontSize: 8, fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--text-dim)" }}>{label} </span>
      <span style={{ fontWeight: 700, color: c }}>{v}</span>
    </span>
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

/** 紧凑原因值饼图(场景 B/C,根因推理阶段):主导 vs 终端噪声 —— 内联到推理流中 */
function donutSeg(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const pt = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [sx0, sy0] = pt(rOut, a0), [ex0, ey0] = pt(rOut, a1), [sx1, sy1] = pt(rIn, a1), [ex1, ey1] = pt(rIn, a0);
  return `M ${sx0} ${sy0} A ${rOut} ${rOut} 0 ${large} 1 ${ex0} ${ey0} L ${sx1} ${sy1} A ${rIn} ${rIn} 0 ${large} 0 ${ex1} ${ey1} Z`;
}
function ChrPie({ chr }: { chr: NonNullable<StoryState["chrPopup"]> }) {
  const NOISE = ["#38bdf8", "#f472b6", "#2dd4bf", "#facc15", "#fb923c"];
  const related = chr.related ?? [];
  const domShare = chr.share ?? 60;
  const segs = [
    { cn: chr.causeCn, code: chr.causeCode, share: domShare, color: "#a78bfa", dom: true },
    ...related.map((r, i) => ({ cn: r.cn, code: r.code, share: r.share ?? 8, color: NOISE[i % NOISE.length], dom: false })),
  ];
  const total = segs.reduce((a, s) => a + s.share, 0) || 1;
  let acc = 0;
  const arcs = segs.map((s) => { const a0 = (acc / total) * Math.PI * 2; acc += s.share; return { ...s, a0, a1: (acc / total) * Math.PI * 2 }; });
  const noiseShare = related.reduce((a, r) => a + (r.share ?? 8), 0);
  const cx = 26, cy = 26, rO = 22, rI = 14;
  return (
    <div style={{ marginTop: 6, padding: "5px 7px", borderRadius: 6, border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.06)" }}>
      <div style={{ fontSize: 8.5, fontWeight: 800, color: "#c4b5fd", fontFamily: "var(--font-mono)", marginBottom: 3, letterSpacing: "0.04em" }}>🥧 CHR 原因值分布 · 降噪→聚类</div>
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        <svg width={52} height={52} viewBox="0 0 52 52" style={{ flexShrink: 0 }}>
          {arcs.map((s, i) => (<path key={i} d={donutSeg(cx, cy, rO, rI, s.a0, s.a1)} fill={s.color} opacity={s.dom ? 0.95 : 0.55} stroke="rgba(10,16,30,0.6)" strokeWidth={0.6} />))}
          <text x={cx} y={cy - 1} textAnchor="middle" fontSize={9} fontWeight={800} fill="var(--text-bright)" fontFamily="var(--font-mono)">{Math.round(domShare)}%</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={5} fill="var(--text-dim)" fontFamily="var(--font-sans)">主导</text>
        </svg>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <div style={{ fontSize: 8.5, color: "#a78bfa", fontWeight: 700, fontFamily: "var(--font-mono)" }}>● {chr.causeCode} {chr.causeCn} · {Math.round(domShare)}%</div>
          <div style={{ fontSize: 7.8, color: "var(--text-mid)" }}>终端噪声 {Math.round(noiseShare)}%(降噪剔除):{related.map((r) => r.code).join(" · ")}</div>
        </div>
      </div>
    </div>
  );
}
