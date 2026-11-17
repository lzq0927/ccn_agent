from dataclasses import dataclass
from pathlib import Path
import os


ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    window_minutes: int = 15
    confirmation_minutes: int = 5
    confirmation_hits: int = 4
    warmup_minutes: int = 15
    min_anomaly_count: int = 6
    mad_multiplier: float = 4.5
    min_cluster_support: int = 5
    significance_q: float = 0.05
    min_lift: float = 1.8
    flow_tolerance_seconds: int = 5


SETTINGS = Settings()
DATA_DIR = Path(os.getenv("CHR_DATA_DIR", ROOT / "data"))
TOPO_FILE = Path(os.getenv("CHR_TOPO_FILE", ROOT / "topo/topo.csv"))
KNOWLEDGE_FILE = Path(os.getenv("CHR_KG_FILE", ROOT / "chr-knowledge-graph/graph.json"))
