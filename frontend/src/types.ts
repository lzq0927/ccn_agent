export type Stage = "perception" | "analysis" | "handoff";
export type Tab =
  | "overview"
  | "perception"
  | "analysis"
  | "knowledge"
  | "handoff";
export interface Log {
  id: number;
  time: string;
  elapsed_ms: number;
  stage: Stage;
  message: string;
  level: string;
  component: string;
}
export interface Series {
  id: string;
  nf: string;
  procedure: string;
  cause: string;
  confirmed: boolean;
  hits: number;
  points: {
    minute: number;
    time: string;
    count: number;
    threshold: number;
    anomalous: boolean;
  }[];
}
export interface Distribution {
  id: string;
  nf: string;
  procedure: string;
  before: { name: string; value: number }[];
  after: { name: string; value: number }[];
}
export interface Feature {
  dimension: string;
  label: string;
  value: string;
  count: number;
  total: number;
  background_count?: number;
  background_total?: number;
  share: number;
  baseline_share: number;
  lift: number;
  p_value: number;
  q_value: number;
  severity: string;
  scope: string;
}
export interface Cluster {
  id: string;
  nf: string;
  procedure: string;
  cause: string;
  count: number;
  group_total: number;
  cause_percent: number;
  users: number;
  features: Feature[];
  significant: boolean;
  score: number;
}
export interface Flow {
  user_id: string;
  trace_id: string;
  procedure: string;
  time: string;
  failure_path: string;
  AMF_ID: string | null;
  SMF_ID: string | null;
  steps: { nf: string; cause: string; timestamp: string }[];
  correlation: string;
  cross_nf: boolean;
  confirmed_path: boolean;
}
export interface Hypothesis {
  id: string;
  scenario_id: string;
  nf: string;
  title: string;
  score: number;
  eligible: boolean;
  evidence: { id: string; label: string; matched: boolean }[];
  supporting_codes: string[];
  explanation: string;
  limitations: string;
  pod: string;
  peers: string[];
  affected_users: number;
  correlated_flows: number;
}
export interface Conclusion extends Hypothesis {
  summary: string;
  confidence_label: string;
  score_label: string;
  recovery: {
    kind: string;
    status: string;
    alternative: string | null;
    paths: string[][];
    steps: string[];
    preconditions: string[];
  };
}
export interface Quality {
  input_rows: number;
  valid_rows: number;
  duplicates: number;
  invalid_rows: number;
  missing_optional: Record<string, number>;
  issues: { source: string; line: number; error: string }[];
  files?: {
    file: string;
    input_rows: number;
    valid_rows: number;
    invalid_rows: number;
    duplicates: number;
  }[];
}
export interface TopologyNode {
  id: string;
  type: string;
  label: string;
  anomalies: number;
  status: string;
  pods: string[];
}
export interface Topology {
  nodes: TopologyNode[];
  edges: { source: string; target: string; status: string }[];
}
export interface Knowledge {
  version: string;
  provenance: string;
  codes: {
    id: string;
    name: string;
    layer: string;
    standard: boolean;
    source: string;
    scenarios: string[];
  }[];
  facts: Record<string, string>;
  scenarios: {
    id: string;
    title: string;
    explanation: string;
    requirements: string[];
  }[];
}
export interface Meta {
  run_id: string;
  label: string;
  start: string;
  duration_minutes: number;
  record_count: number;
  nf_count: number;
  edge_count: number;
  settings: Record<string, number>;
  quality: Quality;
  knowledge: Knowledge;
  topology_missing_nfs: string[];
}
export interface Snapshot {
  minute: number;
  timestamp: string;
  stage: Stage;
  perception: {
    status: string;
    dimensions: number;
    confirmed_dimensions: number;
    candidate_dimensions: number;
    raw_count: number;
    retained_count: number;
    removed_count: number;
    removed_percent: number;
    first_alert_minute: number | null;
    max_hits: number;
    window_start: string;
    window_end: string;
    series: Series[];
    distributions: Distribution[];
    method: string;
    denoising_rule: string;
  };
  flows: {
    total: number;
    correlated: number;
    ambiguous: number;
    rows: Flow[];
    note: string;
  };
  clusters: {
    groups: Cluster[];
    tested_dimensions: number;
    hypotheses_tested: number;
    fallback: {
      group_id: string;
      user_id: string;
      count: number;
      significant: boolean;
      features: Feature[];
    }[];
    fallback_attempted: number;
    fallback_hypotheses?: number;
    method: string;
    note?: string;
  };
  reasoning: {
    status: string;
    hypotheses: Hypothesis[];
    conclusion: Conclusion | null;
    unknown_codes: string[];
    graph_version: string;
    slow_reasoning: null | {
      status: string;
      reason: string;
      message: string;
      tasks: { tool: string; action: string; status: string }[];
      recommendation: string;
    };
  };
  topology: Topology;
  quality: Quality;
  logs: Log[];
  handoff: { status: string; delivered: boolean; [key: string]: unknown };
}
