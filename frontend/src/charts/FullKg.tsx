import { useEffect, useMemo, useState } from 'react'
import { EChart, TOOLTIP } from '../components/EChart'
import { INK } from '../lib/colors'
import type { CrossVal, Kg } from '../types'
import { shortScenario } from './KgGraph'

interface RawNode { id: string; type: string; name?: string; code?: string; category?: string; nf_type?: string; procedure?: string; interface?: string; desc?: string }
interface RawEdge { source: string; target: string; relation: string; weight?: number; condition?: string }
interface RawKg { nodes: RawNode[]; edges: RawEdge[] }

const TYPES = ['CauseCode', 'Scenario', 'NFType', 'Interface', 'Procedure'] as const
const TYPE_LABEL: Record<string, string> = { CauseCode: '原因码', Scenario: '产生场景', NFType: '网元类型', Interface: '接口', Procedure: '流程' }
const TYPE_COLOR: Record<string, string> = { CauseCode: '#d03b3b', Scenario: '#6250d6', NFType: '#2a78d6', Interface: '#0f9d6c', Procedure: '#eb6834' }
const REL_LABEL: Record<string, string> = { CAUSED_BY: '可能由该场景产生', PROPAGATES_TO: '失败向上游传导', RAISED_BY: '由该网元产生', OCCURS_IN: '发生在该流程', ON_INTERFACE: '发生在该接口' }

/** 完整知识图谱：全量节点与关系，本次故障推理经过的节点和路径点亮，其余压暗。可缩放、平移，悬停看说明。 */
export function FullKg({ kg, crossval }: { kg: Kg; crossval: CrossVal | null }) {
  const [raw, setRaw] = useState<RawKg | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { fetch('/api/knowledge-graph').then((r) => r.json()).then(setRaw).catch(() => setFailed(true)) }, [])

  // 点亮范围：突增的原因码、它们之间的传导关系、根因侧原因码的候选场景（命中的加重），以及相关的网元/接口/流程
  const lit = useMemo(() => {
    const strong = new Set<string>(), weak = new Set<string>(), edgeStrong = new Set<string>(), edgeWeak = new Set<string>()
    const codes = new Set(kg.causes.map((c) => c.code))
    const rootCodes = new Set(Object.entries(kg.roles).filter(([, r]) => r === 'root').map(([k]) => k.split('|')[2]))
    const matched = new Map<string, Set<string>>()
    crossval?.items.forEach((it) => { if (it.best) (matched.get(it.cause) ?? matched.set(it.cause, new Set()).get(it.cause)!).add(it.best.scenario_id) })
    kg.causes.forEach((c) => {
      strong.add(`cause:${c.code}`)
      c.targets.filter((t) => codes.has(t)).forEach((t) => edgeStrong.add(`cause:${c.code}>cause:${t}`))
      if (!rootCodes.has(c.code)) return
      c.scenarios.forEach((s) => {
        const hit = matched.get(c.code)?.has(s.id)
        ;(hit ? strong : weak).add(s.id)
        ;(hit ? edgeStrong : edgeWeak).add(`cause:${c.code}>${s.id}`)
      })
    })
    return { strong, weak, edgeStrong, edgeWeak, codes }
  }, [kg, crossval])

  const option = useMemo(() => {
    if (!raw) return null
    // 相关的网元类型 / 接口 / 流程作为上下文一并点亮
    const ctx = new Set<string>(), ctxEdge = new Set<string>()
    raw.edges.forEach((e) => {
      if (['RAISED_BY', 'OCCURS_IN', 'ON_INTERFACE'].includes(e.relation) && lit.strong.has(e.source)) {
        ctx.add(e.target); ctxEdge.add(`${e.source}>${e.target}`)
      }
    })
    const level = (id: string) => (lit.strong.has(id) ? 2 : lit.weak.has(id) || ctx.has(id) ? 1 : 0)
    const label = (n: RawNode) => (n.type === 'CauseCode' ? n.code! : n.type === 'Scenario' ? shortScenario(n.name ?? '').replace(/^\S+ 后端至 (\S+) 的 /, '$1 ') : n.name ?? n.id)

    // 布局（确定性）：网元类型成簇排在中圈，原因码围在各自网元外侧，场景在最外圈并靠近它所属的原因码，流程与接口在内圈
    const pos: Record<string, [number, number]> = {}
    const polar = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a) * 0.72]
    const byType = (t: string) => raw.nodes.filter((n) => n.type === t)
    const nfOrder = ['AMF', 'SMF', 'UPF', 'PCF', 'UDM', 'AUSF']
    const nfAngle: Record<string, number> = {}
    const nfs = byType('NFType').sort((x, y) => nfOrder.indexOf(x.name ?? '') - nfOrder.indexOf(y.name ?? ''))
    const causes = byType('CauseCode')
    // 每个网元簇占用的角度按其原因码数量分配
    const total = causes.length || 1
    let cursor = -Math.PI * 0.95
    nfs.forEach((nf) => {
      const mine = causes.filter((c) => c.nf_type === nf.name)
      const span = (2 * Math.PI * Math.max(mine.length, 2)) / (total + 2 * nfs.length - causes.length + causes.length)
      const mid = cursor + span / 2
      nfAngle[nf.name ?? ''] = mid
      pos[nf.id] = polar(250, mid)
      mine.forEach((c, i) => { pos[c.id] = polar(390, cursor + (span * (i + 0.5)) / mine.length) })
      cursor += span
    })
    const ringOf = (nodes: RawNode[], r: number, phase: number) =>
      nodes.forEach((n, i) => { pos[n.id] = polar(r, phase + (2 * Math.PI * i) / nodes.length) })
    ringOf(byType('Procedure'), 150, 0.3)
    ringOf(byType('Interface'), 70, 0)
    // 场景：按它所连原因码的平均角度排序后均匀铺在外圈
    const angleOf = (id: string) => Math.atan2(pos[id][1] / 0.72, pos[id][0])
    const scn = byType('Scenario').map((n) => {
      const srcs = raw.edges.filter((e) => e.relation === 'CAUSED_BY' && e.target === n.id && pos[e.source]).map((e) => angleOf(e.source))
      const x = srcs.reduce((acc, a) => acc + Math.cos(a), 0), y = srcs.reduce((acc, a) => acc + Math.sin(a), 0)
      return { n, a: srcs.length ? Math.atan2(y, x) : 0 }
    }).sort((p, q) => p.a - q.a)
    scn.forEach(({ n }, i) => { pos[n.id] = polar(i % 2 ? 560 : 520, -Math.PI + (2 * Math.PI * (i + 0.5)) / scn.length) })

    return {
      animation: false,
      tooltip: {
        ...TOOLTIP, confine: true,
        formatter: (p: { dataType: string; data: { raw?: RawNode; rel?: RawEdge } }) => {
          if (p.dataType === 'edge') {
            const e = p.data.rel!
            return `<div style="max-width:320px;white-space:normal">${REL_LABEL[e.relation] ?? e.relation}${e.weight != null ? `（先验 ${e.weight}）` : ''}` +
              `${e.condition ? `<br/><span style="color:${INK.secondary}">${e.condition}</span>` : ''}</div>`
          }
          const n = p.data.raw!
          const head = `<b>${n.type === 'CauseCode' ? `${n.code} ${n.name}` : n.name}</b> <span style="color:${INK.muted}">${TYPE_LABEL[n.type]}</span>`
          const more = n.type === 'CauseCode' ? `<br/>${n.nf_type} · ${n.procedure} · ${n.interface}<br/><span style="color:${INK.secondary}">${n.desc ?? ''}</span>` : ''
          return `<div style="max-width:320px;white-space:normal">${head}${more}</div>`
        },
      },
      series: [{
        type: 'graph', layout: 'none', roam: true, left: 170, right: 170, top: 28, bottom: 28,
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', label: { show: true }, lineStyle: { width: 2.5 } },
        data: raw.nodes.map((n) => {
          const lv = level(n.id)
          const hub = n.type === 'NFType' || n.type === 'Procedure' || n.type === 'Interface'
          const [x, y] = pos[n.id] ?? [0, 0]
          return {
            id: n.id, name: label(n), raw: n, x, y,
            symbolSize: lv === 2 ? (n.type === 'Scenario' ? 22 : 18) : n.type === 'NFType' ? 20 : lv === 1 ? 12 : hub ? 11 : 8,
            symbol: n.type === 'Scenario' ? 'diamond' : hub ? 'roundRect' : 'circle',
            itemStyle: {
              color: TYPE_COLOR[n.type], opacity: lv === 2 ? 1 : lv === 1 ? 0.85 : 0.38,
              borderColor: lv === 2 ? '#101828' : '#fff', borderWidth: lv === 2 ? 2 : 1,
              shadowBlur: lv === 2 ? 16 : 0, shadowColor: TYPE_COLOR[n.type],
            },
            label: {
              show: lv >= 1 || n.type !== 'Scenario',
              position: n.type === 'NFType' ? 'inside' : x >= 0 ? 'right' : 'left', distance: 5,
              color: n.type === 'NFType' ? '#fff' : lv === 0 ? INK.muted : INK.primary,
              fontSize: lv === 2 ? 12.5 : n.type === 'NFType' ? 9 : 10, fontWeight: lv === 2 || n.type === 'NFType' ? 700 : 400,
              fontFamily: n.type === 'CauseCode' ? 'ui-monospace, Menlo, Consolas, monospace' : undefined,
              backgroundColor: lv === 2 ? 'rgba(255,255,255,0.92)' : 'transparent', padding: lv === 2 ? [2, 5] : 0, borderRadius: 4,
            },
            ...(n.type === 'NFType' ? { symbolSize: [44, 22] } : {}),
          }
        }),
        links: raw.edges.map((e) => {
          const key = `${e.source}>${e.target}`
          const lv = lit.edgeStrong.has(key) ? 2 : lit.edgeWeak.has(key) || ctxEdge.has(key) ? 1 : 0
          const prop = e.relation === 'PROPAGATES_TO'
          return {
            source: e.source, target: e.target, rel: e,
            symbol: lv === 2 ? ['none', 'arrow'] : ['none', 'none'], symbolSize: 9,
            lineStyle: {
              color: lv === 2 ? (prop ? '#ec835a' : '#6250d6') : lv === 1 ? '#667085' : '#c5cad6',
              width: lv === 2 ? 2.8 : lv === 1 ? 1 : 0.6, opacity: lv === 2 ? 1 : lv === 1 ? 0.6 : 0.45,
              type: prop ? 'dashed' : 'solid', curveness: prop ? 0.3 : 0.06,
            },
            z: lv,
          }
        }),
      }],
    }
  }, [raw, lit])

  if (failed) return <div className="empty">图谱加载失败</div>
  if (!raw || !option) return <div className="empty">图谱加载中…</div>
  const count = (t: string) => raw.nodes.filter((n) => n.type === t).length
  return (
    <div className="fullkg">
      <div className="fullkg-plot"><EChart option={option} height="100%" ariaLabel="完整知识图谱" /></div>
      <div className="legend fullkg-legend">
        {TYPES.map((t) => <span key={t}><i className="lg sq" style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t]} {count(t)}</span>)}
        <span><i className="lg lit" />本次故障点亮</span>
        <span><i className="lg line-kg" />推理路径</span>
        <span><i className="lg line-prop" />失败传导</span>
        <span className="muted">共 {raw.nodes.length} 个节点 / {raw.edges.length} 条关系 · 滚轮缩放、拖动平移，悬停看说明</span>
      </div>
    </div>
  )
}
