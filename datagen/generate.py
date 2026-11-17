"""测试数据生成器：拓扑、CHR、知识图谱。

    python -m datagen.generate                       # 批量：40 分钟样例数据写入仓库 data/、topo/、chr-knowledge-graph/
    python -m datagen.generate --live --out runtime  # 持续：按真实时间逐秒追加 CHR 到 runtime/data/，供实时运行联调

批量样例：第 20 分钟起 SMF:smf_2 后端部分链路丢包（N7 -> PCF:pcf_2，N4 -> UPF:upf_1），其余后端链路正常。
持续模式：先补写一段历史（--backfill 分钟），之后实时追加；--fault-after 指定启动后第几分钟注入同样的故障
（可为负数，表示故障在历史段内已经开始），--fault-duration 指定故障持续分钟数（0 表示不恢复）。
"""
from __future__ import annotations

import argparse
import csv
import json
import time
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
BURST = {"cause": "MM-1018", "instance": "AMF:amf_1", "start_s": 11 * 60 + 20, "duration_s": 100, "rate_per_s": 0.5,
         "gnb": "gNB_1017"}

COMMON_COLS = ["Timestamp", "Inner_Cause", "Procedure", "IMSI", "NE_Instance", "RAN_ID", "CELL_ID", "TAC", "POD_ID"]
EXTRA_COLS = {
    "AMF": ["Last_AMF_ID", "Last_SMF_ID", "Last_AUSF_ID", "Last_UDM_ID", "Last_PCF_ID"],
    "SMF": ["Serving_AMF_ID", "Serving_UDM_ID", "Serving_PCF_ID", "Serving_UPF_ID"],
}


class Generator:
    """按分钟生成 CHR。start 为第 0 分钟的时刻；fault_from/fault_to 为故障起止分钟（左闭右开，None 表示无）。"""

    def __init__(self, seed: int, start: datetime, fault_from: int | None = None, fault_to: int | None = None,
                 burst_start_s: int | None = None, end_min: int | None = None):
        self.rng = np.random.default_rng(seed)
        self.start = start
        self.fault_from, self.fault_to = fault_from, fault_to
        self.burst_start_s = burst_start_s
        self.end_sec = end_min * 60 if end_min is not None else None
        self.pending: dict[str, list[dict]] = {t: [] for t in cat.NF_TYPES}
        self._build_users()
        self._fault_pools = []
        for code, rate, cond in FAULT_SOURCES:
            mask = np.ones(N_USERS, dtype=bool)
            for k, v in cond.items():
                mask &= self.u[k] == v
            self._fault_pools.append((code, rate, cond["smf"], np.flatnonzero(mask)))
        self._burst_users = np.intersect1d(np.flatnonzero(self.u_ran == BURST["gnb"]), self.pool[BURST["instance"]])

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

    def _pick_user(self, instance: str, selector: str) -> int:
        rng = self.rng
        pool = self.pool.get(instance, self.all_idx)
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

    # ------------------------------------------------------------ 记录生成
    def _emit(self, code: str, instance: str, user: int, sec: int, ctx: dict):
        """生成一条 CHR，并按知识图谱的传导关系向上游网元生成关联 CHR。"""
        if self.end_sec is not None and sec >= self.end_sec:
            return
        rng = self.rng
        c = cat.CAUSE_BY_CODE[code]
        nf = c["nf"]
        ctx = {**ctx, nf: instance}
        short = instance.split(":")[1]
        row = {
            "_sec": int(sec),
            "Timestamp": (self.start + timedelta(seconds=int(sec))).strftime("%Y-%m-%d %H:%M:%S"),
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
        self.pending[nf].append(row)

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

    def gen_minute(self, minute: int) -> None:
        """生成第 minute 分钟内发生的全部 CHR（传导与重试可能落到下一分钟）。"""
        rng = self.rng
        base = minute * 60
        for nf, code, rate, selector in NOISE:
            for instance in cat.instances(nf):
                for _ in range(rng.poisson(rate)):
                    self._emit(code, instance, self._pick_user(instance, selector), base + int(rng.integers(0, 60)), {})

        if self.burst_start_s is not None:              # 瞬时毛刺
            lo, hi = self.burst_start_s, self.burst_start_s + BURST["duration_s"]
            for sec in range(max(base, lo), min(base + 60, hi)):
                for _ in range(rng.poisson(BURST["rate_per_s"])):
                    user = int(self._burst_users[rng.integers(0, len(self._burst_users))])
                    self._emit(BURST["cause"], BURST["instance"], user, sec, {})

        in_fault = self.fault_from is not None and minute >= self.fault_from and (self.fault_to is None or minute < self.fault_to)
        if in_fault:
            for code, rate, instance, affected in self._fault_pools:
                for _ in range(rng.poisson(rate)):
                    user = int(affected[rng.integers(0, len(affected))])
                    sec = base + int(rng.integers(0, 60))
                    self._emit(code, instance, user, sec, {})
                    for _ in range(MAX_RETRY):
                        if rng.random() >= RETRY_PROB:
                            break
                        sec += int(rng.integers(4, 13))
                        self._emit(code, instance, user, sec, {})

    def take(self, until_sec: int | None = None) -> dict[str, list[dict]]:
        """取出发生时刻早于 until_sec 的记录（按时间排序），None 表示全部。"""
        out = {}
        for nf, rows in self.pending.items():
            ready = [r for r in rows if until_sec is None or r["_sec"] < until_sec]
            self.pending[nf] = [r for r in rows if until_sec is not None and r["_sec"] >= until_sec]
            out[nf] = sorted(ready, key=lambda r: r["_sec"])
        return out

    def dirty(self, row: dict) -> list[dict]:
        """按小概率注入脏数据：缺字段、非法时间戳、实例名简写、重复上报。"""
        rng = self.rng
        row = {k: v for k, v in row.items() if k != "_sec"}
        r = rng.random()
        if r < 0.0005:
            row["Inner_Cause"] = ""
        elif r < 0.001:
            row["Timestamp"] = "N/A"
        elif r < 0.006:
            row["IMSI"] = ""                              # 用户标识未知（保留）
        elif r < 0.016:
            row["NE_Instance"] = row["NE_Instance"].split(":")[1] + " "
        return [row, dict(row)] if rng.random() < 0.003 else [row]


def columns(nf: str) -> list[str]:
    return COMMON_COLS + EXTRA_COLS.get(nf, [])


def write_batch(gen: Generator, out: Path, minutes: int) -> dict:
    (out / "data").mkdir(parents=True, exist_ok=True)
    for minute in range(minutes):
        gen.gen_minute(minute)
    stats = {}
    for nf, rows in gen.take().items():
        lines = [d for row in rows for d in gen.dirty(row)]
        with open(out / "data" / f"chr_{nf.lower()}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=columns(nf))
            w.writeheader()
            w.writerows(lines)
        stats[nf] = len(lines)
    return stats


def run_live(seed: int, out: Path, backfill: int, fault_after: int | None, fault_duration: int) -> None:
    """按真实时间持续追加 CHR。Ctrl+C 结束。"""
    data = out / "data"
    data.mkdir(parents=True, exist_ok=True)
    start = datetime.now().replace(second=0, microsecond=0) - timedelta(minutes=backfill)
    fault_from = backfill + fault_after if fault_after is not None else None
    fault_to = fault_from + fault_duration if fault_from is not None and fault_duration > 0 else None
    gen = Generator(seed, start, fault_from, fault_to)
    files = {}
    for nf in cat.NF_TYPES:
        f = open(data / f"chr_{nf.lower()}.csv", "w", newline="", encoding="utf-8")
        w = csv.DictWriter(f, fieldnames=columns(nf))
        w.writeheader()
        files[nf] = (f, w)

    def flush(until_sec: int) -> int:
        n = 0
        for nf, rows in gen.take(until_sec).items():
            f, w = files[nf]
            for row in rows:
                lines = gen.dirty(row)
                w.writerows(lines)
                n += len(lines)
            f.flush()
        return n

    def describe(m):
        return (start + timedelta(minutes=m)).strftime("%H:%M")

    print(f"写入 {data}，历史 {backfill} 分钟（自 {describe(0)}）", flush=True)
    if fault_from is not None:
        print(f"故障 {describe(fault_from)} 开始" + (f"，{describe(fault_to)} 恢复" if fault_to is not None else "，不恢复"), flush=True)
    minute = 0
    try:
        while True:
            now_sec = int((datetime.now() - start).total_seconds())
            while minute * 60 <= now_sec:           # 进入新的一分钟时生成该分钟的记录
                gen.gen_minute(minute)
                minute += 1
            n = flush(now_sec + 1)
            if n and now_sec % 60 == 0:
                print(f"{datetime.now():%H:%M:%S} 追加中…", flush=True)
            time.sleep(1.0 - (datetime.now().microsecond / 1e6) + 0.02)
    except KeyboardInterrupt:
        pass
    finally:
        for f, _ in files.values():
            f.close()


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
        "meta": {"version": "0.1", "source": "样例图谱，由产品代码分析结果替换",
                 "relations": ["RAISED_BY", "OCCURS_IN", "ON_INTERFACE", "CAUSED_BY", "PROPAGATES_TO"]},
        "nodes": nodes, "edges": edges,
    }


def main():
    ap = argparse.ArgumentParser(description="生成测试用的拓扑、CHR 与知识图谱")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=ROOT)
    ap.add_argument("--live", action="store_true", help="按真实时间持续追加 CHR（只写 <out>/data）")
    ap.add_argument("--backfill", type=int, default=20, help="持续模式：先补写多少分钟历史")
    ap.add_argument("--fault-after", type=int, default=None, help="持续模式：启动后第几分钟注入故障，可为负；不指定则无故障")
    ap.add_argument("--fault-duration", type=int, default=0, help="持续模式：故障持续分钟数，0 表示不恢复")
    args = ap.parse_args()

    if args.live:
        run_live(args.seed, args.out, args.backfill, args.fault_after, args.fault_duration)
        return

    n_edges = write_topo(args.out)
    kg = build_kg()
    kg_dir = args.out / "chr-knowledge-graph"
    kg_dir.mkdir(parents=True, exist_ok=True)
    (kg_dir / "graph.json").write_text(json.dumps(kg, ensure_ascii=False, indent=1), encoding="utf-8")

    gen = Generator(args.seed, START, FAULT_MIN, None, BURST["start_s"], DURATION_MIN)
    stats = write_batch(gen, args.out, DURATION_MIN)
    truth = {"seed": args.seed, "start": START.isoformat(sep=" "), "duration_min": DURATION_MIN, "fault": FAULT,
             "note": "仅用于说明与测试，后端分析不读取本文件"}
    (args.out / "data" / "scenario_truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"topo: {n_edges} edges | kg: {len(kg['nodes'])} nodes, {len(kg['edges'])} edges")
    print("chr rows:", stats, "total", sum(stats.values()))


if __name__ == "__main__":
    main()
