"""SQLite + file storage layer."""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agents.shared.models import CasePackage

logger = logging.getLogger(__name__)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cases (
    case_id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    fault_type TEXT,
    fault_mode TEXT,
    difficulty TEXT,
    is_normal BOOLEAN,
    is_train BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    validation_status TEXT DEFAULT 'pending',
    validation_notes TEXT,
    file_path TEXT NOT NULL,
    metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS diagnosis_sessions (
    session_id TEXT PRIMARY KEY,
    case_id INTEGER REFERENCES cases(case_id),
    route_taken TEXT NOT NULL,
    initial_confidence REAL,
    final_confidence REAL,
    fault_type_predicted TEXT,
    fault_elements_predicted TEXT,
    fault_links_predicted TEXT,
    fault_mode_predicted TEXT,
    iterations_used INTEGER,
    tokens_used INTEGER,
    llm_model TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    status TEXT DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS reasoning_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES diagnosis_sessions(session_id),
    step_number INTEGER,
    step_type TEXT,
    content TEXT,
    tool_name TEXT,
    tool_args TEXT,
    tool_result TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evaluations (
    evaluation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES diagnosis_sessions(session_id),
    case_id INTEGER REFERENCES cases(case_id),
    exact_match BOOLEAN,
    partial_match BOOLEAN,
    precision_score REAL,
    recall_score REAL,
    f1_score REAL,
    fault_type_match BOOLEAN,
    case_category TEXT,
    trace_quality_score REAL,
    evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS optimization_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER REFERENCES evaluations(evaluation_id),
    suggestion_type TEXT,
    target TEXT,
    suggestion_content TEXT,
    evidence TEXT,
    priority REAL DEFAULT 0.5,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loop_iterations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loop_type TEXT,
    iteration_number INTEGER,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    cases_generated INTEGER DEFAULT 0,
    cases_evaluated INTEGER DEFAULT 0,
    accuracy_before REAL,
    accuracy_after REAL,
    summary TEXT,
    -- LIVE mode fields only apply to newly created databases; existing schemas are not migrated.
    session_id TEXT,
    scenario_id TEXT,
    runner_state TEXT,
    restart_count INTEGER DEFAULT 0,
    llm_mode TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_sessions_session_id ON loop_iterations(session_id);

CREATE INDEX IF NOT EXISTS idx_cases_fault_type ON cases(fault_type);
CREATE INDEX IF NOT EXISTS idx_cases_difficulty ON cases(difficulty);
CREATE INDEX IF NOT EXISTS idx_sessions_case_id ON diagnosis_sessions(case_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON diagnosis_sessions(status);
CREATE INDEX IF NOT EXISTS idx_evaluations_case_id ON evaluations(case_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON optimization_suggestions(status);
"""


class Storage:
    """SQLite-backed storage with file system support."""

    def __init__(self, db_path: str = "./storage/ccn_agent.db"):
        self.db_path = db_path
        self._ensure_dirs()
        self._init_db()

    def _ensure_dirs(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(SCHEMA_SQL)
        logger.info("Database initialized: %s", self.db_path)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # -----------------------------------------------------------------------
    # Cases
    # -----------------------------------------------------------------------

    def save_case(
        self,
        case_id: int,
        source: str,
        file_path: str,
        fault_type: str | None = None,
        fault_mode: str | None = None,
        difficulty: str | None = None,
        is_normal: bool = False,
        is_train: bool = False,
        metadata_json: str | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO cases
                   (case_id, source, fault_type, fault_mode, difficulty,
                    is_normal, is_train, file_path, metadata_json, validation_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
                (
                    case_id,
                    source,
                    fault_type,
                    fault_mode,
                    difficulty,
                    is_normal,
                    is_train,
                    file_path,
                    metadata_json,
                ),
            )

    def update_case_validation(self, case_id: int, status: str, notes: str = "") -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE cases SET validation_status = ?, validation_notes = ? WHERE case_id = ?",
                (status, notes, case_id),
            )

    def get_case(self, case_id: int) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM cases WHERE case_id = ?", (case_id,)).fetchone()
            return dict(row) if row else None

    def list_cases(
        self,
        fault_type: str | None = None,
        difficulty: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        query = "SELECT * FROM cases WHERE 1=1"
        params: list[Any] = []
        if fault_type:
            query += " AND fault_type = ?"
            params.append(fault_type)
        if difficulty:
            query += " AND difficulty = ?"
            params.append(difficulty)
        query += " ORDER BY case_id LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, params).fetchall()]

    def count_cases(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM cases").fetchone()
            return row[0]

    # -----------------------------------------------------------------------
    # Diagnosis sessions
    # -----------------------------------------------------------------------

    def create_session(
        self,
        session_id: str,
        case_id: int,
        route_taken: str,
        initial_confidence: float,
        llm_model: str,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO diagnosis_sessions
                   (session_id, case_id, route_taken, initial_confidence,
                    llm_model, started_at, status)
                   VALUES (?, ?, ?, ?, ?, datetime('now'), 'running')""",
                (session_id, case_id, route_taken, initial_confidence, llm_model),
            )

    def complete_session(
        self,
        session_id: str,
        fault_elements: list[str],
        fault_links: list[str],
        fault_type: str | None,
        fault_mode: str | None,
        final_confidence: float,
        iterations_used: int,
        tokens_used: int,
        status: str = "completed",
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """UPDATE diagnosis_sessions SET
                   fault_elements_predicted = ?, fault_links_predicted = ?,
                   fault_type_predicted = ?, fault_mode_predicted = ?,
                   final_confidence = ?, iterations_used = ?,
                   tokens_used = ?, completed_at = datetime('now'), status = ?
                   WHERE session_id = ?""",
                (
                    json.dumps(fault_elements),
                    json.dumps(fault_links),
                    fault_type,
                    fault_mode,
                    final_confidence,
                    iterations_used,
                    tokens_used,
                    status,
                    session_id,
                ),
            )

    def get_session(self, session_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM diagnosis_sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            return dict(row) if row else None

    def list_sessions(self, limit: int = 50, offset: int = 0) -> list[dict]:
        with self._conn() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM diagnosis_sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
            ]

    # -----------------------------------------------------------------------
    # Reasoning steps
    # -----------------------------------------------------------------------

    def save_reasoning_step(
        self,
        session_id: str,
        step_number: int,
        step_type: str,
        content: str,
        tool_name: str | None = None,
        tool_args: str | None = None,
        tool_result: str | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO reasoning_steps
                   (session_id, step_number, step_type, content, tool_name, tool_args, tool_result)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (session_id, step_number, step_type, content, tool_name, tool_args, tool_result),
            )

    def get_reasoning_steps(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM reasoning_steps WHERE session_id = ? ORDER BY step_number",
                    (session_id,),
                ).fetchall()
            ]

    # -----------------------------------------------------------------------
    # Evaluations
    # -----------------------------------------------------------------------

    def save_evaluation(
        self,
        session_id: str,
        case_id: int,
        exact_match: bool,
        precision: float,
        recall: float,
        f1: float,
        fault_type_match: bool,
        case_category: str,
        trace_quality: float,
        notes: str = "",
    ) -> int:
        with self._conn() as conn:
            cursor = conn.execute(
                """INSERT INTO evaluations
                   (session_id, case_id, exact_match, precision_score, recall_score,
                    f1_score, fault_type_match, case_category, trace_quality_score, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    case_id,
                    exact_match,
                    precision,
                    recall,
                    f1,
                    fault_type_match,
                    case_category,
                    trace_quality,
                    notes,
                ),
            )
            return cursor.lastrowid

    def get_evaluation(self, evaluation_id: int) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM evaluations WHERE evaluation_id = ?", (evaluation_id,)
            ).fetchone()
            return dict(row) if row else None

    # -----------------------------------------------------------------------
    # Optimization suggestions
    # -----------------------------------------------------------------------

    def save_suggestion(
        self,
        evaluation_id: int,
        suggestion_type: str,
        target: str,
        content: str,
        evidence: str = "",
        priority: float = 0.5,
    ) -> int:
        with self._conn() as conn:
            cursor = conn.execute(
                """INSERT INTO optimization_suggestions
                   (evaluation_id, suggestion_type, target, suggestion_content,
                    evidence, priority)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (evaluation_id, suggestion_type, target, content, evidence, priority),
            )
            return cursor.lastrowid

    def list_suggestions(
        self, status: str | None = None, suggestion_type: str | None = None
    ) -> list[dict]:
        query = "SELECT * FROM optimization_suggestions WHERE 1=1"
        params: list[Any] = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if suggestion_type:
            query += " AND suggestion_type = ?"
            params.append(suggestion_type)
        query += " ORDER BY priority DESC, created_at DESC"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, params).fetchall()]

    def apply_suggestion(self, suggestion_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE optimization_suggestions SET status = 'applied', applied_at = datetime('now') WHERE id = ?",
                (suggestion_id,),
            )

    # -----------------------------------------------------------------------
    # Loop iterations and live sessions
    # -----------------------------------------------------------------------

    def record_live_session(
        self,
        session_id: str,
        scenario_id: str,
        runner_state: str,
        llm_mode: str,
    ) -> None:
        """Upsert a live session row keyed by session_id."""
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO loop_iterations
                   (session_id, scenario_id, runner_state, llm_mode,
                    loop_type, iteration_number, started_at, restart_count)
                   VALUES (?, ?, ?, ?, 'live', 1, CURRENT_TIMESTAMP, 0)
                   ON CONFLICT(session_id) DO UPDATE SET
                     runner_state=excluded.runner_state,
                     llm_mode=excluded.llm_mode""",
                (session_id, scenario_id, runner_state, llm_mode),
            )

    def update_live_session_state(
        self, session_id: str, runner_state: str, restart_count: int | None = None
    ) -> None:
        with self._conn() as conn:
            if restart_count is None:
                conn.execute(
                    "UPDATE loop_iterations SET runner_state=? WHERE session_id=?",
                    (runner_state, session_id),
                )
            else:
                conn.execute(
                    "UPDATE loop_iterations SET runner_state=?, restart_count=? WHERE session_id=?",
                    (runner_state, restart_count, session_id),
                )

    def complete_live_session(self, session_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE loop_iterations SET completed_at=CURRENT_TIMESTAMP WHERE session_id=?",
                (session_id,),
            )

    def list_live_sessions(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT session_id, scenario_id, runner_state, llm_mode,
                          restart_count, started_at, completed_at
                   FROM loop_iterations
                   WHERE session_id IS NOT NULL
                   ORDER BY started_at DESC"""
            ).fetchall()
            return [dict(r) for r in rows]

    def start_loop_iteration(
        self, loop_type: str, iteration_number: int, accuracy_before: float = 0.0
    ) -> int:
        with self._conn() as conn:
            cursor = conn.execute(
                """INSERT INTO loop_iterations
                   (loop_type, iteration_number, started_at, accuracy_before)
                   VALUES (?, ?, datetime('now'), ?)""",
                (loop_type, iteration_number, accuracy_before),
            )
            return cursor.lastrowid

    def complete_loop_iteration(
        self,
        iteration_id: int,
        cases_generated: int,
        cases_evaluated: int,
        accuracy_after: float,
        summary: str = "",
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """UPDATE loop_iterations SET
                   completed_at = datetime('now'), cases_generated = ?,
                   cases_evaluated = ?, accuracy_after = ?, summary = ?
                   WHERE id = ?""",
                (cases_generated, cases_evaluated, accuracy_after, summary, iteration_id),
            )

    def get_dashboard_summary(self) -> dict:
        with self._conn() as conn:
            total_cases = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            total_sessions = conn.execute("SELECT COUNT(*) FROM diagnosis_sessions").fetchone()[0]
            total_evals = conn.execute("SELECT COUNT(*) FROM evaluations").fetchone()[0]

            accuracy_row = conn.execute(
                "SELECT AVG(CASE WHEN exact_match THEN 1.0 ELSE 0.0 END) FROM evaluations"
            ).fetchone()
            accuracy = accuracy_row[0] or 0.0

            by_route = conn.execute(
                "SELECT route_taken, COUNT(*) FROM diagnosis_sessions GROUP BY route_taken"
            ).fetchall()
            by_fault = conn.execute(
                "SELECT fault_type, COUNT(*) FROM cases WHERE fault_type IS NOT NULL GROUP BY fault_type"
            ).fetchall()

        return {
            "total_cases": total_cases,
            "total_diagnoses": total_sessions,
            "total_evaluations": total_evals,
            "overall_accuracy": round(accuracy, 4),
            "by_route": {r[0]: r[1] for r in by_route},
            "by_fault_type": {r[0]: r[1] for r in by_fault},
        }

    # -----------------------------------------------------------------------
    # File storage helpers
    # -----------------------------------------------------------------------

    def save_case_files(self, case_id: int, package: "CasePackage") -> str:
        """Save case package files to storage/cases/{case_id}/."""
        case_dir = Path(self.db_path).parent / "cases" / f"case_{case_id:03d}"
        case_dir.mkdir(parents=True, exist_ok=True)

        (case_dir / "data.csv").write_text(package.kpi_data, encoding="utf-8")
        (case_dir / "topo.txt").write_text(package.topology_text, encoding="utf-8")
        (case_dir / "process.txt").write_text(package.process_text, encoding="utf-8")
        (case_dir / "result.txt").write_text(package.result_text, encoding="utf-8")
        (case_dir / "metadata.json").write_text(package.metadata.to_json(), encoding="utf-8")
        (case_dir / "chr.jsonl").write_text(package.chr_data, encoding="utf-8")

        return str(case_dir)

    def load_case_files(self, case_id: int) -> dict[str, str] | None:
        """Load case files from storage/cases/{case_id}/."""
        case_dir = Path(self.db_path).parent / "cases" / f"case_{case_id:03d}"
        if not case_dir.exists():
            return None
        files = {
            "data.csv": (case_dir / "data.csv").read_text(encoding="utf-8"),
            "topo.txt": (case_dir / "topo.txt").read_text(encoding="utf-8"),
            "process.txt": (case_dir / "process.txt").read_text(encoding="utf-8"),
            "result.txt": (case_dir / "result.txt").read_text(encoding="utf-8"),
            "metadata.json": (case_dir / "metadata.json").read_text(encoding="utf-8"),
        }
        # chr.jsonl is optional — older cases predate the free5GC CHR layer.
        chr_path = case_dir / "chr.jsonl"
        if chr_path.exists():
            files["chr.jsonl"] = chr_path.read_text(encoding="utf-8")
        return files

    def save_session_trace(self, session_id: str, trace: dict) -> None:
        """Save full reasoning trace to storage/sessions/{session_id}/."""
        session_dir = Path(self.db_path).parent / "sessions" / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        (session_dir / "trace.json").write_text(
            json.dumps(trace, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
