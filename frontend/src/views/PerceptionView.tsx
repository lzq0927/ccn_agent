import { useEffect, useMemo, useState } from 'react'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { SeriesCard } from '../charts/SeriesChart'
import { TrendChart } from '../charts/TrendChart'
import { Icon } from '../components/Icon'
import { Section } from '../components/Section'
import { Topology, TopologyLegend } from '../components/Topology'
import { num } from '../lib/format'
import type { AppState, Meta, Topo } from '../types'

export function Kpi({ icon, label, value, hint, tone, bar }:
  { icon?: string; label: string; value: string; hint?: string; tone?: string; bar?: number }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-label">{icon && <span className="kpi-icon"><Icon name={icon} size={13} /></span>}{label}</div>
      <div className={`kpi-value ${value.length > 9 ? 'long' : ''}`}>{value}</div>
      {bar != null ? <div className="kpi-bar"><i style={{ width: `${bar}%` }} /></div> : hint && <div className="kpi-hint" title={hint}>{hint}</div>}
    </div>
  )
}

export function PerceptionView({ state, topo, meta }: { state: AppState; topo: Topo; meta: Meta }) {
  const { tick, trend, incident } = state
  // 故障恢复后，感知页回到常态展示；分析与结论页仍保留最近一次故障的结果
  const p = incident?.status === 'active' ? state.perception : null
  const alarmLabel = incident?.status === 'active' && trend.some((t) => t.label === incident.onset_label) ? incident.onset_label : null
  const [group, setGroup] = useState(0)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setGroup(0); setShowAll(false) }, [p])

  const labels = useMemo(() => trend.map((t) => t.label), [trend])

  const all = p?.series ?? tick?.series ?? []
  const hot = all.filter((s) => s.status === 'sustained')
  const series = p && !showAll ? hot : all
  const pie = p?.pies[group]
  const colors = useMemo(() => colorMap(pie ? pie.before.map((c) => c.cause) : []), [pie])
  const nAnom = p?.stats.n_anomalous ?? tick?.n_sustained ?? 0
  const { sustain_n: n, sustain_m: m, window_min: w } = meta.settings

  return (
    <div className="view">
      <div className="kpis">
        <Kpi icon="clock" label={`滑窗 · ${w} 分钟`} value={tick ? `${tick.window.from}–${tick.window.to}` : '—'} hint="每分钟感知一次" />
        <Kpi icon="database" label="窗口内 CHR" value={num(tick?.total)} hint={tick ? `已清洗 ${num(tick.preprocess.input - tick.preprocess.output)} 条脏数据` : '条'} />
        <Kpi icon="layers" label="时序维度" value={num(p?.stats.n_series ?? tick?.n_series)} hint="网元实例 × 流程 × 原因码" />
        <Kpi icon="alert" label="持续突增维度" value={num(nAnom)} tone={nAnom ? 'critical' : ''} hint={`${n} 分钟内 ≥${m} 分钟突增`} />
        <Kpi icon="filter" label="降噪滤除" value={p ? `${p.stats.filtered_pct}%` : '—'} tone={p ? 'accent' : ''}
          bar={p ? p.stats.filtered_pct : undefined} hint="发现异常后自动执行" />
      </div>

      <div className="grid-2 wide-left">
        <Section title="全网 CHR 趋势" hint="条/分钟" takeaway={incident?.status === 'active' ? <><Icon name="alert" size={13} />{incident.opened_at} 触发分析</> : undefined} tone="critical">
          <TrendChart trend={trend} labels={labels} windowFrom={tick?.window.from} alarm={alarmLabel} />
        </Section>
        <Section title="网元状态" hint="最近一分钟">
          <Topology topo={topo} live={tick?.node_status} />
          <TopologyLegend mode="live" />
        </Section>
      </div>

      <Section no="1.2" title="时序异常检测" hint="粒度：网元实例 + 流程 + 原因码"
        tone={hot.length ? 'critical' : undefined}
        takeaway={p ? <><b>{p.stats.n_anomalous}</b> 个持续突增 <span className="sep" /> {p.stats.n_transient} 个未达持续判定 <span className="sep" /> 共 {p.stats.n_series} 个维度</> : undefined}>
        {series.length ? <div className="series-grid">{series.map((s) => <SeriesCard key={s.key} s={s} />)}</div>
          : <div className="empty">等待数据…</div>}
        {p && all.length > hot.length && (
          <button className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? '只看持续突增' : `显示对照维度（未达持续判定 / 平稳底噪）+${all.length - hot.length}`}
          </button>
        )}
      </Section>

      <Section no="1.2" title="降噪前后对比" hint="只保留持续突增维度自起始之后的 CHR" tone="accent"
        takeaway={p ? <>滤除 <b>{p.stats.filtered_pct}%</b></> : undefined}>
        {!p || !pie ? <div className="empty">当前未见异常，无需降噪。发现持续突增后自动执行。</div> : (
          <>
            <div className="ratio">
              <div className="ratio-bar">
                <i className="kept" style={{ width: `${100 - p.stats.filtered_pct}%` }} />
                <i className="dropped" style={{ width: `${p.stats.filtered_pct}%` }} />
              </div>
              <div className="ratio-legend">
                <span><i className="sw kept" />保留 <b>{num(p.stats.kept)}</b> 条 · 故障新增</span>
                <span><i className="sw dropped" />滤除 <b>{num(p.stats.filtered)}</b> 条 · 常态底噪与毛刺</span>
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
            <div className="pie-compare">
              <Donut title="降噪前" slices={toSlices(pie.before, colors)} />
              <div className="pie-arrow" aria-hidden><Icon name="arrowRight" size={18} /></div>
              <Donut title={pie.after_total ? '降噪后' : '降噪后 · 无残留'} slices={toSlices(pie.after, colors)} />
              <table className="pie-legend">
                <thead><tr><th>原因码</th><th className="r">降噪前</th><th className="r">降噪后</th></tr></thead>
                <tbody>
                  {pie.before.slice(0, 7).map((c) => {
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
          </>
        )}
      </Section>
    </div>
  )
}
