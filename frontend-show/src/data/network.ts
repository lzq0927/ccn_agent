// ============================================================================
// 网络图构建 —— 在解析拓扑上分配数据流分层布局 + 推导业务流/注册链路
// 布局:横向数据流 gNB → AMF → SMF → {UDM/PCF, UPF};NRF 为顶部注册枢纽
// ============================================================================

import { PARSED_TOPO } from "./topo";
import type { NEInstance, NEType, GraphEdge, FaultSpec } from "./types";

export const VIEW_W = 1120;
export const VIEW_H = 660;

/** 每类 NE 的布局:x 列 + 该类型实例的 y 序列(按编号升序对齐) */
const LAYOUT: Record<NEType, { x: number; ys: number[] }> = {
  gNB: { x: 92, ys: [228, 348, 468] },
  AMF: { x: 288, ys: [238, 348, 458] },
  SMF: { x: 498, ys: [318, 398] },
  UDM: { x: 712, ys: [196, 262] },
  AUSF: { x: 806, ys: [196, 262] },
  PCF: { x: 712, ys: [356, 422] },
  UPF: { x: 928, ys: [356, 442, 528] },
  NRF: { x: 498, ys: [78, 128] },
  NSSF: { x: 928, ys: [196, 262] },
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

function numSuffix(id: string): number {
  const m = id.match(/_(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** 构建带布局坐标的节点 */
function buildNodes(): NEInstance[] {
  // 按 (type, 数字编号) 排序,使 ys 序列稳定对齐
  const entries = Object.values(PARSED_TOPO.nodes);
  const byType: Record<string, NEInstance[]> = {};
  for (const n of entries) {
    (byType[n.type] ??= []).push(n as unknown as NEInstance);
  }
  const out: NEInstance[] = [];
  for (const type of Object.keys(byType)) {
    const list = byType[type].sort((a, b) => numSuffix(a.id) - numSuffix(b.id));
    const lay = LAYOUT[type as NEType];
    list.forEach((n, i) => {
      const base = PARSED_TOPO.nodes[n.id];
      out.push({
        id: n.id,
        type: base.type,
        role: base.role,
        pool: base.pool,
        dc: base.dc,
        layer: LAYER_OF[base.type],
        x: lay.x,
        y: lay.ys[i] ?? lay.ys[lay.ys.length - 1],
      });
    });
  }
  return out;
}

export const NODES = buildNodes();
export const NODE_BY_ID: Record<string, NEInstance> = Object.fromEntries(NODES.map((n) => [n.id, n]));

function instancesOf(type: NEType): string[] {
  return NODES.filter((n) => n.type === type).map((n) => n.id);
}

function edgeId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

/** 业务流链路:忠实复刻 PDU 建立流程的真实跳(gNB-AMF, AMF-SMF, SMF-UDM, SMF-PCF, SMF-UPF) */
function buildFlowEdges(): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const push = (a: string, b: string, w: number, ta: NEType, tb: NEType) => {
    const id = edgeId(a, b);
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, a, b, kind: "flow", weight: w, types: [ta, tb] });
  };
  const seen = new Set<string>();
  const gNBs = instancesOf("gNB");
  const amfs = instancesOf("AMF");
  const smfs = instancesOf("SMF");
  const pcfs = instancesOf("PCF");
  const upfs = instancesOf("UPF");
  const udmsActive = instancesOf("UDM").filter((id) => PARSED_TOPO.nodes[id].role !== "standby"); // master 承载流量

  for (const g of gNBs) for (const a of amfs) push(g, a, 1.0, "gNB", "AMF");
  for (const a of amfs) for (const s of smfs) push(a, s, 1.4, "AMF", "SMF");
  for (const s of smfs) for (const u of udmsActive) push(s, u, 1.6, "SMF", "UDM");
  for (const s of smfs) for (const p of pcfs) push(s, p, 1.2, "SMF", "PCF");
  for (const s of smfs) for (const u of upfs) push(s, u, 1.5, "SMF", "UPF");
  return edges;
}

/** NRF 注册链路:所有 SBI 网元向 NRF 注册(弱可见的"注册织网") */
function buildRegistryEdges(): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const nrfs = instancesOf("NRF");
  if (nrfs.length === 0) return edges;
  const sbiTypes: NEType[] = ["AMF", "SMF", "UPF", "PCF", "UDM", "AUSF", "NSSF"];
  const primaryNrf = nrfs[0];
  for (const t of sbiTypes) {
    for (const id of instancesOf(t)) {
      edges.push({ id: edgeId(id, primaryNrf), a: id, b: primaryNrf, kind: "registry", weight: 0.5, types: [t, "NRF"] });
    }
  }
  if (nrfs.length > 1) edges.push({ id: edgeId(nrfs[0], nrfs[1]), a: nrfs[0], b: nrfs[1], kind: "registry", weight: 0.5, types: ["NRF", "NRF"] });
  return edges;
}

export const FLOW_EDGES = buildFlowEdges();
export const REGISTRY_EDGES = buildRegistryEdges();
export const EDGES: GraphEdge[] = [...FLOW_EDGES, ...REGISTRY_EDGES];
export const EDGE_BY_ID: Record<string, GraphEdge> = Object.fromEntries(EDGES.map((e) => [e.id, e]));

/** 邻接表 */
export const ADJ: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const n of NODES) m[n.id] = [];
  for (const e of EDGES) {
    (m[e.a] ??= []).push(e.b);
    (m[e.b] ??= []).push(e.a);
  }
  return m;
})();

/** 给定故障,计算受影响的 NE 集合与链路集合 */
export function affectedEntities(fault: FaultSpec): { neSet: Set<string>; edgeSet: Set<string> } {
  const neSet = new Set<string>(fault.elements);
  const edgeSet = new Set<string>();
  // 链路型故障
  for (const lk of fault.links) {
    const parts = lk.split("->");
    if (parts.length === 2) {
      const id = edgeId(parts[0].trim(), parts[1].trim());
      if (EDGE_BY_ID[id]) {
        edgeSet.add(id);
        neSet.add(parts[0].trim());
        neSet.add(parts[1].trim());
      }
    }
  }
  // NE 型故障(link 模式:所有邻接边劣化;business 模式:仅标记 NE)
  for (const ne of fault.elements) {
    for (const e of EDGES) {
      if (e.kind !== "flow") continue;
      if (e.a === ne || e.b === ne) edgeSet.add(e.id);
    }
  }
  return { neSet, edgeSet };
}

/** 恢复动作产生的"重路由"备用路径(用于恢复阶段高亮) */
export function recoveryReroute(fault: FaultSpec): string[] {
  // gNB 全故障 → 由邻站/AMF 侧重选;单 NE 故障 → 同类型备用实例接管
  const reroute: string[] = [];
  if (fault.faultType === "all_type_ne") {
    // 无线侧重选:UE 经 AMF 直接锚定,跳过故障 gNB
    for (const a of instancesOf("AMF")) reroute.push(edgeId(a, "AMF_1"));
  }
  if (fault.elements.includes("AMF_3")) {
    reroute.push(edgeId("gNB_2", "AMF_1"), edgeId("gNB_2", "AMF_2"));
  }
  if (fault.faultType === "path_link") {
    // SMF-UPF 链路劣化 → 切换到备用 UPF
    const upfs = instancesOf("UPF");
    for (const u of upfs) reroute.push(edgeId("SMF_1", u), edgeId("SMF_2", u));
  }
  return reroute.filter((id, i, arr) => EDGE_BY_ID[id] && arr.indexOf(id) === i);
}
