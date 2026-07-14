// ============================================================================
// Radar —— 蜘蛛/雷达图(N 轴,值 0..1)
// ============================================================================

interface Axis {
  label: string;
  value: number; // 0..1
}
interface Props {
  axes: Axis[];
  color: string;
  size?: number;
}

export function Radar({ axes, color, size = 150 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, rad: number) => [cx + Math.cos(angle(i)) * rad, cy + Math.sin(angle(i)) * rad] as const;

  const rings = [0.25, 0.5, 0.75, 1];
  const poly = axes.map((a, i) => point(i, r * Math.max(0, Math.min(1, a.value))).join(",")).join(" ");

  return (
    <svg width={size} height={size}>
      {rings.map((rr, idx) => (
        <polygon key={idx} points={axes.map((_, i) => point(i, r * rr).join(",")).join(" ")} fill="none" stroke="rgba(56,189,248,0.1)" strokeWidth={0.8} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, r);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(56,189,248,0.12)" strokeWidth={0.8} />;
      })}
      <polygon points={poly} fill={`${color}33`} stroke={color} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 5px ${color}99)`, transition: "all 0.5s ease" }} />
      {axes.map((a, i) => {
        const [x, y] = point(i, r);
        return <circle key={i} cx={x} cy={y} r={2.4} fill={color} />;
      })}
      {axes.map((a, i) => {
        const [x, y] = point(i, r + 13);
        return (
          <text key={i} x={x} y={y} fontSize={8} fill="var(--text-mid)" textAnchor="middle" fontFamily="var(--font-mono)" style={{ letterSpacing: "0.02em" }}>
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
