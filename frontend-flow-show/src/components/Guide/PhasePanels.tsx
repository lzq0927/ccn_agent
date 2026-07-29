// ============================================================================
// PhasePanels —— 富弹窗各相位内容(渲染在 StageCanvas 右上 foreignObject 内)
//   · AnomalyPanel(②检测):KPI 曲线 + 过载告警 + CHR 分布(画出异常)
//   · MatchPanel(③匹配):置信度 + 路由 + 为什么命中该策略(匹配逻辑)
//   · ReasonPanel(④推理):推理步骤链 + 根因
//   · DispatchPanel(⑤下发):3 策略(场景 F)+ 目标 + 当前轮参数
//   · EvalPanel(⑦评估):沉淀了什么 Skill / 优化什么(无真值对比)
// ============================================================================

import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";
import { ROUTE_COLORS, STATUS, srColor } from "../../theme";
import { getKpi } from "../../story/director";
import { sample } from "../../data/kpi";

/* ————————————————————— ② 异常检测:画出异常图 ————————————————————— */
export function AnomalyPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const overall = kpi.overall;
  const cur = sample(overall, simT);
  const isStorm = scenario.fault.faultType === "iot_storm";
  // KPI 曲线点(0..100 x, SR 映射)
  const W = 318, H = 56;
  const xAt = (i: number) => (i / (overall.length - 1)) * W;
  const yAt = (v: number) => H - 4 - ((v - 0.8) / 0.2) * (H - 8);
  // 实时:只画到当前 simT(未来不展示)
  const curI = Math.min(Math.max(Math.floor(simT) - 1, 0), overall.length - 1);
  const pts = overall.slice(0, Math.max(2, curI + 2)).map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const curX = xAt(curI);
  const fs = kpi.faultStart, fe = kpi.faultEnd;
  const winX0 = ((fs - 1) / 59) * W, winW = ((fe - fs) / 59) * W;
  // CHR top causes(若有)
  const chr = scenario.chrInsight;
  const related = chr?.related ?? [];
  // 过载 NE(storm:scenario.fault.elements)
  const overloadNEs = isStorm ? scenario.fault.elements : [];

  return (
    <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
      <Row label="整网成功率" val={`${(cur * 100).toFixed(2)}%`} valC={srColor(cur)} />
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>KPI 时序 · 逐链路成功率</div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
          <rect x={winX0} y={0} width={winW} height={H} fill="rgba(239,68,68,0.08)" />
          <line x1={0} y1={yAt(kpi.threshold)} x2={W} y2={yAt(kpi.threshold)} stroke="rgba(245,158,11,0.6)" strokeWidth={0.8} strokeDasharray="3 3" />
          <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth={1.6} />
          <circle cx={curX} cy={yAt(cur)} r={2.4} fill={srColor(cur)} />
        </svg>
      </div>

      {isStorm && scenario.stormMetrics && (() => {
        const m = scenario.stormMetrics;
        const isG = m.udmCpu != null;
        const bars = isG
          ? [{ id: "UDM_1", cpu: m.udmCpu as number }, { id: "AMF(正常)", cpu: m.amfCpu }, { id: "SMF(正常)", cpu: m.smfCpu }]
          : overloadNEs.map((id) => ({ id, cpu: id.replace(/_\d+$/, "") === "AMF" ? m.amfCpu : m.smfCpu }));
        return (
          <div style={{ marginTop: 8, padding: "8px 9px", borderRadius: 7, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.07)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#fbbf24", fontFamily: "var(--font-mono)", marginBottom: 5 }}>⚠ 容器过载告警{isG ? "(UDM · AMF/SMF 不过载)" : ""}</div>
            {bars.map((b) => <CpuBar key={b.id} id={b.id} cpu={b.cpu} />)}
            <div style={{ fontSize: 10.5, color: "#fbbf24", marginTop: 5 }}>注册请求 +{m.regSurge}% · PDU 会话 +{m.sessionSurge}%{isG && m.msgToUdmSurge ? ` · AMF/SMF→UDM 消息 +${m.msgToUdmSurge}%` : ""}</div>
          </div>
        );
      })()}

      {chr && (
        <div style={{ marginTop: 8, padding: "8px 9px", borderRadius: 7, border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.07)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#c4b5fd", fontFamily: "var(--font-mono)", marginBottom: 5 }}>CHR 原因值分布</div>
          <Bar label={`${chr.causeCode} ${chr.causeCn}`} share={chr.share ?? 60} color="#a78bfa" />
          {related.map((r) => <Bar key={r.code} label={`${r.code} ${r.cn}`} share={r.share ?? 8} color="#64748b" />)}
        </div>
      )}
    </div>
  );
}

/* ————————————————————— ③ 策略匹配:为什么命中该策略 ————————————————————— */
export function MatchPanel({ scenario }: { scenario: Scenario }) {
  const c = scenario.confidence;
  const rc = ROUTE_COLORS[c.route];
  const dims = [
    { k: "模式强度", v: c.pattern, w: 0.4 },
    { k: "异常严重", v: c.severity, w: 0.2 },
    { k: "时序清晰", v: c.temporal, w: 0.15 },
    { k: "空间清晰", v: c.spatial, w: 0.15 },
    { k: "模糊度", v: c.ambiguity, w: 0.1 },
  ];
  const why = whyMatched(scenario);
  return (
    <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: rc.base, fontFamily: "var(--font-mono)" }}>{c.score.toFixed(2)}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: rc.base }}>→ {rc.cn}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 8 }}>{c.patternName}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 9 }}>
        {dims.map((d) => (
          <div key={d.k}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-mid)", marginBottom: 2 }}>
              <span>{d.k} <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>×{d.w}</span></span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-bright)" }}>{d.v.toFixed(2)}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: `${d.v * 100}%`, background: rc.base }} /></div>
          </div>
        ))}
      </div>
      <div style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${rc.base}55`, background: `${rc.base}0d` }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: rc.base, fontFamily: "var(--font-mono)", marginBottom: 3 }}>为什么命中该策略</div>
        <div style={{ fontSize: 12, color: "var(--text-soft)", lineHeight: 1.55 }}>{why}</div>
      </div>
    </div>
  );
}

/* ————————————————————— ④ 根因推理:推理步骤 + 根因 ————————————————————— */
export function ReasonPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const steps = state.reasoningSteps;
  const root = state.rootCause;
  return (
    <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
      <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>推理链 · Agent Loop(共 {state.reasoningTotal} 步,已揭示 {steps.length})</div>
      <div style={{ maxHeight: 230, overflowY: "auto", paddingRight: 3, display: "flex", flexDirection: "column", gap: 5 }}>
        {steps.slice(-9).map((s) => {
          const concl = s.type === "conclusion";
          return (
            <div key={s.n} style={{ display: "flex", gap: 7, padding: "6px 8px", borderRadius: 6, background: concl ? "rgba(239,68,68,0.1)" : "rgba(167,139,250,0.07)", border: `1px solid ${concl ? "rgba(239,68,68,0.4)" : "rgba(167,139,250,0.28)"}` }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: concl ? STATUS.faultGlow : "#c4b5fd", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{s.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--text-soft)", lineHeight: 1.4 }}>{s.text}</div>
                {s.result && <div style={{ fontSize: 11, color: concl ? STATUS.faultGlow : "#7dd3fc", fontFamily: "var(--font-mono)", marginTop: 2 }}>→ {s.result}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {root.nes.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", textAlign: "center" }}>
          <div style={{ fontSize: 10, color: STATUS.faultGlow, fontFamily: "var(--font-mono)" }}>🎯 根因定位</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: STATUS.faultGlow, fontFamily: "var(--font-mono)", margin: "3px 0" }}>{root.nes.join(" · ")}</div>
          {root.links.length > 0 && <div style={{ fontSize: 10.5, color: "var(--text-mid)" }}>{root.links.join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}

/* ————————————————————— ⑤ 策略下发:3 策略 + 目标 ————————————————————— */
export function DispatchPanel({ scenario, state }: { scenario: Scenario; state: StoryState }) {
  const plan = scenario.recoveryPlan;
  const r = state.round;
  if (plan) {
    const values = r === 1 ? plan.strategies.map((s) => ({ layer: s.layer, value: s.initialValue })) : plan.rounds.r2Values;
    const note = r === 1 ? plan.rounds.r1Note : plan.rounds.r2Note;
    return (
      <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
        <div style={{ fontSize: 11, color: "#5eead4", fontWeight: 800, fontFamily: "var(--font-mono)", marginBottom: 6 }}>🛡 3 策略并行下发 · 第 {r} 轮 {r === 2 ? "(排除 iPhone + 微调)" : "(全发,iPhone 忽略→放大)"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {plan.strategies.map((s, i) => {
            const v = values[i];
            const col = s.layer === "UE" ? "#fbbf24" : s.layer === "AMF" ? "#38bdf8" : "#a78bfa";
            const isG = scenario.stormMetrics?.udmCpu != null;
            // 策略语义:F=1 AMF+SMF通知UE / 2 AMF限流 / 3 SMF限流;G=1 回T3346/T3396 / 2 限SST=3 / 3 限DNN=MIot.xx
            const label = isG
              ? (s.layer === "UE" ? "AMF/SMF 回 T3346/T3396(10min)" : s.layer === "AMF" ? "限 SST=3 注册用户" : "限 DNN=MIot.xx 会话用户")
              : (s.layer === "UE" ? "AMF+SMF 通知 UE(back-off)" : s.layer === "AMF" ? "AMF 限流(NSSAI)" : "SMF 限流(DNN)");
            return (
              <div key={s.layer} style={{ padding: "7px 9px", borderRadius: 7, border: `1px solid ${col}55`, background: `${col}0d` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: col, fontFamily: "var(--font-mono)" }}>策略{i + 1} · {label}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: col, fontFamily: "var(--font-mono)" }}>{v.value}{s.unit}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-mid)", fontFamily: "var(--font-mono)", margin: "2px 0" }}>{s.formula}</div>
                {r === 2 && s.layer === "UE" && <div style={{ fontSize: 10, color: "#f472b6" }}>⊘ 排除 iPhone · 仅 65% 终端</div>}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: r === 1 ? "#fbbf24" : STATUS.healthy, fontWeight: 700, lineHeight: 1.5, padding: "6px 8px", borderRadius: 6, background: r === 1 ? "rgba(245,158,11,0.08)" : "rgba(34,197,94,0.08)" }}>{r === 1 ? "⚠ " : "✓ "}{note}</div>
      </div>
    );
  }
  // 非 F:通用动作列表
  const actions = state.recoveryActions;
  return (
    <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
      <div style={{ fontSize: 11, color: "#5eead4", fontWeight: 800, fontFamily: "var(--font-mono)", marginBottom: 6 }}>恢复策略下发</div>
      {actions.map((a, i) => (
        <div key={a.id} style={{ display: "flex", gap: 7, marginBottom: 4, fontSize: 12 }}><span style={{ color: "#5eead4", fontWeight: 800 }}>{i + 1}.</span><span>{a.cn}</span></div>
      ))}
    </div>
  );
}

/* ————————————————————— ⑦ 评估优化:沉淀 + 优化(无真值对比)————————————————————— */
export function EvalPanel({ scenario }: { scenario: Scenario }) {
  const sk = scenario.skillEvolution;
  const rep = scenario.faultReport;
  return (
    <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
      {rep && (
        <div style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(45,212,191,0.4)", background: "rgba(45,212,191,0.06)", marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#5eead4", fontFamily: "var(--font-mono)", marginBottom: 4 }}>📋 故障报告</div>
          <RepRow k="根因" v={rep.rootCause} />
          <RepRow k="处置" v={rep.action} />
          <RepRow k="结果" v={rep.outcome} accent />
        </div>
      )}
      {sk && (
        <div style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#c4b5fd", padding: "2px 7px", borderRadius: 4, background: "rgba(167,139,250,0.18)", border: "1px solid rgba(167,139,250,0.4)", fontFamily: "var(--font-mono)" }}>{sk.kind === "NEW" ? "新增 Skill" : "更新 Skill"}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-bright)" }}>{sk.skillCn}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 5 }}>沉淀经验 · 回流 Agent 1/2</div>
          <div style={{ fontSize: 12, color: "var(--text-soft)", lineHeight: 1.55, marginBottom: 5 }}>{sk.insight ?? sk.after}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "5px 8px", borderRadius: 5, background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.25)" }}>
            <span style={{ color: "var(--text-mid)" }}>优化效果</span>
            <span style={{ color: "#2dd4bf", fontWeight: 800, fontFamily: "var(--font-mono)" }}>下次命中率 → {(sk.nextHitRate * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ————————————————————— 小件 ————————————————————— */
function Row({ label, val, valC }: { label: string; val: string; valC: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span style={{ color: "var(--text-mid)" }}>{label}</span><span style={{ fontWeight: 800, color: valC, fontFamily: "var(--font-mono)" }}>{val}</span></div>;
}
function CpuBar({ id, cpu }: { id: string; cpu: number }) {
  const c = cpu >= 85 ? STATUS.fault : cpu >= 70 ? STATUS.warning : STATUS.healthy;
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}><span style={{ color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>{id}</span><span style={{ color: c, fontWeight: 700, fontFamily: "var(--font-mono)" }}>CPU {cpu}%</span></div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: `${cpu}%`, background: c }} /></div>
    </div>
  );
}
function Bar({ label, share, color }: { label: string; share: number; color: string }) {
  return (
    <div style={{ marginBottom: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 1 }}><span style={{ color: "var(--text-mid)" }}>{label}</span><span style={{ color, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{share}%</span></div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}><div style={{ height: "100%", width: `${share}%`, background: color }} /></div>
    </div>
  );
}
function RepRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return <div style={{ fontSize: 11.5, color: accent ? "#5eead4" : "var(--text-soft)", lineHeight: 1.5, marginBottom: 2, display: "flex", gap: 5 }}><span style={{ color: "var(--text-dim)", flexShrink: 0, minWidth: 32 }}>{k}</span><span style={accent ? { fontWeight: 700 } : undefined}>{v}</span></div>;
}

/** 为什么命中该策略(匹配逻辑)—— 按场景路由给出口语化解释 */
function whyMatched(s: Scenario): string {
  const c = s.confidence;
  if (c.route === "workflow") {
    if (s.fault.faultType === "iot_storm" && s.stormMetrics?.udmCpu != null) {
      return `检测到 UDM 容器 CPU 过载告警(>85%)+ AMF/SMF→UDM 消息突增 + 注册/会话 SR 下降 = 典型「UDM 过载」模式,且 AMF/SMF 自身不过载。模式清晰,置信度 ${c.score.toFixed(2)} > 0.7 → 命中确定性工作流:看全局拓扑判定治理点在 AMF/SMF 侧,不走 LLM Loop。`;
    }
    if (s.fault.faultType === "iot_storm") {
      return `检测到 AMF/SMF 容器 CPU 过载告警 + 大片 NE 同时异常 = 典型「过载风暴」模式。模式强度高、信号清晰,置信度 ${c.score.toFixed(2)} > 0.7 → 命中确定性工作流:直达根因(物联终端风暴),不走 LLM Loop。`;
    }
    return `异常模式强度高、时空清晰,置信度 ${c.score.toFixed(2)} > 0.7 → 命中确定性工作流,直达根因。`;
  }
  if (c.route === "guided") {
    return `异常存在但叠加终端噪声,信号中等。置信度 ${c.score.toFixed(2)} ∈ [0.3,0.7] → 技能引导 Loop:注入匹配 Skill,多维校验(CHR 降噪)收敛根因。`;
  }
  return `信号模糊、原因分散,置信度 ${c.score.toFixed(2)} ≤ 0.3 → 自主探索 Loop:多角度并行(CHR 聚类 + 用户分群)多轮收敛。`;
}
