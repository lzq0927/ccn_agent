import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, PieChart, ScatterChart, GraphChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  GraphicComponent,
  AriaComponent,
  TitleComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
echarts.use([
  LineChart,
  PieChart,
  ScatterChart,
  GraphChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  GraphicComponent,
  AriaComponent,
  TitleComponent,
  SVGRenderer,
]);
export type ChartEvent = { data: unknown; name: string; dataIndex: number };
export default function Chart({
  option,
  height = 250,
  label,
  onClick,
}: {
  option: EChartsCoreOption;
  height?: number;
  label: string;
  onClick?: (event: ChartEvent) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current, undefined, { renderer: "svg" });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);
  useEffect(() => {
    instance.current?.setOption(
      {
        animationDuration: 350,
        textStyle: {
          fontFamily: 'Inter, "Noto Sans CJK SC", system-ui, sans-serif',
          color: "#718096",
        },
        ...option,
      },
      true,
    );
  }, [option]);
  useEffect(() => {
    const chart = instance.current;
    if (onClick) chart?.on("click", onClick as never);
    return () => {
      chart?.off("click");
    };
  }, [onClick]);
  return (
    <div
      className="chart"
      ref={element}
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}
