import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { GraphChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, GraphicComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([GraphChart, LineChart, PieChart, ScatterChart, GridComponent, MarkAreaComponent, MarkLineComponent,
  TooltipComponent, GraphicComponent, CanvasRenderer])

export const TOOLTIP = {
  backgroundColor: '#ffffff', borderColor: 'rgba(11,11,11,0.10)', borderWidth: 1, padding: [8, 10],
  textStyle: { color: '#0b0b0b', fontSize: 12 }, extraCssText: 'box-shadow:0 4px 16px rgba(11,11,11,0.08);border-radius:8px;',
}

interface Props {
  option: EChartsCoreOption
  height: number | string
  onClick?: (params: { data?: unknown; dataIndex?: number; name?: string }) => void
  ariaLabel?: string
}

export function EChart({ option, height, onClick, ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const click = useRef(onClick)
  click.current = onClick

  useEffect(() => {
    const c = echarts.init(el.current!)
    chart.current = c
    c.on('click', (p) => click.current?.(p as never))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); c.dispose() }
  }, [])

  useEffect(() => { chart.current?.setOption(option, true) }, [option])

  return <div ref={el} style={{ height, width: '100%' }} role="img" aria-label={ariaLabel} />
}
