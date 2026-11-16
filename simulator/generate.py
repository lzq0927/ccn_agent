"""仿真数据生成器：拓扑、CHR、知识图谱。

    python -m simulator.generate            # 默认种子 42，写入仓库根目录
    python -m simulator.generate --seed 7

场景：共 40 分钟数据，第 20 分钟起 SMF:smf_2 后端部分链路丢包
（N7 -> PCF:pcf_2，N4 -> UPF:upf_1），其余后端链路正常。
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from . import catalog as cat

ROOT = Path(__file__).resolve().parent.parent
START = datetime(2026, 11, 16, 10, 0, 0)
DURATION_MIN = 40
FAULT_MIN = 20
N_USERS = 30000
N_GNB = 40
GNB_PER_TAC = 5

FAULT = {
    "ne": "SMF:smf_2",
    "links": [
        {"source": "SMF:smf_2", "target": "PCF:pcf_2", "interface": "N7"},
        {"source": "SMF:smf_2", "target": "UPF:upf_1", "interface": "N4"},
    ],
    "type": "link_packet_loss",
    "start_minute": FAULT_MIN,
}

# 背景噪声：(网元类型, 原因码, 每实例每分钟条数, 用户选择器)
NOISE = [
    ("AMF", "MM-1102", 25, "weak_ran"),
    ("AMF", "MM-1201", 30, "any"),
    ("AMF", "MM-1301", 5, "group:wrong_dnn"),
    ("AMF", "MM-1021", 3, "tac"),
    ("AMF", "MM-1401", 4, "any"),
    ("AMF", "MM-1306", 0.4, "any"),
    ("AMF", "MM-1018", 1, "any"),
    ("AMF", "MM-1105", 0.5, "any"),
    ("SMF", "SM-2001", 1.5, "group:wrong_dnn_smf"),
    ("SMF", "SM-2003", 1.5, "group:dn_auth"),
    ("SMF", "SM-2005", 1, "any"),
    ("SMF", "SM-2007", 6, "weak_ran"),
    ("SMF", "SM-2101", 0.6, "any"),
    ("SMF", "SM-2201", 0.6, "any"),
    ("SMF", "SM-2210", 0.3, "any"),
    ("SMF", "SM-2211", 0.4, "any"),
    ("SMF", "SM-2401", 18, "any"),
    ("AUSF", "AU-3001", 0.5, "any"),
    ("AUSF", "AU-3002", 3, "any"),
    ("UDM", "UD-4001", 6, "group:unsub"),
    ("UDM", "UD-4002", 1, "any"),
    ("UDM", "UD-4010", 1, "any"),
    ("PCF", "PC-5001", 1.5, "any"),
    ("PCF", "PC-5002", 1, "any"),
    ("PCF", "PC-5010", 3, "any"),
    ("UPF", "UP-6001", 0.5, "any"),
    ("UPF", "UP-6003", 2, "any"),
    ("UPF", "UP-6005", 0.3, "any"),
]

# 故障注入：(原因码, 每分钟条数, 受影响用户需满足的途经网元)
FAULT_SOURCES = [
    ("SM-2101", 22, {"smf": "SMF:smf_2", "pcf": "PCF:pcf_2"}),
    ("SM-2201", 12, {"smf": "SMF:smf_2", "upf": "UPF:upf_1"}),
    ("SM-2211", 13, {"smf": "SMF:smf_2", "upf": "UPF:upf_1"}),
    ("SM-2210", 6, {"smf": "SMF:smf_2", "upf": "UPF:upf_1"}),
]
RETRY_PROB = 0.3          # 失败后 UE 重试并再次失败的概率
MAX_RETRY = 2

# 瞬时毛刺：单基站闪断引发的集中重注册失败，持续约 100 秒，不应触发告警
BURST = {"cause": "MM-1018", "instance": "AMF:amf_1", "start_s": 11 * 60 + 20, "end_s": 13 * 60, "rate_per_s": 0.5,
         "gnb": "gNB_1017"}

COMMON_COLS = ["Timestamp", "Inner_Cause", "Procedure", "IMSI", "NE_Instance", "RAN_ID", "CELL_ID", "TAC", "POD_ID"]
EXTRA_COLS = {
    "AMF": ["Last_AMF_ID", "Last_SMF_ID", "Last_AUSF_ID", "Last_UDM_ID", "Last_PCF_ID"],
    "SMF": ["Serving_AMF_ID", "Serving_UDM_ID", "Serving_PCF_ID", "Serving_UPF_ID"],
}


class Simulator:
    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        self.records: dict[str, list[dict]] = {t: [] for t in cat.NF_TYPES}
        self._build_users()

    # ------------------------------------------------------------ 用户与无线侧
    def _build_users(self):
        rng = self.rng
        gnbs = [f"gNB_{1001 + i}" for i in range(N_GNB)]
        weights = rng.dirichlet(np.full(N_GNB, 30.0))
        gi = rng.choice(N_GNB, size=N_USERS, p=weights)
        self.u_ran = np.array(gnbs)[gi]
        self.u_cell = np.array([f"{gnbs[g]}-C{c}" for g, c in zip(gi, rng.integers(1, 4, N_USERS))])
        self.u_tac = np.array([f"TAC_{4101 + g // GNB_PER_TAC}" for g in gi])
        self.u_imsi = np.array([f"46000{1230000000 + i * 3 + 7:010d}" for i in range(N_USERS)])
        self.u = {}
        for t in ("AMF", "SMF", "PCF", "UPF"):
            self.u[t.lower()] = np.array(cat.instances(t))[rng.integers(0, cat.INSTANCES_PER_TYPE, N_USERS)]
        self.all_idx = np.arange(N_USERS)
        self.pool = {i: np.flatnonzero(self.u[t.lower()] == i)
                     for t in ("AMF", "SMF", "PCF", "UPF") for i in cat.instances(t)}
        self.groups = {
            "wrong_dnn": rng.choice(N_USERS, 80, replace=False),
            "wrong_dnn_smf": rng.choice(N_USERS, 60, replace=False),
            "dn_auth": rng.choice(N_USERS, 40, replace=False),
            "unsub": rng.choice(N_USERS, 40, replace=False),
        }
        self.weak_users = np.flatnonzero(np.isin(self.u_ran, ["gNB_1006", "gNB_1023", "gNB_1031"]))
        self.tac_users = np.flatnonzero(self.u_tac == "TAC_4108")

    def _pool_for(self, nf_type: str, instance: str) -> np.ndarray:
        return self.pool.get(instance, self.all_idx)

    def _pick_user(self, nf_type: str, instance: str, selector: str) -> int:
        rng = self.rng
        pool = self._pool_for(nf_type, instance)
        cand = None
        if selector.startswith("group:"):
            cand = np.intersect1d(self.groups[selector[6:]], pool)
        elif selector == "weak_ran" and rng.random() < 0.3:
            cand = np.intersect1d(self.weak_users, pool)
        elif selector == "tac" and rng.random() < 0.8:
            cand = np.intersect1d(self.tac_users, pool)
        if cand is None or len(cand) == 0:
            cand = pool
        return int(cand[rng.integers(0, len(cand))])

    # ------------------------------------------------------------ 记录写入
    def _emit(self, code: str, instance: str, user: int, sec: int, ctx: dict):
        """写入一条 CHR，并按知识图谱的传导关系向上游网元生成关联 CHR。"""
        if sec >= DURATION_MIN * 60:
            return
        rng = self.rng
        c = cat.CAUSE_BY_CODE[code]
        nf = c["nf"]
        ctx = {**ctx, nf: instance}
        short = instance.split(":")[1]
        row = {
            "Timestamp": (START + timedelta(seconds=int(sec))).strftime("%Y-%m-%d %H:%M:%S"),
            "Inner_Cause": code, "Procedure": c["procedure"], "IMSI": self.u_imsi[user],
            "NE_Instance": instance, "RAN_ID": self.u_ran[user], "CELL_ID": self.u_cell[user],
            "TAC": self.u_tac[user], "POD_ID": f"{short}-pod-{rng.integers(1, cat.PODS_PER_INSTANCE + 1)}",
        }
        if nf in EXTRA_COLS:
            prefix = "Last" if nf == "AMF" else "Serving"
            for col in EXTRA_COLS[nf]:
                row[col] = ""
            for peer in c["peers"]:
                row[f"{prefix}_{peer}_ID"] = self._peer_value(nf, peer, instance, user, ctx)
            ctx = {**ctx, **{p: row[f"{prefix}_{p}_ID"] for p in c["peers"]}}
        self.records[nf].append(row)

        # 向上游传导（多个上游互斥）
        r = rng.random()
        acc = 0.0
        for up_code, prob in c["propagates_to"]:
            acc += prob
            if r < acc:
                up_nf = cat.CAUSE_BY_CODE[up_code]["nf"]
                up_inst = self.u[up_nf.lower()][user]
                self._emit(up_code, up_inst, user, sec + int(rng.integers(0, 2)), ctx)
                break

    def _peer_value(self, nf: str, peer: str, instance: str, user: int, ctx: dict) -> str:
        if peer == nf:
            return instance
        am_pcf = nf == "AMF" and peer == "PCF"      # AMF 侧的 PCF 是接入策略 PCF，与会话 PCF 无关
        if peer in ctx and not am_pcf:
            return ctx[peer]
        if peer.lower() in self.u and not am_pcf:
            return self.u[peer.lower()][user]
        return cat.instances(peer)[self.rng.integers(0, cat.INSTANCES_PER_TYPE)]

    # ------------------------------------------------------------ 流量生成
    def run(self):
        rng = self.rng
        for nf, code, rate, selector in NOISE:
            for instance in cat.instances(nf):
                for minute in range(DURATION_MIN):
                    for _ in range(rng.poisson(rate)):
                        user = self._pick_user(nf, instance, selector)
                        self._emit(code, instance, user, minute * 60 + int(rng.integers(0, 60)), {})

        # 瞬时毛刺
        b = BURST
        users = np.intersect1d(np.flatnonzero(self.u_ran == b["gnb"]), self.pool[b["instance"]])
        for sec in range(b["start_s"], b["end_s"]):
            for _ in range(rng.poisson(b["rate_per_s"])):
                self._emit(b["cause"], b["instance"], int(users[rng.integers(0, len(users))]), sec, {})

        # 故障注入
        for code, rate, cond in FAULT_SOURCES:
            mask = np.ones(N_USERS, dtype=bool)
            for k, v in cond.items():
                mask &= self.u[k] == v
            affected = np.flatnonzero(mask)
            instance = cond["smf"]
            for minute in range(FAULT_MIN, DURATION_MIN):
                for _ in range(rng.poisson(rate)):
                    user = int(affected[rng.integers(0, len(affected))])
                    sec = minute * 60 + int(rng.integers(0, 60))
                    self._emit(code, instance, user, sec, {})
                    for _ in range(MAX_RETRY):
                        if rng.random() >= RETRY_PROB:
                            break
                        sec += int(rng.integers(4, 13))
                        self._emit(code, instance, user, sec, {})

    # ------------------------------------------------------------ 输出
    def write_chr(self, out: Path) -> dict:
        rng = self.rng
        (out / "data").mkdir(parents=True, exist_ok=True)
        stats = {}
        for nf, rows in self.records.items():
            rows.sort(key=lambda r: r["Timestamp"])
            cols = COMMON_COLS + EXTRA_COLS.get(nf, [])
            dirty = []
            for row in rows:
                row = dict(row)
                r = rng.random()
                if r < 0.0005:
                    row["Inner_Cause"] = ""                       # 原因码缺失
                elif r < 0.001:
                    row["Timestamp"] = "N/A"                      # 时间戳非法
                elif r < 0.006:
                    row["IMSI"] = ""                              # 用户标识未知（保留）
                elif r < 0.016:
                    row["NE_Instance"] = row["NE_Instance"].split(":")[1] + " "   # 简写 + 多余空格
                dirty.append(row)
                if rng.random() < 0.003:
                    dirty.append(dict(row))                       # 重复上报
            with open(out / "data" / f"chr_{nf.lower()}.csv", "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=cols)
                w.writeheader()
                w.writerows(dirty)
            stats[nf] = len(dirty)
        return stats


def write_topo(out: Path) -> int:
    (out / "topo").mkdir(parents=True, exist_ok=True)
    edges = [(s, t) for (a, b) in cat.INTERFACES for s in cat.instances(a) for t in cat.instances(b)]
    with open(out / "topo" / "topo.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["source", "target"])
        w.writerows(edges)
    return len(edges)


def build_kg() -> dict:
    nodes, edges, seen = [], [], set()

    def add(node):
        if node["id"] not in seen:
            seen.add(node["id"])
            nodes.append(node)

    for t in cat.NF_TYPES:
        add({"id": f"nf:{t}", "type": "NFType", "name": t})
    for (a, b), name in cat.INTERFACES.items():
        add({"id": f"if:{name}", "type": "Interface", "name": name, "between": [a, b]})
    for p in cat.PROCEDURES:
        add({"id": f"proc:{p}", "type": "Procedure", "name": p})
    for c in cat.CAUSES:
        cid = f"cause:{c['code']}"
        add({"id": cid, "type": "CauseCode", "code": c["code"], "name": c["name"], "nf_type": c["nf"],
             "procedure": c["procedure"], "interface": c["interface"], "protocol": c["protocol"],
             "code_ref": c["code_ref"], "desc": c["desc"]})
        edges.append({"source": cid, "relation": "RAISED_BY", "target": f"nf:{c['nf']}"})
        edges.append({"source": cid, "relation": "OCCURS_IN", "target": f"proc:{c['procedure']}"})
        if f"if:{c['interface']}" in seen:
            edges.append({"source": cid, "relation": "ON_INTERFACE", "target": f"if:{c['interface']}"})
        for scn, weight, condition in c["scenarios"]:
            add(scn)
            edges.append({"source": cid, "relation": "CAUSED_BY", "target": scn["id"],
                          "weight": weight, "condition": condition})
        for up, prob in c["propagates_to"]:
            edges.append({"source": cid, "relation": "PROPAGATES_TO", "target": f"cause:{up}", "prob": prob})
    return {
        "meta": {"version": "sim-0.1", "source": "simulator/catalog.py（示例，后续由产品代码分析结果替换）",
                 "relations": ["RAISED_BY", "OCCURS_IN", "ON_INTERFACE", "CAUSED_BY", "PROPAGATES_TO"]},
        "nodes": nodes, "edges": edges,
    }


def main():
    ap = argparse.ArgumentParser(description="生成仿真拓扑、CHR 与知识图谱")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=ROOT)
    args = ap.parse_args()

    n_edges = write_topo(args.out)
    kg = build_kg()
    kg_dir = args.out / "chr-knowledge-graph"
    kg_dir.mkdir(parents=True, exist_ok=True)
    (kg_dir / "graph.json").write_text(json.dumps(kg, ensure_ascii=False, indent=1), encoding="utf-8")

    sim = Simulator(args.seed)
    sim.run()
    stats = sim.write_chr(args.out)
    truth = {"seed": args.seed, "start": START.isoformat(sep=" "), "duration_min": DURATION_MIN, "fault": FAULT,
             "note": "仅用于说明与测试，后端分析不读取本文件"}
    (args.out / "data" / "scenario_truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"topo: {n_edges} edges | kg: {len(kg['nodes'])} nodes, {len(kg['edges'])} edges")
    print("chr rows:", stats, "total", sum(stats.values()))


if __name__ == "__main__":
    main()
