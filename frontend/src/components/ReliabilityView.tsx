import { useEffect, useState } from 'react';
import './ReliabilityView.css';

type Action = { kind: 'isolate'; ne_id: string }
  | { kind: 'reroute'; from_ne_id: string; to_ne_id: string }
  | { kind: 'flow_control'; layer: 'UE' | 'AMF' | 'SMF'; ratio: number;
      flt: { sst?: number; dnn?: string; device_type?: string } };
type Design = {
  name: string; scenario_id: string; actions: Action[]; seeds: number[];
  warmup_ticks: number; fault_ticks: number; recovery_ticks: number;
  targets: { success_rate: number; max_core_cpu: number; sustained_ticks: number };
  rationale: string;
};
type Saved = { id: string; revision: number; design: Design };
type Scenario = { id: string; name: string; description: string };
type Node = { id: string; name: string; kind: string; evidence_level: string };
type Summary = { registration_success_rate: number; pdu_success_rate: number;
  max_core_cpu: number; final_target_met_fraction: number; admission_rejects: number;
  backoff_rejects: number; sample_count: number };
type RunSummary = { id: string; design_revision: number; created_at: string };
type Run = RunSummary & { design_id: string; input_hash: string; result_hash: string;
  input: { design: Design }; result: { conclusion: string; warnings: string[];
  summary: { baseline: Summary; candidate: Summary }; trials: { seed: number;
  baseline: { recovery_time: number | null }; candidate: { recovery_time: number | null } }[] } };

const BASE = '/api/v1/reliability';
const initial: Design = {
  name: 'UPF 微损：隔离与冗余重选', scenario_id: 'A',
  actions: [{ kind: 'isolate', ne_id: 'UPF_1' },
    { kind: 'reroute', from_ne_id: 'UPF_1', to_ne_id: 'UPF_2' }],
  seeds: [42, 43, 44], warmup_ticks: 15, fault_ticks: 14, recovery_ticks: 30,
  targets: { success_rate: 0.99, max_core_cpu: 80, sustained_ticks: 5 },
  rationale: '合成场景验证：比较隔离与冗余重选相对无机制基线的效果。',
};

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
  return data;
}

export default function ReliabilityView() {
  const [draft, setDraft] = useState<Design>(initial);
  const [seeds, setSeeds] = useState('42, 43, 44');
  const [saved, setSaved] = useState<Saved | null>(null);
  const [designs, setDesigns] = useState<Saved[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);
  const [knowledge, setKnowledge] = useState<Node[]>([]);
  const [ready, setReady] = useState(false);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [session, setSession] = useState<{ url: string } | null>(null);

  async function refreshHealth() {
    try { setReady((await request<{ ready: boolean }>('/agent/health')).ready); }
    catch { setReady(false); }
    finally { setHealthLoaded(true); }
  }
  useEffect(() => {
    Promise.all([
      request<{ scenarios: Scenario[]; topology: { id: string }[] }>('/scenarios'),
      request<Saved[]>('/designs'), request<{ entities: Node[] }>('/knowledge'),
    ]).then(([data, list, kb]) => {
      setScenarios(data.scenarios); setNodes(data.topology.map(n => n.id));
      setDesigns(list); setKnowledge(kb.entities);
    }).catch(e => setError(String(e)));
    void refreshHealth();
  }, []);

  function edit(update: Partial<Design>) {
    setDraft(d => ({ ...d, ...update })); setRun(null); setSession(null); setMessage('');
  }
  async function perform(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function persist(asNew = false) {
    const tokens = seeds.split(/[,，\s]+/).filter(Boolean);
    if (!tokens.length || tokens.some(s => !/^\d+$/.test(s))) throw new Error('请填写逗号分隔的非负整数种子');
    const design = { ...draft, seeds: tokens.map(Number) };
    const item = saved && !asNew
      ? await request<Saved>(`/designs/${saved.id}`, 'PUT', { expected_revision: saved.revision, design })
      : await request<Saved>('/designs', 'POST', design);
    setSaved(item); setDraft(item.design); setSession(null);
    setDesigns(await request<Saved[]>('/designs'));
    setHistory(await request<RunSummary[]>(`/designs/${item.id}/runs`));
    setMessage(`已保存方案 · 修订 ${item.revision}`);
    return item;
  }
  async function openDesign(id: string) {
    const item = await request<Saved>(`/designs/${id}`);
    setSaved(item); setDraft(item.design); setSeeds(item.design.seeds.join(', '));
    setRun(null); setSession(null);
    setHistory(await request<RunSummary[]>(`/designs/${id}/runs`));
  }
  function actionAt(index: number, action: Action) {
    edit({ actions: draft.actions.map((a, i) => i === index ? action : a) });
  }
  const chooseNode = (value: string, onChange: (id: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {nodes.map(id => <option key={id}>{id}</option>)}
    </select>
  );

  return <section className="reliability">
    <div className="rel-heading"><div><p className="rel-eyebrow">ReMAP / AI 系统</p>
      <h1>可靠性机制设计与仿真</h1>
      <p>明确故障与目标，设计候选机制，用对照实验检查恢复收益和代价。</p></div>
      <div className="rel-agent"><span className={ready ? 'rel-online' : ''}>
        {ready ? 'OpenCode 已连接' : healthLoaded ? 'OpenCode 未连接 · 可独立仿真' : '正在检查 OpenCode…'}</span>
        <button disabled={busy} onClick={() => void refreshHealth()}>刷新连接</button></div>
    </div>
    {error && <p role="alert" className="rel-error">{error}</p>}
    {message && <p role="status" className="rel-status">{message}</p>}
    <div className="rel-toolbar"><label>打开已保存方案
      <select disabled={busy} value={saved?.id ?? ''} onChange={e => {
        if (e.target.value) void perform(() => openDesign(e.target.value));
      }}><option value="">选择方案</option>{designs.map(d => <option key={d.id} value={d.id}>
        {d.design.name} · r{d.revision}</option>)}</select></label>
      <button disabled={busy} onClick={() => { setSaved(null); setDraft(initial); setSeeds('42, 43, 44');
        setHistory([]); setRun(null); setSession(null); setMessage(''); setError(''); }}>新建方案</button>
    </div>
    <fieldset disabled={busy} className="rel-form">
      <div className="rel-grid"><div className="rel-panel">
        <h2>1. 系统与目标</h2>
        <label>方案名称<input value={draft.name} maxLength={120} onChange={e => edit({ name: e.target.value })} /></label>
        <label>仿真场景<select value={draft.scenario_id} onChange={e => edit({ scenario_id: e.target.value, actions: [] })}>
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</select></label>
        <p className="rel-muted">{scenarios.find(s => s.id === draft.scenario_id)?.description}</p>
        <div className="rel-fields"><label>业务成功率目标<input type="number" min="0.01" max="1" step="0.001"
          value={draft.targets.success_rate} onChange={e => edit({ targets: { ...draft.targets, success_rate: Number(e.target.value) } })} /></label>
          <label>核心 CPU 上限 (%)<input type="number" min="1" max="100" value={draft.targets.max_core_cpu}
            onChange={e => edit({ targets: { ...draft.targets, max_core_cpu: Number(e.target.value) } })} /></label></div>
        <label>设计依据<textarea rows={3} value={draft.rationale} onChange={e => edit({ rationale: e.target.value })} /></label>
        <details><summary>实验参数</summary><label>随机种子<input value={seeds} onChange={e => {
          setSeeds(e.target.value); setRun(null); setSession(null); }} /></label>
          <div className="rel-fields">{([
            ['warmup_ticks', '正常段 (秒)'], ['fault_ticks', '故障段 (秒)'], ['recovery_ticks', '恢复观测 (秒)'],
          ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="12"
            value={draft[key]} onChange={e => edit({ [key]: Number(e.target.value) })} /></label>)}
            <label>连续达标 (秒)<input type="number" min="1" value={draft.targets.sustained_ticks}
              onChange={e => edit({ targets: { ...draft.targets, sustained_ticks: Number(e.target.value) } })} /></label>
          </div></details>
      </div><div className="rel-panel">
        <h2>2. 候选机制</h2><p className="rel-muted">按顺序施加于仿真系统。无机制基线会自动生成。</p>
        {draft.actions.map((action, i) => <div className="rel-action" key={i}>
          <div className="rel-action-title"><strong>{i + 1}. {{ isolate: '故障隔离', reroute: '冗余重选', flow_control: '流控与退避' }[action.kind]}</strong>
            <button aria-label={`删除机制 ${i + 1}`} onClick={() => edit({ actions: draft.actions.filter((_, j) => i !== j) })}>删除</button></div>
          {action.kind === 'isolate' && <label>隔离网元{chooseNode(action.ne_id, ne_id => actionAt(i, { ...action, ne_id }), '隔离网元')}</label>}
          {action.kind === 'reroute' && <div className="rel-fields"><label>源网元{chooseNode(action.from_ne_id,
            from_ne_id => actionAt(i, { ...action, from_ne_id }), '重选源网元')}</label><label>目标网元{chooseNode(action.to_ne_id,
              to_ne_id => actionAt(i, { ...action, to_ne_id }), '重选目标网元')}</label></div>}
          {action.kind === 'flow_control' && <div className="rel-fields"><label>控制层<select value={action.layer}
            onChange={e => actionAt(i, { ...action, layer: e.target.value as 'UE' | 'AMF' | 'SMF' })}>
            <option>UE</option><option>AMF</option><option>SMF</option></select></label>
            <label>限制比例<input type="number" min="0.01" max="0.95" step="0.05" value={action.ratio}
              onChange={e => actionAt(i, { ...action, ratio: Number(e.target.value) })} /></label>
            <label>切片 SST（空为全部）<input type="number" min="1" max="255" value={action.flt.sst ?? ''}
              onChange={e => actionAt(i, { ...action, flt: { ...action.flt, sst: e.target.value ? Number(e.target.value) : undefined } })} /></label>
            <label>DNN（空为全部）<input value={action.flt.dnn ?? ''} onChange={e => actionAt(i, {
              ...action, flt: { ...action.flt, dnn: e.target.value || undefined } })} /></label>
            <label>终端类型（空为全部）<input value={action.flt.device_type ?? ''} onChange={e => actionAt(i, {
              ...action, flt: { ...action.flt, device_type: e.target.value || undefined } })} /></label></div>}
        </div>)}
        {!draft.actions.length && <p className="rel-muted">尚未配置机制，可先评估无机制现状。</p>}
        <div className="rel-buttons"><button onClick={() => edit({ actions: [...draft.actions, { kind: 'isolate', ne_id: 'UPF_1' }] })}>+ 隔离</button>
          <button onClick={() => edit({ actions: [...draft.actions, { kind: 'reroute', from_ne_id: 'UPF_1', to_ne_id: 'UPF_2' }] })}>+ 重选</button>
          <button onClick={() => edit({ actions: [...draft.actions, { kind: 'flow_control', layer: 'AMF', ratio: 0.8, flt: { sst: 3 } }] })}>+ 流控</button></div>
      </div></div>
      <div className="rel-buttons rel-submit">
        <button onClick={() => void perform(async () => { await persist(); })}>保存方案</button>
        {saved && <button onClick={() => void perform(async () => { await persist(true); setRun(null); })}>另存为候选</button>}
        <button className="rel-primary" onClick={() => void perform(async () => {
          const item = await persist();
          setRun(await request<Run>(`/designs/${item.id}/runs`, 'POST', { expected_revision: item.revision }));
          setHistory(await request<RunSummary[]>(`/designs/${item.id}/runs`)); setMessage('对照仿真已完成');
        })}>{busy ? '处理中…' : '运行对照仿真'}</button>
        <button disabled={!ready} onClick={() => void perform(async () => {
          const item = await persist();
          setSession(await request('/agent/sessions', 'POST', { design_id: item.id, expected_revision: item.revision }));
          setMessage('已同步方案；在 OpenCode 中运行 /ai-reliability 开始协作');
        })}>交给 OpenCode 协作</button>
      </div>
    </fieldset>
    {session && <p><a href={session.url} target="_blank" rel="noreferrer">打开方案的 OpenCode 会话 ↗</a></p>}
    <div className="rel-panel rel-results"><div className="rel-action-title"><h2>3. 验证与证据</h2>
      <select aria-label="历史实验" disabled={busy} value={run?.id ?? ''} onChange={e => {
        if (e.target.value) void perform(async () => setRun(await request<Run>(`/runs/${e.target.value}`)));
      }}><option value="">查看历史实验</option>{history.map(r => <option key={r.id} value={r.id}>
        r{r.design_revision} · {new Date(r.created_at).toLocaleString()}</option>)}</select></div>
      {!run ? <p className="rel-muted">运行后查看基线与候选结果。每次实验保留输入、种子、模型版本和逐种子轨迹。</p> : <>
        <p><strong>{run.result.conclusion === 'simulation_target_met' ? '全部样本末端持续达标' : '存在未达标样本'}</strong>
          {' · '}{run.input.design.name} · 修订 {run.design_revision} · 合成仿真证据</p>
        <div className="rel-table"><table><thead><tr><th>指标</th><th>无机制基线</th><th>候选机制</th></tr></thead><tbody>
          {([['注册成功率', 'registration_success_rate', true], ['PDU 成功率', 'pdu_success_rate', true],
            ['最大核心 CPU (%)', 'max_core_cpu', false], ['持续达标样本比例', 'final_target_met_fraction', true],
            ['末窗准入拒绝数', 'admission_rejects', false], ['末窗退避数', 'backoff_rejects', false]] as const).map(([label, key, percent]) =>
            <tr key={key}><td>{label}</td>{(['baseline', 'candidate'] as const).map(b => <td key={b}>
              {(run.result.summary[b][key] * (percent ? 100 : 1)).toFixed(2)}{percent ? '%' : ''}</td>)}</tr>)}
        </tbody></table></div>
        <p className="rel-muted">{run.result.summary.candidate.sample_count} 个种子 · 成功率为末端 12 秒滚动窗口的跨种子均值，不代表年度可用度。</p>
        {run.result.warnings.map(w => <p className="rel-muted" key={w}>{w}</p>)}
        <div className="rel-buttons"><a href={`${BASE}/runs/${run.id}/report`}>下载报告</a>
          <a href={`${BASE}/runs/${run.id}`} target="_blank" rel="noreferrer">完整实验数据</a>
          <button disabled={busy} onClick={() => void perform(async () => {
            const replay = await request<Run>(`/runs/${run.id}/replay`, 'POST');
            setMessage(replay.result_hash === run.result_hash ? '重放完成：结果摘要一致' : '重放完成：结果摘要存在差异');
            setRun(replay); setHistory(await request<RunSummary[]>(`/designs/${replay.design_id}/runs`));
          })}>按原输入重放</button></div>
      </>}
    </div>
    <details className="rel-panel"><summary>知识库与适用范围</summary><p>当前实现：5GC 服务保障仿真。AI 训练与推理平台需要专用模型及校准证据。</p>
      <div className="rel-knowledge">{knowledge.map(n => <span key={n.id}>{n.name}<small>
        {n.evidence_level === 'synthetic' ? '合成模型' : '已实现'}</small></span>)}</div>
    </details>
  </section>;
}
