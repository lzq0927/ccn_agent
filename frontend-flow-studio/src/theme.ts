// ============================================================================
// 高稳智能体 · Studio 设计 Token —— 「静谧仪器」
// 结构色(面板/线/文字/强调)在 styles/global.css 的 CSS 变量里(随主题切换);
// 此处只保留与「数据语义」绑定、需要拼接透明度后缀的常量(主题稳定):
//   · STATUS  健康度/告警语义色(SVG fill/stroke 可直接用,也可拼 "xx" 透明度)
//   · ROUTE_COLORS  置信度三路由(ok 绿 / accent 靛 / warn 琥珀)
//   · PHASES  8 相位 —— 收敛为语义四色:ok(健康/完成)· accent(智能体工作)
//             · warn(检出/干预)· danger(故障),见 docs/plans/frontend-flow-studio-redesign.md §4.4
// ============================================================================

/** 健康度 / 状态色阶(与 global.css --sem-* 同值,保持主题稳定) */
export const STATUS = {
  healthy: "#35b57c",
  warning: "#d9a13c",
  warningHi: "#eec26b",
  fault: "#e05d4f",
  faultHi: "#ff8f80",
  info: "#6f9fd8",
} as const;

/** 路由配色(置信度三档:确定性=绿 · 技能引导=靛 · 自主探索=琥珀) */
export const ROUTE_COLORS: Record<string, { base: string; hi: string; label: string; cn: string }> = {
  workflow: { base: "#35b57c", hi: "#63cf9d", label: "WORKFLOW", cn: "确定性工作流" },
  guided: { base: "#7d8af2", hi: "#a3acf9", label: "GUIDED", cn: "技能引导 Loop" },
  autonomous: { base: "#d9a13c", hi: "#eec26b", label: "AUTONOMOUS", cn: "自主探索 Loop" },
  exploration: { base: "#d9a13c", hi: "#eec26b", label: "EXPLORATION", cn: "多算法融合" },
};

/** 闭环故事 8 阶段(色 = 语义轴,不再是每相一彩) */
export interface PhaseDef {
  id: number;
  key: string;
  cn: string;
  en: string;
  color: string;
  glow: string; // 亮变体(深底文字/强调线)
}
export const PHASES: PhaseDef[] = [
  { id: 0, key: "idle", cn: "网络就绪", en: "STEADY STATE", color: "#35b57c", glow: "#63cf9d" },
  { id: 1, key: "generation", cn: "数据采集", en: "AGENT 1 · COLLECTION", color: "#7d8af2", glow: "#a3acf9" },
  { id: 2, key: "anomaly", cn: "异常检测", en: "ANOMALY DETECTED", color: "#d9a13c", glow: "#eec26b" },
  { id: 3, key: "confidence", cn: "策略匹配", en: "POLICY MATCHING", color: "#7d8af2", glow: "#a3acf9" },
  { id: 4, key: "reasoning", cn: "根因推理", en: "AGENT 2 · REASONING", color: "#7d8af2", glow: "#a3acf9" },
  { id: 5, key: "recovery", cn: "执行恢复", en: "RECOVERY ACTION", color: "#d9a13c", glow: "#eec26b" },
  { id: 6, key: "healed", cn: "网络恢复", en: "NETWORK HEALED", color: "#35b57c", glow: "#63cf9d" },
  { id: 7, key: "evaluation", cn: "评估优化", en: "AGENT 3 · EVALUATION", color: "#35b57c", glow: "#63cf9d" },
];

export const FONT = {
  display: 'var(--font-display)',
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
};

/** 把 success_rate(0..1)映射成语义色(绿→琥珀→橙→红) */
export function srColor(sr: number): string {
  if (sr >= 0.995) return STATUS.healthy;
  if (sr >= 0.97) return STATUS.warning;
  if (sr >= 0.9) return "#e0854f";
  return STATUS.fault;
}
