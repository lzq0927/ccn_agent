"""Shared local persistence for independent API and MCP processes."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from reliability.models import Design
from reliability.solver import canonical, digest

ROOT = Path(__file__).resolve().parent.parent


class ConflictError(ValueError):
    pass


class Store:
    def __init__(self, directory: str | Path | None = None):
        self.directory = Path(directory or os.getenv("CCN_RELIABILITY_DATA", ROOT / "storage/reliability"))
        self.directory.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS designs (
                    id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, design_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    id TEXT PRIMARY KEY, document TEXT NOT NULL);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.directory / "reliability.sqlite", timeout=30)
        try:
            with db:
                yield db
        finally:
            db.close()

    def create_design(self, design: Design) -> dict:
        item = {"id": uuid.uuid4().hex, "revision": 1, "design": design.model_dump()}
        with self.connect() as db:
            db.execute("INSERT INTO designs VALUES (?, ?, ?)",
                       (item["id"], 1, canonical(item)))
        return item

    def get_design(self, design_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT document FROM designs WHERE id=?", (design_id,)).fetchone()
        if row is None:
            raise KeyError("方案不存在")
        return json.loads(row[0])

    def list_designs(self) -> list[dict]:
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute(
                "SELECT document FROM designs ORDER BY rowid DESC LIMIT 100")]

    def update_design(self, design_id: str, design: Design, expected_revision: int) -> dict:
        self.get_design(design_id)
        item = {"id": design_id, "revision": expected_revision + 1, "design": design.model_dump()}
        with self.connect() as db:
            updated = db.execute("UPDATE designs SET revision=?, document=? WHERE id=? AND revision=?",
                                 (item["revision"], canonical(item), design_id, expected_revision))
            if updated.rowcount != 1:
                raise ConflictError("方案已更新，请重新读取当前版本")
        return item

    def save_run(self, design_id: str, revision: int, frozen: dict, result: dict,
                 source_run_id: str | None = None) -> dict:
        item = {
            "id": uuid.uuid4().hex, "design_id": design_id, "design_revision": revision,
            "created_at": datetime.now(UTC).isoformat(), "status": "completed",
            "input": frozen, "input_hash": digest(frozen), "result": result,
            "result_hash": digest(result), "source_run_id": source_run_id,
        }
        with self.connect() as db:
            db.execute("INSERT INTO runs VALUES (?, ?, ?, ?)",
                       (item["id"], design_id, item["created_at"], canonical(item)))
        return item

    def get_run(self, run_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT document FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("实验不存在")
        return json.loads(row[0])

    def list_runs(self, design_id: str) -> list[dict]:
        self.get_design(design_id)
        with self.connect() as db:
            rows = db.execute("SELECT document FROM runs WHERE design_id=? "
                              "ORDER BY created_at DESC LIMIT 100", (design_id,)).fetchall()
        return [{k: v for k, v in json.loads(row[0]).items() if k not in ("input", "result")}
                for row in rows]

    def bind_session(self, session_id: str, design: dict) -> dict:
        item = {"id": session_id, "design_id": design["id"], "revision": design["revision"]}
        with self.connect() as db:
            db.execute("INSERT INTO agent_sessions VALUES (?, ?)", (session_id, canonical(item)))
        return item

    def get_session(self, session_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT document FROM agent_sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise KeyError("当前模块未绑定此 OpenCode 会话")
        return json.loads(row[0])
