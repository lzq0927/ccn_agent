from collections import defaultdict

from .config import SETTINGS


def reconstruct(records):
    """Use trace + subscriber + procedure; bounded matching without a trace is explicitly uncertain."""
    traced, untraced = defaultdict(list), defaultdict(list)
    for record in sorted(records, key=lambda r: r.timestamp):
        if record.trace:
            traced[(record.imsi, record.procedure, record.trace)].append(record)
        else:
            untraced[(record.imsi, record.procedure)].append(record)
    batches = [(group, "trace_id") for group in traced.values()]
    ambiguous = 0
    for group in untraced.values():
        pending = []
        for record in group:
            # Anchor the entire group, not adjacent pairs: prevents chained merging over minutes.
            if pending and (record.timestamp - pending[0].timestamp).total_seconds() > SETTINGS.flow_tolerance_seconds:
                batches.append((pending, "time_window"))
                pending = []
            pending.append(record)
        if pending:
            batches.append((pending, "time_window"))
    flows = []
    for group, method in batches:
        group.sort(key=lambda r: r.timestamp)
        amfs = {r.nf for r in group if r.nf.startswith("AMF:")}
        smfs = {r.nf for r in group if r.nf.startswith("SMF:")}
        amfs.update(r.paths["AMF"] for r in group if r.paths.get("AMF"))
        smfs.update(r.paths["SMF"] for r in group if r.paths.get("SMF"))
        is_ambiguous = len(amfs) > 1 or len(smfs) > 1 or (method == "time_window" and len({r.nf for r in group}) < len(group))
        # Do not invent a single path when the subscriber has overlapping transactions.
        if is_ambiguous:
            ambiguous += 1
        cross_nf = len({r.nf for r in group}) > 1
        flows.append({"user_id": group[0].imsi, "trace_id": group[0].trace,
                      "procedure": group[0].procedure, "time": group[0].timestamp.isoformat(),
                      "failure_path": " → ".join(f"{r.nf} [{r.cause}]" for r in group),
                      "AMF_ID": ", ".join(sorted(amfs)) or None, "SMF_ID": ", ".join(sorted(smfs)) or None,
                      "steps": [{"nf": r.nf, "cause": r.cause, "timestamp": r.timestamp.isoformat()} for r in group],
                      "correlation": "ambiguous" if is_ambiguous else method,
                      "cross_nf": cross_nf, "confirmed_path": method == "trace_id" and cross_nf and not is_ambiguous})
    flows.sort(key=lambda f: (not f["confirmed_path"], f["time"], f["user_id"]))
    return {"total": len(flows), "correlated": sum(f["confirmed_path"] for f in flows),
            "ambiguous": ambiguous, "rows": flows,
            "note": "TRACE_ID 精确关联；无 TRACE_ID 时使用同用户同流程 5 秒有界窗口，仅作为候选关联，不能证明因果。"}
