import type { Conclusion, NodeRole, Tick, Topo } from '../types'

const W = 700, H = 372
// 版式：上排为鉴权/签约/策略类网元，下方自左向右为 AMF -> SMF -> UPF。
// 同类两个实例错开摆放，避免高亮连线从其它网元背后穿过。
const TYPE_POS: Record<string, { at: [number, number][]; label: [number, number] }> = {
  AUSF: { at: [[150, 46], [238, 72]], label: [194, 18] },
  UDM: { at: [[350, 46], [438, 72]], label: [394, 18] },
  PCF: { at: [[550, 46], [638, 72]], label: [594, 18] },
  AMF: { at: [[60, 196], [120, 296]], label: [60, 166] },
  SMF: { at: [[310, 196], [400, 296]], label: [310, 166] },
  UPF: { at: [[590, 236], [650, 326]], label: [590, 206] },
}
const NODE = { w: 72, h: 30 }
const ROLE_TEXT: Record<NodeRole, string> = {
  root: '根因网元', link_peer: '故障链路对端', impacted: '受影响', alternative: '可用路径', suspect: '疑似', normal: '',
}

interface Props {
  topo: Topo
  live?: Tick['node_status']
  overlay?: Conclusion['topology']
  selected?: string | null
  onSelect?: (id: string) => void
}

function clip(from: [number, number], to: [number, number], halfW: number, halfH: number): [number, number] {
  // 把线段终点收到目标节点边框外，避免箭头被节点盖住
  const dx = to[0] - from[0], dy = to[1] - from[1]
  const t = Math.min(dx ? (halfW + 5) / Math.abs(dx) : 1, dy ? (halfH + 5) / Math.abs(dy) : 1)
  return [to[0] - dx * t, to[1] - dy * t]
}

export function Topology({ topo, live, overlay, selected, onSelect }: Props) {
  const pos: Record<string, [number, number]> = {}
  const byType: Record<string, string[]> = {}
  topo.nodes.forEach((n) => { (byType[n.type] ??= []).push(n.id) })
  Object.entries(byType).forEach(([type, ids]) => {
    const slots = TYPE_POS[type]?.at ?? [[W / 2, H / 2]]
    ids.sort().forEach((id, i) => { pos[id] = slots[i % slots.length] })
  })
  const role = (id: string): NodeRole => overlay?.nodes[id]?.role ?? 'normal'
  const marked = new Set((overlay?.edges ?? []).map((e) => [e.source, e.target].sort().join('~')))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="topo" role="img" aria-label="5GC 网元拓扑">
      <defs>
        <marker id="arrow-prop" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,1 L9,5 L0,9 z" fill="#ec835a" />
        </marker>
      </defs>

      {topo.edges.filter((e) => !marked.has([e.source, e.target].sort().join('~'))).map((e) => (
        <line key={`${e.source}-${e.target}`} className="topo-edge" x1={pos[e.source][0]} y1={pos[e.source][1]}
          x2={pos[e.target][0]} y2={pos[e.target][1]} />
      ))}

      {(overlay?.edges ?? []).map((e) => {
        const a = pos[e.source], b = pos[e.target]
        const end = e.role === 'propagation' ? clip(a, b, NODE.w / 2, NODE.h / 2) : b
        const mx = a[0] + (b[0] - a[0]) * 0.56, my = a[1] + (b[1] - a[1]) * 0.56
        return (
          <g key={`${e.role}-${e.source}-${e.target}`}>
            <line className={`topo-edge ${e.role}`} x1={a[0]} y1={a[1]} x2={end[0]} y2={end[1]}
              markerEnd={e.role === 'propagation' ? 'url(#arrow-prop)' : undefined} />
            {e.role === 'fault' && (
              <g transform={`translate(${mx},${my})`}>
                <rect className="edge-label-bg fault" x={-31} y={-10} width={62} height={20} rx={10} />
                <text className="edge-label" textAnchor="middle" dy="4">✕ {e.label}</text>
              </g>
            )}
          </g>
        )
      })}

      {Object.entries(TYPE_POS).map(([type, { label }]) => byType[type] && (
        <text key={type} className="topo-type" x={label[0]} y={label[1]} textAnchor="middle">{type}</text>
      ))}

      {topo.nodes.map((n) => {
        const [x, y] = pos[n.id]
        const r = role(n.id)
        const st = live?.[n.id]
        const liveCls = st?.sustained ? 'live-sustained' : st?.flagged ? 'live-flagged' : ''
        const scale = r === 'root' ? 1.2 : 1
        const w = NODE.w * scale, h = NODE.h * scale
        const badge = st && (st.sustained || st.flagged) ? st.sustained || st.flagged : 0
        return (
          <g key={n.id} className={`topo-node ${r} ${liveCls} ${selected === n.id ? 'selected' : ''} ${onSelect ? 'clickable' : ''}`}
            transform={`translate(${x},${y})`} onClick={() => onSelect?.(n.id)}>
            {r === 'root' && <rect className="halo" x={-w / 2 - 7} y={-h / 2 - 7} width={w + 14} height={h + 14} rx={15} />}
            <rect className="box" x={-w / 2} y={-h / 2} width={w} height={h} rx={9} />
            <text className="name" textAnchor="middle" dy="4">{n.name}</text>
            {ROLE_TEXT[r] && <text className="role" textAnchor="middle" y={h / 2 + (r === 'root' ? 22 : 14)}>{ROLE_TEXT[r]}</text>}
            {badge > 0 && (
              <g transform={`translate(${w / 2 - 2},${-h / 2 + 2})`}>
                <circle className="badge" r={9} />
                <text className="badge-text" textAnchor="middle" dy="3.5">{badge}</text>
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
      <span><i className="lg box-flagged" />有突增点的网元</span>
      <span><i className="lg box-sustained" />有持续突增维度的网元</span>
      <span><i className="lg dot-badge" />角标为维度数</span>
    </div>
  ) : (
    <div className="legend">
      <span><i className="lg box-root" />根因网元</span>
      <span><i className="lg line-fault" />故障链路</span>
      <span><i className="lg line-prop" />失败传导</span>
      <span><i className="lg box-impacted" />受影响网元</span>
      <span><i className="lg line-alt" />可用路径</span>
    </div>
  )
}
