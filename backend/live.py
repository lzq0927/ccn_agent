"""实时运行器：后台线程按真实时间每分钟驱动一次引擎，并把事件广播给所有前端连接。

时间以服务器本地时钟为准，CHR 的时间戳应为同一时区的本地时间。
每分钟结束后等待 tick_grace_s 秒（容纳晚到的记录），再处理刚结束的这一分钟。
启动时先用数据源里最近 2 个滑窗时长的历史数据预热基线，不产生告警；之后进入实时循环。
运行器同时维护一份“当前状态快照”，新连接的前端先拿到快照，再接收后续事件。
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
from .perception.preprocess import RAW_COLS
from .source import CsvTailSource

ANALYSIS_KEYS = ("perception", "flows", "clustering", "kg", "crossval", "agent", "conclusion")


class LiveRunner:
    def __init__(self, settings: Settings | None = None):
        self.s = settings or Settings()
        # 分钟序号起点取昨天零点，保证预热用到的历史分钟序号非负
        self.t0 = pd.Timestamp(datetime.now()).floor("D") - pd.Timedelta(days=1)
        self.engine = Engine(self.s, self.t0)
        self.source = CsvTailSource(self.s.data_dir)
        self.pending = pd.DataFrame(columns=RAW_COLS + ["_minute"])
        self._lock = threading.Lock()
        self._subs: set[queue.Queue] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.next_at = 0.0                 # 下次感知的时刻（epoch 秒）
        self.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.state = self._empty_state()

    # ------------------------------------------------------------ 状态快照
    def _empty_state(self) -> dict:
        return {"steps": {}, "activeStage": "perception", "logs": deque(maxlen=self.s.log_keep),
                "agentLogs": deque(maxlen=self.s.log_keep), "tick": None,
                "trend": deque(maxlen=self.s.trend_minutes), "incident": None, "incidents": deque(maxlen=20),
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
        elif t == "incident":
            if ev["event"] == "opened":
                for k in ANALYSIS_KEYS:
                    st[k] = None
                st["steps"] = {k: v for k, v in st["steps"].items() if k.startswith("perception.")}
            st["incident"] = ev["incident"]
            if ev["event"] == "recovered":
                st["incidents"].appendleft(ev["incident"])

    def snapshot(self) -> dict:
        with self._lock:
            st = self.state
            return {"type": "snapshot", "next_in": max(0.0, self.next_at - time.time()),
                    **{k: (list(v) if isinstance(v, deque) else v) for k, v in st.items()}}

    def emit(self, ev: dict) -> None:
        ev = {k: v for k, v in ev.items() if k != "delay"}
        if ev["type"] == "tick":
            ev["next_in"] = max(0.0, self.next_at - time.time())
        with self._lock:
            self._apply(ev)
            for q in self._subs:
                q.put(ev)

    def subscribe(self) -> tuple[queue.Queue, dict]:
        """注册一个前端连接。返回 (事件队列, 当前快照)，两者在同一把锁内取得，保证不丢不重。"""
        q: queue.Queue = queue.Queue()
        with self._lock:
            st = self.state
            snap = {"type": "snapshot", "next_in": max(0.0, self.next_at - time.time()),
                    **{k: (list(v) if isinstance(v, deque) else v) for k, v in st.items()}}
            self._subs.add(q)
        return q, snap

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._subs.discard(q)

    # ------------------------------------------------------------ 时间与数据
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

    # ------------------------------------------------------------ 主循环
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="ccn-live", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

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
                    delay = ev.get("delay", 0)
                    self.emit(ev)
                    if delay:
                        time.sleep(delay)
            except Exception as exc:  # 单次处理失败不应中断长期运行
                self.emit(self.engine._log("系统", nxt + 1, f"本分钟处理失败：{type(exc).__name__}: {exc}", "alert"))
            nxt += 1
