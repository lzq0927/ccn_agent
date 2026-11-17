import { useEffect, useMemo, useState } from 'react'
import { ClusterScatter } from '../charts/ClusterScatter'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { KgGraph } from '../charts/KgGraph'
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
  const [modal, setModal] = useState<'flows' | 'cluster' | 'kg' | 'cv' | null>(null)

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
        action={kg ? { label: '图谱', onClick: () => setModal('kg') } : undefined}>
        {!kg ? <div className="empty">图谱推理中…</div> : (
          <div className="rows">
            {kg.causes.filter((c) => rootCodes.includes(c.code)).map((c) => (
              <div key={c.code} className="row-item kg-row">
                <span className="code-chip root">{c.code}</span>
                <span className="row-name">{c.name}</span>
                <span className="scn-chips">
                  {c.scenarios.filter((x) => matchedIds.has(x.id)).map((x) => (
                    <span key={x.id} className="scn-chip on" title={`${x.name}：${x.condition}`}><Icon name="check" size={11} />{x.name.replace('/时延抖动', '').replace(/^.*的 /, '')}</span>
                  ))}
                  <span className="scn-chip" title={c.scenarios.filter((x) => !matchedIds.has(x.id)).map((x) => x.name).join('；')}>
                    {matchedIds.size ? '另 ' : ''}{c.scenarios.filter((x) => !matchedIds.has(x.id)).length} 种候选</span>
                </span>
              </div>
            ))}
            {derivedCodes.length > 0 && (
              <div className="row-item kg-row">
                {derivedCodes.map((c) => <span key={c} className="code-chip">{c}</span>)}
                <span className="row-name">为下游失败向上传导的结果，不单独定根因</span>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section no="2.3" title="交叉验证" hint="聚类 × 图谱" tone={crossval?.decision === 'conclusion' ? 'good' : undefined}
        takeaway={crossval ? (crossval.decision === 'conclusion' ? <><Icon name="checkCircle" size={13} />唯一结论 · 慢推理未触发</> : <>转慢推理</>) : undefined}
        action={crossval ? { label: '核对明细', onClick: () => setModal('cv') } : undefined}>
        {!crossval ? <div className="empty">等待聚类与图谱推理完成…</div> : (
          <div className="rows">
            {crossval.items.map((it) => (
              <div key={it.series} className="row-item cv-row">
                <span className="cv-series"><b>{short(it.instance)}</b> · <span className="mono">{it.cause}</span></span>
                <span className="row-meta grow">{it.cluster_hints.slice(0, 2).map((h) => `${h.set.map(short).join('、')} ${pct(h.score)}`).join(' · ')}</span>
                <span className="cv-arrow"><Icon name="arrowRight" size={13} /></span>
                {it.best ? <span className="cv-match"><Icon name="check" size={12} />{it.best.name.replace('/时延抖动', '').replace(' 后端至 ', '→').replace(' 的 ', ' ')}<b>{pct(it.best.match_score)}</b></span>
                  : <span className="cv-nomatch">{it.verdict === 'none' ? '无匹配场景' : '多个场景接近'}</span>}
              </div>
            ))}
            {crossval.derived.length > 0 && (
              <div className="row-item cv-derived">
                <span className="row-meta">传导侧</span>
                {crossval.derived.map((d) => (
                  <span key={d.series} className="hint-chip" title="增量中可由下游失败解释的比例">{short(d.instance)}·<span className="mono">{d.cause}</span> <b>{pct(d.explained_ratio)}</b></span>
                ))}
              </div>
            )}
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
        <Modal wide title="图谱推理 · 原因码与产生场景" onClose={() => setModal(null)}>
          <KgGraph kg={kg} crossval={crossval} />
          <div className="cause-list">
            {kg.causes.map((c) => (
              <details key={c.code} className="cause">
                <summary><span className="mono">{c.code}</span><b>{c.name}</b><span className="muted">{c.nf_type} · {c.procedure} · {c.interface}</span></summary>
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
        </Modal>
      )}

      {modal === 'cv' && crossval && (
        <Modal wide title="交叉验证 · 场景特征逐项核对" onClose={() => setModal(null)}>
          <div className="modal-row"><span>{crossval.reason}。关键维度全部满足才算匹配；带圈的为关键维度。</span></div>
          {crossval.items.map((it) => (
            <div key={it.series} className="cv-block">
              <div className="cv-block-head"><b>{short(it.instance)}</b> · {it.procedure} · <span className="mono">{it.cause}</span> {it.cause_name}</div>
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
            </div>
          ))}
        </Modal>
      )}
    </div>
  )
}
