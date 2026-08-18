// ============================================================================
// anomaly —— 动态异常检测(图表层)
//   替代固定阈值(如 KPI<99.5% / CHR>30%):用「因果滚动窗口」的自适应基线,
//   每个时刻只看过去 win 个采样点 → 滚动中位数 μ 与鲁棒离散度 MAD,
//   动态界 = μ ± k·MAD(1.4826 把 MAD 归一到 σ 等价尺度)。
//   网络方向:跌破下界 = 异常;CHR 方向:突破上界 = 突增。
//   这就是横向(均质化)比较的数学形式:多条曲线在同一时刻的截面分布决定"正常范围"。
// ============================================================================

/** 中位数 */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** MAD(中位绝对偏差),乘 1.4826 归一到 σ 尺度 */
export function madSigma(xs: number[]): number {
  if (xs.length < 2) return 0;
  const med = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

export interface DynBand {
  /** 滚动中位数基线(逐时刻) */
  base: number[];
  /** 异常界(下界或上界,逐时刻) */
  bound: number[];
  /** 每时刻是否检出(曲线上该点越界) */
  alarm: boolean[];
}

/**
 * 单序列动态界(CHR 突增等):upper=true 求上界,否则下界。
 * warmup:窗口不足时用已有全部点;前 minPts 个点不判异常(无基线)。
 */
export function dynamicBand(series: number[], opts?: { k?: number; win?: number; upper?: boolean; minPts?: number; floor?: number }): DynBand {
  const k = opts?.k ?? 3;
  const win = opts?.win ?? 10;
  const upper = opts?.upper ?? false;
  const minPts = opts?.minPts ?? 4;
  const floor = opts?.floor ?? 1e-4;
  const base: number[] = [];
  const bound: number[] = [];
  const alarm: boolean[] = [];
  for (let i = 0; i < series.length; i++) {
    const from = Math.max(0, i - win);
    const winPts = series.slice(from, i); // 因果:不含当前点
    const pts = winPts.length >= minPts ? winPts : series.slice(0, Math.max(i, 1));
    const mu = median(pts);
    const sig = Math.max(madSigma(pts), floor);
    const b = upper ? mu + k * sig : mu - k * sig;
    base.push(mu);
    bound.push(b);
    alarm.push(upper ? series[i] > b : series[i] < b);
  }
  return { base, bound, alarm };
}

/**
 * 多序列横向比较(均质化)动态界:每个时刻取所有曲线的**截面中位数**为基线,
 * 截面 MAD 为离散度 → 正常范围;任一曲线越界即为离群点。
 * 返回逐时刻界 + 每条曲线的离群标记。
 */
export function crossSectionBand(paths: number[][], opts?: { k?: number; win?: number; floor?: number }): { base: number[]; lo: number[]; hi: number[]; outliers: boolean[][] } {
  const k = opts?.k ?? 3;
  const win = opts?.win ?? 8;
  // σ̂ 下限:健康平线的 MAD 极小,不加下限会把 ±0.1% 噪声判成离群;
  // KPI 域传 floor≈0.004(0.4%)—— 真实故障跌落 ≥1% 仍必然越界
  const floor = opts?.floor ?? 1e-4;
  const n = Math.max(...paths.map((p) => p.length), 0);
  const base: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  const outliers: boolean[][] = paths.map(() => []);
  for (let i = 0; i < n; i++) {
    // 因果:截面中位数的滚动窗口(前一窗口的基线水平),窗口不足用当前截面
    const histBase: number[] = [];
    for (let j = Math.max(0, i - win); j < i; j++) {
      const slice = paths.map((p) => p[j]).filter((v) => v != null);
      if (slice.length) histBase.push(median(slice));
    }
    const cur = paths.map((p) => p[i]).filter((v) => v != null);
    const mu = histBase.length >= 3 ? median(histBase) : median(cur);
    const sig = Math.max(madSigma(histBase.length >= 3 ? histBase : cur), floor);
    base.push(mu);
    lo.push(mu - k * sig);
    hi.push(mu + k * sig);
    paths.forEach((p, pi) => {
      outliers[pi][i] = p[i] != null && (p[i] < mu - k * sig || p[i] > mu + k * sig);
    });
  }
  return { base, lo, hi, outliers };
}

/** 通俗口径标注(图例用):"中位数 − 3·MAD" / "中位数 + 3·MAD" */
export function bandLabel(upper: boolean, k = 3): string {
  return upper ? `动态上界 μ+${k}·σ̂` : `动态下界 μ−${k}·σ̂`;
}
