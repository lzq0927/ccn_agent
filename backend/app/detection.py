"""Causal, per-series detection. A series confirms independently of other series."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta
import math

import numpy as np
from scipy.stats import poisson

from .config import SETTINGS, Settings


class Detector:
    def __init__(self, records, settings: Settings = SETTINGS):
        self.records, self.settings = records, settings
        self.start = records[0].timestamp.replace(second=0, microsecond=0)
        self.duration = math.floor((records[-1].timestamp - self.start).total_seconds() / 60) + 1
        self.counts, self.thresholds, self.flags, self.confirmed = {}, {}, {}, {}
        self.first_seen = {}
        self.buckets = defaultdict(list)
        for record in records:
            minute = self.minute_of(record)
            self.buckets[minute].append(record)
            if record.key not in self.counts:
                self.counts[record.key] = [0] * self.duration
                self.first_seen[record.key] = minute
            self.counts[record.key][minute] += 1
        # Availability, not the number of future series, controls multiple-series correction.
        available = [sum(first <= m for first in self.first_seen.values()) for m in range(self.duration)]
        for key, counts in self.counts.items():
            thresholds, flags, confirms = [], [], []
            frozen = float(settings.min_anomaly_count)
            for minute, count in enumerate(counts):
                prior = [counts[i] for i in range(max(0, minute - settings.window_minutes), minute) if not flags[i]]
                if len(prior) >= 5:
                    median = float(np.median(prior))
                    mad = float(np.median(np.abs(np.array(prior) - median)))
                    # Conservative Poisson tail plus robust dispersion guards low-count series.
                    tail = float(poisson.ppf(1 - .001 / max(1, available[minute]), max(median, .25)))
                    frozen = max(settings.min_anomaly_count, median + settings.mad_multiplier * 1.4826 * mad, tail)
                thresholds.append(round(frozen, 2))
                flags.append(bool(minute >= settings.warmup_minutes and count > frozen))
                confirms.append(sum(flags[max(0, minute - settings.confirmation_minutes + 1):]) >= settings.confirmation_hits)
            self.thresholds[key], self.flags[key], self.confirmed[key] = thresholds, flags, confirms

    def minute_of(self, record):
        return int((record.timestamp - self.start).total_seconds() // 60)

    def window(self, minute):
        return [r for i in range(max(0, minute - self.settings.window_minutes), minute) for r in self.buckets[i]]

    def snapshot(self, minute):
        s = self.settings
        index = minute - 1
        known = [key for key in self.counts if self.first_seen[key] < minute]
        confirmed = {key for key in known if self.confirmed[key][index]}
        candidates = {key for key in known if any(self.flags[key][max(0, minute - 5):minute])}
        window = self.window(minute)
        retained = [r for r in window if r.key in confirmed and self.flags[r.key][self.minute_of(r)]]
        ranked = sorted(known, key=lambda key: (key in confirmed, key in candidates,
                        max(self.counts[key][max(0, minute - 5):minute])), reverse=True)
        series = []
        for key in ranked:
            nf, procedure, cause = key
            series.append({"id": "|".join(key), "nf": nf, "procedure": procedure, "cause": cause,
                           "confirmed": key in confirmed, "hits": sum(self.flags[key][max(0, minute - 5):minute]),
                           "points": [{"minute": m + 1, "time": (self.start + timedelta(minutes=m)).strftime("%H:%M"),
                                       "count": self.counts[key][m], "threshold": self.thresholds[key][m],
                                       "anomalous": self.flags[key][m]} for m in range(max(0, minute - s.window_minutes), minute)]})
        first_alert = next((m + 1 for m in range(minute) if any(self.confirmed[k][m] for k in known)), None)
        distribution = []
        pair_keys = sorted({r.key[:2] for r in window})
        for nf, procedure in pair_keys:
            before = Counter(r.cause for r in window if r.nf == nf and r.procedure == procedure)
            after = Counter(r.cause for r in retained if r.nf == nf and r.procedure == procedure)
            distribution.append({"id": f"{nf}|{procedure}", "nf": nf, "procedure": procedure,
                                 "before": [{"name": c, "value": n} for c, n in before.most_common()],
                                 "after": [{"name": c, "value": n} for c, n in after.most_common()]})
        output = {"status": "confirmed" if confirmed else "confirming" if candidates else "warming_up" if minute <= s.warmup_minutes else "normal",
                  "dimensions": len(known), "confirmed_dimensions": len(confirmed), "candidate_dimensions": len(candidates),
                  "raw_count": len(window), "retained_count": len(retained),
                  "removed_count": len(window) - len(retained),
                  "removed_percent": round(100 * (1 - len(retained) / len(window)), 2) if window else 0,
                  "first_alert_minute": first_alert, "max_hits": max((sum(self.flags[k][max(0, minute - 5):minute]) for k in known), default=0),
                  "window_start": (self.start + timedelta(minutes=max(0, minute - s.window_minutes))).isoformat(),
                  "window_end": (self.start + timedelta(minutes=minute)).isoformat(),
                  "series": series, "distributions": distribution,
                  "method": "15 分钟因果基线 · Median/MAD + Poisson 尾部阈值 · 同维度 4/5 确认",
                  "denoising_rule": "仅保留当前已确认维度在分析滑窗内的异常分钟 CHR；正常分钟和未确认尖峰均不进入分析"}
        return output, window, retained
