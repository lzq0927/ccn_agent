import gc
import os
import tempfile

from agents.shared.storage import Storage


def test_loop_iterations_supports_live_columns():
    with tempfile.TemporaryDirectory() as d:
        db = os.path.join(d, "test.db")
        s = Storage(db_path=db)
        s.record_live_session(
            session_id="sess_001",
            scenario_id="F",
            runner_state="running",
            llm_mode="stub",
        )
        rows = s.list_live_sessions()
        assert len(rows) == 1
        assert rows[0]["session_id"] == "sess_001"
        assert rows[0]["scenario_id"] == "F"
        assert rows[0]["runner_state"] == "running"
        assert rows[0]["llm_mode"] == "stub"
        assert rows[0]["restart_count"] == 0
        gc.collect()
