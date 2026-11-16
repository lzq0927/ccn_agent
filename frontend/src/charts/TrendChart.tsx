import { useMemo } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { INK, STATUS } from '../lib/colors'

interface Props {
  trend: { label: string; total: number }[]
  totalMinutes: number
  windowFrom?: string
  alarm?: string | null
  labels: string[]
}

/** 全网每分钟 CHR 条数；浅色带为当前 15 分钟滑窗。 */
export function TrendChart({ trend, windowFrom, alarm, labels }: Props) {
  const option = useMemo(() => {
    const last = trend[trend.length - 1]?.label
    return {
      animation: false,
      grid: { left: 40, right: 16, top: 22, bottom: 24 },
      tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: INK.axis } },
        valueFormatter: (v: number) => `${v} 条/分` },
      xAxis: {
        type: 'category', data: labels, boundaryGap: false, axisTick: { show: false },
        axisLine: { lineStyle: { color: INK.axis } }, axisLabel: { color: INK.muted, fontSize: 11, interval: 4 },
      },
      yAxis: {
        type: 'value', min: 0, splitNumber: 3, axisLabel: { color: INK.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: INK.grid } },
      },
      series: [{
        name: 'CHR', type: 'line', showSymbol: false, lineStyle: { width: 2, color: STATUS.accent },
        areaStyle: { color: STATUS.accent, opacity: 0.08 }, data: trend.map((t) => t.total),
        markArea: windowFrom && last ? {
          silent: true, itemStyle: { color: 'rgba(11,11,11,0.035)' },
          label: { show: true, position: 'insideTopLeft', color: INK.muted, fontSize: 10, formatter: '当前滑窗' },
          data: [[{ xAxis: windowFrom }, { xAxis: last }]],
        } : undefined,
        markLine: alarm ? {
          silent: true, symbol: 'none', lineStyle: { color: STATUS.critical, width: 1, type: 'solid' },
          label: { formatter: '触发分析', color: INK.secondary, fontSize: 10, position: 'end', rotate: 0 },
          data: [{ xAxis: alarm }],
        } : undefined,
      }],
    }
  }, [trend, windowFrom, alarm, labels])
  return <EChart option={option} height={268} ariaLabel="全网每分钟 CHR 条数" />
}
