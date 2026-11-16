import { useEffect, useMemo, useState } from 'react'
import { Donut, colorMap, toSlices } from '../charts/Donut'
import { SeriesCard } from '../charts/SeriesChart'
import { TrendChart } from '../charts/TrendChart'
import { Topology, TopologyLegend } from '../components/Topology'
import { num } from '../lib/format'
import type { AppState, Meta, Topo } from '../types'

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone ?? ''}`}>{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  )
}

export function PerceptionView({ state, topo, meta }: { state: AppState; topo: Topo; meta: Meta }) {
  const { tick, perception: p, trend, alarmLabel } = state
  const [group, setGroup] = useState(0)
  useEffect(() => setGroup(0), [p])

  const labels = useMemo(() => {
    const [h, m] = meta.start.split(' ')[1].split(':').map(Number)
    return Array.from({ length: meta.minutes }, (_, i) => {
      const t = h * 60 + m + i
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    })
  }, [meta])

  const series = p?.series ?? tick?.series ?? []
  const pie = p?.pies[group]
  const colors = useMemo(() => colorMap(pie ? pie.before.map((c) => c.cause) : []), [pie])
  const { sustain_n: n, sustain_m: m, window_min: w } = meta.settings

  return (
    <div className="view">
      <div className="kpis">
        <Kpi label="滑窗" value={tick ? `${tick.window.from} – ${tick.window.to}` : '—'} hint={`${w} 分钟，每分钟感知一次`} />
        <Kpi label="窗口内 CHR" value={num(tick?.total)} hint={tick ? `累计清洗 ${num(tick.preprocess.input - tick.preprocess.output)} 条脏数据` : '条'} />
        <Kpi label="时序维度" value={num(p?.stats.n_series ?? tick?.n_series)} hint="网元实例 × 流程 × 原因码" />
        <Kpi label="持续突增维度" value={num(p?.stats.n_anomalous ?? tick?.n_sustained)} tone={(p?.stats.n_anomalous ?? tick?.n_sustained) ? 'critical' : ''}
          hint={`${n} 分钟内 ≥${m} 分钟突增`} />
        <Kpi label="降噪滤除" value={p ? `${p.stats.filtered_pct}%` : '—'} hint={p ? `保留 ${num(p.stats.kept)} / ${num(p.stats.total)} 条` : '发现异常后执行'} />
      </div>

      <div className="grid-2">
        <section className="card">
          <header><h3>全网 CHR 趋势</h3><p>每分钟条数，浅色带为当前滑窗</p></header>
          <TrendChart trend={trend} labels={labels} totalMinutes={meta.minutes} windowFrom={tick?.window.from} alarm={alarmLabel} />
        </section>
        <section className="card">
          <header><h3>网元状态</h3><p>最近一分钟各网元实例的突增情况</p></header>
          <Topology topo={topo} live={tick?.node_status} />
          <TopologyLegend mode="live" />
        </section>
      </div>

      <section className="card">
        <header>
          <h3>时序异常检测</h3>
          <p>
            粒度为网元实例 + 流程 + 原因码，红点为突增点。
            {p ? ` 本窗口共分析 ${p.stats.n_series} 个维度，${p.stats.n_anomalous} 个持续突增，${p.stats.n_transient} 个有突增点但未达持续判定（不告警）；下方为典型维度。`
              : ' 维度较多，仅展示典型的（突增优先，其次为量最大的常态底噪）。'}
          </p>
        </header>
        {series.length ? <div className="series-grid">{series.map((s) => <SeriesCard key={s.key} s={s} />)}</div>
          : <div className="empty">等待数据…</div>}
      </section>

      <section className="card">
        <header>
          <h3>降噪前后对比</h3>
          <p>按网元实例 + 流程查看原因码分布。降噪只保留持续突增维度自突增起始之后的 CHR，一直存在的底噪被滤除。</p>
        </header>
        {!p || !pie ? <div className="empty">发现异常后执行降噪，这里展示降噪前后的原因码饼图。</div> : (
          <>
            <div className="statement">
              窗口 {p.window.from}–{p.window.to} 内共 <b>{num(p.stats.total)}</b> 条 CHR，降噪滤除 <b>{p.stats.filtered_pct}%</b>，
              保留 <b>{num(p.stats.kept)}</b> 条交给分析阶段。
            </div>
            <div className="chips" role="tablist">
              {p.pies.map((g, i) => (
                <button key={`${g.instance}|${g.procedure}`} role="tab" aria-selected={i === group}
                  className={`chip-btn ${i === group ? 'on' : ''} ${g.after_total ? '' : 'quiet'}`} onClick={() => setGroup(i)}>
                  {g.instance} · {g.procedure}
                </button>
              ))}
            </div>
            <div className="pie-compare">
              <Donut title="降噪前" slices={toSlices(pie.before, colors)} />
              <div className="pie-arrow" aria-hidden>→</div>
              <Donut title={pie.after_total ? '降噪后' : '降噪后（无残留）'} slices={toSlices(pie.after, colors)} />
              <table className="pie-legend">
                <thead><tr><th>原因码</th><th className="r">降噪前</th><th className="r">降噪后</th></tr></thead>
                <tbody>
                  {pie.before.map((c) => {
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
      </section>
    </div>
  )
}
