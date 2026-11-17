import type { CrossVal, Kg } from '../types'

interface Props { kg: Kg; crossval: CrossVal | null }

const ROW = 30
const W = 530
const COL = { derived: 46, root: 166, scn: 272 }
const NODE_W = 78

/** 场景名称的简写，用于图上标注。 */
export function shortScenario(name: string) {
  return name.replace('/时延抖动', '').replace('/处理时延增大', '').replace('单 POD/进程异常', '单 POD 异常').replace('/进程异常', '')
}

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
  const H = rows * ROW + 30
  const yOf = (i: number, n: number) => 26 + (rows * ROW - n * ROW) / 2 + i * ROW + ROW / 2
  const yDer = Object.fromEntries(derived.map((c, i) => [c.code, yOf(i, derived.length)]))
  const yRoot = Object.fromEntries(roots.map((c, i) => [c.code, yOf(i, roots.length)]))
  const yScn = Object.fromEntries(scenarios.map((s, i) => [s.id, yOf(i, scenarios.length)]))
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
  const half = NODE_W / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="kg" role="img" aria-label="原因码与场景的知识图谱子图">
      <text className="kg-col" x={COL.derived} y={14} textAnchor="middle">传导侧原因码</text>
      <text className="kg-col" x={COL.root} y={14} textAnchor="middle">根因侧原因码</text>
      <text className="kg-col" x={COL.scn + 8} y={14}>图谱给出的产生场景</text>

      {roots.map((c) => c.targets.filter((t) => yDer[t] != null).map((t) => (
        <path key={`${c.code}>${t}`} className="kg-edge prop" d={curve(COL.root - half, yRoot[c.code], COL.derived + half, yDer[t])} />
      )))}
      {roots.map((c) => c.scenarios.map((s) => {
        const on = matchedEdge.has(`${c.code}>${s.id}`)
        return <path key={`${c.code}>${s.id}`} className={`kg-edge ${on ? 'on' : ''}`} strokeWidth={on ? 2.2 : 0.75 + s.weight * 2}
          d={curve(COL.root + half, yRoot[c.code], COL.scn, yScn[s.id])} />
      }))}

      {derived.map((c) => (
        <g key={c.code} transform={`translate(${COL.derived},${yDer[c.code]})`}>
          <rect className="kg-node" x={-half} y={-12} width={NODE_W} height={24} rx={7} />
          <text className="kg-code" textAnchor="middle" dy="4">{c.code}</text>
          <title>{c.name}</title>
        </g>
      ))}
      {roots.map((c) => (
        <g key={c.code} transform={`translate(${COL.root},${yRoot[c.code]})`}>
          <rect className="kg-node root" x={-half} y={-12} width={NODE_W} height={24} rx={7} />
          <text className="kg-code" textAnchor="middle" dy="4">{c.code}</text>
          <title>{c.name}</title>
        </g>
      ))}
      {scenarios.map((s) => (
        <g key={s.id} transform={`translate(${COL.scn},${yScn[s.id]})`} className={matched.has(s.id) ? 'kg-scn on' : 'kg-scn'}>
          <circle r={4.5} />
          <text x={12} dy="4">{matched.has(s.id) ? '✓ ' : ''}{shortScenario(s.name)}</text>
          <title>{s.name}</title>
        </g>
      ))}
    </svg>
  )
}
