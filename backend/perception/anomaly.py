"""时序异常检测（CHR 突增检测）。

粒度：网元实例 + 流程 + 原因码，每分钟一个计数点。

算法：稳健 Z-Score
  基线 mu    = 滑窗内“正常点”的中位数与均值取大（低计数序列中位数常为 0，取大可抑制误报）
  离散度 sigma = max(1.4826 * MAD, sqrt(mu), 1)   —— MAD 抗离群；sqrt(mu) 是计数数据的泊松下限
  突增点      : z = (x - mu) / sigma >= z_threshold 且 x - mu >= min_delta
已判为突增的点不参与后续基线估计；窗口内正常点不足时沿用上一次基线（基线冻结），
这样故障持续期间基线不会被故障数据抬高。

持续性：最近 sustain_n 分钟内至少 sustain_m 分钟为突增点，才认定该维度异常，
用于滤除瞬时毛刺并给后续分析积累足够数据。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import Settings


@dataclass
class Point:
    value: float
    baseline: float
    sigma: float
    z: float
    flagged: bool
    judged: bool


class SpikeDetector:
    def __init__(self, settings: Settings):
        self.s = settings
        self.flags: dict[str, set[int]] = {}             # series -> 被判为突增的分钟
        self.baseline: dict[str, tuple[float, float]] = {}  # series -> (mu, sigma)
        self.points: dict[str, dict[int, Point]] = {}    # series -> minute -> Point

    def update(self, counts: pd.DataFrame, minute: int) -> dict[str, Point]:
        """用窗口计数矩阵（index=series, columns=窗口内各分钟）评估最新一分钟。"""
        result = {}
        prev = [m for m in counts.columns if m < minute]
        values = counts.to_numpy(dtype=float)
        col = {m: i for i, m in enumerate(counts.columns)}
        for row, series in enumerate(counts.index):
            flagged = self.flags.setdefault(series, set())
            clean = [values[row, col[m]] for m in prev if m not in flagged]
            if len(clean) >= self.s.min_baseline_points:
                med = float(np.median(clean))
                mad = float(np.median(np.abs(np.asarray(clean) - med)))
                mu = max(med, float(np.mean(clean)))
                sigma = max(1.4826 * mad, np.sqrt(mu), 1.0)
                self.baseline[series] = (mu, sigma)
            x = values[row, col[minute]]
            if series in self.baseline:
                mu, sigma = self.baseline[series]
                z = (x - mu) / sigma
                is_spike = z >= self.s.z_threshold and (x - mu) >= self.s.min_delta
                p = Point(x, mu, sigma, float(z), bool(is_spike), True)
                if is_spike:
                    flagged.add(minute)
            else:
                p = Point(x, 0.0, 1.0, 0.0, False, False)
            self.points.setdefault(series, {})[minute] = p
            result[series] = p
        return result

    def recent_flags(self, series: str, minute: int) -> list[int]:
        lo = minute - self.s.sustain_n + 1
        return sorted(m for m in self.flags.get(series, ()) if lo <= m <= minute)

    def sustained(self, series: str, minute: int) -> bool:
        return len(self.recent_flags(series, minute)) >= self.s.sustain_m

    def emerging(self, series: str, minute: int) -> bool:
        """最近 sustain_m-1 分钟连续突增（尚未满足持续性判定，但与已触发的异常同期出现）。"""
        flags = self.flags.get(series, ())
        return all(m in flags for m in range(minute - self.s.sustain_m + 2, minute + 1))

    def onset(self, series: str, minute: int) -> int | None:
        """本次持续突增的起始分钟。"""
        recent = self.recent_flags(series, minute)
        return recent[0] if recent else None

    def threshold(self, series: str) -> float | None:
        if series not in self.baseline:
            return None
        mu, sigma = self.baseline[series]
        return max(mu + self.s.z_threshold * sigma, mu + self.s.min_delta)
