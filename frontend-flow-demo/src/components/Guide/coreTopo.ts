// ============================================================================
// coreTopo —— 引导画布共用「核心拓扑」
//   从 scenario.realGraph 过滤出 6 类网元(gNB/AMF/SMF/UDM/PCF/UPF),
//   去掉 NRF/AUSF/NSSF(展会拓扑不展示仓储/鉴权/切片),按列流重排版。
//   A–F 与 G 共用同一核心拓扑;G 在此基础上叠加 UE/AI 平台(见 GuideCanvas)。
// ============================================================================

import type { NetworkGraph } from "../../data/network";
import type { NEInstance } from "../../data/types";

/** 保留的 6 类核心网元(去掉 NRF/AUSF/NSSF) */
const KEEP = new Set(["gNB", "AMF", "SMF", "UDM", "PCF", "UPF"]);

/** 各类型列 x(左→右数据流 gNB→AMF→SMF→{UDM,PCF,UPF});加宽铺满画布,减少右侧空白 */
const COL_X: Record<string, number> = { gNB: 110, AMF: 300, SMF: 495, UDM: 695, PCF: 695, UPF: 890 };

/** 各类型实例的 y 序列(UDM/PCF 同列,上下错开) */
const YS: Record<string, number[]> = {
  gNB: [200, 335, 470],
  AMF: [200, 335, 470],
  SMF: [265, 405],
  UDM: [205, 295],
  PCF: [440, 530],
  UPF: [235, 335, 435],
};

export interface CoreNode {
  id: string;
  type: string;
  role: string;
  x: number;
  y: number;
}
export interface CoreEdge { id: string; a: string; b: string; }
export interface CoreTopo {
  nodes: CoreNode[];
  nodeById: Record<string, CoreNode>;
  edges: CoreEdge[];
}

const numSuffix = (id: string) => parseInt(id.match(/_(\d+)$/)?.[1] ?? "0", 10);

/** 真实图 → 核心拓扑(6 类,列流布局) */
export function buildCoreTopo(graph: NetworkGraph | undefined): CoreTopo {
  if (!graph) return { nodes: [], nodeById: {}, edges: [] };
  const byType: Record<string, NEInstance[]> = {};
  for (const n of graph.nodes) {
    if (!KEEP.has(n.type)) continue;
    (byType[n.type] ??= []).push(n);
  }
  const nodes: CoreNode[] = [];
  const nodeById: Record<string, CoreNode> = {};
  for (const type of Object.keys(byType)) {
    const list = byType[type].sort((a, b) => numSuffix(a.id) - numSuffix(b.id));
    const x = COL_X[type];
    const ys = YS[type];
    list.forEach((n, i) => {
      const c: CoreNode = { id: n.id, type: n.type, role: n.role, x, y: ys[i] ?? ys[ys.length - 1] };
      nodes.push(c);
      nodeById[n.id] = c;
    });
  }
  const edges: CoreEdge[] = [];
  const seen = new Set<string>();
  for (const e of graph.flowEdges) {
    if (!nodeById[e.a] || !nodeById[e.b]) continue;
    const id = [e.a, e.b].sort().join("__");
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, a: e.a, b: e.b });
  }
  return { nodes, nodeById, edges };
}
