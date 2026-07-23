// ============================================================================
// KpiChart —— KPI(整网成功率时序)+ CHR(主导原因值占比)双线小图
//   x: 仿真时间 1..60;SR 线(0.80~1.00)+ 阈值 0.995 + 故障窗阴影 + simT 播放头。
//   有 chrInsight 时叠加 CHR 主导原因(sudden)失败占比线(0~0.6 反向轴,突增向上)。
//   用于右侧阶段侧栏(phase 0/1/2/6)。
// ============================================================================

import { getKpi } from "../../story/director";
import { buildChrSeries, sample } from "../../data/kpi";
import { srColor, STATUS } from "../../theme";
import type { Scenario } from "../../data/types";
import type { StoryState } from "../../story/types";

const W = 300;
const H = 132;
const PAD = { l: 6, r: 6, t: 14, b: 16 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
const SR_LO = 0.8;
const SR_HI = 1.0;
const CHR_MAX = 0.6;

function xOf(t: number): number {
  return PAD.l + (t / 60) * PLOT_W;
}
function ySr(sr: number): number {
  return PAD.t + ((SR_HI - sr) / (SR_HI - SR_LO)) * PLOT_H;
}
function yChr(v: number): number {
  return PAD.t + PLOT_H - (Math.min(v, CHR_MAX) / CHR_MAX) * PLOT_H;
}

export function KpiChart({ scenario, state, compact = false }: { scenario: Scenario; state: StoryState; compact?: boolean }) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const chrSeries = buildChrSeries(scenario).filter((c) => c.verdict === "sudden");
  const chrMain = chrSeries[0];

  // SR 折线点
  const srPts = kpi.overall.map((v, i) => `${xOf(i + 1).toFixed(1)},${ySr(v).toFixed(1)}`).join(" ");
  // CHR 折线点
  const chrPts = chrMain ? chrMain.data.map((v, i) => `${xOf(i + 1).toFixed(1)},${yChr(v).toFixed(1)}`).join(" ") : "";

  const curSr = sample(kpi.overall, simT);
  const curChr = chrMain ? sample(chrMain.data, simT) : 0;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={compact ? 92 : 116} preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
        {/* 故障窗阴影 */}
        <rect x={xOf(kpi.faultStart)} y={PAD.t} width={xOf(kpi.faultEnd) - xOf(kpi.faultStart)} height={PLOT_H} fill="rgba(239,68,68,0.08)" />
        {/* 阈值线 0.995 */}
        <line x1={PAD.l} y1={ySr(kpi.threshold)} x2={W - PAD.r} y2={ySr(kpi.threshold)} stroke="rgba(148,163,184,0.5)" strokeWidth={0.8} strokeDasharray="3 3" />
        <text x={W - PAD.r} y={ySr(kpi.threshold) - 2} textAnchor="end" fontSize={7} fill="var(--text-mid)" fontFamily="var(--font-mono)">阈值 {(kpi.threshold * 100).toFixed(1)}%</text>

        {/* CHR 线 */}
        {chrMain && (
          <>
            <polyline points={chrPts} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeLinejoin="round" opacity={0.9} />
            <circle cx={xOf(simT)} cy={yChr(curChr)} r={2.6} fill="#a78bfa" stroke="#04070f" strokeWidth={0.8} />
          </>
        )}

        {/* SR 线 */}
        <polyline points={srPts} fill="none" stroke="#38bdf8" strokeWidth={1.8} strokeLinejoin="round" opacity={0.95} />
        <circle cx={xOf(simT)} cy={ySr(curSr)} r={3.4} fill={srColor(curSr)} stroke="#04070f" strokeWidth={1} style={{ filter: `drop-shadow(0 0 4px ${srColor(curSr)})` }} />

        {/* 播放头 */}
        <line x1={xOf(simT)} y1={PAD.t} x2={xOf(simT)} y2={PAD.t + PLOT_H} stroke="var(--text-bright)" strokeWidth={0.9} opacity={0.5} />

        {/* 当前读数 */}
        <text x={PAD.l} y={10} fontSize={8.5} fontWeight={700} fill={srColor(curSr)} fontFamily="var(--font-mono)">SR {(curSr * 100).toFixed(2)}%</text>
        {chrMain && <text x={PAD.l + 70} y={10} fontSize={8} fill="#a78bfa" fontFamily="var(--font-mono)">CHR {chrMain.key} {(curChr * 100).toFixed(0)}%</text>}
        <text x={W - PAD.r} y={H - 3} textAnchor="end" fontSize={6.5} fill="var(--text-mid)" fontFamily="var(--font-mono)">T{simT.toFixed(0)}/60</text>
      </svg>
      {!compact && (
        <div style={{ display: "flex", gap: 10, marginTop: 2, fontSize: 7.5, fontFamily: "var(--font-mono)", color: "var(--text-mid)" }}>
          <span><span style={{ color: "#38bdf8" }}>━</span> KPI 成功率</span>
          {chrMain && <span><span style={{ color: "#a78bfa" }}>━</span> CHR {chrMain.key}</span>}
          <span style={{ color: STATUS.fault }}>▦</span> 故障窗
        </div>
      )}
    </div>
  );
}
