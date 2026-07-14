// ============================================================================
// App —— 高稳智能体 · 5GC 数字孪生平台(沉浸式三栏布局)
//   左:大脑架构(Brain)  中:数字孪生(DigitalTwin)  右:阶段详情面板
//   顶:TopBar  底:Timeline
//   DEMO 模式:内置样本数据自动循环。LIVE 模式:真实用例文件驱动孪生 + KPI。
// ============================================================================

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DEFAULT_SCENARIO_ID, SCENARIOS, getScenario } from "./data/scenarios";
import { fetchHealth } from "./data/api";
import { buildLiveModel, buildLiveScenario, type CaseMeta } from "./data/live";
import type { LiveModel } from "./data/live";
import type { Scenario } from "./data/types";
import type { NetworkGraph } from "./data/network";
import type { KpiBundle } from "./data/kpi";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { Timeline } from "./components/Timeline/Timeline";
import { Brain } from "./components/Brain/Brain";
import { DigitalTwin } from "./components/DigitalTwin/DigitalTwin";
import { ScenarioTags } from "./components/Twin/ScenarioTags";
import { ComparisonPanel } from "./components/Twin/ComparisonPanel";
import { GenerationPanel } from "./components/panels/GenerationPanel";
import { KpiPanel } from "./components/panels/KpiPanel";
import { ConfidencePanel } from "./components/panels/ConfidencePanel";
import { ReasoningTrace } from "./components/panels/ReasoningTrace";
import { RecoveryPanel } from "./components/panels/RecoveryPanel";
import { EvaluationPanel } from "./components/panels/EvaluationPanel";

interface CaseListItem {
  case_id: number;
  fault_type: string | null;
  is_normal?: boolean;
  difficulty?: string | null;
}

export default function App() {
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [liveConnected, setLiveConnected] = useState(false);

  // LIVE 用例状态
  const [liveCases, setLiveCases] = useState<CaseListItem[]>([]);
  const [liveCaseId, setLiveCaseId] = useState<number | null>(null);
  const [liveModel, setLiveModel] = useState<LiveModel | null>(null);
  const [liveScenario, setLiveScenario] = useState<Scenario | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  // 健康轮询
  useEffect(() => {
    if (mode !== "live") {
      setLiveConnected(false);
      return;
    }
    let alive = true;
    const poll = async () => {
      const ok = await fetchHealth();
      if (alive) setLiveConnected(ok);
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode]);

  // 拉取用例列表
  useEffect(() => {
    if (!(mode === "live" && liveConnected)) {
      setLiveCases([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/v1/generation/cases?page=1&page_size=30", { cache: "no-store" });
        const d = await r.json();
        const cases: CaseListItem[] = d.cases ?? [];
        if (!alive) return;
        setLiveCases(cases);
        if (cases.length && liveCaseId == null) setLiveCaseId(cases[0].case_id);
      } catch {
        if (alive) setLiveError("无法获取用例列表");
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, liveConnected]);

  // 拉取用例文件 → 构建真实图 + KPI + 场景
  useEffect(() => {
    if (!(mode === "live" && liveCaseId != null)) {
      setLiveModel(null);
      setLiveScenario(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/v1/generation/cases/${liveCaseId}/files`, { cache: "no-store" });
        if (!r.ok) throw new Error("http");
        const d = await r.json();
        const files: Record<string, string> = d.files ?? {};
        const meta: CaseMeta = JSON.parse(files["metadata.json"] || "{}");
        const result = JSON.parse(files["result.txt"] || "{}");
        const model = buildLiveModel(files["topo.txt"] || "", files["data.csv"] || "", meta);
        const scn = buildLiveScenario(meta, result, liveCaseId);
        if (!alive) return;
        setLiveModel(model);
        setLiveScenario(scn);
        setLiveError(null);
      } catch {
        if (alive) {
          setLiveModel(null);
          setLiveScenario(null);
          setLiveError("用例文件加载失败");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, liveCaseId]);

  const isLive = mode === "live" && liveScenario && liveModel;
  const scenario: Scenario = isLive ? (liveScenario as Scenario) : getScenario(scenarioId);
  const clock = useStoryClock(scenario);
  const { state } = clock;
  // DEMO 模式注入 scenario 的真实拓扑/遥测(优先于内置 DEMO_GRAPH/buildKpi);
  // LIVE 模式注入后端实时构建的图/KPI。
  const liveGraph: NetworkGraph | undefined = isLive ? (liveModel as LiveModel).graph : scenario.realGraph;
  const liveKpi: KpiBundle | undefined = isLive ? (liveModel as LiveModel).kpi : scenario.realKpi;

  const renderPanel = () => {
    switch (state.phaseIndex) {
      case 1:
        return <GenerationPanel scenario={scenario} state={state} />;
      case 2:
      case 6:
        return <KpiPanel scenario={scenario} state={state} graph={liveGraph} kpi={liveKpi} />;
      case 3:
        return <ConfidencePanel state={state} />;
      case 4:
        return <ReasoningTrace state={state} />;
      case 5:
        return <RecoveryPanel state={state} />;
      case 7:
        return <EvaluationPanel state={state} scenario={scenario} />;
      default:
        return <KpiPanel scenario={scenario} state={state} graph={liveGraph} kpi={liveKpi} />;
    }
  };

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar
          clock={clock}
          state={state}
          scenario={scenario}
          mode={mode}
          onToggleMode={() => setMode((m) => (m === "demo" ? "live" : "demo"))}
          liveConnected={liveConnected}
        />

        <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
          {/* 左:大脑 */}
          <div style={{ width: 304, minWidth: 304, display: "flex", minHeight: 0 }}>
            <Brain state={state} scenario={scenario} />
          </div>

          {/* 中:场景标签 + 数字孪生 + 对比区 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, gap: 10 }}>
            {mode === "demo" && <ScenarioTags scenarios={SCENARIOS} scenario={scenario} onSelect={setScenarioId} />}
            <div className="hud" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
              <div className="hud-head">
                <span className="title">
                  <span className="dot" />
                  数字孪生 · 网络本体
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-faint)" }}>
                  {isLive ? (
                    <>
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, color: "#22c55e", border: "1px solid #22c55e55", fontFamily: "var(--font-mono)" }}>真实遥测</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "var(--text-dim)" }}>
                        用例
                        <select
                          value={liveCaseId ?? ""}
                          onChange={(e) => setLiveCaseId(Number(e.target.value))}
                          style={{ background: "var(--bg-panel-solid)", color: "var(--text-soft)", border: "1px solid var(--border-strong)", borderRadius: 4, padding: "2px 4px", fontSize: 9, fontFamily: "var(--font-mono)" }}
                        >
                          {liveCases.map((c) => (
                            <option key={c.case_id} value={c.case_id}>
                              #{c.case_id} · {c.is_normal ? "normal" : c.fault_type ?? "?"}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <span>
                      {scenario.cn} · {scenario.en}
                    </span>
                  )}
                </span>
              </div>
              <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
                {mode === "live" && liveError && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, color: "#fb7185", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                    {liveError} · 显示内置样本
                  </div>
                )}
                <DigitalTwin scenario={scenario} state={state} graph={liveGraph} kpi={liveKpi} />
                {/* 过程中算法标注(随相位高亮)—— 放在拓扑框底部,避免遮挡上方 */}
                {state.algorithms.length > 0 && (
                  <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, zIndex: 3, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", pointerEvents: "none" }}>
                    {state.algorithms.map((a) => (
                      <span
                        key={a.en}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: 5,
                          color: state.phase.glow,
                          border: `1px solid ${state.phase.color}88`,
                          background: "var(--twin-readout-bg)",
                          boxShadow: `0 0 9px ${state.phase.color}44`,
                          fontFamily: "var(--font-sans)",
                          letterSpacing: "0.02em",
                          animation: "float-up 0.35s ease",
                        }}
                      >
                        {a.cn}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {mode === "demo" && <ComparisonPanel scenario={scenario} state={state} />}
          </div>

          {/* 右:阶段详情 */}
          <div style={{ width: 376, minWidth: 376, display: "flex", minHeight: 0 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={state.phaseIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28 }}
                style={{ width: "100%", height: "100%" }}
              >
                {renderPanel()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <Timeline clock={clock} />

        {/* LIVE 模式说明条 */}
        {mode === "live" && (
          <div style={{ position: "fixed", bottom: 12, right: 16, fontSize: 9, color: liveConnected ? "#22c55e" : "#ef4444", fontFamily: "var(--font-mono)", background: "var(--twin-readout-bg)", padding: "4px 9px", borderRadius: 6, border: `1px solid ${liveConnected ? "#22c55e44" : "#ef444444"}`, maxWidth: 360, lineHeight: 1.5 }}>
            {liveConnected
              ? isLive
                ? "● 真实遥测驱动孪生 · 置信度为实时估算 · 评估假定命中(真实诊断需运行 Agent 2/3 闭环)"
                : "● 后端已连接 · 加载真实用例中…"
              : "● 后端离线 · 运行 python -m uvicorn api.app:app --port 8000"}
          </div>
        )}
      </div>
    </>
  );
}
