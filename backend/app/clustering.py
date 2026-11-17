"""Distribution enrichment relative to observed CHR background, not traffic failure rate."""
from __future__ import annotations

from collections import Counter, defaultdict
import math

from scipy.stats import fisher_exact

from .config import SETTINGS

DIMENSIONS = {"imsi": "用户", "ran": "基站", "cell": "小区", "region": "区域", "nf": "网元", "pod": "POD"}


def adjust_bh(tests):
    ranked = sorted(tests, key=lambda test: test["p_value"])
    last = 1.0
    for index in range(len(ranked) - 1, -1, -1):
        last = min(last, ranked[index]["p_value"] * len(ranked) / (index + 1))
        ranked[index]["q_value"] = float(last)


def feature_tests(foreground, background, dimension, scope):
    fg = Counter(getattr(r, dimension) for r in foreground if getattr(r, dimension))
    bg = Counter(getattr(r, dimension) for r in background if getattr(r, dimension))
    n, m = sum(fg.values()), sum(bg.values())
    if not n or not m:
        return []
    tests = []
    for value, count in fg.items():
        baseline_count = bg[value]
        # Jeffreys smoothing is used only for the effect size, not for Fisher's table.
        share = count / n
        expected = (baseline_count + .5) / (m + 1)
        p = float(fisher_exact([[count, n - count], [baseline_count, m - baseline_count]], alternative="greater").pvalue)
        tests.append({"dimension": dimension, "label": DIMENSIONS[dimension], "value": value,
                      "count": count, "total": n, "background_count": baseline_count, "background_total": m,
                      "share": round(share, 4), "baseline_share": round(expected, 4), "lift": round(share / expected, 3),
                      "p_value": p, "q_value": 1.0, "scope": scope})
    return tests


def grade(test):
    significant = test["count"] >= SETTINGS.min_cluster_support and test["q_value"] < SETTINGS.significance_q and test["lift"] >= SETTINGS.min_lift
    return "strong" if significant and test["q_value"] < .001 and test["lift"] >= 3 else "significant" if significant else "none"


def analyze_clusters(retained, historical, window):
    if not retained:
        return {"groups": [], "tested_dimensions": 6, "hypotheses_tested": 0, "fallback": [], "fallback_attempted": 0,
                "method": "Fisher 单侧检验 + BH-FDR + lift + 最小支持度"}
    groups, all_tests = [], []
    by_key = defaultdict(list)
    for r in retained:
        by_key[r.key].append(r)
    earliest = min(r.timestamp for r in retained)
    # Reference records precede the retained anomaly; no experimental truth / injection time.
    background = [r for r in historical if r.timestamp < earliest]
    for key, records in by_key.items():
        nf, procedure, cause = key
        reference = [r for r in background if r.nf == nf and r.procedure == procedure]
        tests = []
        for dimension in DIMENSIONS:
            if dimension == "nf":
                # Never test NF=100% within an NF-conditioned group (a tautology).
                fg = [r for r in retained if r.procedure == procedure and r.cause == cause and r.nf.split(":")[0] == nf.split(":")[0]]
                bg_pool = [r for r in background if r.procedure == procedure and r.nf.split(":")[0] == nf.split(":")[0]]
                same_cause = [r for r in bg_pool if r.cause == cause]
                bg = same_cause if len(same_cause) >= 10 else bg_pool
                scope = "同类网元、同流程的同原因码跨实例对照" if len(same_cause) >= 10 else "同类网元、同流程 CHR 跨实例对照（新码基线不足）"
                derived = feature_tests(fg, bg, dimension, scope)
                derived = [test for test in derived if test["value"] == nf]
            else:
                derived = feature_tests(records, reference, dimension, "该实例该流程的故障前 CHR 分布")
            tests.extend(derived)
        total = sum(r.nf == nf and r.procedure == procedure for r in retained)
        group = {"id": "|".join(key), "nf": nf, "procedure": procedure, "cause": cause,
                 "count": len(records), "group_total": total, "cause_percent": round(100 * len(records) / total, 2),
                 "users": len({r.imsi for r in records}), "tests": tests, "features": []}
        groups.append(group)
        all_tests.extend(tests)
    adjust_bh(all_tests)
    for group in groups:
        for dimension in DIMENSIONS:
            choices = [test for test in group["tests"] if test["dimension"] == dimension]
            for test in choices:
                test["severity"] = grade(test)
            if choices:
                group["features"].append(max(choices, key=lambda test: (test["severity"] != "none", test["lift"] if test["severity"] != "none" else test["share"], test["count"])))
            else:
                group["features"].append({"dimension": dimension, "label": DIMENSIONS[dimension], "value": "数据不足",
                                          "count": 0, "total": 0, "share": 0, "baseline_share": 0, "lift": 0,
                                          "p_value": 1, "q_value": 1, "severity": "unavailable", "scope": "缺少字段或基线"})
        group["significant"] = any(f["severity"] in ("strong", "significant") for f in group["features"])
        group["score"] = round(sum(min(8, -math.log10(max(t["q_value"], 1e-100))) * min(t["lift"], 5) for t in group["features"] if t["severity"] in ("strong", "significant")), 2)
        del group["tests"]
    fallback, fallback_tests = [], []
    unresolved = [g for g in groups if not g["significant"]]
    for group in unresolved:
        user_records = defaultdict(list)
        for record in by_key[(group["nf"], group["procedure"], group["cause"])]:
            user_records[record.imsi].append(record)
        for user, records in user_records.items():
            if len(records) < SETTINGS.min_cluster_support:
                continue
            # Conditional reference avoids "this user's cell is 100%" becoming false evidence.
            reference = [r for r in background if r.imsi == user and r.nf == group["nf"] and r.procedure == group["procedure"]]
            tests = [test for dim in ("ran", "cell", "region", "pod") for test in feature_tests(records, reference, dim, "同一用户的故障前 CHR 对照")]
            fallback.append({"group_id": group["id"], "user_id": user, "count": len(records), "features": tests})
            fallback_tests.extend(tests)
    adjust_bh(fallback_tests)
    for item in fallback:
        for test in item["features"]:
            test["severity"] = grade(test)
        item["significant"] = any(test["severity"] in ("strong", "significant") for test in item["features"])
    groups.sort(key=lambda g: (-g["score"], -g["count"]))
    return {"groups": groups, "tested_dimensions": 6, "hypotheses_tested": len(all_tests), "fallback": fallback,
            "fallback_attempted": len(unresolved), "fallback_hypotheses": len(fallback_tests),
            "method": "Fisher 单侧检验 + BH-FDR；q < 0.05、lift ≥ 1.8、支持度 ≥ 5",
            "note": "比例是 CHR 内部的原因码/特征占比，不是业务失败率。背景由异常前 CHR 构成，缺少成功业务暴露量。"}
