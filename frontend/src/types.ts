export type StepStatus = 'idle' | 'running' | 'done' | 'skipped'
export type Stage = 'perception' | 'analysis' | 'decision'

export interface TopoNode { id: string; type: string; name: string }
export interface TopoEdge { source: string; target: string; interface: string }
export interface Topo { nodes: TopoNode[]; edges: TopoEdge[] }

export interface Run { mode: 'step' | 'realtime'; status: 'idle' | 'running' | 'paused' | 'finished'; minute: number; total: number | null; time: string | null }

export interface Meta {
  mode: 'step' | 'realtime'; instances: number; links: number; started_at: string; files: string[]
  settings: { window_min: number; sustain_n: number; sustain_m: number; z_threshold: number; recover_min: number }
  kg: { nodes: number; edges: number; version: string }
}

export interface Incident {
  id: string; status: 'active' | 'recovered'; opened_at: string; onset_label: string
  recovered_at: string | null; title: string; definitive: boolean | null
}

export interface LogLine { channel: 'system' | 'agent'; stage: string; time: string; level: string; text: string }

export interface SeriesChart {
  key: string; instance: string; procedure: string; cause: string; cause_name: string
  labels: string[]; values: number[]; flags: boolean[]
  baseline: number | null; threshold: number | null; status: 'sustained' | 'transient' | 'normal'
}

export interface Tick {
  minute: number; time: string; window: { from: string; to: string }
  total: number; n_series: number; n_flagged: number; n_sustained: number
  trend_point: { label: string; total: number; by_nf: Record<string, number> }
  series: SeriesChart[]
  node_status: Record<string, { count: number; flagged: number; sustained: number }>
  preprocess: Record<string, number>
  incident: Incident | null
  next_in?: number
}

export interface CauseCount { cause: string; name: string; count: number; anomalous?: boolean }
export interface PieGroup {
  instance: string; procedure: string; before: CauseCount[]; after: CauseCount[]
  before_total: number; after_total: number
}
export interface Perception {
  stats: { total: number; kept: number; filtered: number; filtered_pct: number; n_series: number
    n_anomalous: number; n_transient: number; n_trigger: number; n_co: number }
  window: { from: string; to: string }
  series: SeriesChart[]; pies: PieGroup[]; anomalous: { key: string; onset: string }[]
}

export interface Hop { nf_type: string; instance: string; cause: string }
export interface Flow { id: number; imsi: string; procedure: string; time: string; path: string; hops: Hop[]; amf_id: string; smf_id: string }
export interface FlowPattern { procedure: string; path: string; smf_id: string; flows: number; users: number; amf_ids: string[]; hops: Hop[] }
export interface Flows {
  summary: { total_flows: number; total_users: number; multi_hop_flows: number; records: number; records_without_user: number; patterns: FlowPattern[] }
  flows: Flow[]
}

export type Grade = 'high' | 'mid' | 'low' | 'none' | 'noise'
export interface Dim {
  dim: string; label: string; score: number; coverage: number; expected: number; z: number; grade: Grade
  set: string[]; values: { value: string; share: number; count: number }[]; n: number
}
export interface ClusterSeries {
  key: string; instance: string; nf_type: string; procedure: string; cause: string; cause_name: string
  count: number; onset: number; dims: Dim[]; grade: Grade
  fallback: null | { reason: string; users: number; linked_records: number; linked_ratio: number; dims: Dim[] }
  best: { dim: string; label: string; set: string[]; score: number; grade: Grade }
}
export interface ClusterPoint {
  key: string; instance: string; procedure: string; cause: string; cause_name: string
  count: number; group_total: number; share: number; anomalous: boolean; grade: Grade
}
export interface Clustering {
  series: ClusterSeries[]; points: ClusterPoint[]; groups: Record<string, CauseCount[]>
  thresholds: { high: number; mid: number }
}

export interface KgScenario { id: string; name: string; category: string; weight: number; condition: string }
export interface KgCause {
  code: string; name: string; known: boolean; nf_type: string; procedure: string; interface: string
  protocol: string; code_ref: string; desc: string; scenarios: KgScenario[]; sources: string[]; targets: string[]
}
export interface Kg {
  causes: KgCause[]; roles: Record<string, 'root' | 'derived'>
  chains: { series: string; cause: string; sources: string[]; explained_ratio: number; derived: boolean }[]
}

export interface Check { dim: string; label: string; expect: 'high' | 'low'; observed: number | null; values: string[]; pass: boolean | null; key: boolean }
export interface Candidate {
  scenario_id: string; name: string; category: string; prior: number; condition: string
  checks: Check[]; matched: boolean; match_score: number; score: number
}
export interface CrossItem {
  series: string; instance: string; procedure: string; cause: string; cause_name: string
  cluster_hints: { label: string; set: string[]; score: number; grade: Grade }[]
  candidates: Candidate[]; verdict: 'unique' | 'ambiguous' | 'none'; best: Candidate | null
}
export interface CrossVal {
  items: CrossItem[]
  derived: { series: string; instance: string; procedure: string; cause: string; cause_name: string; explained_ratio: number
    explained_by: { upstream: string; count: number }[] }[]
  groups: { category: string; mode: string; anchor: string; scenarios: string[]
    links: { source: string; target: string; interface: string; causes: string[]; procedures: string[] }[] }[]
  decision: 'conclusion' | 'slow_reasoning'; reason: string
}

export type NodeRole = 'normal' | 'root' | 'link_peer' | 'impacted' | 'alternative' | 'suspect'
export interface Conclusion {
  title: string; summary: string; confidence: number; definitive: boolean
  chain: { label: string; value: string; sub: string }[]
  onset: string; detected_at: string
  root: { type: string; ne: string; links: { source: string; target: string; interface: string; causes: string[] }[] }
  impact: { procedures: string[]; users: number; failures: number; instances: string[] }
  evidence: { kind: string; title: string; detail: string; metric?: string; unit?: string }[]
  recovery: { definitive: boolean; steps: { tag?: string; title: string; detail: string }[] }
  topology: { nodes: Record<string, { role: NodeRole; note?: string }>
    edges: { source: string; target: string; role: 'fault' | 'propagation' | 'alternative'; label: string }[] }
  node_stats: Record<string, { labels: string[]; values: number[]
    series: { procedure: string; cause: string; cause_name: string; baseline: number; current: number
      best: { label: string; set: string[]; score: number; grade: Grade } }[] }>
  handoff: Record<string, unknown>
}

export interface AppState {
  connected: boolean
  steps: Record<string, StepStatus>
  activeStage: Stage | null
  logs: LogLine[]
  agentLogs: LogLine[]
  tick: Tick | null
  trend: { label: string; total: number }[]
  incident: Incident | null
  incidents: Incident[]
  run: Run | null
  nextAt: number | null
  perception: Perception | null
  flows: Flows | null
  clustering: Clustering | null
  kg: Kg | null
  crossval: CrossVal | null
  agent: unknown
  conclusion: Conclusion | null
}
