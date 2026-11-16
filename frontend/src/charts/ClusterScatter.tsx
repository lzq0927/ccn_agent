import { useMemo } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { GRADE_COLOR, GRADE_LABEL, INK } from '../lib/colors'
import type { ClusterPoint } from '../types'

interface Props { points: ClusterPoint[]; selected: string | null; onSelect: (key: string) => void }

/** 横轴：原因码在“网元实例+流程”内的占比；纵轴：该“网元实例+流程”的 CHR 总数。越靠右上越可能是根因。 */
export function ClusterScatter({ points, selected, onSelect }: Props) {
  const option = useMemo(() => {
    const sorted = [...points].sort((a, b) => Number(a.anomalous) - Number(b.anomalous))
    const maxY = Math.max(...points.map((p) => p.group_total), 10)
    return {
      animation: false,
      grid: { left: 52, right: 30, top: 24, bottom: 40 },
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
        type: 'value', min: 0, max: 100, name: '原因码在 网元实例+流程 内的占比', nameLocation: 'middle', nameGap: 26,
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
            show: p.anomalous, formatter: `${p.instance.split(':')[1]} ${p.cause}`, position: p.share > 0.8 ? 'left' : 'right', distance: 6,
            color: INK.secondary, fontSize: 10,
          },
        })),
        labelLayout: { moveOverlap: 'shiftY' },
      }],
    }
  }, [points, selected])
  return <EChart option={option} height={320} ariaLabel="原因码占比与总量散点图"
    onClick={(p) => { const d = (p.data as { p?: ClusterPoint })?.p; if (d?.anomalous) onSelect(d.key) }} />
}
