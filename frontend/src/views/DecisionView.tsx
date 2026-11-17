import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Section } from '../components/Section'
import { Topology, TopologyLegend } from '../components/Topology'
import { GRADE_LABEL } from '../lib/colors'
import { num, pct, short } from '../lib/format'
import type { AppState, Topo } from '../types'

const EV_ICON: Record<string, string> = { 时序: 'activity', 聚集性: 'target', 图谱: 'graph', 排除: 'shield', 业务流: 'route', 慢推理: 'cpu' }

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1), w = 220, h = 48
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - 3 - (v / max) * (h - 8)}`)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" role="img" aria-label="每分钟 CHR 条数">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} /><polyline points={pts.join(' ')} />
    </svg>
  )
}

function Ring({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 88 88" className="ring" role="img" aria-label={`置信度 ${pct(value)}`}>
      <circle cx="44" cy="44" r={r} className="ring-track" />
      <circle cx="44" cy="44" r={r} className="ring-fill" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="43" textAnchor="middle" className="ring-val">{pct(value)}</text>
      <text x="44" y="57" textAnchor="middle" className="ring-label">置信度</text>
    </svg>
  )
}

export function DecisionView({ state, topo }: { state: AppState; topo: Topo }) {
  const c = state.conclusion
  const inc = state.incident
  const [node, setNode] = useState<string | null>(null)
  useEffect(() => setNode(c?.root.ne || null), [c])

  if (!c) return <div className="view"><div className="card"><div className="empty tall"><Icon name="zap" size={22} /><div>当前未见异常。分析完成后在这里给出结论与恢复方案</div></div></div></div>
  const stat = node ? c.node_stats[node] : null
  const note = node ? c.topology.nodes[node]?.note : ''

  return (
    <div className="view">
      <section className={`hero ${c.definitive ? 'definitive' : 'tentative'} ${inc?.status === 'recovered' ? 'recovered' : ''}`}>
        <div className="hero-main">
          <div className="hero-kicker"><span className="hero-badge"><Icon name="target" size={13} />{c.definitive ? '根因已定位' : '可能原因'}</span>
            {inc?.status === 'recovered' && <span className="hero-recovered"><Icon name="checkCircle" size={13} />已恢复 {inc.recovered_at}</span>}
            {inc && <span className="mono">{inc.id}</span>} 故障起始 <b>{c.onset}</b> · 感知 <b>{c.detected_at}</b></div>
          <h2>{c.title}</h2>
          <div className="chain">
            {c.chain.map((x, i) => (
              <div key={i} className="chain-wrap">
                {i > 0 && <span className="chain-arrow"><Icon name="arrowRight" size={16} /></span>}
                <div className={`chain-item c${i}`}>
                  <div className="chain-label">{x.label}</div>
                  <div className="chain-value">{x.value}</div>
                  <div className="chain-sub">{x.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-side">
          <Ring value={c.confidence} />
          <div className="hero-stats">
            <div><b>{num(c.impact.users)}</b><span>受影响用户</span></div>
            <div><b>{num(c.impact.failures)}</b><span>故障 CHR</span></div>
            <div><b>{c.impact.procedures.length}</b><span>受影响流程</span></div>
          </div>
        </div>
      </section>

      <Section title="拓扑定位" hint="点击网元查看详情">
        <div className="grid-topo">
          <div>
            <Topology topo={topo} overlay={c.topology} selected={node} onSelect={setNode} />
            <TopologyLegend mode="conclusion" />
          </div>
          <div className="node-detail">
            {stat && node ? (
              <>
                <div className="detail-title">{node}</div>
                <div className="detail-sub">{note || '未见异常'}</div>
                <Spark values={stat.values} />
                <div className="spark-axis"><span>{stat.labels[0]}</span><span>CHR 条/分钟</span><span>{stat.labels[stat.labels.length - 1]}</span></div>
                {stat.series.length === 0 ? <div className="muted small">窗口内没有持续突增的维度。</div> : (
                  <ul className="node-series">
                    {stat.series.map((s) => (
                      <li key={`${s.procedure}${s.cause}`}>
                        <div className="ns-top"><span><span className="mono">{s.cause}</span> {s.cause_name}</span>
                          <span className="ns-rate">{s.baseline} → <b>{s.current}</b></span></div>
                        <div className="ns-sub">{s.procedure} · {s.best.label} {s.best.set.map(short).join('、')} {pct(s.best.score)}
                          <span className={`gtag ${s.best.grade}`}>{GRADE_LABEL[s.best.grade]}</span></div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <div className="muted small">选择一个网元。</div>}
          </div>
        </div>
      </Section>

      <Section title="关键证据" hint="悬停卡片查看完整说明">
        <div className="ev-grid">
          {c.evidence.map((e, i) => (
            <div key={i} className={`ev-card k-${e.kind}`}>
              <div className="ev-head"><span className="ev-icon"><Icon name={EV_ICON[e.kind] ?? 'check'} size={14} /></span>{e.kind}</div>
              {e.metric && <div className="ev-metric">{e.metric}<small>{e.unit}</small></div>}
              <div className="ev-title">{e.title}</div>
              <div className="ev-detail">{e.detail}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="恢复方案" hint={c.recovery.definitive ? '结论明确，优先切换到可用路径' : '结论不确定，以下为处理建议'} tone="good"
        takeaway={<><Icon name="tool" size={13} />{c.recovery.steps.length} 步</>}>
        <ol className="steps">
          {c.recovery.steps.map((s, i) => (
            <li key={i} className={`t-${s.tag ?? ''}`}>
              <span className="step-no">{i + 1}</span>
              <div className="step-body">
                <div className="step-title">{s.title}{s.tag && <span className="step-tag">{s.tag}</span>}</div>
                <div className="step-detail">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>
        <details className="fold">
          <summary>移交决策执行模块的载荷（本系统不执行）</summary>
          <pre>{JSON.stringify(c.handoff, null, 2)}</pre>
        </details>
      </Section>
    </div>
  )
}
