import { useEffect, useMemo, useState } from 'react'
import { ClusterScatter } from '../charts/ClusterScatter'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { KgGraph } from '../charts/KgGraph'
import { GRADE_LABEL } from '../lib/colors'
import { num, pct, short } from '../lib/format'
import type { AppState, ClusterSeries, Dim } from '../types'

const DIM_ORDER = ['user', 'ran', 'cell', 'tac', 'pod', 'local', 'peer_amf', 'peer_smf', 'peer_ausf', 'peer_udm', 'peer_pcf', 'peer_upf', 'flow_smf', 'flow_amf']

function allDims(s: ClusterSeries): Dim[] {
  return [...s.dims, ...(s.fallback?.dims ?? [])]
}

function GradeLegend() {
  return (
    <div className="legend">
      <span><i className="lg sq high" />强聚集 ≥90%</span>
      <span><i className="lg sq mid" />中聚集 ≥60%</span>
      <span><i className="lg sq low" />未聚集</span>
      <span><i className="lg sq noise" />常态底噪（已滤除）</span>
    </div>
  )
}

export function AnalysisView({ state }: { state: AppState }) {
  const { flows, clustering, kg, crossval } = state
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (!clustering) return setSel(null)
    const rank = { high: 3, mid: 2, low: 1, none: 0, noise: 0 }
    const best = [...clustering.points].filter((p) => p.anomalous)
      .sort((a, b) => rank[b.grade] - rank[a.grade] || b.share * b.group_total - a.share * a.group_total)[0]
    setSel(best?.key ?? null)
  }, [clustering])

  const cols = useMemo(() => {
    const present = new Map<string, string>()
    clustering?.series.forEach((s) => allDims(s).forEach((d) => present.set(d.dim, d.label)))
    return DIM_ORDER.filter((d) => present.has(d)).map((d) => ({ dim: d, label: present.get(d)! }))
  }, [clustering])

  if (!flows) return <div className="view"><div className="card"><div className="empty tall">感知阶段发现异常后进入分析。</div></div></div>

  const selSeries = clustering?.series.find((s) => s.key === sel)
  const groupKey = selSeries ? `${selSeries.instance}|${selSeries.procedure}` : ''
  const group = clustering?.groups[groupKey] ?? []
  const colors = colorMap(group.map((g) => g.cause))

  return (
    <div className="view">
      <section className="card">
        <header>
          <h3>用户级业务流还原</h3>
          <p>同一用户、同一流程、时间相邻的跨网元 CHR 串成一条失败路径，先失败的网元在前。</p>
        </header>
        <div className="statement">
          还原出 <b>{num(flows.summary.total_flows)}</b> 条失败路径，涉及 <b>{num(flows.summary.total_users)}</b> 个用户，
          其中 <b>{num(flows.summary.multi_hop_flows)}</b> 条跨网元。
        </div>
        <div className="patterns">
          {flows.summary.patterns.slice(0, 6).map((p) => (
            <div key={`${p.path}|${p.smf_id}|${p.procedure}`} className="pattern">
              <div className="path">
                {p.hops.map((h, i) => (
                  <span key={i}>{i > 0 && <span className="path-arrow">→</span>}<span className="hop"><b>{h.nf_type}</b> <span className="mono">{h.cause}</span></span></span>
                ))}
              </div>
              <div className="pattern-meta">{p.procedure} · SMF {short(p.smf_id) || '—'} · {p.flows} 条 / {p.users} 用户</div>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>用户 ID</th><th>失败路径</th><th>AMF_ID</th><th>SMF_ID</th><th>流程</th><th>时间</th></tr></thead>
            <tbody>
              {flows.flows.slice(0, 120).map((f) => (
                <tr key={f.id}>
                  <td className="mono">{f.imsi}</td><td className="mono">{f.path}</td>
                  <td>{f.amf_id || '—'}</td><td>{f.smf_id || '—'}</td><td>{f.procedure}</td><td className="mono muted">{f.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {flows.summary.total_flows > 120 && <div className="footnote">显示前 120 条，共 {num(flows.summary.total_flows)} 条。</div>}
      </section>

      <section className="card">
        <header>
          <h3>异常特征聚类</h3>
          <p>每个点是一个网元实例 + 流程 + 原因码。越靠右上越可能是根因；点击突增的点查看所在网元实例 + 流程的原因码分布与各维度聚集度。</p>
        </header>
        {!clustering ? <div className="empty">聚类分析中…</div> : (
          <>
            <div className="grid-cluster">
              <div>
                <ClusterScatter points={clustering.points} selected={sel} onSelect={setSel} />
                <GradeLegend />
              </div>
              {selSeries && (
                <div className="cluster-detail">
                  <div className="detail-title">{selSeries.instance} · {selSeries.procedure}</div>
                  <div className="detail-sub"><span className="mono">{selSeries.cause}</span> {selSeries.cause_name} · 降噪后 {selSeries.count} 条</div>
                  <div className="detail-pie">
                    <Donut title="该网元实例 + 流程的原因码分布" slices={toSlices(group, colors)} size={150} />
                    <ul className="mini-legend">
                      {group.slice(0, 6).map((g) => (
                        <li key={g.cause} className={g.cause === selSeries.cause ? 'current' : ''}>
                          <i className="swatch" style={{ background: colors[g.cause] }} /><span className="mono">{g.cause}</span>
                          <span className="grow">{g.name}</span><span>{g.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {selSeries.fallback && <div className="note">{selSeries.fallback.reason}（{selSeries.fallback.users} 个用户，{pct(selSeries.fallback.linked_ratio)} 的记录关联到业务流）。</div>}
                  <div className="bars">
                    {allDims(selSeries).sort((a, b) => b.score - a.score).map((d) => (
                      <div key={d.dim} className="bar-row" title={`覆盖 ${pct(d.coverage)}，正常期望 ${pct(d.expected)}，z=${d.z}`}>
                        <span className="bar-label">{d.label}</span>
                        <span className="bar-track"><span className={`bar-fill ${d.grade}`} style={{ width: `${Math.max(d.score * 100, 1.5)}%` }} /></span>
                        <span className="bar-val">{pct(d.score)}</span>
                        <span className="bar-top">{d.grade === 'high' || d.grade === 'mid' ? d.set.map(short).join('、') : GRADE_LABEL[d.grade]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <h4>各维度聚集度</h4>
            <div className="table-wrap flat">
              <table className="table matrix">
                <thead><tr><th>网元实例 · 流程 · 原因码</th>{cols.map((c) => <th key={c.dim} className="c">{c.label}</th>)}</tr></thead>
                <tbody>
                  {clustering.series.map((s) => {
                    const dims = Object.fromEntries(allDims(s).map((d) => [d.dim, d]))
                    return (
                      <tr key={s.key} className={s.key === sel ? 'sel' : ''} onClick={() => setSel(s.key)}>
                        <td>{s.instance} · {s.procedure} · <span className="mono">{s.cause}</span></td>
                        {cols.map((c) => {
                          const d = dims[c.dim]
                          if (!d) return <td key={c.dim} className="c muted">—</td>
                          const strong = d.grade === 'high' || d.grade === 'mid'
                          return (
                            <td key={c.dim} className={`c cell ${strong ? d.grade : ''}`} title={`${d.set.join('、')}：覆盖 ${pct(d.coverage)}，正常期望 ${pct(d.expected)}`}>
                              <span>{pct(d.score)}</span>{strong && <small>{d.set.map(short).join('、')}</small>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="footnote">聚集度 = 增量在取值集合上的覆盖率相对正常分布的超出比例；“业务流”列为未发现聚集时下钻到用户粒度的结果。</div>
          </>
        )}
      </section>

      <section className="card">
        <header>
          <h3>图谱推理</h3>
          <p>知识图谱来自产品代码分析：每个原因码在哪些场景下产生，失败如何跨网元传导。</p>
        </header>
        {!kg ? <div className="empty">图谱推理中…</div> : (
          <>
            <KgGraph kg={kg} crossval={crossval} />
            <div className="cause-list">
              {kg.causes.map((c) => (
                <details key={c.code} className="cause">
                  <summary>
                    <span className="mono">{c.code}</span><b>{c.name}</b>
                    <span className="muted">{c.nf_type} · {c.procedure} · {c.interface}</span>
                    <span className="muted grow r">{c.scenarios.length} 种产生场景</span>
                  </summary>
                  <dl>
                    <dt>说明</dt><dd>{c.desc}</dd>
                    <dt>协议映射</dt><dd>{c.protocol}</dd>
                    <dt>代码位置</dt><dd className="mono">{c.code_ref}</dd>
                    <dt>产生场景</dt>
                    <dd><ol>{c.scenarios.map((s) => <li key={s.id}>{s.name}（先验 {s.weight.toFixed(2)}）：{s.condition}</li>)}</ol></dd>
                  </dl>
                </details>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <header>
          <h3>交叉验证</h3>
          <p>用图谱场景应有的聚集特征去核对聚类结果。关键维度全部满足才算匹配；唯一匹配则输出结论，否则转慢推理。</p>
        </header>
        {!crossval ? <div className="empty">等待聚类与图谱推理完成…</div> : (
          <>
            <div className={`verdict ${crossval.decision}`}>
              <b>{crossval.decision === 'conclusion' ? '得到唯一结论' : '转慢推理'}</b>
              <span>{crossval.reason}。{crossval.decision === 'conclusion' ? '慢推理 Agent 未触发。' : ''}</span>
            </div>
            {crossval.items.map((it) => (
              <div key={it.series} className="cv-item">
                <div className="cv-head">
                  <span>{it.instance} · {it.procedure} · <span className="mono">{it.cause}</span> {it.cause_name}</span>
                  <span className="muted">聚类线索：{it.cluster_hints.map((h) => `${h.label} ${h.set.map(short).join('、')} ${pct(h.score)}`).join('；') || '无'}</span>
                </div>
                <table className="table cv">
                  <thead><tr><th>图谱场景</th>{it.candidates[0]?.checks.map((c) => <th key={c.dim} className="c">{c.dim === 'peer' ? '对端网元' : c.label}</th>)}<th className="r">匹配度</th><th>判定</th></tr></thead>
                  <tbody>
                    {it.candidates.filter((c) => c.checks.length).map((c) => (
                      <tr key={c.scenario_id} className={c.matched ? 'matched' : ''}>
                        <td>{c.name}</td>
                        {it.candidates[0].checks.map((ref) => {
                          const k = c.checks.find((x) => x.dim === ref.dim)
                          if (!k) return <td key={ref.dim} className="c muted">—</td>
                          return (
                            <td key={ref.dim} className="c" title={`观测聚集度 ${pct(k.observed)}`}>
                              <span className={`mark ${k.pass ? 'ok' : 'no'}`}>{k.pass ? '✓' : '✗'}</span>
                              <small>应{k.expect === 'high' ? '聚集' : '不聚集'}{k.key ? ' · 关键' : ''}</small>
                            </td>
                          )
                        })}
                        <td className="r">{pct(c.match_score)}</td>
                        <td>{c.matched ? <span className="tag ok"><i />匹配</span> : <span className="muted">不匹配</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {crossval.derived.length > 0 && (
              <div className="cv-item">
                <div className="cv-head"><span>传导侧维度（由业务流核对，不单独定根因）</span></div>
                <ul className="plain">
                  {crossval.derived.map((d) => (
                    <li key={d.series}>{d.instance} · {d.procedure} · <span className="mono">{d.cause}</span>：增量的 <b>{pct(d.explained_ratio)}</b> 可由下游 {d.explained_by.map((e) => e.upstream).slice(0, 2).join('、')} 解释</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
