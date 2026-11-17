import { useState } from "react";
import {
  Focus,
  Network,
  Server,
  ChevronRight,
  Layers,
  CircleDot,
} from "lucide-react";
import type { Snapshot } from "./types";
import { number } from "./utils";

export default function Topology({ snapshot }: { snapshot: Snapshot }) {
  const { topology, reasoning } = snapshot;
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const nodeId = selected || reasoning.conclusion?.nf || topology.nodes[0]?.id;
  const node = topology.nodes.find((n) => n.id === nodeId);
  const layout: Record<string, [number, number[]]> = {
    AMF: [90, [135, 265]],
    SMF: [310, [135, 265]],
    UDM: [540, [70, 150]],
    PCF: [540, [255, 335]],
    AUSF: [770, [70, 150]],
    UPF: [770, [255, 335]],
  };
  const positions: Record<string, [number, number]> = {};
  const counts: Record<string, number> = {};
  topology.nodes.forEach((n, i) => {
    const [x, ys] = layout[n.type] || [
      90 + (i % 4) * 220,
      [70 + Math.floor(i / 4) * 100],
    ];
    const index = counts[n.type] || 0;
    counts[n.type] = index + 1;
    positions[n.id] = [x, ys[index] ?? ys[0] + index * 80];
  });
  const edges = topology.edges.filter(
    (e) =>
      full ||
      e.status !== "normal" ||
      e.source === nodeId ||
      e.target === nodeId,
  );
  return (
    <section className="card topology-card">
      <div className="card-heading">
        <div>
          <h3>
            <Network size={16} /> 核心网拓扑{" "}
            <span className="subtle-label">TOPOLOGY</span>
          </h3>
          <p>
            {topology.nodes.length} 个实例 · {topology.edges.length} 条逻辑连接
            · 点击网元查看证据
          </p>
        </div>
        <div className="segmented small">
          <button
            className={!full ? "selected" : ""}
            onClick={() => setFull(false)}
          >
            <Focus size={13} /> 关联路径
          </button>
          <button
            className={full ? "selected" : ""}
            onClick={() => setFull(true)}
          >
            完整拓扑
          </button>
        </div>
      </div>
      <div className="topology-legend">
        <span>
          <i className="dot blue" />
          未检出异常
        </span>
        <span>
          <i className="dot orange" />
          受影响
        </span>
        <span>
          <i className="dot coral" />
          推断根因
        </span>
        <span className="legend-line">疑似故障链路</span>
      </div>
      <div className="topology-canvas">
        <svg
          viewBox="0 0 870 400"
          role="img"
          aria-label="5GC 网元拓扑；可使用下方网元选择器查看证据"
        >
          <defs>
            <pattern
              id="grid-dots"
              width="18"
              height="18"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r=".7" fill="#e3e8f0" />
            </pattern>
          </defs>
          <rect width="870" height="400" fill="url(#grid-dots)" />
          <g className="topology-column-labels">
            <text x="90" y="27">
              接入与移动性
            </text>
            <text x="310" y="27">
              会话管理
            </text>
            <text x="540" y="27">
              用户与策略
            </text>
            <text x="770" y="27">
              鉴权与用户面
            </text>
          </g>
          {edges.map((e, i) => {
            const a = positions[e.source],
              b = positions[e.target];
            if (!a || !b) return null;
            const color =
              e.status === "suspected"
                ? "#e98970"
                : e.status === "propagation"
                  ? "#91a1df"
                  : "#dce2ec";
            return (
              <path
                key={i}
                d={`M${a[0]},${a[1]} C${(a[0] + b[0]) / 2},${a[1]} ${(a[0] + b[0]) / 2},${b[1]} ${b[0]},${b[1]}`}
                stroke={color}
                strokeWidth={e.status === "normal" ? 1 : 2}
                opacity={e.status === "normal" ? 0.65 : 1}
                strokeDasharray={e.status === "suspected" ? "5 4" : undefined}
                fill="none"
              />
            );
          })}
          {topology.nodes.map((n) => {
            const [x, y] = positions[n.id],
              root = n.status === "root",
              affected = n.status === "affected";
            return (
              <g
                key={n.id}
                className={`topology-node ${root ? "root-node" : ""}`}
                onClick={() => setSelected(n.id)}
                role="button"
                tabIndex={0}
                aria-label={`查看网元 ${n.id}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(n.id);
                  }
                }}
              >
                {root && (
                  <rect
                    x={x - 69}
                    y={y - 34}
                    width="138"
                    height="68"
                    rx="14"
                    fill="#f9ebe7"
                    opacity=".9"
                  />
                )}
                <rect
                  x={x - 61}
                  y={y - 27}
                  width="122"
                  height="54"
                  rx="10"
                  fill="white"
                  stroke={
                    root
                      ? "#e18c76"
                      : n.id === nodeId
                        ? "#7c92dc"
                        : affected
                          ? "#e9b47e"
                          : "#dfe5ed"
                  }
                  strokeWidth={root || n.id === nodeId ? 1.6 : 1}
                />
                <rect
                  x={x - 49}
                  y={y - 14}
                  width="27"
                  height="28"
                  rx="6"
                  fill={root ? "#fcf0ec" : "#eff3fc"}
                />
                <g transform={`translate(${x - 44},${y - 9})`}>
                  <rect
                    x="0"
                    y="0"
                    width="16"
                    height="7"
                    rx="2"
                    fill="none"
                    stroke={root ? "#cb7f67" : "#788fc7"}
                    strokeWidth="1.2"
                  />
                  <rect
                    x="0"
                    y="11"
                    width="16"
                    height="7"
                    rx="2"
                    fill="none"
                    stroke={root ? "#cb7f67" : "#788fc7"}
                    strokeWidth="1.2"
                  />
                  <circle cx="3" cy="3.5" r="1" fill="#9ca9bc" />
                  <circle cx="3" cy="14.5" r="1" fill="#9ca9bc" />
                </g>
                <text
                  x={x - 11}
                  y={y - 3}
                  fill="#3c4960"
                  fontSize="13"
                  fontWeight="600"
                >
                  {n.label}
                </text>
                <text x={x - 11} y={y + 13} fill="#98a1b0" fontSize="9">
                  {n.type} · {n.pods.length} POD
                </text>
                <circle
                  cx={x + 50}
                  cy={y - 16}
                  r="3"
                  fill={root ? "#e3866c" : affected ? "#e2b472" : "#91afa4"}
                />
                {root && (
                  <g>
                    <rect
                      x={x - 31}
                      y={y + 37}
                      width="62"
                      height="19"
                      rx="9.5"
                      fill="#fbefe9"
                    />
                    <text
                      x={x}
                      y={y + 50}
                      textAnchor="middle"
                      fill="#bd7b63"
                      fontSize="10"
                    >
                      疑似根因
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="node-details">
        <div className="node-details-title">
          <Server size={15} />
          <select
            aria-label="选择网元"
            value={nodeId || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {topology.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id}
              </option>
            ))}
          </select>
          <ChevronRight size={12} />
        </div>
        <span>
          <CircleDot size={12} />
          异常 CHR <b>{number(node?.anomalies || 0)}</b>
        </span>
        <span>
          <Layers size={12} />
          {node?.pods.join(" / ") || "当前窗口无 POD 数据"}
        </span>
      </div>
    </section>
  );
}
