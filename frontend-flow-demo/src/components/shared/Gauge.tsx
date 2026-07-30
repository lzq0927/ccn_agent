// ============================================================================
// Gauge —— 圆弧仪表(0..1)
// ============================================================================

interface Props {
  value: number; // 0..1
  label?: string;
  display?: string;
  color: string;
  size?: number;
  sub?: string;
}

export function Gauge({ value, label, display, color, size = 92, sub }: Props) {
  const v = Math.max(0, Math.min(1, value));
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const arc = 0.75; // 270°
  const bgDash = `${arc * C} ${C}`;
  const valDash = `${v * arc * C} ${C}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(135deg)" }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(56,189,248,0.12)" strokeWidth={6} strokeDasharray={bgDash} strokeLinecap="round" />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeDasharray={valDash}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dasharray 0.5s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.22, fontWeight: 800, color, fontFamily: "var(--font-mono)" }}>
          {display ?? `${Math.round(v * 100)}`}
        </div>
      </div>
      {label && (
        <div style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-dim)", fontFamily: "var(--font-mono)", textAlign: "center" }}>{label}</div>
      )}
      {sub && <div style={{ fontSize: 8, color: "var(--text-faint)" }}>{sub}</div>}
    </div>
  );
}
