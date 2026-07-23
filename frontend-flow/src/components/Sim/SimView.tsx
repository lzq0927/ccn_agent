// ============================================================================
// SimView —— 实时仿真视图(过载场景 D/E)
//   自驱动时钟(setInterval)推进 sim engine;实时渲染:相位时间轴、AMF/SMF CPU、
//   注册/会话速率、2C 限流、UE 事件流、智能体实时叙事、E 双通道准入比例。
//   与 DEMO 模式并列(由 App 顶层 DEMO/SIM 开关切换)。
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { SIM_LOOP, type SimEvent, type SimPhase, type SimState, type SimStrategy } from "../../sim/types";
import { initSim, mulberry32, stepSim } from "../../sim/engine";
import { Gauge } from "../shared/Gauge";

const PHASES: { key: SimPhase; cn: string; color: string }[] = [
  { key: "normal", cn: "稳态", color: "#2dd4bf" },
  { key: "storm", cn: "风暴", color: "#ef4444" },
  { key: "detect", cn: "检测", color: "#f59e0b" },
  { key: "trace", cn: "溯源", color: "#38bdf8" },
  { key: "recover", cn: "恢复", color: "#fb7185" },
  { key: "healed", cn: "收敛", color: "#22c55e" },
];

export function SimView() {
  const [strategy, setStrategy] = useState<SimStrategy>("D");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [state, setState] = useState<SimState>(() => initSim("D"));

  // 引擎时钟:每 200ms 推进 dt=0.2*speed 仿真秒
  const rngRef = useRef(mulberry32(12345));
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setState((s) => stepSim(s, 0.2 * speed, rngRef.current));
    }, 200);
    return () => clearInterval(id);
  }, [playing, speed]);

  // 切换策略时重置
  useEffect(() => {
    rngRef.current = mulberry32(strategy === "D" ? 12345 : 67890);
    setState(initSim(strategy));
  }, [strategy]);

  return (
    <div className="hud" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="hud-head">
        <span className="title">
          <span className="dot" style={{ background: "#ef4444", boxShadow: "0 0 8px #ef4444" }} />
          实时仿真 · 过载场景(IoT 注册风暴)
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 3 }}>
            {(["D", "E"] as SimStrategy[]).map((sg) => (
              <button key={sg} className={strategy === sg ? "btn active" : "btn"} onClick={() => setStrategy(sg)} style={{ padding: "3px 8px", fontSize: 9 }}>
                策略 {sg}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => setPlaying((p) => !p)} style={{ minWidth: 34 }}>{playing ? "❚❚" : "▶"}</button>
          <div style={{ display: "flex", gap: 3 }}>
            {[0.5, 1, 2, 4].map((sp) => (
              <button key={sp} className={speed === sp ? "btn active" : "btn"} onClick={() => setSpeed(sp)} style={{ padding: "3px 6px", fontSize: 9 }}>{sp}×</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", gap: 10, padding: 10, minHeight: 0 }}>
        {/* 左:实时指标 + 智能体叙事 */}
        <div style={{ flex: "1 1 56%", display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
          <PhaseTimeline state={state} />
          <div style={{ display: "flex", gap: 10 }}>
            <Gauge value={state.amfCpu / 100} display={`${state.amfCpu.toFixed(0)}%`} color={cpuColor(state.amfCpu)} size={92} label="AMF CPU" sub="接入与移动性" />
            <Gauge value={state.smfCpu / 100} display={`${state.smfCpu.toFixed(0)}%`} color={cpuColor(state.smfCpu)} size={92} label="SMF CPU" sub="会话管理" />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" }}>
              <RateBar label="注册请求" v={state.regRate} unit="/s" color="#38bdf8" />
              <RateBar label="物联重注册" v={state.iotRegRate} unit="/s" color="#f59e0b" />
              <RateBar label="PDU 会话建立" v={state.sessionRate} unit="/s" color="#a78bfa" />
              <RateBar label="2C 限流比" v={state.twoCThrottle * 100} unit="%" color="#ef4444" />
            </div>
          </div>
          {state.strategy === "E" && (
            <div style={{ padding: "7px 9px", borderRadius: 7, border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.06)" }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: "#c4b5fd", fontFamily: "var(--font-mono)", marginBottom: 4 }}>策略 E · 双通道准入限流(反压 {state.ratioAlgo})</div>
              <div style={{ display: "flex", gap: 14 }}>
                <LimitBar label="AMF NSSAI 限制" v={state.nssaiLimit} color="#a78bfa" />
                <LimitBar label="SMF APN 限制" v={state.apnLimit} color="#38bdf8" />
              </div>
              <div style={{ fontSize: 8, color: "var(--text-mid)", marginTop: 3 }}>首轮 back-off 仅 {Math.round(state.iotBackoffSupport * 100)}% 物联支持 → 二轮按 容量/流量/CPU 反压实调节双通道比例</div>
            </div>
          )}
          <div style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${PHASES.find((p) => p.key === state.phase)?.color}55`, background: "var(--accent-a12)" }}>
            <div style={{ fontSize: 8, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 3 }}>高稳智能体 · 实时监测处置</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)", lineHeight: 1.4 }}>{state.agentStep}</div>
          </div>
        </div>

        {/* 右:UE 事件流 */}
        <div className="hud" style={{ flex: "1 1 44%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="hud-head"><span className="title"><span className="dot" />UE 实时事件流</span><span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>T={state.t.toFixed(1)}s</span></div>
          <div style={{ flex: 1, overflow: "hidden", padding: "6px 8px", display: "flex", flexDirection: "column-reverse", gap: 3 }}>
            {state.events.map((e, i) => <EventRow key={`${e.t}-${i}-${e.ue}`} e={e} idx={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseTimeline({ state }: { state: SimState }) {
  const cur = PHASES.find((p) => p.key === state.phase);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {PHASES.map((p) => {
        const isCur = p.key === state.phase;
        return (
          <div key={p.key} style={{ flex: 1, padding: "5px 6px", borderRadius: 6, border: `1px solid ${isCur ? p.color : "rgba(148,163,184,0.2)"}`, background: isCur ? `${p.color}1f` : "transparent", boxShadow: isCur ? `0 0 12px ${p.color}55` : "none", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: isCur ? p.color : "var(--text-mid)" }}>{p.cn}</div>
            <div style={{ position: "relative", height: 3, marginTop: 3, borderRadius: 2, background: "rgba(148,163,184,0.18)" }}>
              {isCur && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${((state.t % SIM_LOOP) / SIM_LOOP) * 100}%`, background: p.color, borderRadius: 2 }} />}
            </div>
          </div>
        );
      })}
      <div style={{ flex: "0 0 auto", alignSelf: "center", fontSize: 8, color: cur?.color, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{state.t.toFixed(1)}s</div>
    </div>
  );
}

function RateBar({ label, v, unit, color }: { label: string; v: number; unit: string; color: string }) {
  const max = unit === "%" ? 100 : 1000;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--text-mid)", marginBottom: 1 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color }}>{v.toFixed(0)} {unit}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "rgba(148,163,184,0.16)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, (v / max) * 100)}%`, background: color, borderRadius: 3, transition: "width 0.2s ease" }} />
      </div>
    </div>
  );
}

function LimitBar({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--text-mid)", marginBottom: 1 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color }}>{Math.round(v * 100)}%</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: "rgba(148,163,184,0.16)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${v * 100}%`, background: color, borderRadius: 4, transition: "width 0.3s ease" }} />
      </div>
    </div>
  );
}

function EventRow({ e, idx }: { e: SimEvent; idx: number }) {
  const color = e.result === "success" ? "#22c55e" : e.result === "reject" ? "#ef4444" : e.result === "throttled" ? "#f59e0b" : "#fb7185";
  const tag = e.result === "success" ? "成功" : e.result === "reject" ? "拒绝" : e.result === "throttled" ? "限流" : "失败";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, opacity: Math.max(0.35, 1 - idx * 0.06), fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--text-faint)", flexShrink: 0 }}>{e.t.toFixed(1)}s</span>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: e.group === "IoT" ? "#f59e0b" : "#38bdf8", flexShrink: 0 }} />
      <span style={{ color: "var(--text-detail)", minWidth: 64 }}>{e.ue}</span>
      <span style={{ color: "var(--text-mid)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.kind === "registration" ? "注册" : "PDU 会话"} · {e.detail}</span>
      <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{tag}</span>
    </div>
  );
}

function cpuColor(cpu: number): string {
  if (cpu >= 85) return "#ef4444";
  if (cpu >= 70) return "#f59e0b";
  return "#22c55e";
}
