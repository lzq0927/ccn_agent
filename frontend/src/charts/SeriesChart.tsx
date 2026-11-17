import { useMemo } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { INK, STATUS } from '../lib/colors'
import type { SeriesChart as S } from '../types'

const STATUS_TEXT = { sustained: '持续突增', transient: '未达持续', normal: '平稳' }

/** 单个时序维度（网元实例 + 流程 + 原因码）的小图：每分钟 CHR 条数、阈值线、突增点。 */
export function SeriesCard({ s, fill }: { s: S; fill?: boolean }) {
  const option = useMemo(() => {
    const peak = Math.max(...s.values, s.threshold ?? 0, 4)
    return {
      animation: false,
      grid: { left: 28, right: 30, top: 8, bottom: 16 },
      tooltip: {
        ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: INK.axis } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex
          return `<div style="color:${INK.muted};margin-bottom:2px">${s.labels[i]}</div>` +
            `<b>${s.values[i]}</b> 条/分${s.flags[i] ? ' · 突增' : ''}` +
            (s.baseline != null ? `<div style="color:${INK.secondary}">基线 ${s.baseline.toFixed(1)} · 阈值 ${(s.threshold ?? 0).toFixed(1)}</div>` : '')
        },
      },
      xAxis: {
        type: 'category', data: s.labels, boundaryGap: false, axisTick: { show: false },
        axisLine: { lineStyle: { color: INK.axis } },
        axisLabel: { color: INK.muted, fontSize: 10, interval: (i: number) => i === 0 || i === s.labels.length - 1 },
      },
      yAxis: {
        type: 'value', min: 0, max: Math.ceil(peak * 1.15), splitNumber: 2,
        axisLabel: { color: INK.muted, fontSize: 10 }, splitLine: { lineStyle: { color: INK.grid } },
      },
      series: [{
        type: 'line', smooth: false, lineStyle: { width: 2, color: s.status === 'sustained' ? STATUS.critical : STATUS.accent },
        areaStyle: { color: s.status === 'sustained' ? STATUS.critical : STATUS.accent, opacity: 0.08 },
        showSymbol: true,
        data: s.values.map((v, i) => s.flags[i]
          ? { value: v, symbol: 'circle', symbolSize: 9, itemStyle: { color: STATUS.critical, borderColor: '#fff', borderWidth: 2 } }
          : { value: v, symbol: 'none' }),
        markLine: s.threshold == null ? undefined : {
          silent: true, symbol: 'none', lineStyle: { color: INK.axis, width: 1, type: 'solid' },
          label: { formatter: '阈值', color: INK.muted, fontSize: 10, position: 'end' },
          data: [{ yAxis: s.threshold }],
        },
      }],
    }
  }, [s])

  return (
    <div className={`series-card ${s.status} ${fill ? 'fill' : ''}`} title={`${s.instance} · ${s.procedure} · ${s.cause} ${s.cause_name}`}>
      <div className="series-head">
        <div className="series-title"><b>{s.instance.split(':')[1]}</b> · {s.procedure} · <span className="mono">{s.cause}</span></div>
        <i className={`sdot ${s.status}`} title={STATUS_TEXT[s.status]} />
      </div>
      <div className="series-plot"><EChart option={option} height={fill ? '100%' : 84} ariaLabel={`${s.key} 每分钟 CHR 条数`} /></div>
    </div>
  )
}
