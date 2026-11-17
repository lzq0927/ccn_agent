import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  GitBranch,
  Info,
  Layers3,
  Link2,
  ListFilter,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { Cluster, Distribution, Meta, Snapshot, Tab } from "./types";
import Chart from "./Chart";
import { causeColor, lineOption, pieOption, scatterOption } from "./charts";
import Topology from "./Topology";
import {
  downloadJson,
  number,
  procedure,
  scientific,
  shortCause,
  time,
} from "./utils";

export function Empty({
  title = "等待异常确认",
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <ScanLine size={30} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>
        {children ||
          "同一维度在最近 5 分钟内至少 4 分钟异常后，将自动开始分析。"}
      </p>
    </div>
  );
}

export function Summary({
  snapshot,
  onNavigate,
}: {
  snapshot: Snapshot;
  onNavigate: (tab: Tab) => void;
}) {
  const c = snapshot.reasoning.conclusion;
  const p = snapshot.perception;
  if (!c)
    return (
      <div
        className={`summary-banner ${snapshot.reasoning.slow_reasoning ? "uncertain" : "monitoring"}`}
      >
        <div className="summary-icon">
          <Activity size={23} />
        </div>
        <div>
          <div className="eyebrow">
            {snapshot.reasoning.slow_reasoning
              ? "EVIDENCE REVIEW"
              : "LIVE PERCEPTION"}
          </div>
          <h2>
            {snapshot.reasoning.slow_reasoning
              ? "证据尚未收敛，进入慢推理待办"
              : p.status === "warming_up"
                ? "正在建立 CHR 正常基线"
                : p.status === "confirming"
                  ? "检测到突增，等待持续性确认"
                  : "当前窗口未确认持续异常"}
          </h2>
          <p>
            {snapshot.reasoning.slow_reasoning?.reason ||
              `最近 5 分钟最大异常命中 ${p.max_hits}/5；分析将在达到 4/5 时触发。`}
          </p>
        </div>
        <button
          className="text-button"
          onClick={() =>
            onNavigate(
              snapshot.reasoning.slow_reasoning ? "knowledge" : "perception",
            )
          }
        >
          查看证据 <ArrowRight size={14} />
        </button>
      </div>
    );
  return (
    <div className="summary-banner">
      <div className="summary-icon">
        <Waypoints size={24} />
      </div>
      <div className="summary-text">
        <div className="eyebrow">
          ROOT CAUSE IDENTIFIED <span>证据交叉验证完成</span>
        </div>
        <h2>
          <span>{c.nf}</span> {c.title}
        </h2>
        <p>
          异常集中于 <b>{c.pod}</b>，涉及 {c.affected_users} 个用户；
          {c.correlated_flows} 条跨网元失败链提供关联证据。
        </p>
      </div>
      <div className="summary-action">
        <span className="badge green">
          <CheckCircle2 size={12} />
          {c.confidence_label}
        </span>
        <button className="text-button" onClick={() => onNavigate("knowledge")}>
          查看推理过程 <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function TimeSeries({
  snapshot,
  compact = false,
}: {
  snapshot: Snapshot;
  compact?: boolean;
}) {
  const all = snapshot.perception.series;
  const initial =
    all.find(
      (s) =>
        s.nf === snapshot.reasoning.conclusion?.nf &&
        s.cause === "SIM_SBI_TIMEOUT",
    ) || all[0];
  const [choice, setChoice] = useState("");
  const series = all.find((s) => s.id === choice) || initial;
  const option = useMemo(() => lineOption(series), [series]);
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h3>
            <Activity size={16} /> CHR 异常时序
          </h3>
          <p>
            {series
              ? `${series.nf} · ${procedure(series.procedure)}`
              : "当前暂无数据"}
            {compact ? "" : ` · 共分析 ${all.length} 个维度`}
          </p>
        </div>
        {series && (
          <span className={`badge ${series.confirmed ? "orange" : "neutral"}`}>
            {series.hits}/5 异常分钟
          </span>
        )}
      </div>
      <div className="chart-toolbar">
        <span className="series-label">
          <i className="dot blue" />
          {shortCause(series?.cause || "")}
        </span>
        <select
          aria-label="选择时序维度"
          value={series?.id || ""}
          onChange={(e) => setChoice(e.target.value)}
        >
          {all.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nf} · {procedure(s.procedure)} · {s.cause}
            </option>
          ))}
        </select>
      </div>
      <Chart
        option={option}
        height={compact ? 217 : 290}
        label={`CHR时序：${series?.id}，${series?.points.map((p) => `${p.time} ${p.count}条`).join("；")}`}
      />
      <div className="card-footnote">
        15 分钟滑窗 · 因果动态阈值 · 橙色点为超过阈值的分钟
      </div>
    </section>
  );
}

export function Denoising({
  snapshot,
  compact = false,
  groupId,
}: {
  snapshot: Snapshot;
  compact?: boolean;
  groupId?: string;
}) {
  const groups = snapshot.perception.distributions;
  const [choice, setChoice] = useState("");
  const defaultGroup =
    groups.find((g) =>
      groupId
        ? g.id === groupId
        : g.nf === snapshot.reasoning.conclusion?.nf &&
          g.procedure === "PduSessionEstablishment",
    ) || groups[0];
  const group = groups.find((g) => g.id === choice) || defaultGroup;
  if (!group)
    return (
      <section className="card">
        <Empty title="窗口内无 CHR" />
      </section>
    );
  const before = group.before.reduce((sum, item) => sum + item.value, 0),
    after = group.after.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h3>
            <ListFilter size={16} /> 降噪前后对比
          </h3>
          <p>
            {group.nf} · {procedure(group.procedure)}
          </p>
        </div>
        <span className="badge blue">
          <ArrowDownRight size={12} />
          {before ? ((1 - after / before) * 100).toFixed(1) : "0"}%
        </span>
      </div>
      {!compact && (
        <div className="chart-toolbar">
          <span className="muted">网元实例＋流程</span>
          <select
            aria-label="选择饼图分组"
            value={group.id}
            onChange={(e) => setChoice(e.target.value)}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nf} · {procedure(g.procedure)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="pies">
        <div>
          <Chart
            option={pieOption(group.before, before, "降噪前")}
            height={compact ? 165 : 195}
            label={`降噪前 ${before} 条：${group.before.map((i) => `${i.name} ${i.value}`).join("，")}`}
          />
        </div>
        <ArrowRight size={16} className="pie-arrow" />
        <div>
          <Chart
            option={pieOption(group.after, after, "降噪后")}
            height={compact ? 165 : 195}
            label={`降噪后 ${after} 条：${group.after.map((i) => `${i.name} ${i.value}`).join("，")}`}
          />
        </div>
      </div>
      <div className="pie-legend">
        {group.before.slice(0, compact ? 3 : 8).map((item, i) => (
          <span key={item.name}>
            <i
              className="legend-dot"
              style={{ background: causeColor(item.name) }}
            />
            {shortCause(item.name)}
          </span>
        ))}
      </div>
      <div className="card-footnote">
        仅保留已确认维度的异常分钟；稳定噪声被过滤
      </div>
    </section>
  );
}

export function Overview({
  snapshot,
  onNavigate,
}: {
  snapshot: Snapshot;
  onNavigate: (tab: Tab) => void;
}) {
  return (
    <>
      <Summary snapshot={snapshot} onNavigate={onNavigate} />
      <Topology snapshot={snapshot} />
      <div className="two-columns overview-charts">
        <TimeSeries snapshot={snapshot} compact />
        <Denoising snapshot={snapshot} compact />
      </div>
      <div className="evidence-link">
        <ShieldCheck size={16} />
        <span>每项结论均保留时序、统计检验和知识图谱证据。</span>
        <button className="text-button" onClick={() => onNavigate("analysis")}>
          探索关联分析 <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}

export function Perception({ snapshot }: { snapshot: Snapshot }) {
  const p = snapshot.perception;
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>从背景噪声中识别持续异常</h2>
          <p>
            按网元实例、流程、原因码独立检测，仅将已确认的异常记录交给分析。
          </p>
        </div>
        <span className="badge blue">{p.dimensions} 个检测维度</span>
      </div>
      <div className="method-strip">
        <div>
          <span>01</span>
          <b>标准化与校验</b>
          <small>字段映射 · UTC 时间 · 去重</small>
        </div>
        <ChevronRight size={15} />
        <div>
          <span>02</span>
          <b>15 分钟因果基线</b>
          <small>Median / MAD + Poisson</small>
        </div>
        <ChevronRight size={15} />
        <div>
          <span>03</span>
          <b>同维度 4 / 5 确认</b>
          <small>异常分钟与稳定背景分离</small>
        </div>
      </div>
      <TimeSeries snapshot={snapshot} />
      <div className="two-columns">
        <Denoising snapshot={snapshot} />
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>
                <ScanLine size={16} /> 降噪证据
              </h3>
              <p>
                {time(p.window_start)} — {time(p.window_end)} UTC
              </p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>窗口内有效 CHR</dt>
              <dd>{number(p.raw_count)}</dd>
            </div>
            <div>
              <dt>异常候选维度</dt>
              <dd>{p.candidate_dimensions}</dd>
            </div>
            <div>
              <dt>持续异常维度</dt>
              <dd>{p.confirmed_dimensions}</dd>
            </div>
            <div>
              <dt>保留 CHR</dt>
              <dd className="blue-text">{number(p.retained_count)}</dd>
            </div>
            <div>
              <dt>过滤 CHR</dt>
              <dd>
                {number(p.removed_count)}{" "}
                <span className="muted">/ {p.removed_percent}%</span>
              </dd>
            </div>
            <div>
              <dt>首次确认时间</dt>
              <dd>
                {p.first_alert_minute
                  ? `T+${p.first_alert_minute} min`
                  : "尚未确认"}
              </dd>
            </div>
          </dl>
          <div className="info-box">
            <Info size={15} />
            <p>
              筛除比例包含未达到持续性条件的记录。原因码本身没有永久黑名单；原有噪声码发生显著突增时也可被保留。
            </p>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h3>数据质量</h3>
            <p>全量输入校验；统计量不参与根因推断</p>
          </div>
          <span className="badge neutral">
            {snapshot.quality.valid_rows} 条有效记录
          </span>
        </div>
        <div className="quality-grid">
          <div>
            <b>{snapshot.quality.duplicates}</b>
            <span>重复记录</span>
          </div>
          <div>
            <b>{snapshot.quality.invalid_rows}</b>
            <span>隔离的无效记录</span>
          </div>
          <div>
            <b>{snapshot.quality.missing_optional.cell}</b>
            <span>缺失小区</span>
          </div>
          <div>
            <b>{snapshot.quality.missing_optional.region}</b>
            <span>缺失区域</span>
          </div>
        </div>
        {snapshot.quality.issues.length > 0 && (
          <ul className="issue-list">
            {snapshot.quality.issues.map((issue, i) => (
              <li key={i}>
                {issue.source}:{issue.line} · {issue.error}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Features({ cluster }: { cluster: Cluster }) {
  return (
    <div className="feature-grid">
      {cluster.features.map((f) => (
        <div className={`feature ${f.severity}`} key={f.dimension}>
          <div>
            <span>{f.label}</span>
            <span className="feature-grade">
              {f.severity === "strong"
                ? "强显著"
                : f.severity === "significant"
                  ? "显著"
                  : f.severity === "unavailable"
                    ? "缺少数据"
                    : "未显著"}
            </span>
          </div>
          <b title={f.value}>{f.value}</b>
          <div className="feature-measure">
            <strong>
              {(f.share * 100).toFixed(1)}
              <small>%</small>
            </strong>
            <span>lift {f.lift.toFixed(2)}×</span>
          </div>
          <div className="mini-bar">
            <i style={{ width: `${f.share * 100}%` }} />
          </div>
          <small className="feature-q">
            q = {scientific(f.q_value)} · n = {f.count}
          </small>
          <p>{f.scope}</p>
        </div>
      ))}
    </div>
  );
}

function FlowTable({ snapshot }: { snapshot: Snapshot }) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(null);
  const filtered = snapshot.flows.rows.filter((f) =>
    `${f.user_id} ${f.failure_path} ${f.trace_id}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const maxPage = Math.max(0, Math.ceil(filtered.length / 8) - 1),
    currentPage = Math.min(page, maxPage);
  const flow = snapshot.flows.rows.find(
    (f) => `${f.user_id}|${f.trace_id}|${f.time}` === selected,
  );
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h3>
            <GitBranch size={16} /> 用户级失败路径
          </h3>
          <p>
            {number(snapshot.flows.total)} 条流程 ·{" "}
            {number(snapshot.flows.correlated)} 条精确跨网元关联 ·{" "}
            {snapshot.flows.ambiguous} 条歧义
          </p>
        </div>
        <div className="search-field">
          <Search size={14} />
          <input
            placeholder="搜索用户 / 网元 / Trace"
            aria-label="搜索用户路径"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>用户 ID / IMSI</th>
              <th>失败路径</th>
              <th>AMF_ID</th>
              <th>SMF_ID</th>
              <th>关联方式</th>
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(currentPage * 8, currentPage * 8 + 8)
              .map((f, i) => (
                <tr key={`${f.user_id}-${f.trace_id}-${i}`}>
                  <td>
                    <button
                      className="table-link mono"
                      onClick={() =>
                        setSelected(`${f.user_id}|${f.trace_id}|${f.time}`)
                      }
                    >
                      {f.user_id}
                    </button>
                  </td>
                  <td className="path-cell">
                    {f.steps.map((step, j) => (
                      <span key={j}>
                        {j > 0 && <ArrowRight size={11} />}
                        <span title={step.cause}>
                          <b>{step.nf.split(":")[1]}</b>
                          <small>{shortCause(step.cause)}</small>
                        </span>
                      </span>
                    ))}
                  </td>
                  <td className="mono muted">
                    {f.AMF_ID?.split(":")[1] || "—"}
                  </td>
                  <td className="mono muted">
                    {f.SMF_ID?.split(":")[1] || "—"}
                  </td>
                  <td>
                    <span
                      className={`badge ${f.confirmed_path ? "green" : "neutral"}`}
                    >
                      {f.confirmed_path
                        ? "TRACE_ID"
                        : f.correlation === "ambiguous"
                          ? "歧义待核验"
                          : f.correlation === "time_window"
                            ? "候选时间关联"
                            : "单网元记录"}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="table-empty">没有匹配的用户路径</div>
        )}
      </div>
      <div className="table-footer">
        <span>
          第 {filtered.length ? currentPage * 8 + 1 : 0}–
          {Math.min((currentPage + 1) * 8, filtered.length)} 条，共{" "}
          {number(filtered.length)} 条
        </span>
        <div>
          <button
            aria-label="上一页用户路径"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {currentPage + 1} / {maxPage + 1}
          </span>
          <button
            aria-label="下一页用户路径"
            disabled={currentPage >= maxPage}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      {flow && (
        <div className="flow-expanded">
          <div>
            <b>Trace · {flow.trace_id || "无精确 Trace ID"}</b>
            <button className="text-button" onClick={() => setSelected(null)}>
              收起 <ChevronDown size={13} />
            </button>
          </div>
          {flow.steps.map((step, i) => (
            <p key={i}>
              <span className="mono">{step.timestamp.slice(11, 19)}</span>
              <ArrowRight size={12} />
              <b>{step.nf}</b>
              <code>{step.cause}</code>
            </p>
          ))}
          <small>{snapshot.flows.note}</small>
        </div>
      )}
    </section>
  );
}

export function Analysis({ snapshot }: { snapshot: Snapshot }) {
  const groups = snapshot.clusters.groups,
    [selected, setSelected] = useState("");
  const group = groups.find((g) => g.id === selected) || groups[0];
  const distribution = snapshot.perception.distributions.find(
    (g) => group && g.nf === group.nf && g.procedure === group.procedure,
  );
  if (!group)
    return (
      <section className="card">
        <Empty />
      </section>
    );
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>沿着聚集特征，缩小故障范围</h2>
          <p>
            六类维度、{number(snapshot.clusters.hypotheses_tested)}{" "}
            项检验；显著性由 q 值、效应量和支持度共同决定。
          </p>
        </div>
        <span className="badge blue">Fisher + BH-FDR</span>
      </div>
      <div className="two-columns analysis-top">
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>
                <ScanLine size={16} /> 异常特征分布
              </h3>
              <p>越靠右上越值得排查；点击气泡查看证据</p>
            </div>
            <CircleHelp size={16} className="muted" />
          </div>
          <Chart
            option={scatterOption(groups)}
            height={300}
            label="异常特征散点图，横轴原因码在实例与流程内的占比，纵轴该实例与流程保留的CHR总数"
            onClick={(event) => {
              const data = event.data as { id?: string };
              if (data?.id) setSelected(data.id);
            }}
          />
          <div className="scatter-legend">
            <span>
              <i className="dot coral" />
              强显著
            </span>
            <span>
              <i className="dot orange" />
              显著
            </span>
            <span>
              <i className="dot blue" />
              未显著
            </span>
            <span>气泡大小 = 该原因码数量</span>
          </div>
        </section>
        <section className="card selected-cluster">
          <div className="card-heading">
            <div>
              <h3>当前分析分组</h3>
              <p>网元实例＋流程＋原因码</p>
            </div>
            <span className="badge orange">
              {group.significant ? "特征显著" : "继续核验"}
            </span>
          </div>
          <select
            className="full-select"
            aria-label="选择异常聚类"
            value={group.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nf} · {procedure(g.procedure)} · {shortCause(g.cause)}
              </option>
            ))}
          </select>
          <div className="cluster-detail">
            <div>
              <span className="muted">{group.nf}</span>
              <h3>{shortCause(group.cause)}</h3>
              <code>{group.cause}</code>
              <p>{procedure(group.procedure)}</p>
            </div>
            <Chart
              option={pieOption(
                distribution?.after || [],
                group.group_total,
                "分组 CHR",
              )}
              height={160}
              label={`当前聚类分组 ${group.group_total} 条`}
            />
          </div>
          <div className="cluster-stats">
            <div>
              <b>{group.cause_percent}%</b>
              <span>原因码占比</span>
            </div>
            <div>
              <b>{number(group.count)}</b>
              <span>原因码数量</span>
            </div>
            <div>
              <b>{group.users}</b>
              <span>涉及用户</span>
            </div>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h3>
              <Layers3 size={16} /> 六维聚集性证据
            </h3>
            <p>
              {group.nf} · {procedure(group.procedure)} ·{" "}
              {shortCause(group.cause)}
            </p>
          </div>
          <span className="muted small-text">相对故障前 CHR 背景</span>
        </div>
        <Features cluster={group} />
        <div className="card-footnote">
          {snapshot.clusters.method}
          。网元维度使用跨实例对照，避免分组条件造成必然的 100% 聚集。
        </div>
      </section>
      <FlowTable snapshot={snapshot} />
      <section className="card">
        <div className="card-heading">
          <div>
            <h3>用户粒度二次分析</h3>
            <p>仅对第一轮未发现显著聚集的分组执行</p>
          </div>
          <span className="badge neutral">
            {snapshot.clusters.fallback_attempted} 个分组触发
          </span>
        </div>
        <div className="fallback-content">
          {snapshot.clusters.fallback.length ? (
            snapshot.clusters.fallback.map((f, i) => (
              <div key={i}>
                <code>{f.user_id}</code>
                <span>{f.count} 条 CHR</span>
                <span
                  className={`badge ${f.significant ? "orange" : "neutral"}`}
                >
                  {f.significant ? "条件特征显著" : "仍未显著"}
                </span>
              </div>
            ))
          ) : (
            <p className="muted">
              {snapshot.clusters.fallback_attempted
                ? "已按用户重新分组，但没有用户达到最小支持度，保留为未解决证据。"
                : "当前所有异常分组已存在显著特征，无需执行用户粒度二次分析。"}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

export function KnowledgeView({
  snapshot,
  meta,
}: {
  snapshot: Snapshot;
  meta: Meta;
}) {
  const [selectedCode, setSelectedCode] = useState("SIM_SBI_TIMEOUT");
  const graph = meta.knowledge;
  const code = graph.codes.find((c) => c.id === selectedCode) || graph.codes[0];
  const scenarios = graph.scenarios.filter((s) =>
    code?.scenarios.includes(s.id),
  );
  const option = {
    tooltip: { renderMode: "richText" },
    series: [
      {
        type: "graph",
        layout: "none",
        roam: false,
        symbol: "roundRect",
        symbolSize: [145, 42],
        label: { show: true, fontSize: 11, color: "#546176" },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 5,
        data: [
          {
            id: "code",
            name: shortCause(code?.id || ""),
            x: 100,
            y: 160,
            itemStyle: {
              color: "#edf1fd",
              borderColor: "#b9c6ed",
              borderWidth: 1,
            },
          },
          ...scenarios.map((s, i) => ({
            id: s.id,
            name: s.title,
            x: 430,
            y: 35 + i * (250 / Math.max(1, scenarios.length - 1)),
            itemStyle: {
              color:
                s.id === snapshot.reasoning.conclusion?.scenario_id
                  ? "#fcefe8"
                  : "#f6f8fb",
              borderColor:
                s.id === snapshot.reasoning.conclusion?.scenario_id
                  ? "#e4b29e"
                  : "#dfe5ed",
              borderWidth: 1,
            },
          })),
        ],
        links: scenarios.map((s) => ({ source: "code", target: s.id })),
        lineStyle: { color: "#c7d1e4", width: 1.4, curveness: 0.1 },
      },
    ],
  };
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>让统计特征与机制证据相互验证</h2>
          <p>
            一个原因码可能对应多个场景；只有充分且唯一的匹配才能生成根因结论。
          </p>
        </div>
        <span className="badge blue">Knowledge v{graph.version}</span>
      </div>
      <div className="two-columns">
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>
                <Waypoints size={16} /> 原因码 → 候选场景
              </h3>
              <p>选择原因码查看一对多推理路径</p>
            </div>
          </div>
          <select
            className="full-select"
            value={code?.id || ""}
            aria-label="选择知识图谱原因码"
            onChange={(e) => setSelectedCode(e.target.value)}
          >
            {graph.codes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.name}
              </option>
            ))}
          </select>
          <Chart
            option={option}
            height={280}
            label={`${code?.id} 对应候选：${scenarios.map((s) => s.title).join("、")}`}
          />
          <div className="card-footnote">
            {code?.standard ? "3GPP 标准原因码" : "模拟内部 CHR 码"} ·{" "}
            {code?.source}
          </div>
        </section>
        <section className="card reasoning-summary">
          <div className="card-heading">
            <div>
              <h3>
                <ShieldCheck size={16} /> 交叉验证结论
              </h3>
              <p>统计显著性 × 机制匹配 × 用户失败链</p>
            </div>
          </div>
          {snapshot.reasoning.conclusion ? (
            <>
              <div className="verdict-icon">
                <CheckCircle2 size={25} />
              </div>
              <h2>{snapshot.reasoning.conclusion.nf}</h2>
              <h3>{snapshot.reasoning.conclusion.title}</h3>
              <p>{snapshot.reasoning.conclusion.explanation}</p>
              <span className="badge green">唯一充分匹配</span>
              <div className="info-box">
                <Info size={14} />
                <p>
                  证据覆盖率{" "}
                  {(snapshot.reasoning.conclusion.score * 100).toFixed(0)}
                  %，是规则覆盖指标，不是校准后的故障概率。
                </p>
              </div>
            </>
          ) : (
            <Empty
              title={
                snapshot.reasoning.slow_reasoning
                  ? "需要慢推理"
                  : "尚未触发分析"
              }
            >
              {snapshot.reasoning.slow_reasoning?.reason}
            </Empty>
          )}
        </section>
      </div>
      {snapshot.reasoning.hypotheses.length > 0 && (
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>
                <GitBranch size={16} /> 候选解释与证据匹配
              </h3>
              <p>接近、冲突或多个充分匹配均进入慢推理</p>
            </div>
            <span className="badge neutral">
              {snapshot.reasoning.hypotheses.length} 个候选
            </span>
          </div>
          <div className="hypotheses">
            {snapshot.reasoning.hypotheses.map((h, i) => (
              <div
                className={`hypothesis ${h.eligible ? "eligible" : ""}`}
                key={h.id}
              >
                <div className="hypothesis-rank">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="hypothesis-body">
                  <div>
                    <h4>
                      {h.nf} · {h.title}
                    </h4>
                    <b>
                      {Math.round(h.score * 100)}
                      <small>% 证据覆盖</small>
                    </b>
                  </div>
                  <p>{h.explanation}</p>
                  <div className="evidence-chips">
                    {h.evidence.map((e) => (
                      <span className={e.matched ? "matched" : ""} key={e.id}>
                        {e.matched ? (
                          <Check size={12} />
                        ) : (
                          <span className="missing-dot" />
                        )}
                        {e.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {snapshot.reasoning.slow_reasoning && (
        <section className="card slow-reasoning">
          <div className="card-heading">
            <div>
              <h3>
                <Sparkles size={16} /> Agent 慢推理待办
              </h3>
              <p>{snapshot.reasoning.slow_reasoning.message}</p>
            </div>
            <span className="badge orange">待接入</span>
          </div>
          <div className="task-list">
            {snapshot.reasoning.slow_reasoning.tasks.map((task) => (
              <div key={task.tool}>
                <code>{task.tool}</code>
                <p>{task.action}</p>
                <span className="badge neutral">未执行</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="info-box">
        <Info size={16} />
        <p>
          {graph.provenance}。
          {snapshot.reasoning.conclusion?.limitations ||
            "无充分证据时保留候选解释，使用工具补充证据。"}
          {snapshot.reasoning.unknown_codes.length > 0 &&
            ` 未映射原因码：${snapshot.reasoning.unknown_codes.join("、")}`}
        </p>
      </div>
    </>
  );
}

export function Handoff({ snapshot }: { snapshot: Snapshot }) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const c = snapshot.reasoning.conclusion;
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>从故障结论，到可审阅的恢复建议</h2>
          <p>生成结构化证据和恢复方案，供外部决策执行模块消费。</p>
        </div>
        <span className="badge neutral">执行模块未接入</span>
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h3>
              <Link2 size={16} /> 决策交接
            </h3>
            <p>状态：{c ? "载荷已生成 · 尚未发送" : "等待充分证据"}</p>
          </div>
          <button
            className="button primary"
            onClick={() =>
              downloadJson(
                snapshot.handoff,
                `chr-handoff-${snapshot.minute}.json`,
              )
            }
          >
            <Download size={14} /> 下载交接 JSON
          </button>
        </div>
        {c ? (
          <div className="handoff-summary">
            <span className="badge orange">CHR 证据推断</span>
            <h2>{c.summary}</h2>
            <p>{c.explanation}</p>
          </div>
        ) : (
          <Empty title="尚无可交接的确定结论" />
        )}
      </section>
      {c && (
        <>
          <section className="card">
            <div className="card-heading">
              <div>
                <h3>
                  <GitBranch size={16} /> 恢复方案
                </h3>
                <p>根据当前拓扑和异常证据生成；操作尚未执行</p>
              </div>
              <span className="badge blue">
                {c.recovery.kind === "reroute"
                  ? "路径切换建议"
                  : "配置恢复建议"}
              </span>
            </div>
            <div className="recovery-steps">
              {c.recovery.steps.map((step, i) => (
                <div key={i}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <p>{step}</p>
                </div>
              ))}
            </div>
            {c.recovery.paths.length > 0 && (
              <div className="recovery-paths">
                <span className="eyebrow">候选替代路径</span>
                {c.recovery.paths.map((path, i) => (
                  <div key={i}>
                    {path.map((node, j) => (
                      <span key={j}>
                        {j > 0 && <ArrowRight size={14} />}
                        <code>{node}</code>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="preconditions">
              <b>执行前需要核验</b>
              {c.recovery.preconditions.map((p) => (
                <p key={p}>
                  <Info size={13} />
                  {p}
                </p>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-heading">
              <div>
                <h3>交接载荷预览</h3>
                <p>schema_version 1.0 · delivered: false</p>
              </div>
              <button
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify(snapshot.handoff, null, 2),
                    );
                    setCopied(true);
                    setCopyError("");
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setCopyError("浏览器未允许复制，请使用下载交接 JSON。");
                  }
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "已复制" : "复制 JSON"}
              </button>
            </div>
            {copyError && <div className="inline-error">{copyError}</div>}
            <pre className="json-preview">
              {JSON.stringify(snapshot.handoff, null, 2)}
            </pre>
          </section>
        </>
      )}
    </>
  );
}
