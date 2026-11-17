"""真实时间方式的数据源：增量读取 data 目录下不断追加的 chr_*.csv。

各网元把 CHR 逐条追加到对应文件，这里记住每个文件已读到的位置，每次只取新增的完整行。
文件被截断或轮转（变小）时从头重读；新出现的文件自动纳入。
"""
from __future__ import annotations

import io
from pathlib import Path

import pandas as pd

from .perception.preprocess import RAW_COLS, normalize_columns


class CsvTailSource:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self._offset: dict[str, int] = {}
        self._header: dict[str, str] = {}

    def files(self) -> list[str]:
        return sorted(p.name for p in self.data_dir.glob("chr_*.csv"))

    def poll(self) -> pd.DataFrame:
        """返回自上次调用以来新增的原始 CHR（规范列名，全为字符串）。"""
        frames = []
        for path in sorted(self.data_dir.glob("chr_*.csv")):
            try:
                size = path.stat().st_size
                offset = self._offset.get(path.name, 0)
                if size < offset:                       # 文件被截断或轮转
                    offset = 0
                    self._header.pop(path.name, None)
                if size == offset:
                    continue
                with open(path, "rb") as f:
                    f.seek(offset)
                    data = f.read()
            except OSError:
                continue
            end = data.rfind(b"\n")
            if end < 0:                                 # 还没有完整的一行
                continue
            text = data[:end + 1].decode("utf-8", errors="replace")
            self._offset[path.name] = offset + end + 1
            if path.name not in self._header:
                header, _, text = text.partition("\n")
                self._header[path.name] = header.strip("\r")
            if not text.strip():
                continue
            df = pd.read_csv(io.StringIO(self._header[path.name] + "\n" + text), dtype=str, keep_default_na=False,
                             on_bad_lines="skip")
            frames.append(normalize_columns(df, path.name))
        if not frames:
            return pd.DataFrame(columns=RAW_COLS)
        return pd.concat(frames, ignore_index=True)
