"""数据预处理：列名归一、清洗、去重、拓扑校验，输出统一的 CHR 宽表。

各网元 CHR 文件列不完全相同（AMF 有 Last_*，SMF 有 Serving_*），
这里统一成 peer_<类型> 列，后续算法不再关心来源文件的差异。
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from ..topology import Topology, nf_type

# 规范列名 -> 可接受的原始列名（已做小写、空格/连字符转下划线处理）
ALIASES = {
    "ts": ["timestamp", "time", "时间戳"],
    "cause": ["inner_cause", "inner_cauce", "innercause", "失败原因码", "原因码"],
    "procedure": ["procedure", "流程标记", "流程", "procedure_tag"],
    "imsi": ["imsi", "用户标识"],
    "instance": ["ne_instance", "网元实例", "ne_id", "instance"],
    "ran": ["ran_id", "基站id", "gnb_id"],
    "cell": ["cell_id", "小区id"],
    "tac": ["tac", "区域", "area_id"],
    "pod": ["pod_id"],
}
PEER_RE = re.compile(r"^(?:last|serving)_([a-z]+)_id$")
PEER_TYPES = ["amf", "smf", "ausf", "udm", "pcf", "upf"]
PEER_COLS = [f"peer_{t}" for t in PEER_TYPES]
DIM_COLS = ["imsi", "ran", "cell", "tac", "pod"] + PEER_COLS
COLUMNS = ["ts", "minute", "nf_type", "instance", "procedure", "cause", "series"] + DIM_COLS


def _canon(name: str) -> str:
    return re.sub(r"[\s\-]+", "_", str(name).strip().lower())


RAW_COLS = ["ts", "cause", "procedure", "instance"] + DIM_COLS + ["source_file"]


def normalize_columns(df: pd.DataFrame, source_file: str) -> pd.DataFrame:
    """把一个 CHR 文件的列名归一成规范列名，缺失的列补空。"""
    rename = {}
    for col in df.columns:
        c = _canon(col)
        m = PEER_RE.match(c)
        if m and m.group(1) in PEER_TYPES:
            rename[col] = f"peer_{m.group(1)}"
            continue
        for canon, names in ALIASES.items():
            if c in names:
                rename[col] = canon
    df = df.rename(columns=rename)
    df["source_file"] = source_file
    for col in RAW_COLS:
        if col not in df:
            df[col] = ""
    return df[RAW_COLS].fillna("")


def read_raw(data_dir: Path) -> pd.DataFrame:
    """读取 data/ 下所有 chr_*.csv，按规范列名纵向合并（全部按字符串读入，不做清洗）。"""
    frames = [normalize_columns(pd.read_csv(path, dtype=str, keep_default_na=False), path.name)
              for path in sorted(Path(data_dir).glob("chr_*.csv"))]
    if not frames:
        raise FileNotFoundError(f"{data_dir} 下没有 chr_*.csv")
    raw = pd.concat(frames, ignore_index=True)
    # 到达时间：时间戳非法的记录按文件内前一条的时间到达（模拟流式上报）
    parsed = pd.to_datetime(raw["ts"], errors="coerce", format="%Y-%m-%d %H:%M:%S")
    raw["arrival"] = parsed.groupby(raw["source_file"]).ffill().fillna(parsed.min())
    return raw.sort_values("arrival", kind="stable").reset_index(drop=True)


def preprocess(raw: pd.DataFrame, topo: Topology, t0: pd.Timestamp) -> tuple[pd.DataFrame, dict]:
    """清洗一批原始 CHR。返回 (规范化数据, 统计)。"""
    stats = {"input": len(raw), "bad_timestamp": 0, "missing_key": 0, "unknown_instance": 0,
             "duplicate": 0, "normalized_instance": 0}
    if raw.empty:
        return pd.DataFrame(columns=COLUMNS), {**stats, "output": 0}
    df = raw.copy()
    for col in ["cause", "procedure", "instance"] + DIM_COLS:
        df[col] = df[col].astype(str).str.strip()

    df["ts"] = pd.to_datetime(df["ts"], errors="coerce", format="%Y-%m-%d %H:%M:%S")
    bad = df["ts"].isna()
    stats["bad_timestamp"] = int(bad.sum())
    df = df[~bad]

    missing = (df["cause"] == "") | (df["instance"] == "") | (df["procedure"] == "")
    stats["missing_key"] = int(missing.sum())
    df = df[~missing]

    norm = df["instance"].map(topo.normalize).astype(str)
    stats["normalized_instance"] = int((norm != df["instance"]).sum())
    df["instance"] = norm
    for col in PEER_COLS:
        df[col] = df[col].map(topo.normalize)
    unknown = ~df["instance"].map(topo.has).astype(bool)
    stats["unknown_instance"] = int(unknown.sum())
    df = df[~unknown]
    if df.empty:                       # 本批全部被清洗掉
        return pd.DataFrame(columns=COLUMNS), {**stats, "output": 0}

    before = len(df)
    df = df.drop_duplicates(subset=["ts", "cause", "procedure", "instance", "imsi", "pod"])
    stats["duplicate"] = before - len(df)

    df["nf_type"] = df["instance"].map(nf_type)
    df["minute"] = ((df["ts"] - t0).dt.total_seconds() // 60).astype(int)
    df["series"] = df["instance"] + "|" + df["procedure"] + "|" + df["cause"]
    stats["output"] = len(df)
    return df[COLUMNS].reset_index(drop=True), stats
