"""Shared data models across all agents.

These models define the data contracts between agents and the storage layer.
They build on top of simulator/models.py types without modifying them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional

from simulator.models import FaultPointType, FaultMode


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Route(str, Enum):
    WORKFLOW = "workflow"
    GUIDED = "guided"
    AUTONOMOUS = "autonomous"
    EXPLORATION = "exploration"


class CaseDifficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    EDGE = "edge"


class CaseSource(str, Enum):
    SIMULATOR = "simulator"
    HARD_GENERATOR = "hard_generator"
    FREE5GC = "free5gc"


class CaseCategory(str, Enum):
    SUCCESS = "success"
    PARTIAL_SUCCESS = "partial_success"
    FAILURE = "failure"
    FALSE_POSITIVE = "false_positive"


class SuggestionType(str, Enum):
    SKILL_UPDATE = "skill_update"
    WORKFLOW_UPDATE = "workflow_update"
    NEW_CASE = "new_case"


class ValidationStatus(str, Enum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"


class SessionStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


# ---------------------------------------------------------------------------
# Agent 1 models
# ---------------------------------------------------------------------------

@dataclass
class CaseParams:
    """Parameters for generating a single fault case."""
    topo_config_index: int = 0
    seed: Optional[int] = None
    fault_type: Optional[FaultPointType] = None
    fault_mode: Optional[FaultMode] = None
    process_name: Optional[str] = None
    ue_count: Optional[int] = None
    loss_rate: Optional[float] = None
    difficulty: CaseDifficulty = CaseDifficulty.MEDIUM


@dataclass
class CaseMetadata:
    """Metadata attached to each generated case."""
    case_id: int
    source: CaseSource
    difficulty: CaseDifficulty
    fault_type: Optional[str] = None
    fault_mode: Optional[str] = None
    topo_config_index: int = 0
    seed: Optional[int] = None
    ue_count: int = 0
    loss_rate: float = 0.0
    fault_start: int = 0
    fault_duration: int = 0
    tags: list[str] = field(default_factory=list)
    validation_status: ValidationStatus = ValidationStatus.PENDING
    validation_notes: str = ""
    created_at: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2, default=str)

    @classmethod
    def from_json(cls, data: str) -> "CaseMetadata":
        d = json.loads(data)
        d["source"] = CaseSource(d["source"])
        d["difficulty"] = CaseDifficulty(d["difficulty"])
        d["validation_status"] = ValidationStatus(d.get("validation_status", "pending"))
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class CasePackage:
    """In-memory representation of a complete case."""
    case_id: int
    kpi_data: str           # CSV content
    topology_text: str      # topo.txt content
    process_text: str       # process.txt content
    result_text: str        # result.txt JSON content
    metadata: CaseMetadata
    chr_data: str = ""      # free5GC-faithful CHR (JSONL content), one record per line


# ---------------------------------------------------------------------------
# Agent 2 models
# ---------------------------------------------------------------------------

@dataclass
class CaseData:
    """Parsed case data ready for diagnosis."""
    case_id: int
    kpi_rows: list[dict]        # [{timestamp, level, ue_id, src, dst, success_rate}, ...]
    topology_text: str
    process_text: str
    ground_truth: dict          # {fault_elements: [...], fault_links: [...]}
    metadata: Optional[CaseMetadata] = None
    chr_records: list[dict] = field(default_factory=list)  # free5GC-faithful CHR rows


def parse_chr_jsonl(text: str) -> list[dict]:
    """Parse CHR JSONL content (one record per line) into a list of dicts.

    Tolerates empty / missing content (returns []) so older cases without the
    free5GC CHR layer load cleanly.
    """
    records: list[dict] = []
    if not text:
        return records
    for line in text.splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


@dataclass
class ConfidenceAssessment:
    """Output of the confidence assessor."""
    score: float
    route: Route
    suggested_workflow: Optional[str] = None
    suggested_skills: list[str] = field(default_factory=list)
    matched_patterns: list[str] = field(default_factory=list)
    anomaly_severity: float = 0.0
    affected_ne_count: int = 0
    temporal_clarity: float = 0.0


@dataclass
class ReasoningStep:
    """A single step in the diagnosis reasoning trace."""
    step_number: int
    step_type: str         # "thinking", "tool_call", "tool_result", "conclusion"
    content: str
    tool_name: Optional[str] = None
    tool_args: Optional[dict] = None
    tool_result: Optional[str] = None
    timestamp: str = ""


@dataclass
class DiagnosisResult:
    """Output of the fault perception agent."""
    session_id: str
    case_id: int
    fault_elements: list[str] = field(default_factory=list)
    fault_links: list[str] = field(default_factory=list)
    fault_type: Optional[str] = None
    fault_mode: Optional[str] = None
    confidence: float = 0.0
    route_taken: Route = Route.AUTONOMOUS
    reasoning_trace: list[ReasoningStep] = field(default_factory=list)
    iterations_used: int = 0
    tokens_used: int = 0
    llm_model: str = ""
    status: SessionStatus = SessionStatus.COMPLETED


# ---------------------------------------------------------------------------
# Phase 2 exploration models (multi-algorithm framework on CHR)
# ---------------------------------------------------------------------------

@dataclass
class ParamGrid:
    """One algorithm's parameter sweep over a data view."""
    algorithm: str                     # "ewma" | "cusum" | "pca" | "iforest" | ...
    data_view: str                     # "link_kpi" | "trace_kpi" | "chr_attempt" | "per_supi_ts"
    params: dict[str, list] = field(default_factory=dict)  # {"lambda_": [0.1, 0.2, 0.3]}


@dataclass
class SweepCell:
    """One (algorithm, view, param-combo) detector run result."""
    algorithm: str
    data_view: str
    params: dict = field(default_factory=dict)
    finding: dict = field(default_factory=dict)
    evidence_elements: list[str] = field(default_factory=list)
    confidence: float = 0.0


@dataclass
class FindingsReport:
    """Aggregated findings across an exploration sweep."""
    cells: list[SweepCell] = field(default_factory=list)
    param_concordance: dict[str, float] = field(default_factory=dict)
    view_concordance: dict[str, float] = field(default_factory=dict)
    bayesian_posterior: list[tuple[str, float]] = field(default_factory=list)
    used_algorithms: list[str] = field(default_factory=list)
    ablation_summary: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Agent 3 models
# ---------------------------------------------------------------------------

@dataclass
class EvaluationMetrics:
    """Metrics from comparing diagnosis against ground truth."""
    exact_match: bool = False
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    fault_type_match: bool = False


@dataclass
class CaseLibraryEntry:
    """An entry in the case library."""
    case_id: int
    session_id: str
    category: CaseCategory
    fault_type: str
    difficulty: CaseDifficulty
    diagnosis_correct: bool
    diagnosis_mode: str
    key_observations: list[str] = field(default_factory=list)
    lessons: list[str] = field(default_factory=list)


@dataclass
class OptimizationSuggestion:
    """A suggestion for improving the system."""
    suggestion_type: SuggestionType
    target: str                           # skill name, workflow name, or case params
    content: str
    evidence: list[str] = field(default_factory=list)
    priority: float = 0.5


@dataclass
class EvaluationReport:
    """Full evaluation report for a diagnosis."""
    evaluation_id: int = 0
    session_id: str = ""
    case_id: int = 0
    metrics: EvaluationMetrics = field(default_factory=EvaluationMetrics)
    case_entry: Optional[CaseLibraryEntry] = None
    suggestions: list[OptimizationSuggestion] = field(default_factory=list)
    trace_quality_score: float = 0.0
    evaluated_at: str = ""


# ---------------------------------------------------------------------------
# Message bus models
# ---------------------------------------------------------------------------

@dataclass
class AgentMessage:
    """Message passed between agents via the message bus."""
    message_id: str
    channel: str
    sender: str
    timestamp: str = ""
    payload: dict = field(default_factory=dict)
    correlation_id: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)
