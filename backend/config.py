"""全局配置。算法阈值集中在这里，便于内网替换时调整。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _path(env: str, default: Path) -> Path:
    return Path(os.environ[env]) if os.environ.get(env) else default


@dataclass
class Settings:
    # 输入位置可用环境变量覆盖：CCN_DATA_DIR / CCN_TOPO_FILE / CCN_KG_FILE
    data_dir: Path = field(default_factory=lambda: _path("CCN_DATA_DIR", ROOT / "data"))
    topo_file: Path = field(default_factory=lambda: _path("CCN_TOPO_FILE", ROOT / "topo" / "topo.csv"))
    kg_file: Path = field(default_factory=lambda: _path("CCN_KG_FILE", ROOT / "chr-knowledge-graph" / "graph.json"))

    # 运行节拍
    step_seconds: float = 1.0       # 按数据时间推进时，每处理 1 分钟数据占用的真实秒数
    tick_grace_s: int = 5           # 真实时间方式：每分钟结束后等待多少秒再处理，容纳晚到的 CHR
    reanalyze_gap_min: int = 5      # 故障期间出现新的突增维度时，距上次分析至少多久才重新分析
    recover_min: int = 5            # 故障相关维度连续多少分钟回落到基线视为恢复
    trend_minutes: int = 60         # 趋势图保留的分钟数
    log_keep: int = 400             # 保留的日志条数

    # 感知
    window_min: int = 15            # 滑窗长度（分钟）
    sustain_n: int = 5              # 持续性判定：最近 N 分钟
    sustain_m: int = 4              # ……其中至少 M 分钟异常
    z_threshold: float = 3.0        # 稳健 Z-Score 阈值
    min_delta: float = 3.0          # 相对基线的最小绝对增量（条/分钟）
    min_baseline_points: int = 5    # 估计基线所需的最少正常点数
    max_series_charts: int = 9      # 前端展示的典型时序数

    # 分析
    corr_window_s: int = 3          # 同一用户跨网元 CHR 的关联时间窗（秒）
    cluster_high: float = 0.9       # 强聚集
    cluster_mid: float = 0.6        # 中聚集
    cluster_min_z: float = 3.0      # 聚集显著性（二项检验 z）
    cluster_max_set: int = 3        # 聚集值集合的最大元素数
    min_ref_samples: int = 50       # 参考分布最少样本数
    match_margin: float = 0.15      # 交叉验证：首选场景需领先次选的最小分差

    extra: dict = field(default_factory=dict)


# 网元在流程中的调用深度：越大越靠后端，用于还原失败路径的先后顺序
NF_DEPTH = {"AMF": 0, "SMF": 1, "AUSF": 1, "UDM": 2, "PCF": 2, "UPF": 2}

DIM_LABELS = {
    "user": "用户", "ran": "基站", "cell": "小区", "tac": "区域", "pod": "POD", "local": "本端网元",
    "peer_amf": "对端AMF", "peer_smf": "对端SMF", "peer_ausf": "对端AUSF",
    "peer_udm": "对端UDM", "peer_pcf": "对端PCF", "peer_upf": "对端UPF",
    "flow_amf": "业务流AMF", "flow_smf": "业务流SMF", "flow_upstream": "业务流下游原因",
}
