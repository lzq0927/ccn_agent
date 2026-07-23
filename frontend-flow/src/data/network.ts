// ============================================================================
// 网络图构建 —— 把解析拓扑变成可布局、可派生链路的 NetworkGraph。
//   buildGraph(topo):通用工厂(DEMO 与 LIVE 共用)
//   DEMO_GRAPH + 具名导出(NODES/EDGES/...):内置真实 case_001 拓扑，向后兼容
// ============================================================================

import { PARSED_TOPO, parseTopology } from "./topo";
import type { NEInstance, NEType, GraphEdge, FaultSpec } from "./types";

export const VIEW_W = 1040;
export const VIEW_H = 646; // 宽版(宽高比≈1.61):匹配实测的右栏区域,meet 基本铺满、节点铺满更密

/** 每类 NE 的布局:x 列 + 该类型实例的 y 序列(纵向铺满 668 高度,避免聚集留白) */
const LAYOUT: Record<NEType, { x: number; ys: number[] }> = {
  gNB: { x: 92, ys: [237, 392, 548] },
  AMF: { x: 288, ys: [250, 392, 535] },
  SMF: { x: 498, ys: [354, 457] },
  UDM: { x: 712, ys: [195, 281] },
  AUSF: { x: 806, ys: [195, 281] },
  PCF: { x: 712, ys: [403, 488] },
  UPF: { x: 928, ys: [403, 514, 626] },
  NRF: { x: 498, ys: [42, 107] },
  NSSF: { x: 928, ys: [195, 281] },
};

const LAYER_OF: Record<NEType, number> = {
  gNB: 0,
  AMF: 1,
  SMF: 2,
  UDM: 3,
  AUSF: 3,
  PCF: 3,
  UPF: 4,
  NRF: -1,
  NSSF: 3,
};

/** 通用布局:某类型实例数超出资定时，自动在带状内均匀展开 */
function ysFor(type: NEType, count: number): number[] {
  const base = LAYOUT[type].ys;
  if (count <= base.length) return base.slice(0, count);
  const [lo, hi] = [base[0], base[base.length - 1]];
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, count - 1));
}

function numSuffix(id: string): number {
  const m = id.match(/_(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

export interface NetworkGraph {
  nodes: NEInstance[];
  nodeById: Record<string, NEInstance>;
  flowEdges: GraphEdge[];
  registryEdges: GraphEdge[];
  edges: GraphEdge[];
  edgeById: Record<string, GraphEdge>;
  adj: Record<string, string[]>;
}

function instancesOf(nodes: NEInstance[], type: NEType): string[] {
  return nodes.filter((n) => n.type === type).map((n) => n.id);
}

export function edgeId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

function buildNodes(topo: ReturnType<typeof parseTopology>): NEInstance[] {
  const byType: Record<string, NEInstance[]> = {};
  for (const id of topo.order) {
    const base = topo.nodes[id];
    (byType[base.type] ??= []).push({
      id,
      type: base.type,
      role: base.role,
      pool: base.pool,
      dc: base.dc,
      layer: LAYER_OF[base.type],
      x: 0,
      y: 0,
    });
  }
  const out: NEInstance[] = [];
  for (const type of Object.keys(byType)) {
    const list = byType[type].sort((a, b) => numSuffix(a.id) - numSuffix(b.id));
    const xs = LAYOUT[type as NEType].x;
    const ys = ysFor(type as NEType, list.length);
    list.forEach((n, i) => {
      n.x = xs;
      n.y = ys[i] ?? ys[ys.length - 1] ?? 300;
      out.push(n);
    });
  }
  return out;
}

function buildFlowEdges(nodes: NEInstance[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (a: string, b: string, w: number, ta: NEType, tb: NEType) => {
    const id = edgeId(a, b);
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, a, b, kind: "flow", weight: w, types: [ta, tb] });
  };
  const gNBs = instancesOf(nodes, "gNB");
  const amfs = instancesOf(nodes, "AMF");
  const smfs = instancesOf(nodes, "SMF");
  const pcfs = instancesOf(nodes, "PCF");
  const upfs = instancesOf(nodes, "UPF");
  const byId: Record<string, NEInstance> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const udmsActive = instancesOf(nodes, "UDM").filter((id) => byId[id]?.role !== "standby");

  for (const g of gNBs) for (const a of amfs) push(g, a, 1.0, "gNB", "AMF");
  for (const a of amfs) for (const s of smfs) push(a, s, 1.4, "AMF", "SMF");
  for (const s of smfs) for (const u of udmsActive) push(s, u, 1.6, "SMF", "UDM");
  for (const s of smfs) for (const p of pcfs) push(s, p, 1.2, "SMF", "PCF");
  for (const s of smfs) for (const u of upfs) push(s, u, 1.5, "SMF", "UPF");
  return edges;
}

function buildRegistryEdges(nodes: NEInstance[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const nrfs = instancesOf(nodes, "NRF");
  if (nrfs.length === 0) return edges;
  // UPF 不向 NRF 注册(用户面不展示注册连线)，故 sbiTypes 不含 UPF
  const sbiTypes: NEType[] = ["AMF", "SMF", "PCF", "UDM", "AUSF", "NSSF"];
  const primaryNrf = nrfs[0];
  for (const t of sbiTypes) {
    for (const id of instancesOf(nodes, t)) {
      edges.push({ id: edgeId(id, primaryNrf), a: id, b: primaryNrf, kind: "registry", weight: 0.5, types: [t, "NRF"] });
    }
  }
  if (nrfs.length > 1) edges.push({ id: edgeId(nrfs[0], nrfs[1]), a: nrfs[0], b: nrfs[1], kind: "registry", weight: 0.5, types: ["NRF", "NRF"] });
  return edges;
}

function buildAdj(edges: GraphEdge[], nodes: NEInstance[]): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const n of nodes) m[n.id] = [];
  for (const e of edges) {
    (m[e.a] ??= []).push(e.b);
    (m[e.b] ??= []).push(e.a);
  }
  return m;
}

/** 通用工厂:解析拓扑 → 完整 NetworkGraph */
export function buildGraph(topo: ReturnType<typeof parseTopology>): NetworkGraph {
  const nodes = buildNodes(topo);
  const flowEdges = buildFlowEdges(nodes);
  const registryEdges = buildRegistryEdges(nodes);
  const edges = [...flowEdges, ...registryEdges];
  return {
    nodes,
    nodeById: Object.fromEntries(nodes.map((n) => [n.id, n])),
    flowEdges,
    registryEdges,
    edges,
    edgeById: Object.fromEntries(edges.map((e) => [e.id, e])),
    adj: buildAdj(edges, nodes),
  };
}

/** LIVE:由真实 topo.txt 文本构建图(链路随后由 data.csv 注入) */
export function buildGraphFromTopoText(topoText: string): NetworkGraph {
  return buildGraph(parseTopology(topoText));
}

// —— 内置 DEMO 网络(真实 case_001 拓扑)+ 向后兼容具名导出 ——
export const DEMO_GRAPH: NetworkGraph = buildGraph(PARSED_TOPO);
export const NODES = DEMO_GRAPH.nodes;
export const NODE_BY_ID = DEMO_GRAPH.nodeById;
export const FLOW_EDGES = DEMO_GRAPH.flowEdges;
export const REGISTRY_EDGES = DEMO_GRAPH.registryEdges;
export const EDGES = DEMO_GRAPH.edges;
export const EDGE_BY_ID = DEMO_GRAPH.edgeById;
export const ADJ = DEMO_GRAPH.adj;

/** 给定故障，计算受影响的 NE 与链路(指定图) */
export function affectedEntitiesIn(graph: NetworkGraph, fault: FaultSpec): { neSet: Set<string>; edgeSet: Set<string> } {
  const neSet = new Set<string>(fault.elements);
  const edgeSet = new Set<string>();
  for (const lk of fault.links) {
    const parts = lk.split("->");
    if (parts.length === 2) {
      const id = edgeId(parts[0].trim(), parts[1].trim());
      if (graph.edgeById[id]) {
        edgeSet.add(id);
        neSet.add(parts[0].trim());
        neSet.add(parts[1].trim());
      }
    }
  }
  for (const ne of fault.elements) {
    for (const e of graph.flowEdges) {
      if (e.a === ne || e.b === ne) edgeSet.add(e.id);
    }
  }
  return { neSet, edgeSet };
}

/** 恢复重路由备用路径(指定图) */
export function recoveryRerouteIn(graph: NetworkGraph, fault: FaultSpec): string[] {
  const reroute: string[] = [];
  const instances = (t: NEType) => graph.nodes.filter((n) => n.type === t).map((n) => n.id);
  if (fault.faultType === "all_type_ne") {
    for (const a of instances("AMF")) reroute.push(edgeId(a, "AMF_1"));
  }
  if (fault.elements.includes("AMF_3")) {
    reroute.push(edgeId("gNB_2", "AMF_1"), edgeId("gNB_2", "AMF_2"));
  }
  if (fault.faultType === "path_link") {
    for (const u of instances("UPF")) reroute.push(edgeId("SMF_1", u), edgeId("SMF_2", u));
  }
  // UPF 隔离(single_ne):SMF 将用户面流量切换至 UPF POOL 内其它健康 UPF
  if (fault.faultType === "single_ne" && fault.elements.some((e) => e.replace(/_\d+$/, "") === "UPF")) {
    const healthyUpfs = instances("UPF").filter((u) => !fault.elements.includes(u));
    for (const s of instances("SMF")) for (const u of healthyUpfs) reroute.push(edgeId(s, u));
  }
  return reroute.filter((id, i, arr) => graph.edgeById[id] && arr.indexOf(id) === i);
}

// —— DEMO 兼容包装(基于内置图)——
export function affectedEntities(fault: FaultSpec) {
  return affectedEntitiesIn(DEMO_GRAPH, fault);
}
export function recoveryReroute(fault: FaultSpec) {
  return recoveryRerouteIn(DEMO_GRAPH, fault);
}
