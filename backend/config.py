"""全局配置。算法阈值集中在这里，便于内网替换时调整。"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    data_dir: Path = ROOT / "data"
    topo_file: Path = ROOT / "topo" / "topo.csv"
    kg_file: Path = ROOT / "chr-knowledge-graph" / "graph.json"

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
