import type { CrossVal, Kg } from '../types'

interface Props { kg: Kg; crossval: CrossVal | null }

const ROW = 38

/** 图谱推理子图：传导侧原因码 ← 根因侧原因码 → 候选场景。交叉验证匹配上的场景加重显示。 */
export function KgGraph({ kg, crossval }: Props) {
  const derivedCodes = new Set<string>()
  const rootCodes = new Set<string>()
  Object.entries(kg.roles).forEach(([key, role]) => (role === 'derived' ? derivedCodes : rootCodes).add(key.split('|')[2]))
  rootCodes.forEach((c) => derivedCodes.delete(c))
  const roots = kg.causes.filter((c) => rootCodes.has(c.code))
  const derived = kg.causes.filter((c) => derivedCodes.has(c.code))

  const scenarios: { id: string; name: string }[] = []
  roots.forEach((c) => c.scenarios.forEach((s) => { if (!scenarios.find((x) => x.id === s.id)) scenarios.push({ id: s.id, name: s.name }) }))
  const matched = new Set<string>()
  const matchedEdge = new Set<string>()
  crossval?.items.forEach((it) => { if (it.best) { matched.add(it.best.scenario_id); matchedEdge.add(`${it.cause}>${it.best.scenario_id}`) } })

  const rows = Math.max(scenarios.length, roots.length, derived.length, 1)
  const H = rows * ROW + 44
  const W = 900
  const colX = { derived: 96, root: 330, scn: 560 }
  const yOf = (i: number, n: number) => 40 + (rows * ROW - n * ROW) / 2 + i * ROW + ROW / 2
  const yDer = Object.fromEntries(derived.map((c, i) => [c.code, yOf(i, derived.length)]))
  const yRoot = Object.fromEntries(roots.map((c, i) => [c.code, yOf(i, roots.length)]))
  const yScn = Object.fromEntries(scenarios.map((s, i) => [s.id, yOf(i, scenarios.length)]))
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="kg" role="img" aria-label="原因码与场景的知识图谱子图">
      <text className="kg-col" x={colX.derived} y={18} textAnchor="middle">传导侧原因码</text>
      <text className="kg-col" x={colX.root} y={18} textAnchor="middle">根因侧原因码</text>
      <text className="kg-col" x={colX.scn + 8} y={18}>图谱中的产生场景（线宽为先验权重）</text>

      {roots.map((c) => c.targets.filter((t) => yDer[t] != null).map((t) => (
        <path key={`${c.code}>${t}`} className="kg-edge prop" d={curve(colX.root - 46, yRoot[c.code], colX.derived + 46, yDer[t])} />
      )))}
      {roots.map((c) => c.scenarios.map((s) => {
        const on = matchedEdge.has(`${c.code}>${s.id}`)
        return <path key={`${c.code}>${s.id}`} className={`kg-edge ${on ? 'on' : ''}`} strokeWidth={on ? 2 : 0.75 + s.weight * 2}
          d={curve(colX.root + 46, yRoot[c.code], colX.scn, yScn[s.id])} />
      }))}

      {derived.map((c) => (
        <g key={c.code} transform={`translate(${colX.derived},${yDer[c.code]})`}>
          <rect className="kg-node" x={-46} y={-13} width={92} height={26} rx={7} />
          <text className="kg-code" textAnchor="middle" dy="4">{c.code}</text>
          <title>{c.name}</title>
        </g>
      ))}
      {roots.map((c) => (
        <g key={c.code} transform={`translate(${colX.root},${yRoot[c.code]})`}>
          <rect className="kg-node root" x={-46} y={-13} width={92} height={26} rx={7} />
          <text className="kg-code" textAnchor="middle" dy="4">{c.code}</text>
          <title>{c.name}</title>
        </g>
      ))}
      {scenarios.map((s) => (
        <g key={s.id} transform={`translate(${colX.scn},${yScn[s.id]})`} className={matched.has(s.id) ? 'kg-scn on' : 'kg-scn'}>
          <circle r={4.5} />
          <text x={12} dy="4">{matched.has(s.id) ? '✓ ' : ''}{s.name}</text>
        </g>
      ))}
      {derived.length > 0 && <text className="kg-note" x={(colX.derived + colX.root) / 2} y={H - 6} textAnchor="middle">← 失败传导</text>}
    </svg>
  )
}
