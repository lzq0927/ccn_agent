import { useMemo } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { INK, OTHER, SERIES } from '../lib/colors'
import type { CauseCount } from '../types'

export interface Slice { name: string; label: string; value: number; color: string; emphasis?: boolean }

/** 原因码 -> 颜色：按给定顺序固定分配，超出 7 个并入“其它”。颜色跟随原因码，不随排名变化。 */
export function colorMap(causes: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  causes.forEach((c, i) => { map[c] = i < 7 ? SERIES[i] : OTHER })
  return map
}

export function toSlices(items: CauseCount[], colors: Record<string, string>): Slice[] {
  const main: Slice[] = []
  let other = 0
  for (const it of items) {
    const color = colors[it.cause] ?? OTHER
    if (color === OTHER) other += it.count
    else main.push({ name: it.cause, label: it.name, value: it.count, color, emphasis: it.anomalous })
  }
  if (other) main.push({ name: '其它', label: '其余原因码', value: other, color: OTHER })
  return main
}

export function Donut({ slices, title, size = 168 }: { slices: Slice[]; title: string; size?: number }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...TOOLTIP, trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number; data: { label: string } }) =>
        `<b>${p.name}</b> ${p.data.label}<br/>${p.value} 条 · ${p.percent}%` },
    graphic: [
      { type: 'text', left: 'center', top: '40%', style: { text: total.toLocaleString('en-US'), fontSize: 20, fontWeight: 600, fill: INK.primary } },
      { type: 'text', left: 'center', top: '56%', style: { text: '条 CHR', fontSize: 11, fill: INK.muted } },
    ],
    series: [{
      type: 'pie', radius: ['60%', '86%'], avoidLabelOverlap: false, label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 2 }, emphasis: { scale: true, scaleSize: 3 },
      data: total ? slices.map((s) => ({ name: s.name, value: s.value, label: s.label, itemStyle: { color: s.color } }))
        : [{ name: '无', value: 1, label: '', itemStyle: { color: '#f0efec' } }],
      silent: !total,
    }],
  }), [slices, total])
  return (
    <div className="donut">
      <EChart option={option} height={size} ariaLabel={title} />
      <div className="donut-title">{title}</div>
    </div>
  )
}
