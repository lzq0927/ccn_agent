// ============================================================================
// DigitalTwin —— 中央 SVG 网络数字孪生
//   节点(9 类 NE,按数据流分层) + 业务流/注册链路 + 流动数据粒子
//   健康着色由 KPI(simT) 驱动;异常脉冲 / 推理聚焦 / 根因标定 / 恢复叠加
// ============================================================================

import { memo } from "react";
import { FLOW_EDGES, NODE_BY_ID, NODES, REGISTRY_EDGES, VIEW_H, VIEW_W } from "../../data/network";
import { sample } from "../../data/kpi";
import type { Scenario } from "../../data/types";
import { getKpi } from "../../story/director";
import type { StoryState } from "../../story/types";
import { NE_COLORS, STATUS, srColor } from "../../theme";

const R = 18; // 节点半径

function lineBetween(ax: number, ay: number, bx: number, by: number, r: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { x1: ax + ux * r, y1: ay + uy * r, x2: bx - ux * r, y2: by - uy * r };
}

function edgeLine(a: string, b: string) {
  const A = NODE_BY_ID[a];
  const B = NODE_BY_ID[b];
  // 按数据流方向(层级小→大)定向
  const [from, to] = A.layer <= B.layer ? [A, B] : [B, A];
  return lineBetween(from.x, from.y, to.x, to.y, R);
}

interface Props {
  scenario: Scenario;
  state: StoryState;
}

function DigitalTwinBase({ scenario, state }: Props) {
  const kpi = getKpi(scenario);
  const simT = state.simT;
  const threshold = kpi.threshold;

  const focusSet = new Set(state.affectedNe);
  const rootSet = new Set(state.rootCause.nes);
  const cordonedSet = new Set(state.cordonedNe);
  const rerouteSet = new Set(state.rerouteEdges);

  // 总体 KPI 读数
  const overallSr = sample(kpi.overall, simT);
  const degradedCount = NODES.filter((n) => sample(kpi.nodes[n.id], simT) < threshold).length;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="twin-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="twin-glow-strong" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="node-healthy" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#13203a" />
          <stop offset="100%" stopColor="#070d1c" />
        </radialGradient>
        <radialGradient id="node-fault" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#3a1218" />
          <stop offset="100%" stopColor="#180608" />
        </radialGradient>
        {FLOW_EDGES.map((e) => {
          const L = edgeLine(e.a, e.b);
          return <path key={`p-${e.id}`} id={`p-${e.id}`} d={`M ${L.x1} ${L.y1} L ${L.x2} ${L.y2}`} fill="none" stroke="none" />;
        })}
      </defs>

      {/* DC 容器 */}
      <rect x={56} y={46} width={968} height={568} rx={14} fill="rgba(56,189,248,0.025)" stroke="rgba(56,189,248,0.14)" strokeDasharray="2 6" />
      <text x={66} y={40} fill="#7e8aa3" fontSize={11} fontFamily="var(--font-mono)" letterSpacing="0.18em">
        DC1 · 5GC SA CORE · DIGITAL TWIN
      </text>

      {/* UE 接入簇(左) */}
      <UeCluster active={state.twinMode !== "healed" || state.phaseIndex <= 1} anomaly={state.showAnomaly} />

      {/* 注册链路(弱) */}
      <g opacity={0.9}>
        {REGISTRY_EDGES.map((e) => {
          const L = edgeLine(e.a, e.b);
          return <line key={e.id} x1={L.x1} y1={L.y1} x2={L.x2} y2={L.y2} stroke="rgba(148,163,184,0.12)" strokeWidth={0.8} />;
        })}
      </g>

      {/* 业务流链路 */}
      <g>
        {FLOW_EDGES.map((e) => {
          const ll = edgeLine(e.a, e.b);
          const sr = sample(kpi.edges[e.id], simT);
          const degraded = sr < threshold;
          const isReroute = rerouteSet.has(e.id);
          const isFocus = focusSet.has(e.a) || focusSet.has(e.b) || rootSet.has(e.a) || rootSet.has(e.b);
          const color = isReroute ? STATUS.recovered : degraded ? srColor(sr) : "rgba(56,189,248,0.28)";
          const dashClass = isReroute ? "flow-dash-fast" : "flow-dash";
          const width = isReroute ? 3.4 : isFocus ? 2.2 : 1.3 + e.weight * 0.5;
          return (
            <g key={e.id}>
              <line
                x1={ll.x1}
                y1={ll.y1}
                x2={ll.x2}
                y2={ll.y2}
                stroke={color}
                strokeWidth={width}
                strokeLinecap="round"
                className={state.phaseIndex >= 1 ? dashClass : undefined}
                opacity={isReroute ? 1 : degraded ? 0.95 : 0.5}
                filter={degraded || isReroute ? "url(#twin-glow)" : undefined}
              />
              {/* 焦点/重路由边:运动数据包 */}
              {(isFocus || isReroute) && state.phaseIndex >= 1 && (
                <circle r={isReroute ? 3.2 : 2.4} fill={isReroute ? "#bbf7d0" : "#7dd3fc"} filter="url(#twin-glow)">
                  <animateMotion dur={isReroute ? "0.9s" : "1.5s"} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#p-${e.id}`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          );
        })}
      </g>

      {/* 节点 */}
      <g>
        {NODES.map((n) => {
          const sr = sample(kpi.nodes[n.id], simT);
          const degraded = sr < threshold && state.showAnomaly;
          const isFocus = focusSet.has(n.id);
          const isRoot = rootSet.has(n.id);
          const isCordoned = cordonedSet.has(n.id);
          const tc = NE_COLORS[n.type];
          const ringColor = isCordoned ? "#64748b" : degraded ? STATUS.fault : isFocus ? tc.glow : tc.base;
          const fillUrl = degraded ? "url(#node-fault)" : "url(#node-healthy)";
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              {/* 告警脉冲 */}
              {degraded && <circle r={R} fill="none" stroke={STATUS.fault} strokeWidth={1.5} className="alert-ring" opacity={0.8} />}
              {/* 根因标定:旋转准星 */}
              {isRoot && (
                <g className="spin-slow" filter="url(#twin-glow-strong)">
                  <circle r={R + 9} fill="none" stroke={STATUS.fault} strokeWidth={1.4} strokeDasharray="14 6" opacity={0.9} />
                </g>
              )}
              {/* 隔离框 */}
              {isCordoned && (
                <g>
                  <rect x={-R - 7} y={-R - 7} width={(R + 7) * 2} height={(R + 7) * 2} rx={6} fill="none" stroke="#64748b" strokeWidth={1.2} strokeDasharray="3 3" />
                </g>
              )}
              {/* 节点主体 */}
              <circle r={R} fill={fillUrl} stroke={ringColor} strokeWidth={isFocus || isRoot ? 2.6 : 1.6} filter={isFocus || isRoot || degraded ? "url(#twin-glow)" : undefined} />
              <text y={3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={isCordoned ? "#94a3b8" : tc.glow} fontFamily="var(--font-mono)">
                {n.type}
              </text>
              <text y={R + 13} textAnchor="middle" fontSize={8.5} fill={isRoot ? STATUS.faultGlow : isCordoned ? "#64748b" : "#9fb0c9"} fontFamily="var(--font-mono)">
                {n.id}
              </text>
              {/* 健康分(仅故障时) */}
              {degraded && (
                <text y={-R - 8} textAnchor="middle" fontSize={8} fill={STATUS.faultGlow} fontFamily="var(--font-mono)">
                  {(sr * 100).toFixed(1)}%
                </text>
              )}
              {/* 主备徽标 */}
              {n.role !== "lb" && (
                <g transform={`translate(${R - 3} ${-R + 3})`}>
                  <circle r={5} fill={n.role === "master" ? "#facc15" : "#475569"} stroke="#04070f" strokeWidth={1} />
                  <text y={2.5} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#04070f" fontFamily="var(--font-mono)">
                    {n.role === "master" ? "M" : "S"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* 实时读数 */}
      <g transform={`translate(${VIEW_W - 188} 60)`}>
        <rect x={0} y={0} width={178} height={74} rx={8} fill="rgba(4,7,15,0.7)" stroke="rgba(56,189,248,0.25)" />
        <text x={12} y={20} fontSize={9} fill="#7e8aa3" fontFamily="var(--font-mono)" letterSpacing="0.1em">
          LIVE · T={simT.toFixed(0)}s
        </text>
        <text x={12} y={42} fontSize={20} fontWeight={700} fill={srColor(overallSr)} fontFamily="var(--font-mono)">
          {(overallSr * 100).toFixed(2)}%
        </text>
        <text x={12} y={42} fontSize={9} fill="#7e8aa3" fontFamily="var(--font-mono)" textAnchor="start" dx={92}>
          overall SR
        </text>
        <text x={12} y={62} fontSize={9} fill={degradedCount > 0 ? STATUS.fault : STATUS.healthy} fontFamily="var(--font-mono)">
          {degradedCount > 0 ? `▲ ${degradedCount} NE degraded` : "● all NE nominal"}
        </text>
      </g>
    </svg>
  );
}

/** UE 接入簇 + 到 gNB 的弱流动 */
function UeCluster({ active, anomaly }: { active: boolean; anomaly: boolean }) {
  const gnbs = NODES.filter((n) => n.type === "gNB");
  const ueYs = [300, 340, 380];
  return (
    <g>
      <text x={20} y={262} fontSize={9} fill="#7e8aa3" fontFamily="var(--font-mono)" letterSpacing="0.1em">
        UE × 85
      </text>
      {ueYs.map((y, i) => (
        <g key={i}>
          <circle cx={26} cy={y} r={5} fill={anomaly ? STATUS.fault : "#38bdf8"} opacity={0.9} filter="url(#twin-glow)" />
          {gnbs.map((g, j) => (
            <line
              key={j}
              x1={31}
              y1={y}
              x2={g.x - R}
              y2={g.y}
              stroke={anomaly && j === 0 ? "rgba(239,68,68,0.3)" : "rgba(56,189,248,0.16)"}
              strokeWidth={0.8}
              className={active ? "flow-dash" : undefined}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

export const DigitalTwin = memo(DigitalTwinBase);
