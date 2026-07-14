// ============================================================================
// ConfidencePanel —— 置信度评分仪表 + 加权子分分解 + 路由决策
//   忠实于 confidence.py: pattern×0.40 + severity×0.20 + temporal×0.15
//                        + spatial×0.15 − ambiguity×0.10
// ============================================================================

import type { StoryState } from "../../story/types";
import { ROUTE_COLORS, STATUS } from "../../theme";
import { Gauge } from "../shared/Gauge";
import { HudFrame } from "../shared/HudFrame";

export function ConfidencePanel({ state }: { state: StoryState }) {
  const conf = state.confidence;
  if (!conf) return null;
  const rev = state.confidenceReveal;
  const rc = ROUTE_COLORS[conf.route];

  const parts = [
    { cn: "模式强度", en: "pattern", w: 0.4, v: conf.pattern, sign: 1 },
    { cn: "异常严重度", en: "severity", w: 0.2, v: conf.severity, sign: 1 },
    { cn: "时间清晰度", en: "temporal", w: 0.15, v: conf.temporal, sign: 1 },
    { cn: "空间清晰度", en: "spatial", w: 0.15, v: conf.spatial, sign: 1 },
    { cn: "模糊度(罚) ", en: "ambiguity", w: 0.1, v: conf.ambiguity, sign: -1 },
  ];

  return (
    <HudFrame title="智能研判" subtitle="INTELLIGENT JUDGMENT" right={<span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>Agent 2</span>}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Gauge value={conf.score * rev} display={(conf.score * rev).toFixed(2)} color={rc.base} size={96} label="CONFIDENCE" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>ROUTED TO</div>
          <div
            style={{
              fontSize: 17, fontWeight: 800, color: rc.base, fontFamily: "var(--font-mono)",
              textShadow: `0 0 12px ${rc.base}66`, border: `1px solid ${rc.base}55`, borderRadius: 6, padding: "6px 8px", textAlign: "center",
              background: `${rc.base}14`,
            }}
          >
            {rc.label}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--text-mid)", marginTop: 6, textAlign: "center" }}>{rc.cn}</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 4 }}>
            模式:<span style={{ color: "var(--text-soft)" }}>{conf.patternName}</span>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-dim)" }}>
            受影响 NE:<span style={{ color: STATUS.warning }}>{conf.affectedNeCount}</span> · 匹配 Skill:<span style={{ color: "var(--text-soft)" }}>{conf.matchedSkills.length || "—"}</span>
          </div>
        </div>
      </div>

      {/* 加权分解 */}
      <div style={{ marginTop: 12, fontSize: 8.5, letterSpacing: "0.1em", color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>WEIGHTED DECOMPOSITION</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {parts.map((p) => {
          const contrib = p.v * p.w * p.sign;
          const isNeg = p.sign < 0;
          const w = Math.abs(p.v * p.w) * rev;
          return (
            <div key={p.en}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, marginBottom: 2 }}>
                <span style={{ color: "var(--text-mid)" }}>
                  {p.cn} <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>×{p.w}</span>
                </span>
                <span style={{ fontFamily: "var(--font-mono)", color: isNeg ? STATUS.fault : "var(--text-soft)" }}>
                  {contrib >= 0 ? "+" : ""}
                  {contrib.toFixed(3)}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--accent-soft)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${w * 100}%`,
                    background: isNeg ? STATUS.fault : rc.base,
                    boxShadow: `0 0 6px ${isNeg ? STATUS.fault : rc.base}`,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Σ 最终评分</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: rc.base, fontFamily: "var(--font-mono)" }}>{(conf.score * rev).toFixed(3)}</span>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
        阈值: &gt;0.7 → WORKFLOW · 0.3~0.7 → GUIDED · ≤0.3 → AUTONOMOUS;CHR 集中失败 → EXPLORATION(优先)
      </div>
    </HudFrame>
  );
}
