import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  GitBranch,
  HelpCircle,
  Layers3,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Terminal,
  Waypoints,
  X,
} from "lucide-react";
import type { Log, Meta, Snapshot, Stage, Tab } from "./types";
import {
  Analysis,
  Handoff,
  KnowledgeView,
  Overview,
  Perception,
} from "./Views";
import { api, number, time } from "./utils";

const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "故障概览", icon: Network },
  { id: "perception", label: "感知与降噪", icon: Activity },
  { id: "analysis", label: "关联分析", icon: GitBranch },
  { id: "knowledge", label: "图谱推理", icon: Waypoints },
  { id: "handoff", label: "决策交接", icon: ShieldCheck },
];
const stages: {
  id: Stage;
  label: string;
  sub: string;
  icon: typeof Activity;
  tab: Tab;
}[] = [
  {
    id: "perception",
    label: "感知",
    sub: "预处理 · 时序检测 · CHR 降噪",
    icon: Radio,
    tab: "perception",
  },
  {
    id: "analysis",
    label: "分析",
    sub: "特征聚集 · 图谱推理 · 交叉验证",
    icon: Waypoints,
    tab: "analysis",
  },
  {
    id: "handoff",
    label: "决策执行",
    sub: "生成结论交接 · 外部模块执行",
    icon: ShieldCheck,
    tab: "handoff",
  },
];

function EventLog({
  logs,
  busy,
  stage,
  snapshot,
}: {
  logs: Log[];
  busy: boolean;
  stage: Stage;
  snapshot: Snapshot | null;
}) {
  const [filter, setFilter] = useState("all"),
    [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const visible = logs.filter(
    (log) =>
      filter === "all" ||
      (filter === "agent"
        ? log.component.includes("Agent")
        : !log.component.includes("Agent")),
  );
  useEffect(() => {
    if (follow && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [logs, follow]);
  return (
    <aside className="log-panel">
      <div className="log-header">
        <div>
          <Terminal size={17} />
          <h3>执行日志</h3>
        </div>
        <span className={`live-indicator ${busy ? "active" : ""}`}>
          <i />
          {busy ? "运行中" : "本轮完成"}
        </span>
      </div>
      <div className="log-tabs">
        {[
          ["all", "全部"],
          ["pipeline", "Pipeline"],
          ["agent", "Agent"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {label}
            {id === "all" && <small>{logs.length}</small>}
          </button>
        ))}
      </div>
      <div className="run-meta">
        <span>
          RUN / T+{String(snapshot?.minute || 0).padStart(2, "0")} MIN
        </span>
        <span>UTC</span>
      </div>
      <div className="log-body" ref={scroll}>
        {visible.map((log, i) => (
          <div
            className={`log-entry ${log.level}`}
            key={`${log.id}-${log.time}`}
          >
            <div className="log-marker">
              {log.level === "success" ? <Check size={9} /> : <i />}
            </div>
            <div className="log-entry-content">
              <div>
                <time>{log.time.slice(11, 19)}</time>
                <span className="log-component">{log.component}</span>
              </div>
              <p>{log.message}</p>
              {log.level === "success" && (
                <span className="log-done">
                  <CheckCheck size={10} />
                  处理完成
                </span>
              )}
            </div>
          </div>
        ))}
        {!visible.length && (
          <div className="log-empty">
            <Sparkles size={21} />
            <p>
              {filter === "agent"
                ? "当前案例未调用慢推理 Agent"
                : "等待执行事件"}
            </p>
            <small>
              {filter === "agent"
                ? "遇到证据不足或多个匹配时，将在此记录待办。"
                : "日志由后端分析流程实时返回。"}
            </small>
          </div>
        )}
        {busy && (
          <div className="log-working">
            <LoaderCircle size={13} className="spin" />
            正在执行 {stages.find((s) => s.id === stage)?.label}…
          </div>
        )}
      </div>
      <div className="log-bottom">
        <div className="log-summary">
          <span>
            <i className="dot blue" />
            {busy
              ? "处理数据中"
              : snapshot?.reasoning.conclusion
                ? "结论已就绪"
                : "感知运行完成"}
          </span>
          <span>{logs.at(-1)?.elapsed_ms ?? 0} ms</span>
        </div>
        <button
          className={`follow-button ${follow ? "enabled" : ""}`}
          onClick={() => setFollow(!follow)}
        >
          <span className="checkbox">{follow && <Check size={10} />}</span>
          自动跟随日志<span className="mono">{visible.length} events</span>
        </button>
      </div>
    </aside>
  );
}

function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={close}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [runId, setRunId] = useState("default"),
    [minute, setMinute] = useState(24),
    [tab, setTab] = useState<Tab>("overview");
  const [logs, setLogs] = useState<Log[]>([]),
    [stage, setStage] = useState<Stage>("perception");
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [modal, setModal] = useState<"source" | "simulation" | "help" | null>(null);
  const [reportOpen, setReportOpen] = useState(false),
    [mutation, setMutation] = useState(false),
    [modalError, setModalError] = useState("");
  const [scenario, setScenario] = useState("packet_loss"),
    [seed, setSeed] = useState(42),
    [fault, setFault] = useState("SMF:smf_2");
  useEffect(() => {
    let cancelled = false;
    api<Meta>(`/api/meta?run_id=${runId}`)
      .then((value) => {
        if (!cancelled) {
          setMeta(value);
          if (minute > value.duration_minutes)
            setMinute(value.duration_minutes);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, retry]);
  useEffect(() => {
    setBusy(true);
    setError("");
    setLogs([]);
    let cancelled = false;
    const stream = new EventSource(
      `/api/events?run_id=${runId}&minute=${minute}`,
    );
    stream.addEventListener("log", (event) => {
      if (cancelled) return;
      const log: Log = JSON.parse((event as MessageEvent).data);
      setLogs((previous) => [...previous, log]);
      setStage(log.stage);
    });
    stream.addEventListener("result", (event) => {
      if (cancelled) return;
      const result: Snapshot = JSON.parse((event as MessageEvent).data);
      setSnapshot(result);
      setStage(result.stage);
      setBusy(false);
      stream.close();
    });
    stream.addEventListener("pipeline_error", (event) => {
      if (cancelled) return;
      setError(JSON.parse((event as MessageEvent).data).message);
      setBusy(false);
      setPlaying(false);
      stream.close();
    });
    stream.onerror = () => {
      if (cancelled) return;
      setError("分析服务连接中断。请确认后端已启动，然后重试。");
      setBusy(false);
      setPlaying(false);
      stream.close();
    };
    return () => {
      cancelled = true;
      stream.close();
    };
  }, [runId, minute, retry]);
  useEffect(() => {
    if (!playing || busy || !meta || !snapshot || snapshot.minute !== minute)
      return;
    if (minute >= meta.duration_minutes) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setMinute((m) => m + 1),
      1500 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [playing, busy, meta, snapshot, minute, speed]);
  async function createRun() {
    setMutation(true);
    setModalError("");
    setPlaying(false);
    try {
      const value = await api<Meta>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, seed, fault_instance: fault }),
      });
      setMeta(value);
      setRunId(value.run_id);
      setSnapshot(null);
      setMinute(24);
      setModal(null);
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setMutation(false);
    }
  }
  async function reload() {
    setMutation(true);
    setModalError("");
    setPlaying(false);
    try {
      const value = await api<Meta>("/api/reload", { method: "POST" });
      setMeta(value);
      setRunId("default");
      setMinute(Math.min(24, value.duration_minutes));
      setRetry((n) => n + 1);
      setModal(null);
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setMutation(false);
    }
  }
  const p = snapshot?.perception;
  const stageIndex = stages.findIndex((s) => s.id === stage);
  const status = snapshot?.reasoning.conclusion
    ? "已定位故障"
    : snapshot?.reasoning.slow_reasoning
      ? "待补充证据"
      : p?.status === "confirming"
        ? "持续性确认中"
        : p?.status === "warming_up"
          ? "基线预热中"
          : "感知运行中";
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="CHRONOS 首页">
          <span className="brand-symbol">
            <Network size={23} strokeWidth={1.8} />
          </span>
          <span>
            CHRONOS
            <span className="brand-subtitle">CORE NETWORK INTELLIGENCE</span>
          </span>
        </a>
        <div className="header-divider" />
        <div className="workspace-label">
          5GC 故障感知工作台 <ChevronDown size={13} />
        </div>
        <div className="header-right">
          <span className="environment-badge">
            <span />
            实验工作区
          </span>
          <button
            className="icon-button"
            aria-label="使用说明"
            onClick={() => setModal("help")}
          >
            <HelpCircle size={18} />
          </button>
          <span className="avatar">CN</span>
        </div>
      </header>
      <div className="page-wrap">
        <div className="breadcrumb">
          工作空间 <ChevronRight size={11} />
          云核心网 <ChevronRight size={11} />
          <span>CHR 故障感知</span>
        </div>
        <div className="page-heading">
          <div>
            <div className="heading-label">OBSERVE. CORRELATE. UNDERSTAND.</div>
            <h1>
              CHR 故障感知 <span className="badge blue">5G CORE</span>
            </h1>
            <p>从流程异常到故障根因，让每一步分析都有据可循。</p>
          </div>
          <div className="heading-actions">
            <button
              className="button"
              onClick={() => {
                setModalError("");
                setModal("source");
              }}
            >
              <Database size={14} />
              数据源
              <span className="count-pill">
                {meta?.quality.files?.length || 6}
              </span>
            </button>
            <div className="report-control">
              <button
                className="button"
                onClick={() => setReportOpen(!reportOpen)}
                disabled={!snapshot || busy}
              >
                <Download size={14} />
                导出报告
                <ChevronDown size={12} />
              </button>
              {reportOpen && (
                <div className="dropdown">
                  <a
                    href={`/api/report?run_id=${runId}&minute=${snapshot?.minute}&format=markdown`}
                    onClick={() => setReportOpen(false)}
                    download
                  >
                    <FileText size={14} />
                    分析报告 · Markdown
                  </a>
                  <a
                    href={`/api/report?run_id=${runId}&minute=${snapshot?.minute}&format=json`}
                    onClick={() => setReportOpen(false)}
                    download
                  >
                    <Layers3 size={14} />
                    完整证据 · JSON
                  </a>
                </div>
              )}
            </div>
            <button
              className="button primary"
              onClick={() => {
                setModalError("");
                setModal("simulation");
              }}
            >
              <FlaskConical size={14} />
              仿真实验
            </button>
          </div>
        </div>
        <div className="workflow">
          {stages.map((s, i) => {
            const completed = i < stageIndex;
            return (
              <button
                key={s.id}
                className={`workflow-step ${stage === s.id ? "current" : ""} ${completed ? "completed" : ""}`}
                onClick={() => setTab(s.tab)}
              >
                <span className="step-icon">
                  {completed ? <Check size={21} /> : <s.icon size={21} />}
                </span>
                <span className="step-text">
                  <span>
                    <small>0{i + 1}</small>
                    <b>{s.label}</b>
                    {stage === s.id ? (
                      <span className="step-state">
                        {busy
                          ? "正在执行"
                          : i === 2
                            ? "待交接"
                            : snapshot?.reasoning.slow_reasoning
                              ? "待补证"
                              : "当前阶段"}
                      </span>
                    ) : completed ? (
                      <span className="step-completed">已完成</span>
                    ) : null}
                  </span>
                  <span>{s.sub}</span>
                </span>
                {i < 2 && <ChevronRight size={19} className="workflow-arrow" />}
              </button>
            );
          })}
        </div>
        <div className="playback">
          <div className="playback-label">
            <Clock3 size={16} />
            <div>
              <b>时间回放</b>
              <span>
                {meta
                  ? `${new Date(meta.start).toISOString().slice(0, 10)} · UTC`
                  : "加载数据中"}
              </span>
            </div>
          </div>
          <div className="playback-controls">
            <button
              className="icon-button"
              aria-label="回到第一分钟"
              onClick={() => {
                setPlaying(false);
                setMinute(1);
              }}
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="play-button"
              aria-label={playing ? "暂停回放" : "播放回放"}
              onClick={() => {
                if (!playing && minute >= (meta?.duration_minutes || 40))
                  setMinute(1);
                setPlaying(!playing);
              }}
            >
              {playing ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              aria-label="下一分钟"
              disabled={minute >= (meta?.duration_minutes || 40) || busy}
              onClick={() => {
                setPlaying(false);
                setMinute((m) => m + 1);
              }}
            >
              <SkipForward size={15} />
            </button>
          </div>
          <div className="timeline">
            <input
              type="range"
              aria-label="回放分钟"
              min="1"
              max={meta?.duration_minutes || 40}
              value={minute}
              onChange={(e) => {
                setPlaying(false);
                setMinute(Number(e.target.value));
              }}
              style={
                {
                  "--progress": `${((minute - 1) / ((meta?.duration_minutes || 40) - 1 || 1)) * 100}%`,
                } as React.CSSProperties
              }
            />
            <div className="timeline-labels">
              <span>00:00</span>
              <span>10 min</span>
              <span>20 min</span>
              <span>30 min</span>
              <span>{meta?.duration_minutes || 40} min</span>
            </div>
          </div>
          <div className="current-time">
            <b>
              {String(minute).padStart(2, "0")}
              <span> / {meta?.duration_minutes || 40} min</span>
            </b>
            <small>15 分钟滑窗 · 每分钟感知</small>
          </div>
          <select
            className="speed-select"
            aria-label="回放速度"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="button" onClick={() => setRetry((n) => n + 1)}>
              <RefreshCcw size={14} />
              重试
            </button>
          </div>
        )}
        <div className="workspace-grid">
          <main
            className={`main-workspace ${busy && snapshot ? "refreshing" : ""}`}
          >
            <div className="metrics">
              <div className="metric">
                <div>
                  <span>窗口 CHR 总量</span>
                  <Database size={15} />
                </div>
                <strong>
                  {p ? number(p.raw_count) : "—"}
                  <small>条</small>
                </strong>
                <p>
                  {p
                    ? `${time(p.window_start)} — ${time(p.window_end)}`
                    : "15 分钟滑动窗口"}
                  <span className="muted">UTC</span>
                </p>
              </div>
              <div className="metric">
                <div>
                  <span>有效异常 CHR</span>
                  <Activity size={15} />
                </div>
                <strong>
                  {p ? number(p.retained_count) : "—"}
                  <small>条</small>
                </strong>
                <p>
                  <i className="dot coral" />
                  {p?.confirmed_dimensions || 0} 个已确认异常维度
                </p>
              </div>
              <div className="metric">
                <div>
                  <span>噪声过滤比例</span>
                  <ListFilter size={15} />
                </div>
                <strong>
                  {p?.removed_percent.toFixed(1) ?? "—"}
                  <small>%</small>
                </strong>
                <p className="green-text">
                  <ArrowDownRight size={12} />
                  过滤 {p ? number(p.removed_count) : "—"} 条背景记录
                </p>
              </div>
              <div className="metric">
                <div>
                  <span>检测维度</span>
                  <Layers3 size={15} />
                </div>
                <strong>
                  {p?.dimensions ?? "—"}
                  <small>组</small>
                </strong>
                <p>网元实例 × 流程 × 原因码</p>
              </div>
            </div>
            <div className="workspace-nav">
              <div role="tablist" aria-label="分析视图">
                {tabs.map((t) => (
                  <button
                    role="tab"
                    aria-selected={tab === t.id}
                    key={t.id}
                    className={tab === t.id ? "active" : ""}
                    onClick={() => setTab(t.id)}
                  >
                    <t.icon size={14} />
                    {t.label}
                  </button>
                ))}
              </div>
              <span
                className={`status-tag ${snapshot?.reasoning.conclusion ? "identified" : ""}`}
              >
                <i />
                {busy ? "分析处理中" : status}
              </span>
            </div>
            {!snapshot || !meta ? (
              <div className="loading-state">
                <LoaderCircle size={27} className="spin" />
                <h3>正在建立分析工作区</h3>
                <p>读取数据、拓扑与知识图谱…</p>
              </div>
            ) : (
              <div
                className="view-content"
                role="tabpanel"
                aria-label={tabs.find((t) => t.id === tab)?.label}
              >
                {tab === "overview" && (
                  <Overview snapshot={snapshot} onNavigate={setTab} />
                )}
                {tab === "perception" && <Perception snapshot={snapshot} />}
                {tab === "analysis" && <Analysis snapshot={snapshot} />}
                {tab === "knowledge" && (
                  <KnowledgeView snapshot={snapshot} meta={meta} />
                )}
                {tab === "handoff" && <Handoff snapshot={snapshot} />}
              </div>
            )}
          </main>
          <EventLog logs={logs} busy={busy} stage={stage} snapshot={snapshot} />
        </div>
        <footer className="page-footer">
          <span>
            <span className="footer-mark">C</span>CHRONOS <span>·</span>{" "}
            CHR-driven network intelligence
          </span>
          <span>
            数据源：{meta?.label || "CSV"} <span>·</span> 知识图谱 v
            {meta?.knowledge.version || "1.0"}
          </span>
        </footer>
      </div>
      {modal === "simulation" && (
        <Dialog title="创建仿真实验" close={() => !mutation && setModal(null)}>
          <p className="modal-description">
            生成独立的 40 分钟数据集。T+20 注入，原始 CSV 文件保持不变。
          </p>
          <label className="form-label">
            实验场景
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              <option value="packet_loss">持续后端链路丢包</option>
              <option value="normal">正常背景噪声 · 无故障</option>
              <option value="transient">两分钟瞬时尖峰 · 应抑制告警</option>
            </select>
          </label>
          <div className="form-row">
            <label className="form-label">
              随机种子
              <input
                type="number"
                min="0"
                max="2147483647"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </label>
            <label className="form-label">
              故障实例
              <select
                value={fault}
                disabled={scenario === "normal"}
                onChange={(e) => setFault(e.target.value)}
              >
                <option>SMF:smf_2</option>
                <option>SMF:smf_1</option>
              </select>
            </label>
          </div>
          <div className="info-box">
            <InfoIcon />
            <p>
              每类网元 2 个实例、每实例 2 个 POD。内部码标记为
              SIM_*。更换实例可验证根因定位是否来自数据。
            </p>
          </div>
          {modalError && <div className="inline-error">{modalError}</div>}
          <div className="modal-footer">
            <button
              className="button"
              onClick={() => setModal(null)}
              disabled={mutation}
            >
              取消
            </button>
            <button
              className="button primary"
              onClick={createRun}
              disabled={
                mutation ||
                !Number.isInteger(seed) ||
                seed < 0 ||
                seed > 2147483647
              }
            >
              {mutation ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <FlaskConical size={14} />
              )}
              生成并分析
            </button>
          </div>
        </Dialog>
      )}
      {modal === "source" && (
        <Dialog title="数据源与质量" close={() => !mutation && setModal(null)}>
          <p className="modal-description">
            当前运行：{meta?.label}。文件接口支持替换为内网
            CHR、拓扑和产品代码知识图谱。
          </p>
          <div className="source-list">
            {meta?.quality.files?.map((f) => (
              <div key={f.file}>
                <FileText size={17} />
                <div>
                  <b>data/{f.file}</b>
                  <small>
                    {number(f.valid_rows)} 条有效 · {f.invalid_rows} 条无效 ·{" "}
                    {f.duplicates} 条重复
                  </small>
                </div>
                <span className="badge green">CSV</span>
              </div>
            )) || (
              <div>
                <FlaskConical size={18} />
                <div>
                  <b>内存仿真数据集</b>
                  <small>
                    {number(meta?.record_count || 0)} 条记录 · 六类网元
                  </small>
                </div>
              </div>
            )}
            <div>
              <Network size={17} />
              <div>
                <b>topo/topo.csv</b>
                <small>
                  {meta?.nf_count} 个实例 · {meta?.edge_count} 条连接
                </small>
              </div>
            </div>
            <div>
              <Waypoints size={17} />
              <div>
                <b>chr-knowledge-graph/graph.json</b>
                <small>
                  {meta?.knowledge.codes.length} 个原因码 · v
                  {meta?.knowledge.version}
                </small>
              </div>
            </div>
          </div>
          {!!meta?.topology_missing_nfs.length && (
            <div className="inline-error">
              以下网元不在拓扑中：{meta.topology_missing_nfs.join("、")}
            </div>
          )}
          {modalError && <div className="inline-error">{modalError}</div>}
          <div className="modal-footer">
            <span className="muted small-text">
              重新读取服务器配置的本地文件
            </span>
            <button
              className="button primary"
              disabled={mutation}
              onClick={reload}
            >
              {mutation ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <RefreshCcw size={14} />
              )}
              重新加载 CSV
            </button>
          </div>
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="如何阅读这份分析" close={() => setModal(null)}>
          <div className="help-content">
            <p>
              <b>1. 回放时间</b>拖动到第 20–24
              分钟，观察突增如何累积为持续异常。每个快照只读取该时刻之前的数据。
            </p>
            <p>
              <b>2. 追踪证据</b>
              在感知页切换网元、流程和原因码；在关联分析页点击气泡或分组，核查六维显著性与用户路径。
            </p>
            <p>
              <b>3. 理解结论</b>
              原因码占比不是失败率，证据覆盖率不是故障概率。CHR
              支持根因推断，真实链路状态仍需探测验证。
            </p>
            <p>
              <b>4. 交给决策模块</b>可下载分析报告和交接
              JSON。当前系统没有执行网络变更，也未接入慢推理工具。
            </p>
            <a
              className="text-button"
              href="/docs"
              target="_blank"
              rel="noreferrer"
            >
              查看 API 文档 <ExternalLink size={13} />
            </a>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function InfoIcon() {
  return <HelpCircle size={15} />;
}
