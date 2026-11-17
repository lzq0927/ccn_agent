"""运行器：后台线程驱动引擎，并把事件广播给所有前端连接。

两种运行方式：
  StepRunner      默认。按数据时间推进：读取 data 目录中的 CHR，每 step_seconds 秒（默认 1 秒）推进 1 分钟；
                  支持开始、暂停、继续、重新开始。
                  流程有两种方式：交互（默认）——感知到异常后等待确认才开始分析，分析完成后等待确认才进入
                  决策执行；自动——各阶段连续执行，不等待。
  RealtimeRunner  按服务器真实时间每分钟处理一次，增量读取持续追加的 CHR 文件（python -m backend --realtime）。

运行器维护一份“当前状态快照”，新连接的前端先拿到快照，再接收后续事件。
"""
from __future__ import annotations

import queue
import threading
import time
from collections import deque
from datetime import datetime

import pandas as pd

from .config import Settings
from .engine import Engine
from .perception.preprocess import RAW_COLS, read_raw
from .source import CsvTailSource

ANALYSIS_KEYS = ("perception", "flows", "clustering", "kg", "crossval", "agent", "conclusion")


class BaseRunner:
    mode = ""

    def __init__(self, settings: Settings | None = None):
        self.s = settings or Settings()
        self._lock = threading.Lock()
        self._subs: set[queue.Queue] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.next_at = 0.0                 # 下次感知的时刻（epoch 秒），仅真实时间方式使用
        self.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.engine: Engine | None = None
        self.state = self._empty_state()

    # ------------------------------------------------------------ 状态快照
    def _empty_state(self) -> dict:
        return {"steps": {}, "activeStage": "perception", "logs": deque(maxlen=self.s.log_keep),
                "agentLogs": deque(maxlen=self.s.log_keep), "tick": None,
                "trend": deque(maxlen=self.s.trend_minutes), "incident": None, "incidents": deque(maxlen=20),
                "run": {"mode": self.mode, "status": "running", "minute": 0, "total": None, "time": None,
                        "flow": "auto", "pending": None},
                **{k: None for k in ANALYSIS_KEYS}}

    def _apply(self, ev: dict) -> None:
        st = self.state
        t = ev["type"]
        if t == "step":
            st["steps"][f"{ev['stage']}.{ev['step']}"] = ev["status"]
            if ev["status"] == "running":
                st["activeStage"] = ev["stage"]
        elif t == "log":
            line = {k: ev[k] for k in ("channel", "stage", "time", "level", "text")}
            (st["agentLogs"] if ev["channel"] == "agent" else st["logs"]).append(line)
        elif t == "tick":
            st["tick"] = ev
            st["trend"].append({"label": ev["trend_point"]["label"], "total": ev["trend_point"]["total"]})
        elif t == "result":
            st[ev["key"]] = ev["data"]
        elif t == "run":
            st["run"] = ev["run"]
        elif t == "incident":
            if ev["event"] == "opened":
                for k in ANALYSIS_KEYS:
                    st[k] = None
                st["steps"] = {k: v for k, v in st["steps"].items() if k.startswith("perception.")}
            st["incident"] = ev["incident"]
            if ev["event"] == "recovered":
                st["incidents"].appendleft(ev["incident"])

    def _snapshot_locked(self) -> dict:
        st = self.state
        return {"type": "snapshot", "next_in": max(0.0, self.next_at - time.time()) if self.next_at else None,
                **{k: (list(v) if isinstance(v, deque) else v) for k, v in st.items()}}

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_locked()

    def emit(self, ev: dict) -> None:
        ev = {k: v for k, v in ev.items() if k != "delay"}
        if ev["type"] == "tick" and self.next_at:
            ev["next_in"] = max(0.0, self.next_at - time.time())
        with self._lock:
            self._apply(ev)
            for q in self._subs:
                q.put(ev)

    def subscribe(self) -> tuple[queue.Queue, dict]:
        """注册一个前端连接。返回 (事件队列, 当前快照)，两者在同一把锁内取得，保证不丢不重。"""
        q: queue.Queue = queue.Queue()
        with self._lock:
            snap = self._snapshot_locked()
            self._subs.add(q)
        return q, snap

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._subs.discard(q)

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="ccn-runner", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def control(self, action: str) -> dict:
        return self.state["run"]

    def files(self) -> list[str]:
        return []

    def _run(self) -> None:
        raise NotImplementedError


class StepRunner(BaseRunner):
    """按数据时间推进：每 step_seconds 秒处理 1 分钟的 CHR。启动后等待“开始”。"""
    mode = "step"

    def __init__(self, settings: Settings | None = None, flow: str = "interactive"):
        super().__init__(settings)
        self.flow = "auto" if flow == "auto" else "interactive"
        self.pending: str | None = None    # 正在等待确认的闸门：analysis | decision
        self.raw = read_raw(self.s.data_dir)
        self.t0 = self.raw["arrival"].min().floor("min")
        self.raw["arrival_minute"] = ((self.raw["arrival"] - self.t0).dt.total_seconds() // 60).astype(int)
        self.n_minutes = int(self.raw["arrival_minute"].max()) + 1
        self._files = sorted(self.raw["source_file"].unique())
        self.status = "idle"               # idle | running | paused | finished
        self.pos = 0                       # 下一个待处理的分钟
        self._restart = False
        self._reset()

    def files(self) -> list[str]:
        return self._files

    def _run_info(self) -> dict:
        return {"mode": self.mode, "status": self.status, "minute": self.pos, "total": self.n_minutes,
                "time": self.engine.hhmm(self.pos), "flow": self.flow, "pending": self.pending}

    def _reset(self) -> None:
        """回到起点：重建引擎与状态，并把新的快照推给所有已连接的前端。"""
        self.engine = Engine(self.s, self.t0)
        self.pos = 0
        self.pending = None
        with self._lock:
            self.state = self._empty_state()
            self.state["run"] = self._run_info()
            for ev in self.engine.startup_events(0, self._files):
                self._apply({k: v for k, v in ev.items() if k != "delay"})
            snap = self._snapshot_locked()
            for q in self._subs:
                q.put(snap)

    def _publish_run(self) -> None:
        self.emit({"type": "run", "run": self._run_info()})

    def control(self, action: str) -> dict:
        if action in ("start", "resume") and self.status in ("idle", "paused"):
            self.status = "running"
        elif action == "pause" and self.status == "running":
            self.status = "paused"
        elif action == "restart":
            self._restart = True
        elif action == "proceed" and self.pending:
            self.pending = None                 # 主循环发现闸门已放行后继续
            return self._run_info()
        elif action in ("interactive", "auto"):
            self.flow = action                  # 切到自动时，正在等待的闸门随即放行
        else:
            return self._run_info()
        if action != "restart":
            self._publish_run()
        return self._run_info()

    GATE_TEXT = {"analysis": ("感知", "感知到异常，等待确认后开始分析", "已确认，开始分析"),
                 "decision": ("分析", "分析完成，等待确认后进入决策执行", "已确认，进入决策执行")}

    def _wait_gate(self, gate: str) -> None:
        """交互方式下在阶段交界处等待确认；自动方式直接通过。"""
        if self.flow != "interactive":
            return
        stage, waiting, confirmed = self.GATE_TEXT[gate]
        self.pending = gate
        self.emit(self.engine._log(stage, self.pos + 1, waiting, "warn"))
        self._publish_run()
        while self.pending and self.flow == "interactive" and not self._restart and not self._stop.is_set():
            self._stop.wait(0.05)
        self.pending = None
        if not self._restart and not self._stop.is_set():
            self.emit(self.engine._log(stage, self.pos + 1, confirmed if self.flow == "interactive" else "已切换为自动，继续执行"))
            self._publish_run()

    def _run(self) -> None:
        s = self.s
        while not self._stop.is_set():
            if self._restart:
                self._restart = False
                self.status = "running"
                self._reset()
            if self.status != "running":
                self._stop.wait(0.05)
                continue
            if self.pos >= self.n_minutes:
                self.status = "finished"
                self.emit(self.engine._log("系统", self.pos, "数据已全部处理完", "ok"))
                self._publish_run()
                continue
            began = time.time()
            aborted = False
            try:
                for ev in self.engine.process_minute(self.pos, self.raw[self.raw["arrival_minute"] == self.pos]):
                    while self.status == "paused" and not self._restart and not self._stop.is_set():
                        self._stop.wait(0.05)             # 暂停时停在当前步骤
                    if ev["type"] == "gate":
                        self._wait_gate(ev["gate"])
                    if self._restart or self._stop.is_set():
                        aborted = True
                        break
                    if ev["type"] == "gate":
                        continue
                    delay = ev.get("delay", 0)
                    self.emit(ev)
                    if delay and s.step_seconds > 0:
                        time.sleep(delay)
            except Exception as exc:  # 单次处理失败不应中断运行
                self.emit(self.engine._log("系统", self.pos + 1, f"本分钟处理失败：{type(exc).__name__}: {exc}", "alert"))
            if aborted:
                continue
            self.pos += 1
            self._publish_run()
            remain = s.step_seconds - (time.time() - began)
            if remain > 0:
                self._stop.wait(remain)


class RealtimeRunner(BaseRunner):
    """按服务器真实时间每分钟处理一次。

    时间以服务器本地时钟为准，CHR 的时间戳应为同一时区的本地时间。
    每分钟结束后等待 tick_grace_s 秒（容纳晚到的记录），再处理刚结束的这一分钟。
    启动时先用数据源里最近 2 个滑窗时长的历史数据预热基线，不产生告警；之后进入实时循环。
    """
    mode = "realtime"

    def __init__(self, settings: Settings | None = None):
        super().__init__(settings)
        # 分钟序号起点取昨天零点，保证预热用到的历史分钟序号非负
        self.t0 = pd.Timestamp(datetime.now()).floor("D") - pd.Timedelta(days=1)
        self.engine = Engine(self.s, self.t0)
        self.source = CsvTailSource(self.s.data_dir)
        self.pending = pd.DataFrame(columns=RAW_COLS + ["_minute"])

    def files(self) -> list[str]:
        return self.source.files()

    def _minute_of(self, when: datetime) -> int:
        return int((pd.Timestamp(when) - self.t0).total_seconds() // 60)

    def _poll(self) -> None:
        new = self.source.poll()
        if new.empty:
            return
        ts = pd.to_datetime(new["ts"], errors="coerce", format="%Y-%m-%d %H:%M:%S")
        new["_minute"] = ((ts - self.t0).dt.total_seconds() // 60)
        self.pending = pd.concat([self.pending, new], ignore_index=True)

    def _take(self, minute: int, with_invalid: bool = True) -> pd.DataFrame:
        """取出属于 minute 的记录；时间戳非法的记录随当前分钟交给预处理统计；更早的迟到记录丢弃。"""
        p = self.pending
        mine = p[(p["_minute"] == minute) | (p["_minute"].isna() & with_invalid)]
        self.pending = p[(p["_minute"] > minute) | (p["_minute"].isna() & (not with_invalid))]
        return mine[RAW_COLS]

    def _run(self) -> None:
        s = self.s
        now_minute = self._minute_of(datetime.now())
        self._poll()
        # 预热：最近 2 个滑窗时长内、已完整结束的分钟
        self.pending = self.pending[self.pending["_minute"].notna() & (self.pending["_minute"] >= now_minute - 2 * s.window_min)]
        warmed = 0
        for m in range(now_minute - 2 * s.window_min, now_minute):
            chunk = self._take(m, with_invalid=False)
            if len(chunk) or self.engine.first_minute is not None:
                try:
                    self.engine.warm(m, chunk)
                    warmed += 1
                except Exception:              # 历史数据异常不应阻止服务启动
                    pass
        if len(self.engine.buf):
            per_minute = self.engine.buf.groupby("minute").size()
            first = max(int(per_minute.index.min()), now_minute - s.trend_minutes)
            for m in range(first, now_minute):
                self.state["trend"].append({"label": self.engine.hhmm(m), "total": int(per_minute.get(m, 0))})
        for ev in self.engine.startup_events(now_minute, self.source.files()):
            self.emit(ev)
        self.emit(self.engine._log("系统", now_minute, f"已用最近 {warmed} 分钟的历史数据预热基线，进入实时感知" if warmed
                                   else "数据源暂无近期历史数据，基线将随实时数据逐步建立"))
        nxt = now_minute                      # 下一个待处理的分钟
        while not self._stop.is_set():
            # t0 是本地时间的朴素时间戳，to_pydatetime().timestamp() 按本地时区换算成 epoch
            due = (self.t0 + pd.Timedelta(minutes=nxt + 1)).to_pydatetime().timestamp() + s.tick_grace_s
            self.next_at = due
            while time.time() < due:
                if self._stop.wait(min(1.0, max(0.05, due - time.time()))):
                    return
            self.next_at = due + 60
            try:
                self._poll()
                for ev in self.engine.process_minute(nxt, self._take(nxt)):
                    if ev["type"] == "gate":            # 真实时间方式不等待确认
                        continue
                    delay = ev.get("delay", 0)
                    self.emit(ev)
                    if delay:
                        time.sleep(delay)
            except Exception as exc:  # 单次处理失败不应中断长期运行
                self.emit(self.engine._log("系统", nxt + 1, f"本分钟处理失败：{type(exc).__name__}: {exc}", "alert"))
            nxt += 1


def create_runner(settings: Settings | None = None, mode: str = "step", flow: str = "interactive") -> BaseRunner:
    return RealtimeRunner(settings) if mode == "realtime" else StepRunner(settings, flow)
