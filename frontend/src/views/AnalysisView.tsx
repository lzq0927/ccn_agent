import { useEffect, useMemo, useState } from 'react'
import { ClusterScatter } from '../charts/ClusterScatter'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { KgGraph } from '../charts/KgGraph'
import { Icon } from '../components/Icon'
import { Section } from '../components/Section'
import { GRADE_LABEL } from '../lib/colors'
import { num, pct, short } from '../lib/format'
import type { AppState, ClusterSeries, Dim } from '../types'

const DIM_ORDER = ['user', 'ran', 'cell', 'tac', 'pod', 'local', 'peer_amf', 'peer_smf', 'peer_ausf', 'peer_udm', 'peer_pcf', 'peer_upf', 'flow_smf', 'flow_amf']
const allDims = (s: ClusterSeries): Dim[] => [...s.dims, ...(s.fallback?.dims ?? [])]

function StepCard({ no, icon, title, value, unit, sub, state, href }:
  { no: string; icon: string; title: string; value: string; unit?: string; sub?: string; state: 'wait' | 'ok' | 'warn'; href: string }) {
  return (
    <a className={`stepcard ${state}`} href={href}>
      <div className="stepcard-head"><span className="stepcard-icon"><Icon name={icon} size={15} /></span><span>{no} {title}</span></div>
      <div className="stepcard-value">{value}{unit && <small>{unit}</small>}</div>
      <div className="stepcard-sub">{sub}</div>
    </a>
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

  if (!flows) return <div className="view"><div className="card"><div className="empty tall"><Icon name="search" size={22} /><div>当前未见异常。感知发现持续突增后自动进入分析</div></div></div></div>

  const selSeries = clustering?.series.find((s) => s.key === sel)
  const group = clustering?.groups[selSeries ? `${selSeries.instance}|${selSeries.procedure}` : ''] ?? []
  const colors = colorMap(group.map((g) => g.cause))
  const nHigh = clustering?.series.filter((s) => s.grade === 'high').length ?? 0
  const roles = kg ? Object.values(kg.roles) : []
  const nRoot = roles.filter((r) => r === 'root').length
  const maxFlows = Math.max(...flows.summary.patterns.map((p) => p.flows), 1)
  const matchedNames = [...new Set(crossval?.items.filter((i) => i.best).map((i) => i.best!.name) ?? [])]
  const focus = crossval?.groups[0]

  return (
    <div className="view">
      <div className="stepcards">
        <StepCard no="2.1" icon="route" title="业务流还原" href="#sec-flows" state="ok"
          value={num(flows.summary.total_flows)} unit="条失败路径" sub={`${num(flows.summary.total_users)} 个用户 · ${num(flows.summary.multi_hop_flows)} 条跨网元`} />
        <StepCard no="2.2.1" icon="target" title="特征聚类" href="#sec-cluster" state={clustering ? 'ok' : 'wait'}
          value={clustering ? String(nHigh) : '…'} unit={clustering ? '个强聚集维度' : ''}
          sub={clustering ? `共 ${clustering.series.length} 个突增维度` : '分析中'} />
        <StepCard no="2.2.2" icon="graph" title="图谱推理" href="#sec-kg" state={kg ? 'ok' : 'wait'}
          value={kg ? String(nRoot) : '…'} unit={kg ? '个根因侧维度' : ''} sub={kg ? `${roles.length - nRoot} 个为传导结果` : '推理中'} />
        <StepCard no="2.3" icon="shield" title="交叉验证" href="#sec-cv" state={!crossval ? 'wait' : crossval.decision === 'conclusion' ? 'ok' : 'warn'}
          value={!crossval ? '…' : crossval.decision === 'conclusion' ? '唯一结论' : '转慢推理'}
          sub={!crossval ? '等待中' : focus ? `${short(focus.anchor)} · ${focus.links.map((l) => `${l.interface}→${short(l.target)}`).join(' · ')}` : crossval.reason} />
      </div>

      <Section id="sec-flows" no="2.1" title="用户级业务流" hint="同一用户同一流程的跨网元 CHR 串成失败路径"
        takeaway={<><b>{num(flows.summary.total_flows)}</b> 条路径 <span className="sep" /> {num(flows.summary.total_users)} 用户</>}>
        <div className="patterns">
          {flows.summary.patterns.slice(0, 6).map((p) => (
            <div key={`${p.path}|${p.smf_id}|${p.procedure}`} className="pattern">
              <div className="pattern-top">
                <div className="path">
                  {p.hops.map((h, i) => (
                    <span key={i} className="hop-wrap">{i > 0 && <span className="path-arrow"><Icon name="arrowRight" size={12} /></span>}
                      <span className={`hop nf-${h.nf_type}`}><b>{h.nf_type}</b><span className="mono">{h.cause}</span></span></span>
                  ))}
                </div>
                <div className="pattern-n">{p.flows}</div>
              </div>
              <div className="pattern-bar"><i style={{ width: `${(p.flows / maxFlows) * 100}%` }} /></div>
              <div className="pattern-meta">{p.procedure} · {short(p.smf_id) || '—'} · {p.users} 用户</div>
            </div>
          ))}
        </div>
        <details className="fold">
          <summary>查看明细（用户 ID · 失败路径 · AMF_ID · SMF_ID）</summary>
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
        </details>
      </Section>

      <Section id="sec-cluster" no="2.2.1" title="异常特征聚类" hint="越靠右上越可能是根因，点击圆点查看" tone="critical"
        takeaway={clustering && focus ? <>增量集中在 <b>{short(focus.anchor)}</b> ↔ <b>{focus.links.map((l) => short(l.target)).join(' / ')}</b></> : undefined}>
        {!clustering ? <div className="empty">聚类分析中…</div> : (
          <>
            <div className="grid-cluster">
              <div>
                <ClusterScatter points={clustering.points} selected={sel} onSelect={setSel} />
                <div className="legend">
                  <span><i className="lg sq high" />强聚集 ≥90%</span><span><i className="lg sq mid" />中聚集 ≥60%</span>
                  <span><i className="lg sq low" />未聚集</span><span><i className="lg sq noise" />常态底噪</span>
                </div>
              </div>
              {selSeries && (
                <div className="cluster-detail">
                  <div className="detail-title">{selSeries.instance} · {selSeries.procedure}</div>
                  <div className="detail-sub"><span className="mono">{selSeries.cause}</span> {selSeries.cause_name}</div>
                  <div className="detail-pie">
                    <Donut title="" slices={toSlices(group, colors)} size={132} />
                    <ul className="mini-legend">
                      {group.slice(0, 5).map((g) => (
                        <li key={g.cause} className={g.cause === selSeries.cause ? 'current' : ''}>
                          <i className="swatch" style={{ background: colors[g.cause] }} /><span className="mono">{g.cause}</span>
                          <span className="grow">{g.name}</span><span>{g.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {selSeries.fallback && <div className="note"><Icon name="users" size={13} />该粒度未聚集，已下钻到用户粒度（{selSeries.fallback.users} 用户）</div>}
                  <div className="bars">
                    {allDims(selSeries).sort((a, b) => b.score - a.score).slice(0, 7).map((d) => (
                      <div key={d.dim} className="bar-row" title={`覆盖 ${pct(d.coverage)}，正常期望 ${pct(d.expected)}，z=${d.z}`}>
                        <span className="bar-label">{d.label}</span>
                        <span className="bar-track"><span className={`bar-fill ${d.grade}`} style={{ width: `${Math.max(d.score * 100, 1.5)}%` }} /></span>
                        <span className="bar-val">{pct(d.score)}</span>
                        <span className={`bar-top ${d.grade}`}>{d.grade === 'high' || d.grade === 'mid' ? d.set.map(short).join('、') : GRADE_LABEL[d.grade]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="table-wrap flat matrix-wrap">
              <table className="table matrix">
                <thead><tr><th>各维度聚集度</th>{cols.map((c) => <th key={c.dim} className="c">{c.label}</th>)}</tr></thead>
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
                              <span className={`heat ${strong ? d.grade : ''}`} style={strong ? undefined : { opacity: 0.6 + d.score }}>
                                {pct(d.score)}{strong && <small>{d.set.map(short).join('、')}</small>}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section id="sec-kg" no="2.2.2" title="图谱推理" hint="原因码 → 可能的产生场景" tone="accent"
        takeaway={matchedNames.length ? <><Icon name="check" size={13} />{matchedNames.length} 个场景命中</> : undefined}>
        {!kg ? <div className="empty">图谱推理中…</div> : (
          <>
            <KgGraph kg={kg} crossval={crossval} />
            <details className="fold">
              <summary>原因码详情（协议映射 · 代码位置 · 全部场景）</summary>
              <div className="cause-list">
                {kg.causes.map((c) => (
                  <details key={c.code} className="cause">
                    <summary>
                      <span className="mono">{c.code}</span><b>{c.name}</b>
                      <span className="muted">{c.nf_type} · {c.procedure} · {c.interface}</span>
                    </summary>
                    <dl>
                      <dt>说明</dt><dd>{c.desc}</dd>
                      <dt>协议映射</dt><dd>{c.protocol}</dd>
                      <dt>代码位置</dt><dd className="mono">{c.code_ref}</dd>
                      <dt>产生场景</dt>
                      <dd><ol>{c.scenarios.map((s) => <li key={s.id}>{s.name}（{s.weight.toFixed(2)}）：{s.condition}</li>)}</ol></dd>
                    </dl>
                  </details>
                ))}
              </div>
            </details>
          </>
        )}
      </Section>

      <Section id="sec-cv" no="2.3" title="交叉验证" hint="聚类特征 × 图谱场景特征"
        tone={crossval?.decision === 'conclusion' ? 'good' : undefined}
        takeaway={crossval ? (crossval.decision === 'conclusion' ? <><Icon name="checkCircle" size={13} />唯一结论 · 慢推理未触发</> : <>转慢推理</>) : undefined}>
        {!crossval ? <div className="empty">等待聚类与图谱推理完成…</div> : (
          <div className="cv-list">
            {crossval.items.map((it) => (
              <details key={it.series} className="cv-item">
                <summary>
                  <span className="cv-series"><b>{short(it.instance)}</b> · {it.procedure} · <span className="mono">{it.cause}</span></span>
                  <span className="cv-hints">{it.cluster_hints.slice(0, 2).map((h) => (
                    <span key={h.label} className="hint-chip">{h.label} {h.set.map(short).join('、')} <b>{pct(h.score)}</b></span>))}</span>
                  <span className="cv-arrow"><Icon name="arrowRight" size={14} /></span>
                  {it.best ? <span className="cv-match"><Icon name="check" size={13} />{it.best.name}<b>{pct(it.best.match_score)}</b></span>
                    : <span className="cv-nomatch">{it.verdict === 'none' ? '无匹配场景' : '多个场景接近'}</span>}
                </summary>
                <table className="table cv">
                  <thead><tr><th>图谱场景</th>{it.candidates[0]?.checks.map((c) => <th key={c.dim} className="c">{c.dim === 'peer' ? '对端网元' : c.label}</th>)}<th className="r">匹配度</th></tr></thead>
                  <tbody>
                    {it.candidates.filter((c) => c.checks.length).map((c) => (
                      <tr key={c.scenario_id} className={c.matched ? 'matched' : ''}>
                        <td>{c.name}</td>
                        {it.candidates[0].checks.map((ref) => {
                          const k = c.checks.find((x) => x.dim === ref.dim)
                          if (!k) return <td key={ref.dim} className="c dash">·</td>
                          return (
                            <td key={ref.dim} className="c" title={`应${k.expect === 'high' ? '聚集' : '不聚集'}${k.key ? '（关键）' : ''}，观测 ${pct(k.observed)}`}>
                              <span className={`mark ${k.pass ? 'ok' : 'no'} ${k.key ? 'key' : ''}`}><Icon name={k.pass ? 'check' : 'x'} size={12} /></span>
                            </td>
                          )
                        })}
                        <td className="r">{pct(c.match_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
            {crossval.derived.length > 0 && (
              <div className="cv-derived">
                <span className="muted">传导侧（由业务流核对）</span>
                {crossval.derived.map((d) => (
                  <span key={d.series} className="hint-chip">{short(d.instance)} · <span className="mono">{d.cause}</span> <b>{pct(d.explained_ratio)}</b> 可由下游解释</span>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}
