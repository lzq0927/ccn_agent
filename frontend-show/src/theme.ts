// ============================================================================
// 高稳智能体 · 设计 Token
// 深空 HUD 平台视觉语言。所有颜色/尺寸集中于此，组件引用常量。
// ============================================================================

/** 健康度 / 状态色阶 */
export const STATUS = {
  healthy: "#22c55e",
  healthyGlow: "#34d399",
  notice: "#38bdf8",
  warning: "#f59e0b",
  fault: "#ef4444",
  faultGlow: "#fb7185",
  recovered: "#10b981",
  idle: "#475569",
} as const;

/** 9 类网元(NE)的专属配色 —— 取自 free5GC 风格、可区分且高对比 */
export const NE_COLORS: Record<string, { base: string; glow: string; label: string; cn: string }> = {
  gNB: { base: "#22d3ee", glow: "#67e8f9", label: "gNB", cn: "基站" },
  AMF: { base: "#60a5fa", glow: "#93c5fd", label: "AMF", cn: "接入与移动性" },
  SMF: { base: "#a78bfa", glow: "#c4b5fd", label: "SMF", cn: "会话管理" },
  UPF: { base: "#f472b6", glow: "#f9a8d4", label: "UPF", cn: "用户面" },
  PCF: { base: "#facc15", glow: "#fde047", label: "PCF", cn: "策略控制" },
  UDM: { base: "#34d399", glow: "#6ee7b7", label: "UDM", cn: "统一数据管理" },
  AUSF: { base: "#2dd4bf", glow: "#5eead4", label: "AUSF", cn: "鉴权服务" },
  NRF: { base: "#fb923c", glow: "#fdba74", label: "NRF", cn: "网络仓储" },
  NSSF: { base: "#f87171", glow: "#fca5a5", label: "NSSF", cn: "切片选择" },
};

/** 路由配色(置信度三档 + 探索) */
export const ROUTE_COLORS: Record<string, { base: string; glow: string; label: string; cn: string }> = {
  workflow: { base: "#22c55e", glow: "#4ade80", label: "WORKFLOW", cn: "确定性工作流" },
  guided: { base: "#38bdf8", glow: "#7dd3fc", label: "GUIDED", cn: "技能引导 Loop" },
  autonomous: { base: "#a78bfa", glow: "#c4b5fd", label: "AUTONOMOUS", cn: "自主探索 Loop" },
  exploration: { base: "#f472b6", glow: "#f9a8d4", label: "EXPLORATION", cn: "多算法融合" },
};

/** 闭环故事 7 阶段 */
export interface PhaseDef {
  id: number;
  key: string;
  cn: string;
  en: string;
  color: string;
  glow: string;
}
export const PHASES: PhaseDef[] = [
  { id: 0, key: "idle", cn: "网络就绪", en: "STEADY STATE", color: "#34d399", glow: "#6ee7b7" },
  { id: 1, key: "generation", cn: "数据采集", en: "AGENT 1 · DATA COLLECTION", color: "#38bdf8", glow: "#7dd3fc" },
  { id: 2, key: "anomaly", cn: "异常检测", en: "ANOMALY DETECTED", color: "#f59e0b", glow: "#fbbf24" },
  { id: 3, key: "confidence", cn: "策略匹配", en: "POLICY MATCHING", color: "#a78bfa", glow: "#c4b5fd" },
  { id: 4, key: "reasoning", cn: "根因推理", en: "AGENT 2 · REASONING", color: "#818cf8", glow: "#a5b4fc" },
  { id: 5, key: "recovery", cn: "执行恢复", en: "RECOVERY ACTION", color: "#fb7185", glow: "#fda4af" },
  { id: 6, key: "healed", cn: "网络恢复", en: "NETWORK HEALED", color: "#10b981", glow: "#34d399" },
  { id: 7, key: "evaluation", cn: "评估优化", en: "AGENT 3 · EVALUATION", color: "#2dd4bf", glow: "#5eead4" },
];

// 注:界面结构色已统一为 global.css 的 CSS 变量(<html data-theme> 切换)。
// 此处仅保留与数据语义绑定的常量(健康/网元/路由/相位色等)，它们跨主题不变。

export const FONT = {
  mono: 'ui-monospace, "JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
  sans: '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/** 把 success_rate(0..1)映射成健康色(绿→黄→红) */
export function srColor(sr: number): string {
  if (sr >= 0.995) return STATUS.healthy;
  if (sr >= 0.97) return STATUS.warning;
  if (sr >= 0.9) return "#fb923c";
  return STATUS.fault;
}

/** 安全发光滤镜 id 前缀(避免多实例冲突由组件自行拼接) */
export const GLOW = {
  soft: "glow-soft",
  strong: "glow-strong",
  fault: "glow-fault",
};
