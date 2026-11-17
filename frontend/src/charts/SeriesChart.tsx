import { useMemo } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { INK, STATUS } from '../lib/colors'
import type { SeriesChart as S } from '../types'

const THRESHOLD_COLOR = '#98a2b3'

/** 单个时序维度（网元实例 + 流程 + 原因码）的小图：最近 30 分钟每分钟的 CHR 条数、动态阈值线、突增点。 */
export function SeriesCard({ s, fill }: { s: S; fill?: boolean }) {
  const option = useMemo(() => {
    const color = s.status === 'sustained' ? STATUS.critical : STATUS.accent
    const peak = Math.max(...s.values, ...s.thresholds.map((t) => t ?? 0), 4)
    const lastT = s.thresholds.reduce<number>((acc, t, i) => (t != null ? i : acc), -1)
    return {
      animation: false,
      grid: { left: 28, right: 30, top: 8, bottom: 16 },
      tooltip: {
        ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: INK.axis } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex
          const t = s.thresholds[i]
          return `<div style="color:${INK.muted};margin-bottom:2px">${s.labels[i]}</div>` +
            `<b>${s.values[i]}</b> 条/分${s.flags[i] ? ' · 突增' : ''}` +
            `<div style="color:${INK.secondary}">${t != null ? `动态阈值 ${t.toFixed(1)}` : '基线建立中，暂不判定'}</div>`
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
      series: [
        {
          name: '动态阈值', type: 'line', data: s.thresholds, connectNulls: true, showSymbol: false, silent: true, z: 1,
          lineStyle: { width: 1.2, color: THRESHOLD_COLOR, type: [4, 3] },
          endLabel: { show: lastT >= 0, formatter: '阈值', color: INK.muted, fontSize: 10, distance: 4 },
        },
        {
          name: 'CHR', type: 'line', smooth: false, z: 2, lineStyle: { width: 2, color }, areaStyle: { color, opacity: 0.08 },
          showSymbol: true, showAllSymbol: true,
          data: s.values.map((v, i) => s.flags[i]
            ? { value: v, symbol: 'circle', symbolSize: 8, itemStyle: { color: STATUS.critical, borderColor: '#fff', borderWidth: 1.5 } }
            : { value: v, symbol: 'none' }),
        },
      ],
    }
  }, [s])

  return (
    <div className={`series-card ${s.status} ${fill ? 'fill' : ''}`} title={`${s.instance} · ${s.procedure} · ${s.cause} ${s.cause_name}`}>
      <div className="series-head">
        <div className="series-title"><b>{s.instance.split(':')[1]}</b> · {s.procedure} · <span className="mono">{s.cause}</span></div>
      </div>
      <div className="series-plot"><EChart option={option} height={fill ? '100%' : 84} ariaLabel={`${s.key} 每分钟 CHR 条数`} /></div>
    </div>
  )
}
