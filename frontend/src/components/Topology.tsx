import type { Conclusion, NodeRole, Tick, Topo } from '../types'

const W = 700, H = 436
const CHIP = { w: 80, h: 30 }

// 版式：按网元类型分组，无交叉摆放。dir 表示组内两个实例横排还是竖排。
// label 表示组标题在上还是在下：放在连线不经过的一侧。
const GROUPS: Record<string, { x: number; y: number; dir: 'row' | 'col'; name: string; label: 'top' | 'bottom' }> = {
  AUSF: { x: 122, y: 64, dir: 'row', name: '鉴权', label: 'top' },
  UDM: { x: 372, y: 64, dir: 'row', name: '签约数据', label: 'top' },
  AMF: { x: 122, y: 218, dir: 'col', name: '接入移动', label: 'top' },
  SMF: { x: 372, y: 218, dir: 'col', name: '会话管理', label: 'top' },
  UPF: { x: 606, y: 218, dir: 'col', name: '用户面', label: 'top' },
  PCF: { x: 247, y: 380, dir: 'row', name: '策略控制', label: 'bottom' },
}
const PAD = 26     // 组标题占用的高度
const ROLE_BADGE: Partial<Record<NodeRole, string>> = { root: '根因', impacted: '受影响', alternative: '可用', suspect: '疑似' }

interface Props {
  topo: Topo
  live?: Tick['node_status']
  overlay?: Conclusion['topology']
  selected?: string | null
  onSelect?: (id: string) => void
}
type Pt = [number, number]

function groupBox(type: string) {
  const g = GROUPS[type]
  const w = g.dir === 'row' ? CHIP.w * 2 + 10 + 24 : CHIP.w + 52
  const inner = g.dir === 'row' ? CHIP.h : CHIP.h * 2 + 10
  const h = inner + PAD + 22
  // 实例区域以 (g.x, g.y) 为中心，标题在其上方或下方
  const top = g.y - inner / 2 - (g.label === 'top' ? PAD + 6 : 16)
  return { x: g.x - w / 2, y: top, w, h, labelY: g.label === 'top' ? top + 19 : top + h - 10 }
}

/** 线段与矩形边框的交点（从矩形中心指向 to）。 */
function edgePoint(box: { x: number; y: number; w: number; h: number }, to: Pt): Pt {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const dx = to[0] - cx, dy = to[1] - cy
  const t = Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity)
  return [cx + dx * t, cy + dy * t]
}

export function Topology({ topo, live, overlay, selected, onSelect }: Props) {
  const pos: Record<string, Pt> = {}
  const byType: Record<string, string[]> = {}
  topo.nodes.forEach((n) => { (byType[n.type] ??= []).push(n.id) })
  Object.entries(byType).forEach(([type, ids]) => {
    const g = GROUPS[type]
    if (!g) return
    ids.sort().forEach((id, i) => {
      const off = (i - (ids.length - 1) / 2) * ((g.dir === 'row' ? CHIP.w : CHIP.h) + 10)
      pos[id] = g.dir === 'row' ? [g.x + off, g.y] : [g.x, g.y + off]
    })
  })
  const typeOf = (id: string) => id.split(':')[0]
  const role = (id: string): NodeRole => overlay?.nodes[id]?.role ?? 'normal'

  // 常态连线收敛到类型级：每对网元类型一条线，标注接口名
  const typeLinks = new Map<string, { a: string; b: string; iface: string }>()
  topo.edges.forEach((e) => {
    const a = typeOf(e.source), b = typeOf(e.target)
    typeLinks.set([a, b].sort().join('~'), { a, b, iface: e.interface })
  })

  // 实例级高亮连线：从实例的侧边出线，贝塞尔曲线绕开同组的另一个实例
  // 出线方向取目标的主方向；若该方向上紧挨着同组的另一个实例，则改从另一轴出线。
  const anchor = (id: string, to: Pt): { p: Pt; n: Pt } => {
    const [x, y] = pos[id]
    const [gx, gy] = [GROUPS[typeOf(id)].x, GROUPS[typeOf(id)].y]
    const dx = to[0] - x, dy = to[1] - y
    const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1
    const blockedX = Math.sign(gx - x) === sx        // 横排时朝向兄弟实例
    const blockedY = Math.sign(gy - y) === sy        // 竖排时朝向兄弟实例
    const preferY = Math.abs(dy) >= Math.abs(dx) * 0.6
    const vertical = preferY ? !blockedY || blockedX : blockedX && !blockedY
    return vertical ? { p: [x, y + sy * CHIP.h / 2], n: [0, sy] } : { p: [x + sx * CHIP.w / 2, y], n: [sx, 0] }
  }
  const curve = (src: string, dst: string) => {
    const a = anchor(src, pos[dst]), b = anchor(dst, pos[src])
    const k = Math.max(28, Math.min(80, Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) * 0.38))
    const c1: Pt = [a.p[0] + a.n[0] * k, a.p[1] + a.n[1] * k], c2: Pt = [b.p[0] + b.n[0] * k, b.p[1] + b.n[1] * k]
    const at = (t: number): Pt => {
      const u = 1 - t
      return [u ** 3 * a.p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b.p[0],
        u ** 3 * a.p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b.p[1]]
    }
    return { d: `M${a.p} C${c1} ${c2} ${b.p}`, mid: at(0.5) }
  }
  const order = { alternative: 0, propagation: 1, fault: 2 }
  const links = [...(overlay?.edges ?? [])].sort((x, y) => order[x.role] - order[y.role])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="topo" role="img" aria-label="5GC 网元拓扑">
      <defs>
        <marker id="arrow-prop" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M0,1 L9,5 L0,9 z" fill="#ec835a" />
        </marker>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.6" floodColor="#101828" floodOpacity="0.08" />
        </filter>
      </defs>

      {[...typeLinks.values()].filter((l) => GROUPS[l.a] && GROUPS[l.b]).map((l) => {
        const A = groupBox(l.a), B = groupBox(l.b)
        const ca: Pt = [A.x + A.w / 2, A.y + A.h / 2], cb: Pt = [B.x + B.w / 2, B.y + B.h / 2]
        const p1 = edgePoint(A, cb), p2 = edgePoint(B, ca)
        const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2
        return (
          <g key={`${l.a}-${l.b}`}>
            <line className="topo-link" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />
            <rect className="iface-bg" x={mx - 14} y={my - 8} width={28} height={16} rx={8} />
            <text className="iface" x={mx} y={my + 3.5} textAnchor="middle">{l.iface}</text>
          </g>
        )
      })}

      {Object.entries(GROUPS).map(([type, g]) => {
        if (!byType[type]) return null
        const b = groupBox(type)
        const hot = byType[type].some((id) => role(id) === 'root')
        return (
          <g key={type}>
            <rect className={`topo-group ${hot ? 'hot' : ''}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={14} />
            <text className="topo-type" x={b.x + 12} y={b.labelY}>{type}</text>
            <text className="topo-type-name" x={b.x + b.w - 12} y={b.labelY} textAnchor="end">{g.name}</text>
          </g>
        )
      })}

      {links.map((e) => {
        const c = curve(e.source, e.target)
        return (
          <g key={`${e.role}-${e.source}-${e.target}`}>
            {e.role === 'fault' && <path className="topo-edge fault-glow" d={c.d} />}
            <path className={`topo-edge ${e.role}`} d={c.d} markerEnd={e.role === 'propagation' ? 'url(#arrow-prop)' : undefined} />
            {e.role === 'fault' && (
              <g transform={`translate(${c.mid[0]},${c.mid[1]})`}>
                <rect className="edge-pill" x={-30} y={-10} width={60} height={20} rx={10} />
                <text className="edge-pill-text" textAnchor="middle" dy="4">{e.label}</text>
              </g>
            )}
          </g>
        )
      })}

      {topo.nodes.filter((n) => pos[n.id]).map((n) => {
        const [x, y] = pos[n.id]
        const r = role(n.id)
        const st = live?.[n.id]
        const liveCls = st?.sustained ? 'live-sustained' : st?.flagged ? 'live-flagged' : ''
        const count = st ? st.sustained || st.flagged : 0
        const badge = ROLE_BADGE[r]
        return (
          <g key={n.id} className={`chip ${r} ${liveCls} ${selected === n.id ? 'selected' : ''} ${onSelect ? 'clickable' : ''}`}
            transform={`translate(${x},${y})`} onClick={() => onSelect?.(n.id)}>
            {r === 'root' && <rect className="halo" x={-CHIP.w / 2 - 6} y={-CHIP.h / 2 - 6} width={CHIP.w + 12} height={CHIP.h + 12} rx={14} />}
            <rect className="box" x={-CHIP.w / 2} y={-CHIP.h / 2} width={CHIP.w} height={CHIP.h} rx={9} filter="url(#soft)" />
            <circle className="state" cx={-CHIP.w / 2 + 13} cy={0} r={3.5} />
            <text className="name" x={5} dy="4" textAnchor="middle">{n.name}</text>
            {badge && (
              <g transform={`translate(${CHIP.w / 2 - 4},${-CHIP.h / 2})`}>
                <rect className="tagbg" x={-badge.length * 5.6 - 5} y={-8} width={badge.length * 11.2 + 10} height={16} rx={8} />
                <text className="tagtext" textAnchor="middle" dy="3.5">{badge}</text>
              </g>
            )}
            {count > 0 && (
              <g transform={`translate(${CHIP.w / 2 - 2},${-CHIP.h / 2 + 1})`}>
                <circle className="count" r={9} />
                <text className="count-text" textAnchor="middle" dy="3.5">{count}</text>
              </g>
            )}
            <title>{n.id}{overlay?.nodes[n.id]?.note ? ` — ${overlay.nodes[n.id].note}` : ''}</title>
          </g>
        )
      })}
    </svg>
  )
}

export function TopologyLegend({ mode }: { mode: 'live' | 'conclusion' }) {
  return mode === 'live' ? (
    <div className="legend">
      <span><i className="lg chip-flagged" />出现突增点</span>
      <span><i className="lg chip-sustained" />持续突增</span>
      <span><i className="lg dot-count" />突增维度数</span>
    </div>
  ) : (
    <div className="legend">
      <span><i className="lg chip-root" />根因网元</span>
      <span><i className="lg line-fault" />故障链路</span>
      <span><i className="lg line-prop" />失败传导</span>
      <span><i className="lg chip-impacted" />受影响</span>
      <span><i className="lg line-alt" />可用路径</span>
      <span><i className="lg chip-peer" />链路对端</span>
    </div>
  )
}
