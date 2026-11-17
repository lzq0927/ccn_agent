"""离线分析：把 data 目录中的 CHR 按分钟依次送入引擎，不停顿地输出同样的事件流。

用于命令行分析、算法验证和测试。带节拍与运行控制的方式见 runner.py。
"""
from __future__ import annotations

from typing import Iterator

from .config import Settings
from .engine import Engine
from .perception.preprocess import read_raw


class Pipeline:
    def __init__(self, settings: Settings | None = None):
        self.s = settings or Settings()
        self.raw = read_raw(self.s.data_dir)
        self.t0 = self.raw["arrival"].min().floor("min")
        self.raw["arrival_minute"] = ((self.raw["arrival"] - self.t0).dt.total_seconds() // 60).astype(int)
        self.n_minutes = int(self.raw["arrival_minute"].max()) + 1
        self.engine = Engine(self.s, self.t0)
        self.topo, self.kg = self.engine.topo, self.engine.kg

    def run(self) -> Iterator[dict]:
        files = sorted(self.raw["source_file"].unique())
        yield from self.engine.startup_events(0, files)
        for minute in range(self.n_minutes):
            yield from self.engine.process_minute(minute, self.raw[self.raw["arrival_minute"] == minute])
        yield {"type": "done", "incidents": len(self.engine.history) + (1 if self.engine.incident else 0), "delay": 0}
