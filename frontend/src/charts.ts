import type { EChartsCoreOption } from "echarts/core";
import type { Cluster, Distribution, Series } from "./types";
import { shortCause, procedure } from "./utils";
const colors = [
  "#536fe3",
  "#f19a6a",
  "#8c86cb",
  "#8db9ae",
  "#abc1df",
  "#d3b18a",
  "#a5b4c5",
];
export function causeColor(cause: string) {
  const known = [
    "SIM_SBI_TIMEOUT",
    "SIM_TRANSPORT_RETRANS_EXHAUSTED",
    "SIM_AMF_UPSTREAM_FAILURE",
    "5GSM:27",
    "5GSM:29",
    "5GSM:26",
  ];
  const index = known.indexOf(cause);
  return colors[
    index >= 0
      ? index
      : [...cause].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        colors.length
  ];
}
export function lineOption(series?: Series): EChartsCoreOption {
  if (!series) return {};
  return {
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      backgroundColor: "#fff",
      borderColor: "#e4e8ef",
      textStyle: { fontSize: 12 },
    },
    legend: {
      bottom: 0,
      icon: "roundRect",
      itemHeight: 3,
      itemWidth: 15,
      textStyle: { fontSize: 11, color: "#7a8497" },
    },
    grid: { top: 20, left: 43, right: 17, bottom: 51 },
    xAxis: {
      type: "category",
      data: series.points.map((p) => p.time),
      axisLine: { lineStyle: { color: "#e8ecf3" } },
      axisTick: { show: false },
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      name: "CHR / 分钟",
      nameTextStyle: { fontSize: 10 },
      splitLine: { lineStyle: { color: "#eff2f6", type: "dashed" } },
      axisLabel: { fontSize: 10 },
    },
    series: [
      {
        name: "CHR 数量",
        type: "line",
        data: series.points.map((p) => p.count),
        showSymbol: false,
        lineStyle: { color: "#5774df", width: 2.5 },
        itemStyle: { color: "#5774df" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "#dfe7ff" },
              { offset: 1, color: "#ffffff00" },
            ],
          },
        },
        markArea: {
          silent: true,
          itemStyle: { color: "#fdf0e980" },
          data: series.points
            .filter((p) => p.anomalous)
            .map((p) => [
              { xAxis: p.time },
              {
                xAxis:
                  series.points[
                    Math.min(
                      series.points.indexOf(p) + 1,
                      series.points.length - 1,
                    )
                  ].time,
              },
            ]),
        },
      },
      {
        name: "动态异常阈值",
        type: "line",
        data: series.points.map((p) => p.threshold),
        showSymbol: false,
        itemStyle: { color: "#e1a875" },
        lineStyle: { color: "#dfa373", width: 1.5, type: "dashed" },
      },
      {
        name: "异常点",
        type: "scatter",
        data: series.points.map((p) => (p.anomalous ? p.count : null)),
        symbolSize: 7,
        itemStyle: { color: "#e5755b", borderColor: "white", borderWidth: 1.5 },
      },
    ],
  };
}
export function pieOption(
  items: Distribution["before"],
  total: number,
  label: string,
): EChartsCoreOption {
  return {
    color: colors,
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      formatter: "{b}\n{c} 条 · {d}%",
    },
    title: [
      {
        text: total.toLocaleString(),
        left: "center",
        top: "36%",
        textStyle: { fontSize: 24, fontWeight: 600, color: "#233249" },
      },
      {
        text: label,
        left: "center",
        top: "54%",
        textStyle: { fontSize: 10, color: "#8c96a6", fontWeight: 400 },
      },
    ],
    series: [
      {
        type: "pie",
        radius: ["67%", "82%"],
        center: ["50%", "50%"],
        label: { show: false },
        emphasis: { scaleSize: 3 },
        itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 3 },
        data: items.length
          ? items.map((i) => ({
              name: `${shortCause(i.name)} · ${i.name}`,
              value: i.value,
              itemStyle: { color: causeColor(i.name) },
            }))
          : [
              {
                value: 1,
                name: "无已确认异常",
                itemStyle: { color: "#edf0f5" },
                tooltip: { show: false },
              },
            ],
      },
    ],
  };
}
export function scatterOption(groups: Cluster[]): EChartsCoreOption {
  return {
    grid: { top: 33, bottom: 46, left: 60, right: 25 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      formatter: (p: unknown) => {
        const g = (p as { data: { group: Cluster } }).data.group;
        return `${g.nf} · ${procedure(g.procedure)}\n${shortCause(g.cause)}\n原因码占比 ${g.cause_percent}% · 分组 CHR ${g.group_total}\n本码 ${g.count} 条 · ${g.users} 用户\n点击查看六维检验与饼图`;
      },
    },
    xAxis: {
      name: "原因码占比 (%)",
      nameLocation: "middle",
      nameGap: 28,
      type: "value",
      min: 0,
      max: 105,
      interval: 25,
      axisLine: { show: true, lineStyle: { color: "#dfe5ee" } },
      splitLine: { lineStyle: { color: "#f0f2f7", type: "dashed" } },
      axisLabel: { fontSize: 10, formatter: "{value}%" },
    },
    yAxis: {
      name: "实例＋流程 CHR 总数",
      nameTextStyle: { fontSize: 10 },
      type: "value",
      splitLine: { lineStyle: { color: "#f0f2f7", type: "dashed" } },
      axisLabel: { fontSize: 10 },
    },
    series: [
      {
        type: "scatter",
        data: groups.map((g) => ({
          value: [g.cause_percent, g.group_total, g.count],
          group: g,
          id: g.id,
          itemStyle: {
            color: g.features.some((f) => f.severity === "strong")
              ? "#e78872"
              : g.significant
                ? "#e5b267"
                : "#7c97d5",
            opacity: 0.83,
            borderColor: "#fff",
            borderWidth: 2,
          },
        })),
        symbolSize: (v: number[]) => Math.min(42, 10 + Math.sqrt(v[2]) * 1.25),
        emphasis: { scale: 1.2 },
        label: {
          show: true,
          position: "top",
          fontSize: 9,
          color: "#707b8e",
          formatter: (p: unknown) => {
            const g = (p as { data: { group: Cluster } }).data.group;
            return g.nf.split(":")[1];
          },
        },
      },
    ],
  };
}
