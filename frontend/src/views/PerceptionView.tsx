import { useEffect, useMemo, useState } from 'react'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { SeriesCard } from '../charts/SeriesChart'
import { Icon } from '../components/Icon'
import { Section } from '../components/Section'
import { Topology, TopologyLegend } from '../components/Topology'
import { num } from '../lib/format'
import type { AppState, Meta, Topo } from '../types'

/** 一行式指标：图标 + 名称 + 数值。 */
export function Stat({ icon, label, value, tone, title }: { icon: string; label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`} title={title}>
      <span className="stat-icon"><Icon name={icon} size={14} /></span>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
    </div>
  )
}

export function PerceptionView({ state, topo, meta }: { state: AppState; topo: Topo; meta: Meta }) {
  const { tick, incident } = state
  // 故障恢复后，感知页回到常态展示；分析与结论页仍保留最近一次故障的结果
  const p = incident?.status === 'active' ? state.perception : null
  const [group, setGroup] = useState(0)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setGroup(0); setShowAll(false) }, [p])

  const all = p?.series ?? tick?.series ?? []
  const hot = all.filter((s) => s.status === 'sustained')
  const series = p && !showAll ? hot : all
  const pie = p?.pies[group]
  const colors = useMemo(() => colorMap(pie ? pie.before.map((c) => c.cause) : []), [pie])
  const nAnom = p?.stats.n_anomalous ?? tick?.n_sustained ?? 0
  const { sustain_n: n, sustain_m: m, window_min: w } = meta.settings

  return (
    <div className="view">
      <div className="stats">
        <Stat icon="clock" label="滑窗" value={tick ? `${tick.window.from}–${tick.window.to}` : '—'} title={`${w} 分钟滑窗，每分钟感知一次`} />
        <Stat icon="database" label="窗口内 CHR" value={num(tick?.total)} title={tick ? `已清洗 ${num(tick.preprocess.input - tick.preprocess.output)} 条脏数据` : undefined} />
        <Stat icon="layers" label="时序维度" value={num(p?.stats.n_series ?? tick?.n_series)} title="网元实例 × 流程 × 原因码" />
        <Stat icon="alert" label="持续突增" value={num(nAnom)} tone={nAnom ? 'critical' : ''} title={`${n} 分钟内 ≥${m} 分钟突增`} />
        <Stat icon="filter" label="降噪滤除" value={p ? `${p.stats.filtered_pct}%` : '—'} tone={p ? 'accent' : ''} title="发现异常后自动执行" />
      </div>

      <div className="grid-pt">
        <Section title="网元拓扑" hint="最近一分钟的突增情况">
          <div className="topo-fill">
            <Topology topo={topo} live={tick?.node_status} />
          </div>
          <TopologyLegend mode="live" />
        </Section>

        <Section title="时序异常检测" hint="网元实例 + 流程 + 原因码"
          tone={hot.length ? 'critical' : undefined}
          takeaway={p ? <><b>{p.stats.n_anomalous}</b> 个持续突增 <span className="sep" /> 共 {p.stats.n_series} 个维度</> : undefined}>
          {series.length ? <div className="series-grid">{series.map((s) => <SeriesCard key={s.key} s={s} />)}</div>
            : <div className="empty">{tick ? '等待数据…' : '点击右上角“开始”'}</div>}
          {p && all.length > hot.length && (
            <button className="link-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? '只看持续突增' : `显示对照维度 +${all.length - hot.length}`}
            </button>
          )}
        </Section>
      </div>

      <Section title="降噪前后对比" hint="只保留持续突增维度自起始之后的 CHR" tone="accent"
        takeaway={p ? <>滤除 <b>{p.stats.filtered_pct}%</b></> : undefined}>
        {!p || !pie ? <div className="empty">当前未见异常，无需降噪。发现持续突增后自动执行。</div> : (
          <div className="denoise">
            <div className="denoise-left">
              <div className="ratio">
                <div className="ratio-bar">
                  <i className="kept" style={{ width: `${100 - p.stats.filtered_pct}%` }} />
                  <i className="dropped" style={{ width: `${p.stats.filtered_pct}%` }} />
                </div>
                <div className="ratio-legend">
                  <span><i className="sw kept" />保留 <b>{num(p.stats.kept)}</b> 条</span>
                  <span><i className="sw dropped" />滤除 <b>{num(p.stats.filtered)}</b> 条</span>
                </div>
              </div>
              <div className="chips" role="tablist">
                {p.pies.map((g, i) => (
                  <button key={`${g.instance}|${g.procedure}`} role="tab" aria-selected={i === group}
                    className={`chip-btn ${i === group ? 'on' : ''} ${g.after_total ? '' : 'quiet'}`} onClick={() => setGroup(i)}>
                    {g.instance.split(':')[1]} · {g.procedure}
                  </button>
                ))}
              </div>
            </div>
            <div className="pie-compare">
              <Donut title="降噪前" slices={toSlices(pie.before, colors)} size={150} />
              <div className="pie-arrow" aria-hidden><Icon name="arrowRight" size={18} /></div>
              <Donut title={pie.after_total ? '降噪后' : '降噪后 · 无残留'} slices={toSlices(pie.after, colors)} size={150} />
              <table className="pie-legend">
                <thead><tr><th>原因码</th><th className="r">前</th><th className="r">后</th></tr></thead>
                <tbody>
                  {pie.before.slice(0, 5).map((c) => {
                    const after = pie.after.find((a) => a.cause === c.cause)?.count ?? 0
                    return (
                      <tr key={c.cause} className={after ? 'kept' : ''}>
                        <td><i className="swatch" style={{ background: colors[c.cause] }} /><span className="mono">{c.cause}</span> {c.name}</td>
                        <td className="r">{c.count}</td>
                        <td className="r">{after || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
