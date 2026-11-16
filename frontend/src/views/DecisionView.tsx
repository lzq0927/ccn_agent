import { useEffect, useState } from 'react'
import { Topology, TopologyLegend } from '../components/Topology'
import { GRADE_LABEL } from '../lib/colors'
import { num, pct, short } from '../lib/format'
import type { AppState, Topo } from '../types'
import { Kpi } from './PerceptionView'

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1), w = 220, h = 44
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - 3 - (v / max) * (h - 8)}`).join(' ')
  return <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" role="img" aria-label="每分钟 CHR 条数"><polyline points={pts} /></svg>
}

export function DecisionView({ state, topo }: { state: AppState; topo: Topo }) {
  const c = state.conclusion
  const [node, setNode] = useState<string | null>(null)
  useEffect(() => setNode(c?.root.ne || null), [c])

  if (!c) return <div className="view"><div className="card"><div className="empty tall">分析完成后在这里给出结论、关键证据与恢复方案。</div></div></div>
  const stat = node ? c.node_stats[node] : null
  const note = node ? c.topology.nodes[node]?.note : ''

  return (
    <div className="view">
      <section className={`card hero ${c.definitive ? 'definitive' : 'tentative'}`}>
        <div className="hero-kicker">{c.definitive ? '根因结论' : '可能原因（慢推理）'} · 故障起始 {c.onset} · 感知时间 {c.detected_at}</div>
        <h2>{c.title}</h2>
        <p className="hero-summary">{c.summary}</p>
        <div className="kpis compact">
          <Kpi label="置信度" value={pct(c.confidence)} />
          <Kpi label="受影响用户" value={num(c.impact.users)} hint="窗口内出现失败的用户" />
          <Kpi label="故障 CHR" value={num(c.impact.failures)} hint="降噪后保留" />
          <Kpi label="受影响流程" value={String(c.impact.procedures.length)} hint={c.impact.procedures.join('、')} />
        </div>
      </section>

      <section className="card">
        <header><h3>拓扑定位</h3><p>点击网元查看它在窗口内的 CHR 走势与突增维度。</p></header>
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
                <div className="spark-axis"><span>{stat.labels[0]}</span><span>每分钟 CHR</span><span>{stat.labels[stat.labels.length - 1]}</span></div>
                {stat.series.length === 0 ? <div className="muted small">窗口内没有持续突增的维度。</div> : (
                  <ul className="node-series">
                    {stat.series.map((s) => (
                      <li key={`${s.procedure}${s.cause}`}>
                        <div><span className="mono">{s.cause}</span> {s.cause_name}</div>
                        <div className="muted small">{s.procedure} · {s.baseline} → <b>{s.current}</b> 条/分</div>
                        <div className="muted small">{s.best.label} {s.best.set.map(short).join('、')} {pct(s.best.score)}（{GRADE_LABEL[s.best.grade]}）</div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <div className="muted small">选择一个网元。</div>}
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <header><h3>分析过程与关键证据</h3></header>
          <ol className="evidence">
            {c.evidence.map((e, i) => (
              <li key={i}>
                <span className="ev-kind">{e.kind}</span>
                <div><div className="ev-title">{e.title}</div><div className="ev-detail">{e.detail}</div></div>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <header><h3>恢复方案</h3><p>{c.recovery.definitive ? '结论明确，给出确定方案：优先切换到可用路径。' : '结论不确定，以下为处理建议。'}</p></header>
          <ol className="steps">
            {c.recovery.steps.map((s, i) => (
              <li key={i}><span className="step-no">{i + 1}</span><div><div className="ev-title">{s.title}</div><div className="ev-detail">{s.detail}</div></div></li>
            ))}
          </ol>
          <details className="handoff">
            <summary>移交决策执行模块的载荷（本系统不执行）</summary>
            <pre>{JSON.stringify(c.handoff, null, 2)}</pre>
          </details>
        </section>
      </div>
    </div>
  )
}
