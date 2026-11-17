import { useEffect, useMemo, useState } from 'react'
import { ClusterScatter } from '../charts/ClusterScatter'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { FullKg } from '../charts/FullKg'
import { KgGraph, shortScenario } from '../charts/KgGraph'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { Section } from '../components/Section'
import { GRADE_LABEL } from '../lib/colors'
import { num, pct, short } from '../lib/format'
import type { AppState, ClusterSeries, Dim, FlowPattern } from '../types'

const DIM_ORDER = ['user', 'ran', 'cell', 'tac', 'pod', 'local', 'peer_amf', 'peer_smf', 'peer_ausf', 'peer_udm', 'peer_pcf', 'peer_upf', 'flow_smf', 'flow_amf']
const allDims = (s: ClusterSeries): Dim[] => [...s.dims, ...(s.fallback?.dims ?? [])]

function PathChips({ p }: { p: FlowPattern }) {
  return (
    <div className="path">
      {p.hops.map((h, i) => (
        <span key={i} className="hop-wrap">{i > 0 && <span className="path-arrow"><Icon name="arrowRight" size={12} /></span>}
          <span className={`hop nf-${h.nf_type}`}><b>{h.nf_type}</b><span className="mono">{h.cause}</span></span></span>
      ))}
    </div>
  )
}

export function AnalysisView({ state }: { state: AppState }) {
  const { flows, clustering, kg, crossval } = state
  const [sel, setSel] = useState<string | null>(null)
  const [modal, setModal] = useState<'flows' | 'cluster' | 'kg' | null>(null)
  const [cvSel, setCvSel] = useState(0)
  useEffect(() => setCvSel(0), [crossval])

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

  if (!flows) return <div className="view fit"><div className="card grow-card"><div className="empty tall"><Icon name="search" size={22} /><div>当前未见异常。感知发现持续突增后自动进入分析</div></div></div></div>

  const selSeries = clustering?.series.find((s) => s.key === sel)
  const group = clustering?.groups[selSeries ? `${selSeries.instance}|${selSeries.procedure}` : ''] ?? []
  const colors = colorMap(group.map((g) => g.cause))
  const maxFlows = Math.max(...flows.summary.patterns.map((p) => p.flows), 1)
  const focus = crossval?.groups[0]
  const matchedIds = new Set(crossval?.items.filter((i) => i.best).map((i) => i.best!.scenario_id) ?? [])
  const rootCodes = kg ? [...new Set(Object.entries(kg.roles).filter(([, r]) => r === 'root').map(([k]) => k.split('|')[2]))] : []
  const cvItem = crossval?.items[cvSel]
  const derivedCodes = kg ? [...new Set(Object.entries(kg.roles).filter(([, r]) => r === 'derived').map(([k]) => k.split('|')[2]))].filter((c) => !rootCodes.includes(c)) : []

  return (
    <div className="view fit av-grid">
      <Section no="2.1" title="用户级业务流" hint="跨网元失败路径"
        takeaway={<><b>{num(flows.summary.total_flows)}</b> 条路径 <span className="sep" /> {num(flows.summary.total_users)} 用户</>}
        action={{ label: '明细', onClick: () => setModal('flows') }}>
        <div className="rows">
          {flows.summary.patterns.slice(0, 5).map((p) => (
            <div key={`${p.path}|${p.smf_id}|${p.procedure}`} className="row-item">
              <PathChips p={p} />
              <span className="row-meta">{p.procedure} · {short(p.smf_id) || '—'}</span>
              <span className="row-bar"><i style={{ width: `${(p.flows / maxFlows) * 100}%` }} /></span>
              <b className="row-n">{p.flows}</b>
            </div>
          ))}
        </div>
      </Section>

      <Section no="2.2.1" title="异常特征聚类" hint="越靠右上越可能是根因" tone="critical"
        takeaway={clustering && focus ? <>集中在 <b>{short(focus.anchor)}</b> ↔ <b>{focus.links.map((l) => short(l.target)).join(' / ')}</b></> : undefined}
        action={clustering ? { label: '聚集度明细', onClick: () => setModal('cluster') } : undefined}>
        {!clustering ? <div className="empty">聚类分析中…</div> : (
          <div className="scatter-fill">
            <ClusterScatter points={clustering.points} selected={sel} onSelect={(k) => { setSel(k); setModal('cluster') }} height="100%" />
          </div>
        )}
      </Section>

      <Section no="2.2.2" title="图谱推理" hint="原因码 → 场景" tone="accent"
        takeaway={kg ? <><b>{rootCodes.length}</b> 根因侧 <span className="sep" /> {derivedCodes.length} 传导侧</> : undefined}
        action={kg ? { label: '完整图谱', onClick: () => setModal('kg') } : undefined}>
        {!kg ? <div className="empty">图谱推理中…</div> : <div className="kg-fill"><KgGraph kg={kg} crossval={crossval} /></div>}
      </Section>

      <Section no="2.3" title="交叉验证" hint="聚类 × 图谱" tone={crossval?.decision === 'conclusion' ? 'good' : undefined}
        takeaway={crossval ? (crossval.decision === 'conclusion' ? <><Icon name="checkCircle" size={13} />唯一结论 · 慢推理未触发</> : <>转慢推理</>) : undefined}>
        {!crossval ? <div className="empty">等待聚类与图谱推理完成…</div> : (
          <div className="cv-panel">
            <div className="tabs" role="tablist">
              {crossval.items.map((it, i) => (
                <button key={it.series} role="tab" aria-selected={i === cvSel} className={`tab ${i === cvSel ? 'on' : ''}`} onClick={() => setCvSel(i)}
                  title={`${it.instance} · ${it.procedure} · ${it.cause} ${it.cause_name}`}>
                  <span className="tab-text">{short(it.instance)}·<span className="mono">{it.cause}</span></span>
                  {it.best ? <Icon name="check" size={11} /> : <Icon name="alert" size={11} />}
                </button>
              ))}
            </div>
            {cvItem && (
              <div className="cv-table">
                <table className="table cv">
                  <thead><tr><th>图谱场景</th>{cvItem.candidates[0]?.checks.map((c) => <th key={c.dim} className="c">{c.dim === 'ran' ? '基站' : c.label}</th>)}<th className="r">匹配度</th></tr></thead>
                  <tbody>
                    {cvItem.candidates.filter((c) => c.checks.length).map((c) => (
                      <tr key={c.scenario_id} className={c.matched ? 'matched' : ''} title={c.condition}>
                        <td>{c.matched && <Icon name="check" size={12} />}<span className="scn-name">{shortScenario(c.name).replace(/^\S+ 后端至 (\S+) 的 /, '$1 ')}</span></td>
                        {cvItem.candidates[0].checks.map((ref) => {
                          const k = c.checks.find((x) => x.dim === ref.dim)
                          if (!k) return <td key={ref.dim} className="c dash">·</td>
                          return (
                            <td key={ref.dim} className="c" title={`应${k.expect === 'high' ? '聚集' : '不聚集'}${k.key ? '（关键维度）' : ''}，观测聚集度 ${pct(k.observed)}`}>
                              <span className="chk"><span className={`mark ${k.pass ? 'ok' : 'no'} ${k.key ? 'key' : ''}`}><Icon name={k.pass ? 'check' : 'x'} size={11} /></span>
                                <small className="obs">{pct(k.observed)}</small></span>
                            </td>
                          )
                        })}
                        <td className="r"><b>{pct(c.match_score)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="cv-foot">
              <span className="row-meta">带圈为关键维度，全部满足才算匹配</span>
              {crossval.derived.length > 0 && <span className="row-meta" title={crossval.derived.map((d) => `${short(d.instance)} ${d.cause} ${pct(d.explained_ratio)}`).join('；')}>
                · 传导侧 {crossval.derived.length} 个维度 {pct(Math.min(...crossval.derived.map((d) => d.explained_ratio)))} 以上可由下游解释</span>}
            </div>
          </div>
        )}
      </Section>

      {modal === 'flows' && (
        <Modal wide title={`用户级业务流 · ${num(flows.summary.total_flows)} 条失败路径 / ${num(flows.summary.total_users)} 个用户`} onClose={() => setModal(null)}>
          <div className="patterns">
            {flows.summary.patterns.slice(0, 9).map((p) => (
              <div key={`${p.path}|${p.smf_id}|${p.procedure}`} className="pattern">
                <div className="pattern-top"><PathChips p={p} /><div className="pattern-n">{p.flows}</div></div>
                <div className="pattern-bar"><i style={{ width: `${(p.flows / maxFlows) * 100}%` }} /></div>
                <div className="pattern-meta">{p.procedure} · {short(p.smf_id) || '—'} · {p.users} 用户</div>
              </div>
            ))}
          </div>
          <div className="table-wrap tall">
            <table className="table">
              <thead><tr><th>用户 ID</th><th>失败路径</th><th>AMF_ID</th><th>SMF_ID</th><th>流程</th><th>时间</th></tr></thead>
              <tbody>
                {flows.flows.slice(0, 200).map((f) => (
                  <tr key={f.id}>
                    <td className="mono">{f.imsi}</td><td className="mono">{f.path}</td>
                    <td>{f.amf_id || '—'}</td><td>{f.smf_id || '—'}</td><td>{f.procedure}</td><td className="mono">{f.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {flows.summary.total_flows > 200 && <div className="footnote">显示前 200 条，共 {num(flows.summary.total_flows)} 条。</div>}
        </Modal>
      )}

      {modal === 'cluster' && clustering && (
        <Modal wide title="异常特征聚类 · 各维度聚集度" onClose={() => setModal(null)}>
          {selSeries && (
            <div className="cluster-detail">
              <div>
                <div className="detail-title">{selSeries.instance} · {selSeries.procedure}</div>
                <div className="detail-sub"><span className="mono">{selSeries.cause}</span> {selSeries.cause_name}</div>
                <div className="detail-pie">
                  <Donut title="" slices={toSlices(group, colors)} size={132} />
                  <ul className="mini-legend">
                    {group.slice(0, 6).map((g) => (
                      <li key={g.cause} className={g.cause === selSeries.cause ? 'current' : ''}>
                        <i className="swatch" style={{ background: colors[g.cause] }} /><span className="mono">{g.cause}</span>
                        <span className="grow">{g.name}</span><span>{g.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                {selSeries.fallback && <div className="note"><Icon name="users" size={13} />该粒度未聚集，已下钻到用户粒度（{selSeries.fallback.users} 用户）</div>}
                <div className="bars">
                  {allDims(selSeries).sort((a, b) => b.score - a.score).map((d) => (
                    <div key={d.dim} className="bar-row" title={`覆盖 ${pct(d.coverage)}，正常期望 ${pct(d.expected)}，z=${d.z}`}>
                      <span className="bar-label">{d.label}</span>
                      <span className="bar-track"><span className={`bar-fill ${d.grade}`} style={{ width: `${Math.max(d.score * 100, 1.5)}%` }} /></span>
                      <span className="bar-val">{pct(d.score)}</span>
                      <span className={`bar-top ${d.grade}`}>{d.grade === 'high' || d.grade === 'mid' ? d.set.map(short).join('、') : GRADE_LABEL[d.grade]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="table-wrap flat matrix-wrap">
            <table className="table matrix">
              <thead><tr><th>点击行查看该维度</th>{cols.map((c) => <th key={c.dim} className="c">{c.label}</th>)}</tr></thead>
              <tbody>
                {clustering.series.map((s) => {
                  const dims = Object.fromEntries(allDims(s).map((d) => [d.dim, d]))
                  return (
                    <tr key={s.key} className={s.key === sel ? 'sel' : ''} onClick={() => setSel(s.key)}>
                      <td><b>{short(s.instance)}</b> · {s.procedure} · <span className="mono">{s.cause}</span></td>
                      {cols.map((c) => {
                        const d = dims[c.dim]
                        if (!d) return <td key={c.dim} className="c dash">·</td>
                        const strong = d.grade === 'high' || d.grade === 'mid'
                        return (
                          <td key={c.dim} className="c" title={`${d.set.join('、')}：覆盖 ${pct(d.coverage)}，正常期望 ${pct(d.expected)}`}>
                            <span className={`heat ${strong ? d.grade : ''}`}>{pct(d.score)}{strong && <small>{d.set.map(short).join('、')}</small>}</span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="legend"><span><i className="lg sq high" />强聚集 ≥90%</span><span><i className="lg sq mid" />中聚集 ≥60%</span><span>“业务流”列为未聚集时下钻到用户粒度的结果</span></div>
        </Modal>
      )}

      {modal === 'kg' && kg && (
        <Modal xwide title="知识图谱 · 本次故障的推理路径已点亮" onClose={() => setModal(null)}>
          <div className="kg-modal">
            <FullKg kg={kg} crossval={crossval} />
            <aside className="kg-side">
              <h4>推理路径</h4>
              <ol className="kg-steps">
                <li><b>现象</b>：{kg.causes.length} 个原因码突增
                  <div className="kg-codes">{kg.causes.map((c) => <span key={c.code} className={`code-chip ${rootCodes.includes(c.code) ? 'root' : ''}`} title={c.name}>{c.code}</span>)}</div></li>
                <li><b>沿传导关系追溯</b>：{derivedCodes.join('、') || '无'} {derivedCodes.length ? '由下游失败传导而来，' : ''}根因侧为 {rootCodes.join('、')}</li>
                <li><b>沿“可能由…产生”展开</b>：根因侧原因码共 {new Set(kg.causes.filter((c) => rootCodes.includes(c.code)).flatMap((c) => c.scenarios.map((x) => x.id))).size} 个候选场景</li>
                <li><b>与聚类特征核对后命中</b>
                  <ul>{kg.causes.filter((c) => rootCodes.includes(c.code)).map((c) => {
                    const hit = c.scenarios.filter((x) => matchedIds.has(x.id))
                    return <li key={c.code}><span className="mono">{c.code}</span> → {hit.length ? hit.map((x) => shortScenario(x.name)).join('；') : '未命中'}</li>
                  })}</ul></li>
              </ol>
              <details className="fold">
                <summary>原因码详情</summary>
                <div className="cause-list">
                  {kg.causes.map((c) => (
                    <details key={c.code} className="cause">
                      <summary><span className="mono">{c.code}</span><b>{c.name}</b></summary>
                      <dl>
                        <dt>位置</dt><dd>{c.nf_type} · {c.procedure} · {c.interface}</dd>
                        <dt>说明</dt><dd>{c.desc}</dd>
                        <dt>协议</dt><dd>{c.protocol}</dd>
                        <dt>代码</dt><dd className="mono">{c.code_ref}</dd>
                      </dl>
                    </details>
                  ))}
                </div>
              </details>
            </aside>
          </div>
        </Modal>
      )}
    </div>
  )
}
