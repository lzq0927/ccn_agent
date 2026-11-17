import { useMemo } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { GRADE_COLOR, GRADE_LABEL, INK } from '../lib/colors'
import type { ClusterPoint } from '../types'

interface Props { points: ClusterPoint[]; selected: string | null; onSelect: (key: string) => void; height?: number | string }

/** 横轴：原因码在“网元实例+流程”内的占比；纵轴：该“网元实例+流程”的 CHR 总数。越靠右上越可能是根因。 */
export function ClusterScatter({ points, selected, onSelect, height = 320 }: Props) {
  const option = useMemo(() => {
    const sorted = [...points].sort((a, b) => Number(a.anomalous) - Number(b.anomalous))
    const maxY = Math.max(...points.map((p) => p.group_total), 10)
    // 相邻的突增点把标签分别放到上下，避免互相遮挡
    const hot = points.filter((p) => p.anomalous)
    const labelPos = (p: ClusterPoint) => {
      const near = hot.find((o) => o.key !== p.key && Math.abs(o.share - p.share) < 0.12 && Math.abs(o.group_total - p.group_total) < maxY * 0.14)
      if (near) return (p.group_total - near.group_total || p.key.localeCompare(near.key)) > 0 ? 'top' : 'bottom'
      return p.share > 0.8 ? 'left' : 'right'
    }
    return {
      animation: false,
      grid: { left: 48, right: 26, top: 18, bottom: 36 },
      tooltip: {
        ...TOOLTIP, trigger: 'item',
        formatter: (p: { data: { p: ClusterPoint } }) => {
          const d = p.data.p
          return `<b>${d.instance} · ${d.procedure}</b><br/><span style="font-family:ui-monospace,monospace">${d.cause}</span> ${d.cause_name}` +
            `<br/>占比 ${(d.share * 100).toFixed(0)}% · ${d.count} / ${d.group_total} 条` +
            `<br/><span style="color:${INK.secondary}">${d.anomalous ? GRADE_LABEL[d.grade] : '常态底噪（已降噪滤除）'}</span>`
        },
      },
      xAxis: {
        type: 'value', min: 0, max: 100, name: '原因码在 网元实例+流程 内的占比', nameLocation: 'middle', nameGap: 22,
        nameTextStyle: { color: INK.muted, fontSize: 11 }, axisLabel: { color: INK.muted, fontSize: 11, formatter: '{value}%' },
        axisLine: { lineStyle: { color: INK.axis } }, axisTick: { show: false }, splitLine: { lineStyle: { color: INK.grid } },
      },
      yAxis: {
        type: 'value', min: 0, max: Math.ceil(maxY * 1.12 / 10) * 10, name: '网元实例+流程 CHR 总数', nameLocation: 'middle', nameGap: 38,
        nameTextStyle: { color: INK.muted, fontSize: 11 }, axisLabel: { color: INK.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: INK.grid } },
      },
      series: [{
        type: 'scatter', cursor: 'pointer',
        data: sorted.map((p) => ({
          value: [p.share * 100, p.group_total], p,
          symbolSize: p.anomalous ? Math.max(12, Math.min(30, 6 + Math.sqrt(p.count) * 1.6)) : 8,
          itemStyle: {
            color: GRADE_COLOR[p.grade], opacity: p.anomalous ? 1 : 0.55,
            borderColor: p.key === selected ? INK.primary : '#fff', borderWidth: 2,
          },
          label: {
            show: p.anomalous, formatter: `${p.instance.split(':')[1]} ${p.cause}`, position: labelPos(p), distance: 6,
            color: INK.secondary, fontSize: 10,
          },
        })),
        labelLayout: { moveOverlap: 'shiftY' },
        markArea: {
          silent: true, itemStyle: { color: 'rgba(208,59,59,0.045)' },
          label: { show: true, position: 'insideTopRight', color: '#c26a6a', fontSize: 11, fontWeight: 600, formatter: '根因候选区' },
          data: [[{ xAxis: 40, yAxis: Math.ceil(maxY * 1.12 / 10) * 10 * 0.35 }, { xAxis: 100, yAxis: Math.ceil(maxY * 1.12 / 10) * 10 }]],
        },
      }],
    }
  }, [points, selected])
  return <EChart option={option} height={height} ariaLabel="原因码占比与总量散点图"
    onClick={(p) => { const d = (p.data as { p?: ClusterPoint })?.p; if (d?.anomalous) onSelect(d.key) }} />
}
