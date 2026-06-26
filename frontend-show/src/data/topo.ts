// ============================================================================
// 拓扑解析 —— 内置真实 case_001/topo.txt(DC1 双 ResourcePool,9 类 NE,UDM/AUSF 主备)
// ============================================================================

import type { NEType, Role } from "./types";

/** 真实拓扑文本(取自 storage/cases/case_001/topo.txt,原样) */
export const TOPO_TEXT = `DC: DC1
  ResourcePool: RP_DC1_1
    gNB: gNB_3
    AMF: AMF_3
    SMF: SMF_1
    UPF: UPF_1
    UPF: UPF_2
    PCF: PCF_2
    UDM: UDM_1(master)
    AUSF: AUSF_2(standby)
    NSSF: NSSF_2
  ResourcePool: RP_DC1_2
    gNB: gNB_1
    gNB: gNB_2
    AMF: AMF_1
    AMF: AMF_2
    SMF: SMF_2
    UPF: UPF_3
    PCF: PCF_1
    UDM: UDM_2(standby)
    AUSF: AUSF_1(master)
    NRF: NRF_1
    NRF: NRF_2
    NSSF: NSSF_1`;

export interface NEBase {
  id: string;
  type: NEType;
  role: Role;
  pool: string;
  dc: string;
}
export interface ParsedPool {
  id: string;
  neIds: string[];
}
export interface ParsedDC {
  id: string;
  pools: ParsedPool[];
}
export interface ParsedTopo {
  dcs: ParsedDC[];
  nodes: Record<string, NEBase>;
  order: string[];
}

const NE_TYPES: NEType[] = ["gNB", "AMF", "SMF", "UPF", "PCF", "UDM", "AUSF", "NRF", "NSSF"];

/** 解析 topo.txt → 结构化拓扑 */
export function parseTopology(text: string): ParsedTopo {
  const dcs: ParsedDC[] = [];
  const nodes: Record<string, NEBase> = {};
  const order: string[] = [];
  let curDc: ParsedDC | null = null;
  let curPool: ParsedPool | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const t = line.trim();
    if (t.startsWith("DC:")) {
      curDc = { id: t.slice(3).trim(), pools: [] };
      dcs.push(curDc);
      curPool = null;
    } else if (t.startsWith("ResourcePool:")) {
      curPool = { id: t.slice("ResourcePool:".length).trim(), neIds: [] };
      curDc?.pools.push(curPool);
    } else {
      const m = t.match(/^([A-Za-z]+):\s*(.+)$/);
      if (!m || !curDc || !curPool) continue;
      const type = m[1] as NEType;
      if (!NE_TYPES.includes(type)) continue;
      for (let piece of m[2].split(",")) {
        piece = piece.trim();
        if (!piece) continue;
        let role: Role = "lb";
        const rm = piece.match(/^(.+?)\((master|standby)\)$/);
        let id = piece;
        if (rm) {
          id = rm[1].trim();
          role = rm[2] as Role;
        }
        if (nodes[id]) continue;
        nodes[id] = { id, type, role, pool: curPool.id, dc: curDc.id };
        order.push(id);
        curPool.neIds.push(id);
      }
    }
  }
  return { dcs, nodes, order };
}

export const PARSED_TOPO = parseTopology(TOPO_TEXT);
