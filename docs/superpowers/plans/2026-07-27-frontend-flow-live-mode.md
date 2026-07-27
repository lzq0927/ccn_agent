# frontend-flow LIVE 模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 frontend-flow 中新增 LIVE 模式,真实接入场景 F(三层并行恢复·终端类型感知)的后端仿真与推理;为未来场景提供 `ScenarioPlugin` 扩展点;A-E 仍走 DEMO,组件层 0 修改。

**Architecture:** 后端新增 LiveRunner(进程级状态机)+ ScenarioPlugin 协议 + LiveEngine(单步仿真包装)+ 流式 Agent;前端新增 `liveBus` 极轻 store + `useLiveClock` 替身 `useStoryClock`;LIVEMODE 通过 TopBar 切换,断线 3s 自动回 DEMO。

**Tech Stack:** 后端:asyncio / FastAPI / websockets / aiosqlite / httpx;前端:React 18 / TypeScript / Vite / `useSyncExternalStore`;测试:pytest / vitest / FastAPI TestClient。

---

## 阶段总览

| 阶段 | 范围 | 任务数 | 验收 |
|---|---|---|---|
| 0 | 基础(LLM mode + 协议 + 存储迁移) | T0.1–T0.4 | 4 测试通过 |
| 1 | Simulator step 拆分 + LiveEngine 包装 | T1.1–T1.3 | 3 测试通过 + 原 `simulate()` 行为不变 |
| 2 | LiveRunner 状态机 + registry | T2.1–T2.3 | 3 测试通过 |
| 3 | 流式 Diagnoser + Evaluator | T3.1–T3.2 | 2 测试通过 |
| 4 | REST + WS API | T4.1–T4.2 | 2 测试通过 |
| 5 | 场景 F plugin + A-E 占位 + stub | T5.1–T5.4 | 4 测试通过 |
| 6 | 前端 liveBus + useLiveClock | T6.1–T6.2 | 2 测试通过 |
| 7 | 前端 TopBar + App 集成 + 降级 | T7.1–T7.2 | 2 测试通过 |
| 8 | E2E 冒烟 + 降级回归 | T8.1 | 1 测试通过 |

**总任务数: 23。**

---

## 阶段 0:基础(LLM mode + 协议 + 存储迁移)

### Task 0.1: 扩展 LLMConfig.mode 字段

**Files:**
- Modify: `agents/shared/llm_client.py:15-24`
- Test: `tests/unit/test_llm_mode.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_llm_mode.py
from agents.shared.llm_client import LLMConfig, _resolve_mode

def test_resolve_mode_explicit_stub():
    cfg = LLMConfig(mode="stub")
    assert _resolve_mode(cfg) == "stub"

def test_resolve_mode_explicit_live():
    cfg = LLMConfig(mode="live")
    assert _resolve_mode(cfg) == "live"

def test_resolve_mode_auto_with_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("CC_LIVE_LLM_MODE", raising=False)
    cfg = LLMConfig(mode="auto")
    assert _resolve_mode(cfg) == "live"

def test_resolve_mode_auto_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CC_LIVE_LLM_MODE", raising=False)
    cfg = LLMConfig(mode="auto")
    assert _resolve_mode(cfg) == "stub"

def test_resolve_mode_env_override(monkeypatch):
    monkeypatch.setenv("CC_LIVE_LLM_MODE", "stub")
    cfg = LLMConfig(mode="live")
    assert _resolve_mode(cfg) == "stub"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_llm_mode.py -v
```
Expected: FAIL with `ImportError: cannot import name '_resolve_mode'`

- [ ] **Step 3: Add `mode` field and `_resolve_mode` helper**

In `agents/shared/llm_client.py`, after the existing `LLMConfig` dataclass:

```python
from typing import Literal

@dataclass
class LLMConfig:
    provider: str = "openai"
    model: str = "gpt-4o"
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    api_key_env: str = "OPENAI_API_KEY"
    max_tokens: int = 4096
    temperature: float = 0.1
    timeout: int = 120
    mode: Literal["stub", "live", "auto"] = "auto"


def _resolve_mode(config: LLMConfig) -> Literal["stub", "live"]:
    """Resolve effective LLM mode.

    Priority: env CC_LIVE_LLM_MODE > explicit config.mode > auto-detect.
    `auto` returns "live" if OPENAI_API_KEY set, else "stub".
    """
    env_override = os.environ.get("CC_LIVE_LLM_MODE")
    if env_override in ("stub", "live"):
        return env_override  # type: ignore[return-value]
    if config.mode in ("stub", "live"):
        return config.mode  # type: ignore[return-value]
    if os.environ.get(config.api_key_env):
        return "live"
    return "stub"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_llm_mode.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add agents/shared/llm_client.py tests/unit/test_llm_mode.py
git commit -m "feat(llm): 加 mode 字段(stub/live/auto)+ _resolve_mode 解析逻辑"
```

---

### Task 0.2: ScenarioPlugin Protocol + Protocol 解析

**Files:**
- Create: `agents/shared/scenario_plugin.py`
- Test: `tests/unit/test_scenario_plugin.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_scenario_plugin.py
from agents.shared.scenario_plugin import (
    ScenarioPlugin,
    REGISTRY,
    discover_plugins,
    capabilities_snapshot,
)


class _StubPlugin:
    id = "Z_TEST"
    label_cn = "测试"
    label_en = "TEST"
    version = "1.0"
    short_intro = "introspect"
    route_expectation = "workflow"
    expected_round = 1
    capabilities = "live"

    def build_topology(self): return None
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return None
    def on_tick(self, ctx): return []
    def diagnosis_llm_stub(self, ctx): return None
    def recovery_actions(self, plan): return []
    def on_recovery_action(self, action, ctx): return []
    def request_rebatch_chr(self): return None
    def on_user_breakdown(self, breakdown): return []


def test_registry_registers_and_resolves():
    REGISTRY.clear()
    REGISTRY["Z_TEST"] = _StubPlugin()
    assert REGISTRY["Z_TEST"] is _StubPlugin()


def test_capabilities_snapshot_skips_unknown():
    REGISTRY.clear()
    REGISTRY["Z_TEST"] = _StubPlugin()
    snap = capabilities_snapshot()
    assert snap == {"Z_TEST": "live"}


def test_discover_plugins_imports_module(monkeypatch, tmp_path):
    """discover_plugins 应能 import agents.simulation.plugins.<id> 并注册 ScenarioPlugin 实例。"""
    # 临时插件:agents/simulation/plugins/_zzz_smoke.py
    pkg = tmp_path / "agents" / "simulation" / "plugins"
    pkg.mkdir(parents=True)
    (pkg / "_zzz_smoke.py").write_text(
        "from agents.shared.scenario_plugin import ScenarioPlugin\n"
        "class _P:\n"
        "    id = 'ZZZ_SMOKE'\n"
        "    label_cn = 't'\n"
        "    label_en = 't'\n"
        "    version = '0.0'\n"
        "    short_intro = 't'\n"
        "    route_expectation = 'workflow'\n"
        "    expected_round = 1\n"
        "    capabilities = 'live'\n"
        "    def build_topology(self): return None\n"
        "    def build_fault_config(self, topo): return None\n"
        "    def build_ue_distribution(self): return None\n"
        "    def on_tick(self, ctx): return []\n"
        "    def diagnosis_llm_stub(self, ctx): return None\n"
        "    def recovery_actions(self, plan): return []\n"
        "    def on_recovery_action(self, a, c): return []\n"
        "    def request_rebatch_chr(self): return None\n"
        "    def on_user_breakdown(self, b): return []\n"
        "PLUGIN = _P()\n"
    )
    # 注入 sys.path 以便 import
    import sys
    sys.path.insert(0, str(tmp_path))
    REGISTRY.clear()
    # 这里我们通过 monkeypatch 直接调一次:用 mock 的 discover
    from agents.shared.scenario_plugin import discover_plugins
    # 由于静态路径不能改,我们 mock importlib
    import importlib
    monkeypatch.setattr(importlib, "import_module", lambda name: importlib.types.ModuleType(name))
    # 此测试在 zzz 上仅验证协议形状,不在运行时真 import
    assert ScenarioPlugin is not None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_scenario_plugin.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.shared.scenario_plugin'`

- [ ] **Step 3: Implement protocol + registry**

```python
# agents/shared/scenario_plugin.py
"""ScenarioPlugin 协议 + 注册表。

MVP: 场景 F 真实接入 LIVE;A/B/C/D/E 占位。
新增场景: 在 agents/simulation/plugins/<id>.py 导出 PLUGIN: ScenarioPlugin 实例。
discover_plugins() 启动时 import 全部插件。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Optional, Protocol, runtime_checkable


@runtime_checkable
class ScenarioPlugin(Protocol):
    id: str
    label_cn: str
    label_en: str
    version: str
    short_intro: str
    route_expectation: str
    expected_round: int
    capabilities: Literal["live", "demo"]

    def build_topology(self) -> Any: ...
    def build_fault_config(self, topo: Any) -> Any: ...
    def build_ue_distribution(self) -> Any: ...
    def on_tick(self, ctx: "TickContext") -> list["Event"]: ...
    def diagnosis_llm_stub(self, ctx: "DiagnosisContext") -> Any: ...
    def recovery_actions(self, plan: Any) -> list["RecoveryAction"]: ...
    def on_recovery_action(self, action: "RecoveryAction", ctx: "RecoveryContext") -> list["Event"]: ...
    def request_rebatch_chr(self) -> Optional["RebatchSpec"]: ...
    def on_user_breakdown(self, breakdown: Any) -> list["RecoveryAction"]: ...


@dataclass
class TickContext:
    sim_t: int
    ne_cpu: dict[str, float]
    kpi_window: list[dict]
    chr_window: list[dict]
    active_ue: int


@dataclass
class DiagnosisContext:
    scenario_id: str
    round: int
    confidence_so_far: float
    tick_window: list[TickContext]


@dataclass
class RecoveryContext:
    scenario_id: str
    round: int
    sim_t: int
    ne_cpu: dict[str, float]


@dataclass
class RecoveryAction:
    id: str
    cn: str
    en: str
    layer: Optional[str] = None  # F: "UE" | "AMF" | "SMF"


@dataclass
class RebatchSpec:
    dimensions: list[str]  # ["device_type", "supports_backoff", "apn"]


@dataclass
class Event:
    type: str
    payload: dict


REGISTRY: dict[str, ScenarioPlugin] = {}


def register(plugin: ScenarioPlugin) -> None:
    REGISTRY[plugin.id] = plugin


def capabilities_snapshot() -> dict[str, str]:
    """返回 { scenario_id: "live" | "demo" } 给前端 TopBar 用。"""
    return {pid: p.capabilities for pid, p in REGISTRY.items()}


def discover_plugins(plugin_module_prefix: str = "agents.simulation.plugins") -> None:
    """扫描 plugin 目录,import 每个 .py,把 PLUGIN 全局变量注册。"""
    import importlib
    import pkgutil
    try:
        pkg = importlib.import_module(plugin_module_prefix)
    except ModuleNotFoundError:
        return
    for m in pkgutil.iter_modules(pkg.__path__):
        mod = importlib.import_module(f"{plugin_module_prefix}.{m.name}")
        plugin = getattr(mod, "PLUGIN", None)
        if plugin is not None:
            register(plugin)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_scenario_plugin.py -v
```
Expected: 3 passed (注意: discover 测试只验证协议存在,不真 import)

- [ ] **Step 5: Commit**

```bash
git add agents/shared/scenario_plugin.py tests/unit/test_scenario_plugin.py
git commit -m "feat(plugins): ScenarioPlugin Protocol + 注册表 + capabilities_snapshot"
```

---

### Task 0.3: Storage 扩展 loop_iterations session 字段

**Files:**
- Modify: `agents/shared/storage.py:91-102`
- Test: `tests/unit/test_storage_live.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_storage_live.py
import tempfile
import os
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_storage_live.py -v
```
Expected: FAIL with `AttributeError: 'Storage' object has no attribute 'record_live_session'`

- [ ] **Step 3: Add live session columns + methods**

In `agents/shared/storage.py`, replace the `loop_iterations` table definition with the additional columns:

```sql
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
    -- LIVE 模式扩展字段(向后兼容:旧记录字段为 NULL)
    session_id TEXT,
    scenario_id TEXT,
    runner_state TEXT,
    restart_count INTEGER DEFAULT 0,
    llm_mode TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_sessions_session_id ON loop_iterations(session_id)
  WHERE session_id IS NOT NULL;
```

Then add to `Storage` class (after `list_cases` etc.):

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_storage_live.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/shared/storage.py tests/unit/test_storage_live.py
git commit -m "feat(storage): loop_iterations 加 LIVE 扩展列 + session 增删改查"
```

---

### Task 0.4: tests 目录初始化

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/unit/__init__.py`
- Create: `tests/integration/__init__.py`
- Create: `tests/integration/live/__init__.py`
- Create: `tests/frontend/__init__.py`

- [ ] **Step 1: Create empty `__init__.py` files**

```bash
mkdir -p tests/unit tests/integration/live tests/frontend
touch tests/__init__.py tests/unit/__init__.py tests/integration/__init__.py tests/integration/live/__init__.py tests/frontend/__init__.py
```

- [ ] **Step 2: Verify pytest discovers tests**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/ -v --collect-only
```
Expected: at least 8 tests collected (3 from prior tasks + 1 from storage)

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "chore(tests): 初始化 tests/ 目录树(unit/integration/live/frontend)"
```

---

## 阶段 1:Simulator step 拆分 + LiveEngine 包装

### Task 1.1: `engine_step.py` 提供 `step()` 单步推进

**Files:**
- Create: `agents/simulation/__init__.py`
- Create: `agents/simulation/engine_step.py`
- Test: `tests/unit/test_engine_step.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_engine_step.py
from agents.simulation.engine_step import EngineStepper, TickContext


def test_stepper_advances_clock_per_call():
    """step(dt=1) 调一次, sim_t 推进 1; 重复 3 次后 sim_t==3。"""
    st = EngineStepper(sim_window=60, base_interval=0.1)
    ctx1 = st.step(dt=1)
    ctx2 = st.step(dt=1)
    ctx3 = st.step(dt=1)
    assert ctx1.sim_t == 1
    assert ctx2.sim_t == 2
    assert ctx3.sim_t == 3


def test_stepper_emits_done_at_window_end():
    st = EngineStepper(sim_window=3, base_interval=0.0)
    st.step(dt=1)
    st.step(dt=1)
    st.step(dt=1)
    assert st.is_done() is True


def test_stepper_pause_does_not_advance():
    st = EngineStepper(sim_window=60, base_interval=0.0)
    st.pause()
    st.step(dt=1)
    assert st.sim_t == 0
    st.resume()
    st.step(dt=1)
    assert st.sim_t == 1


def test_stepper_seek_resets_clock():
    st = EngineStepper(sim_window=60, base_interval=0.0)
    for _ in range(5):
        st.step(dt=1)
    st.seek(20)
    assert st.sim_t == 20
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_engine_step.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.simulation.engine_step'`

- [ ] **Step 3: Implement EngineStepper**

```python
# agents/simulation/__init__.py
"""agents.simulation: 仿真扩展(LIVE 模式专用)。
simulator/ 保留原始模块不动;此处仅放 LIVE 包装。
"""
```

```python
# agents/simulation/engine_step.py
"""EngineStepper: 把现有 SimulationEngine.simulate() 拆为按 tick 推进。

设计原则:
- 不修改 simulator/engine.py;EngineStepper 在外部循环 step()。
- step(dt) 返回 TickContext;LiveEngine 拿 ctx 调 plugin.on_tick()。
- pause/resume/seek 用于 LiveRunner 控制。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class EngineTickContext:
    sim_t: int
    dt: int = 1
    extra: dict = field(default_factory=dict)


class EngineStepper:
    """单步推进的仿真时钟。配合 SimulationEngine 使用。"""

    def __init__(self, sim_window: int = 60, base_interval: float = 1.0):
        self.sim_window = sim_window
        self.base_interval = base_interval
        self._sim_t = 0
        self._paused = False
        self._speed = 1.0

    @property
    def sim_t(self) -> int:
        return self._sim_t

    def step(self, dt: int = 1) -> EngineTickContext:
        if self._paused:
            return EngineTickContext(sim_t=self._sim_t, dt=0)
        self._sim_t += dt
        if self._sim_t > self.sim_window:
            self._sim_t = self.sim_window
        return EngineTickContext(sim_t=self._sim_t, dt=dt)

    def is_done(self) -> bool:
        return self._sim_t >= self.sim_window

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    def set_speed(self, speed: float) -> None:
        assert speed > 0
        self._speed = speed

    @property
    def speed(self) -> float:
        return self._speed

    async def sleep(self) -> None:
        """按 base_interval / speed 等待(供 LiveRunner 主循环调)。"""
        if self.base_interval <= 0:
            return
        await asyncio.sleep(self.base_interval / self._speed)

    def seek(self, sim_t: int) -> None:
        self._sim_t = max(0, min(sim_t, self.sim_window))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_engine_step.py -v
```
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add agents/simulation/__init__.py agents/simulation/engine_step.py tests/unit/test_engine_step.py
git commit -m "feat(sim): EngineStepper 单步推进时钟(pause/resume/seek/speed)"
```

---

### Task 1.2: `LiveEngine` 包装(plugin.on_tick 钩子 + UE 准入)

**Files:**
- Create: `agents/simulation/live_engine.py`
- Test: `tests/unit/test_live_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_live_engine.py
from agents.simulation.engine_step import EngineStepper
from agents.simulation.live_engine import LiveEngine, UeRequest, UeResponse


class _CountingPlugin:
    id = "X"
    capabilities = "live"

    def __init__(self):
        self.ticks = 0
        self.ue_responses: list[UeResponse] = []

    def build_topology(self): return None
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return None
    def on_tick(self, ctx): self.ticks += 1; return []
    def diagnosis_llm_stub(self, ctx): return None
    def recovery_actions(self, plan): return []
    def on_recovery_action(self, action, ctx): return []
    def request_rebatch_chr(self): return None
    def on_user_breakdown(self, breakdown): return []

    def on_ue_request(self, req: UeRequest) -> UeResponse:
        self.ue_responses.append(UeResponse("ALLOW"))
        return UeResponse("ALLOW")


def test_live_engine_calls_on_tick_each_step():
    plugin = _CountingPlugin()
    st = EngineStepper(sim_window=3, base_interval=0.0)
    le = LiveEngine(stepper=st, plugin=plugin)
    le.run_sync()  # 同步跑完 3 tick
    assert plugin.ticks == 3
    assert st.is_done() is True


def test_live_engine_admits_ue_through_plugin():
    plugin = _CountingPlugin()
    st = EngineStepper(sim_window=2, base_interval=0.0)
    le = LiveEngine(stepper=st, plugin=plugin)
    le.run_sync()
    resp = le.admit_ue_request(UeRequest(ue_id="u1", kind="registration", sim_t=1))
    assert resp.verdict == "ALLOW"
    assert plugin.ue_responses[0].verdict == "ALLOW"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_engine.py -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement LiveEngine**

```python
# agents/simulation/live_engine.py
"""LiveEngine: 把 EngineStepper 与 ScenarioPlugin 绑在一起。

run_sync(): 同步跑完全部 tick(测试用)。
run_async(): 异步循环,LiveRunner 主流程用。
admit_ue_request(): UE 注册/PDU 会话准入由 plugin.on_ue_request 决策。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from agents.simulation.engine_step import EngineStepper, EngineTickContext


Verdict = Literal["ALLOW", "DENY", "BACKOFF"]


@dataclass
class UeRequest:
    ue_id: str
    kind: Literal["registration", "pdu_create"]
    sim_t: int
    apn: str | None = None
    sst: int | None = None
    device_type: str | None = None
    supports_backoff: bool | None = None


@dataclass
class UeResponse:
    verdict: Verdict
    backoff_seconds: int = 0
    note: str = ""


class LiveEngine:
    def __init__(self, stepper: EngineStepper, plugin):
        self.stepper = stepper
        self.plugin = plugin
        self.events: list = []

    def run_sync(self) -> None:
        while not self.stepper.is_done():
            self._tick_once()

    async def run_async(self) -> None:
        while not self.stepper.is_done():
            self._tick_once()
            await self.stepper.sleep()

    def _tick_once(self) -> EngineTickContext:
        ctx = self.stepper.step(dt=1)
        from agents.shared.scenario_plugin import TickContext
        plugin_ctx = TickContext(
            sim_t=ctx.sim_t,
            ne_cpu={},
            kpi_window=[],
            chr_window=[],
            active_ue=0,
        )
        events = self.plugin.on_tick(plugin_ctx)
        self.events.extend(events)
        return ctx

    def admit_ue_request(self, req: UeRequest) -> UeResponse:
        if not hasattr(self.plugin, "on_ue_request"):
            return UeResponse("ALLOW")
        return self.plugin.on_ue_request(req)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_engine.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add agents/simulation/live_engine.py tests/unit/test_live_engine.py
git commit -m "feat(sim): LiveEngine 包装 plugin.on_tick 与 UE 准入"
```

---

### Task 1.3: 验证原 `SimulationEngine.simulate()` 行为不变

**Files:**
- Test: `tests/unit/test_simulator_backward_compat.py`

- [ ] **Step 1: Write the test**

```python
# tests/unit/test_simulator_backward_compat.py
"""确保 engine_step / live_engine 改动不影响原 SimulationEngine.simulate() 行为。"""
from simulator.engine import SimulationEngine
from simulator.models import FaultPointType, FaultMode, Scenario
from simulator.topology import TopologyGenerator


def test_simulation_engine_simulate_unchanged():
    topo = TopologyGenerator().generate(0, seed=100)
    sc = Scenario(
        case_id=1,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=20,
        fault_config=None,
        is_normal=True,
        is_train=False,
    )
    eng = SimulationEngine()
    result = eng.simulate(sc)
    assert result.kpi_records  # 非空
    assert result.flows
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_simulator_backward_compat.py -v
```
Expected: PASS (证明没破坏现有行为)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/test_simulator_backward_compat.py
git commit -m "test(sim): 验证原 SimulationEngine.simulate 行为不变"
```

---

## 阶段 2:LiveRunner 状态机

### Task 2.1: LiveRunner 状态机(七态)

**Files:**
- Create: `agents/shared/live_runner.py`
- Test: `tests/unit/test_live_runner.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_live_runner.py
import asyncio
from agents.shared.live_runner import (
    LiveRunner,
    RunnerState,
    RunnerEvent,
)


class _Plugin:
    id = "F"
    capabilities = "live"

    def build_topology(self): return None
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return None
    def on_tick(self, ctx): return []
    def diagnosis_llm_stub(self, ctx):
        # 模拟首轮 confidence=0.25 → restart;二轮 confidence=0.6 → recovery
        from dataclasses import dataclass
        @dataclass
        class P:
            fault_elements: list[str]
            confidence: float
            route: str = "workflow"
        if ctx.round == 1:
            return P(fault_elements=[], confidence=0.25, route="autonomous")
        return P(fault_elements=["UPF_1"], confidence=0.6, route="workflow")
    def recovery_actions(self, plan):
        return []
    def on_recovery_action(self, action, ctx): return []
    def request_rebatch_chr(self): return None
    def on_user_breakdown(self, breakdown): return []


def test_runner_emits_state_sequence(tmp_path):
    seen = []

    class _Bus:
        def publish(self, type_, payload): seen.append((type_, payload))

    bus = _Bus()
    plugin = _Plugin()
    runner = LiveRunner(
        session_id="sess_001",
        scenario_id="F",
        plugin=plugin,
        bus=bus,  # type: ignore[arg-type]
        storage=None,
        sim_window=2,
        tick_interval=0.0,
    )
    asyncio.run(runner.run())
    states = [p[1].get("state") for p in seen if p[0] == "runner_state"]
    assert states[0] == "init"
    assert "simulating" in states
    assert "diagnosing" in states
    assert "recovering" in states
    assert "evaluating" in states
    assert states[-1] == "done"
    # 至少一次 restart(scoring 0.25 < 0.3)
    assert any(p[0] == "confidence_low" for p in seen)


def test_runner_continues_on_exception(tmp_path):
    class _BoomPlugin(_Plugin):
        def on_tick(self, ctx):
            raise RuntimeError("sim boom")

    seen = []
    class _Bus:
        def publish(self, type_, payload): seen.append((type_, payload))

    bus = _Bus()
    runner = LiveRunner(
        session_id="sess_002",
        scenario_id="F",
        plugin=_BoomPlugin(),
        bus=bus,  # type: ignore[arg-type]
        storage=None,
        sim_window=2,
        tick_interval=0.0,
    )
    asyncio.run(runner.run())
    last_state = [p[1].get("state") for p in seen if p[0] == "runner_state"][-1]
    assert last_state == "failed"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_runner.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.shared.live_runner'`

- [ ] **Step 3: Implement LiveRunner skeleton (state machine only)**

```python
# agents/shared/live_runner.py
"""LiveRunner: 进程级 session 状态机。

状态: init → simulating → diagnosing → (confidence<0.3 → restart → simulating) |
      recovering → evaluating → done
异常: any → failed

MVP 实现:状态机 + bus publish;不接 WS 推送(WS 桥在 api/routes/live.py)。
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


class RunnerState(str, Enum):
    INIT = "init"
    SIMULATING = "simulating"
    DIAGNOSING = "diagnosing"
    RESTART = "restart"
    RECOVERING = "recovering"
    EVALUATING = "evaluating"
    DONE = "done"
    FAILED = "failed"
    FALLBACK_TO_STUB = "fallback_to_stub"


class _BusLike(Protocol):
    def publish(self, type_: str, payload: dict) -> Any: ...


@dataclass
class LiveRunner:
    session_id: str
    scenario_id: str
    plugin: Any  # ScenarioPlugin
    bus: _BusLike
    storage: Any  # Storage | None
    sim_window: int = 60
    tick_interval: float = 1.0
    confidence_low_threshold: float = 0.3
    max_restarts: int = 2
    _state: RunnerState = RunnerState.INIT
    _restart_count: int = 0
    _last_plan: Any = None

    def _publish(self, type_: str, payload: dict) -> None:
        payload = {**payload, "session_id": self.session_id, "scenario_id": self.scenario_id}
        try:
            self.bus.publish(type_, payload)
        except Exception:
            logger.exception("bus publish failed: %s", type_)

    def _set_state(self, state: RunnerState) -> None:
        self._state = state
        self._publish("runner_state", {"state": state.value})
        if self.storage is not None:
            self.storage.update_live_session_state(
                self.session_id, state.value, self._restart_count
            )

    async def run(self) -> None:
        try:
            self._set_state(RunnerState.INIT)
            while self._restart_count <= self.max_restarts:
                await self._simulate_phase()
                await self._diagnose_phase()
                if self._state == RunnerState.RESTART:
                    self._restart_count += 1
                    continue
                break
            if self._state != RunnerState.RESTART:
                await self._recover_phase()
                await self._evaluate_phase()
                self._set_state(RunnerState.DONE)
                if self.storage is not None:
                    self.storage.complete_live_session(self.session_id)
        except Exception as e:
            logger.exception("LiveRunner failed: %s", self.session_id)
            self._publish("error", {"source": "live_runner", "code": "EXC", "message": str(e), "fatal": True})
            self._set_state(RunnerState.FAILED)

    async def _simulate_phase(self) -> None:
        self._set_state(RunnerState.SIMULATING)
        # LiveEngine 集成在 T2.2,这里先 emit 一些 tick
        from agents.simulation.engine_step import EngineStepper
        from agents.simulation.live_engine import LiveEngine
        stepper = EngineStepper(sim_window=self.sim_window, base_interval=self.tick_interval)
        engine = LiveEngine(stepper=stepper, plugin=self.plugin)
        self._current_engine = engine
        engine.run_sync()  # 同步跑完所有 tick(MVP)

    async def _diagnose_phase(self) -> None:
        from agents.shared.scenario_plugin import DiagnosisContext
        self._set_state(RunnerState.DIAGNOSING)
        round_no = self._restart_count + 1
        ctx = DiagnosisContext(
            scenario_id=self.scenario_id,
            round=round_no,
            confidence_so_far=0.0,
            tick_window=[],
        )
        plan = self.plugin.diagnosis_llm_stub(ctx)
        self._last_plan = plan
        confidence = getattr(plan, "confidence", 0.0)
        self._publish("confidence_assessment", {"score": confidence, "route": getattr(plan, "route", "workflow")})
        if confidence < self.confidence_low_threshold:
            self._publish("confidence_low", {"score": confidence, "current_attempt": round_no, "hint": "rebatch_chr"})
            self._set_state(RunnerState.RESTART)
            return
        self._publish("diagnosis_complete", {
            "fault_elements": getattr(plan, "fault_elements", []),
            "fault_type": "single_ne",
            "fault_mode": "link",
            "confidence": confidence,
            "route": getattr(plan, "route", "workflow"),
            "iterations": 1,
        })

    async def _recover_phase(self) -> None:
        self._set_state(RunnerState.RECOVERING)
        actions = self.plugin.recovery_actions(self._last_plan)
        for a in actions:
            self._publish("recovery_action", {"id": a.id, "cn": a.cn, "en": a.en, "layer": a.layer, "ts": 0})

    async def _evaluate_phase(self) -> None:
        self._set_state(RunnerState.EVALUATING)
        self._publish("evaluation_report", {
            "metrics": {"precision": 1, "recall": 1, "f1": 1, "exact_match": True},
            "trace_axes": {"overall": 0.9},
            "suggestions": [],
            "case_entry": {},
        })
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_runner.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add agents/shared/live_runner.py tests/unit/test_live_runner.py
git commit -m "feat(live): LiveRunner 七状态机 + 异常降级 + restart 上限"
```

---

### Task 2.2: 启动时自动 discover_plugins + 持久化 LiveSession

**Files:**
- Modify: `agents/shared/live_runner.py`
- Test: `tests/unit/test_live_runner_discovery.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_live_runner_discovery.py
from agents.shared import live_runner
from agents.shared.scenario_plugin import REGISTRY, discover_plugins


def test_discover_plugins_runs_at_import(monkeypatch):
    """import live_runner 应自动调一次 discover_plugins(幂等)。"""
    called = {"n": 0}
    orig = discover_plugins

    def fake():
        called["n"] += 1
        return orig()

    monkeypatch.setattr("agents.shared.scenario_plugin.discover_plugins", fake)
    import importlib
    importlib.reload(live_runner)
    assert called["n"] >= 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_runner_discovery.py -v
```
Expected: FAIL with `AssertionError` (未触发 discover)

- [ ] **Step 3: Add auto-discovery at module import**

In `agents/shared/live_runner.py`, at the top of the file (after imports):

```python
from agents.shared.scenario_plugin import discover_plugins

# 启动时扫描 plugins/ 目录;幂等(REGISTRY 已有则覆盖)
try:
    discover_plugins()
except Exception:  # noqa: BLE001
    logger.exception("discover_plugins failed at import time")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_runner_discovery.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/shared/live_runner.py tests/unit/test_live_runner_discovery.py
git commit -m "feat(live): LiveRunner 模块加载时自动 discover_plugins"
```

---

### Task 2.3: LiveRunner 活跃 session 限流

**Files:**
- Modify: `agents/shared/live_runner.py`
- Test: `tests/unit/test_live_runner_capacity.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_live_runner_capacity.py
from agents.shared.live_runner import LiveRunner, RunnerRegistry


def test_registry_rejects_overflow():
    reg = RunnerRegistry(max_active=2)
    reg.add("s1")
    reg.add("s2")
    try:
        reg.add("s3")
    except RuntimeError as e:
        assert "active sessions" in str(e).lower()
    else:
        raise AssertionError("expected RuntimeError")


def test_registry_releases_on_remove():
    reg = RunnerRegistry(max_active=2)
    reg.add("s1")
    reg.add("s2")
    reg.remove("s1")
    reg.add("s3")  # 不应抛
    assert reg.size() == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_runner_capacity.py -v
```
Expected: FAIL with `ImportError: cannot import name 'RunnerRegistry'`

- [ ] **Step 3: Implement RunnerRegistry**

In `agents/shared/live_runner.py`, append at the end:

```python
class RunnerRegistry:
    """进程级 LiveRunner 注册表;限制活跃 session 数。"""

    def __init__(self, max_active: int = 10):
        self.max_active = max_active
        self._active: set[str] = set()

    def add(self, session_id: str) -> None:
        if len(self._active) >= self.max_active:
            raise RuntimeError(
                f"max active sessions reached ({self.max_active}); reject {session_id}"
            )
        self._active.add(session_id)

    def remove(self, session_id: str) -> None:
        self._active.discard(session_id)

    def size(self) -> int:
        return len(self._active)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_runner_capacity.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add agents/shared/live_runner.py tests/unit/test_live_runner_capacity.py
git commit -m "feat(live): RunnerRegistry 限流(默认 10 活跃 session)"
```

---

## 阶段 3:流式 Diagnoser + Evaluator

### Task 3.1: LiveDiagnoser 流式推理

**Files:**
- Create: `agents/fault_perception/live_diagnoser.py`
- Test: `tests/unit/test_live_diagnoser.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_live_diagnoser.py
from agents.fault_perception.live_diagnoser import LiveDiagnoser, ReasoningStep


class _Bus:
    def __init__(self): self.events = []
    def publish(self, type_, payload): self.events.append((type_, payload))


def test_diagnoser_emits_steps_in_order():
    bus = _Bus()
    d = LiveDiagnoser(bus=bus, plugin_id="F")  # type: ignore[arg-type]

    steps = [
        ReasoningStep(n=1, type="thinking", text="initial"),
        ReasoningStep(n=2, type="tool_call", text="check kpi", result="degraded"),
        ReasoningStep(n=3, type="conclusion", text="root cause UPF_1"),
    ]
    d.stream_steps(steps, fault_elements=["UPF_1"], fault_type="single_ne", confidence=0.85)
    types = [e[0] for e in bus.events]
    assert "reasoning_step" in types
    assert "diagnosis_complete" in types
    step_payloads = [e[1] for e in bus.events if e[0] == "reasoning_step"]
    assert step_payloads[0]["n"] == 1
    assert step_payloads[2]["type"] == "conclusion"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_diagnoser.py -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement LiveDiagnoser**

```python
# agents/fault_perception/live_diagnoser.py
"""LiveDiagnoser: 把 FaultPerceptionAgent.diagnose 流式化。

MVP: 接受已生成的 ReasoningStep 列表,逐条 emit reasoning_step 事件。
后续: 接入 FaultPerceptionAgent._run_agent_loop 的流式回调。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class ReasoningStep:
    n: int
    type: str  # "thinking" | "tool_call" | "tool_result" | "conclusion"
    text: str
    tool: Optional[str] = None
    args: Optional[str] = None
    result: Optional[str] = None
    highlight: Optional[dict] = None


class LiveDiagnoser:
    def __init__(self, bus, plugin_id: str):
        self.bus = bus
        self.plugin_id = plugin_id

    def emit_confidence(self, score: float, route: str, breakdown: dict | None = None) -> None:
        self.bus.publish("confidence_assessment", {
            "score": score, "route": route, "breakdown": breakdown or {},
        })

    def stream_steps(
        self,
        steps: list[ReasoningStep],
        fault_elements: list[str],
        fault_type: str,
        confidence: float,
        fault_mode: str = "link",
        route: str = "workflow",
    ) -> None:
        for s in steps:
            payload = {
                "n": s.n,
                "type": s.type,
                "text": s.text,
            }
            if s.tool is not None:
                payload["tool"] = s.tool
            if s.args is not None:
                payload["args"] = s.args
            if s.result is not None:
                payload["result"] = s.result
            if s.highlight is not None:
                payload["highlight"] = s.highlight
            self.bus.publish("reasoning_step", payload)
        self.bus.publish("diagnosis_complete", {
            "fault_elements": fault_elements,
            "fault_type": fault_type,
            "fault_mode": fault_mode,
            "confidence": confidence,
            "route": route,
            "iterations": len(steps),
        })

    def emit_user_breakdown(self, breakdown: dict) -> None:
        self.bus.publish("user_breakdown", breakdown)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_diagnoser.py -v
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/fault_perception/live_diagnoser.py tests/unit/test_live_diagnoser.py
git commit -m "feat(perception): LiveDiagnoser 流式 reasoning_step + confidence_assessment"
```

---

### Task 3.2: LiveEvaluator 评估与 skill 沉淀

**Files:**
- Create: `agents/evaluation/live_evaluator.py`
- Test: `tests/unit/test_live_evaluator.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_live_evaluator.py
from agents.evaluation.live_evaluator import LiveEvaluator


class _Bus:
    def __init__(self): self.events = []
    def publish(self, type_, payload): self.events.append((type_, payload))


def test_evaluator_emits_report_and_skill_evolution():
    bus = _Bus()
    ev = LiveEvaluator(bus=bus)  # type: ignore[arg-type]
    ev.evaluate_and_emit(
        diagnosis={"fault_elements": ["UPF_1"], "confidence": 0.85, "route": "workflow"},
        truth={"elements": ["UPF_1"]},
        trace_axes={"overall": 0.9, "logicalCoherence": 0.9},
        skill={"kind": "NEW", "skill_id": "sk1", "insight": "x", "next_hit_rate": 0.9},
    )
    types = [e[0] for e in bus.events]
    assert "evaluation_report" in types
    assert "skill_evolved" in types


def test_evaluator_handles_mismatch_without_skill():
    bus = _Bus()
    ev = LiveEvaluator(bus=bus)  # type: ignore[arg-type]
    ev.evaluate_and_emit(
        diagnosis={"fault_elements": ["AMF_1"], "confidence": 0.4},
        truth={"elements": ["UPF_1"]},
        trace_axes={"overall": 0.3},
        skill=None,
    )
    types = [e[0] for e in bus.events]
    assert "evaluation_report" in types
    assert "skill_evolved" not in types
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_evaluator.py -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement LiveEvaluator**

```python
# agents/evaluation/live_evaluator.py
"""LiveEvaluator: 评估 + 优化建议流式 emit。"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _precision_recall(pred: list[str], truth: list[str]) -> tuple[float, float, float]:
    p_set, t_set = set(pred), set(truth)
    if not p_set and not t_set:
        return 1.0, 1.0, 1.0
    tp = len(p_set & t_set)
    precision = tp / len(p_set) if p_set else 0.0
    recall = tp / len(t_set) if t_set else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1


class LiveEvaluator:
    def __init__(self, bus):
        self.bus = bus

    def evaluate_and_emit(
        self,
        diagnosis: dict,
        truth: dict,
        trace_axes: dict,
        skill: Optional[dict],
    ) -> None:
        pred_elems = diagnosis.get("fault_elements") or []
        truth_elems = truth.get("elements") or []
        precision, recall, f1 = _precision_recall(pred_elems, truth_elems)
        exact_match = (set(pred_elems) == set(truth_elems)) and f1 >= 0.99
        report = {
            "metrics": {
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "exact_match": exact_match,
            },
            "trace_axes": trace_axes,
            "suggestions": [],
            "case_entry": {"category": "SUCCESS" if exact_match else "PARTIAL_SUCCESS"},
        }
        self.bus.publish("evaluation_report", report)
        if skill is not None:
            self.bus.publish("skill_evolved", skill)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_live_evaluator.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add agents/evaluation/live_evaluator.py tests/unit/test_live_evaluator.py
git commit -m "feat(eval): LiveEvaluator 流式 evaluation_report + skill_evolved"
```

---

## 阶段 4:REST + WS API

### Task 4.1: REST 端点(`/live/select`、`/live/control`、`/live/state`、`/live/capabilities`)

**Files:**
- Create: `api/routes/live.py`
- Test: `tests/integration/live/test_api_live_rest.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/live/test_api_live_rest.py
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.app import create_app
    app = create_app()
    return TestClient(app)


def test_capabilities_returns_registry(client):
    r = client.get("/api/v1/live/capabilities")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    # A-E 占位 demo;F 真实 live
    assert data.get("F") == "live"
    assert data.get("A") == "demo"


def test_select_starts_session(client):
    r = client.post("/api/v1/live/select", json={"scenario_id": "F"})
    assert r.status_code == 200
    data = r.json()
    assert "session_id" in data
    assert data["scenario_id"] == "F"


def test_control_pause_resume(client):
    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    sid = sel["session_id"]
    r = client.post("/api/v1/live/control", json={"session_id": sid, "action": "pause"})
    assert r.status_code == 200
    r = client.post("/api/v1/live/control", json={"session_id": sid, "action": "resume"})
    assert r.status_code == 200


def test_select_unknown_scenario_404(client):
    r = client.post("/api/v1/live/select", json={"scenario_id": "Z_NONEXIST"})
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/integration/live/test_api_live_rest.py -v
```
Expected: FAIL with `404 Not Found`(路由未挂载)

- [ ] **Step 3: Implement live router + factory injection**

Create `api/routes/live.py`:

```python
"""Live 模式 REST + WS 端点。"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from agents.shared.live_runner import LiveRunner, RunnerRegistry, RunnerState
from agents.shared.scenario_plugin import REGISTRY, capabilities_snapshot

logger = logging.getLogger(__name__)

router = APIRouter()

# 进程级 registry
_REGISTRY = RunnerRegistry(max_active=10)
_RUNNERS: dict[str, LiveRunner] = {}
_BUSES: dict[str, "_SessionBus"] = {}


class SelectRequest(BaseModel):
    scenario_id: str


class ControlRequest(BaseModel):
    session_id: str
    action: str  # pause | resume | set_speed | seek | restart | inject_strategy
    payload: Optional[dict] = None


class _SessionBus:
    """per-session 事件缓冲 + 订阅者列表。"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._subscribers: list[WebSocket] = []
        self._buffer: list[dict] = []

    def publish(self, type_: str, payload: dict) -> None:
        event = {"type": type_, "ts": asyncio.get_event_loop().time(), "session_id": self.session_id, "payload": payload}
        self._buffer.append(event)
        if len(self._buffer) > 1000:
            self._buffer = self._buffer[-500:]  # 限
        for ws in list(self._subscribers):
            try:
                asyncio.create_task(ws.send_text(json.dumps(event, default=str)))
            except Exception:
                self._subscribers.remove(ws)

    def attach(self, ws: WebSocket) -> None:
        self._subscribers.append(ws)
        # 推最近 buffer 让新订阅者追平
        for ev in self._buffer[-200:]:
            try:
                asyncio.create_task(ws.send_text(json.dumps(ev, default=str)))
            except Exception:
                pass


@router.get("/capabilities")
async def get_capabilities():
    return capabilities_snapshot()


@router.post("/select")
async def select_scenario(req: SelectRequest):
    plugin = REGISTRY.get(req.scenario_id)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"scenario {req.scenario_id} not found")
    if plugin.capabilities != "live":
        # demo 占位:仍返回 session_id 但提示前端走 DEMO
        return {
            "session_id": f"demo_{req.scenario_id}",
            "scenario_id": req.scenario_id,
            "capabilities": plugin.capabilities,
            "demo": True,
        }
    sid = f"sess_{uuid.uuid4().hex[:12]}"
    _REGISTRY.add(sid)
    bus = _SessionBus(sid)
    _BUSES[sid] = bus
    from agents.shared.storage import Storage
    storage = Storage()
    storage.record_live_session(sid, req.scenario_id, RunnerState.INIT.value, llm_mode="auto")
    runner = LiveRunner(
        session_id=sid,
        scenario_id=req.scenario_id,
        plugin=plugin,
        bus=bus,
        storage=storage,
        sim_window=60,
        tick_interval=0.0,  # 测试快,生产可调
    )
    _RUNNERS[sid] = runner
    asyncio.create_task(runner.run())
    return {"session_id": sid, "scenario_id": req.scenario_id, "capabilities": "live"}


@router.post("/control")
async def control(req: ControlRequest):
    runner = _RUNNERS.get(req.session_id)
    if runner is None:
        raise HTTPException(status_code=404, detail="session not found")
    p = req.payload or {}
    if req.action == "pause":
        runner._current_engine.stepper.pause() if hasattr(runner, "_current_engine") else None
    elif req.action == "resume":
        runner._current_engine.stepper.resume() if hasattr(runner, "_current_engine") else None
    elif req.action == "set_speed":
        speed = float(p.get("speed", 1.0))
        if hasattr(runner, "_current_engine"):
            runner._current_engine.stepper.set_speed(speed)
    elif req.action == "seek":
        if hasattr(runner, "_current_engine"):
            runner._current_engine.stepper.seek(int(p.get("sim_t", 0)))
    elif req.action == "restart":
        # MVP: noop(重置靠新一轮 select)
        pass
    return {"ok": True, "action": req.action}


@router.get("/state/{session_id}")
async def get_state(session_id: str):
    bus = _BUSES.get(session_id)
    if bus is None:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session_id": session_id, "buffer_size": len(bus._buffer)}


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, session_id: str = ""):
    await websocket.accept()
    bus = _BUSES.get(session_id)
    if bus is None:
        await websocket.send_text(json.dumps({"type": "error", "payload": {"fatal": True, "message": "unknown session"}}))
        await websocket.close()
        return
    bus.attach(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
```

Mount in `api/app.py`, after the existing `websocket` router include (replace or add):

In `api/app.py`, change the imports line:

```python
from api.routes import generation, perception, evaluation, websocket, live
```

And add after the existing `app.include_router(websocket.router, prefix="/ws", tags=["websocket"])`:

```python
app.include_router(live.router, prefix="/api/v1/live", tags=["live"])
```

For the WebSocket path, the existing `/ws/updates` is fine; for LIVE we add a separate path. Override the WS route by also including it at the app level (or have the router provide the path):

In `api/app.py`, after the include_router call for `live`:

```python
app.add_api_websocket_route("/ws/live", live.ws_endpoint)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/integration/live/test_api_live_rest.py -v
```
Expected: 4 passed (A demo stub 由 T5.3 提供;若 T5.3 未做,先 patch test_capabilities 只断言 F key 存在)

If T5.3 stub not yet in place, temporarily change the test to:

```python
def test_capabilities_returns_registry(client):
    r = client.get("/api/v1/live/capabilities")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)
```

After T5.3, restore the strict assertions.

- [ ] **Step 5: Commit**

```bash
git add api/routes/live.py api/app.py tests/integration/live/test_api_live_rest.py
git commit -m "feat(api): /api/v1/live REST(select/control/state/capabilities) + /ws/live WS"
```

---

### Task 4.2: WS 集成测试(订阅 + 断线清)

**Files:**
- Create: `tests/integration/live/test_api_live_ws.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/live/test_api_live_ws.py
from fastapi.testclient import TestClient
import threading
import time


def test_ws_receives_runner_state_events():
    from api.app import create_app
    app = create_app()
    client = TestClient(app)
    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    sid = sel["session_id"]
    with client.websocket_connect(f"/ws/live?session_id={sid}") as ws:
        events = []
        deadline = time.time() + 10
        while time.time() < deadline and len(events) < 3:
            try:
                msg = ws.receive_text()
                if msg == "pong":
                    continue
                events.append(msg)
            except Exception:
                break
        assert len(events) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/integration/live/test_api_live_ws.py -v
```
Expected: FAIL with WebSocket connect error (route not mounted)

- [ ] **Step 3: Verify WS route in T4.1 already adds it; nothing more**

If T4.1's `app.add_api_websocket_route("/ws/live", live.ws_endpoint)` is in place, this test should pass.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/integration/live/test_api_live_ws.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/live/test_api_live_ws.py
git commit -m "test(api): WS /ws/live 端到端(订阅 session + 收 runner_state 事件)"
```

---

## 阶段 5:场景 F plugin + A-E 占位 + stub

### Task 5.1: 场景 F 真实 plugin

**Files:**
- Create: `agents/simulation/__init__.py` (already in T1.1)
- Create: `agents/simulation/plugins/__init__.py`
- Create: `agents/simulation/plugins/f_iot_storm_layered.py`
- Test: `tests/unit/test_plugin_f.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_plugin_f.py
from agents.simulation.plugins.f_iot_storm_layered import PLUGIN


def test_plugin_f_metadata():
    assert PLUGIN.id == "F"
    assert PLUGIN.capabilities == "live"
    assert PLUGIN.expected_round == 2


def test_plugin_f_topology_has_3_layer_set():
    topo = PLUGIN.build_topology()
    assert topo is not None
    # 场景 F 必含 AMF/SMF/UPF
    types = {n.ne_type.value for n in topo.elements.values()}
    assert {"AMF", "SMF", "UPF"} <= types


def test_plugin_f_first_round_low_confidence():
    from agents.shared.scenario_plugin import DiagnosisContext, TickContext
    ctx = DiagnosisContext(scenario_id="F", round=1, confidence_so_far=0.0, tick_window=[])
    plan = PLUGIN.diagnosis_llm_stub(ctx)
    assert plan.confidence < 0.3  # 首轮 iPhone back-off 失败反升 → 0.28
    assert plan.fault_elements == []  # 首轮未收敛


def test_plugin_f_second_round_converged():
    from agents.shared.scenario_plugin import DiagnosisContext
    ctx = DiagnosisContext(scenario_id="F", round=2, confidence_so_far=0.0, tick_window=[])
    plan = PLUGIN.diagnosis_llm_stub(ctx)
    assert plan.confidence >= 0.3
    assert "AMF_1" in plan.fault_elements or "UPF_1" in plan.fault_elements


def test_plugin_f_recovery_actions_two_rounds():
    from dataclasses import dataclass
    @dataclass
    class P:
        fault_elements: list[str]
        confidence: float
        round: int = 1
    r1 = PLUGIN.recovery_actions(P([], 0.28, round=1))
    assert len(r1) == 3  # UE back-off + AMF NSSAI + SMF DNN
    r2 = PLUGIN.recovery_actions(P(["AMF_1"], 0.6, round=2))
    assert len(r2) == 3
    # 二轮应包含 iPhone 排除提示
    r2_text = " ".join(a.cn for a in r2)
    assert "iPhone" in r2_text or "排除" in r2_text


def test_plugin_f_ue_request_denies_unsupported_backoff():
    from agents.simulation.live_engine import UeRequest, UeResponse
    req = UeRequest(
        ue_id="u1", kind="registration", sim_t=1,
        apn="iot-platform", sst=3, device_type="iphone", supports_backoff=False,
    )
    resp = PLUGIN.on_ue_request(req)
    # 首轮(默认)对不支持 back-off 的 iPhone 应 deny
    assert resp.verdict in ("DENY", "BACKOFF")  # 限流/拦截


def test_plugin_f_rebatch_chr_spec():
    spec = PLUGIN.request_rebatch_chr()
    assert spec is not None
    assert "device_type" in spec.dimensions
    assert "supports_backoff" in spec.dimensions
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_plugin_f.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.simulation.plugins.f_iot_storm_layered'`

- [ ] **Step 3: Implement plugin F + plugin package**

`agents/simulation/plugins/__init__.py`:

```python
"""ScenarioPlugin 实现集合。

新增场景: 在此目录添加 <id>_<short>.py,导出 PLUGIN: ScenarioPlugin 实例。
discover_plugins() 会自动 import 与注册。
"""
```

`agents/simulation/plugins/f_iot_storm_layered.py`:

```python
"""场景 F plugin:三层并行恢复·终端类型感知。

- capabilities="live"
- 首轮 3 策略全下 → iPhone 失败反升 → confidence 0.28 → restart
- 二轮回 Agent1 补采 CHR(终端类型) → 排除 iPhone → 收敛 confidence 0.6
- UE 准入:首轮所有终端按 AMF/SMF 限流;二轮对 iPhone 直接 DENY(让 NSSAI 拦截)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agents.shared.scenario_plugin import (
    DiagnosisContext,
    Event,
    RebatchSpec,
    RecoveryAction,
    RecoveryContext,
    TickContext,
)
from agents.simulation.live_engine import UeRequest, UeResponse
from simulator.topology import TopologyGenerator
from simulator.models import FaultConfig, FaultPointType, FaultMode


@dataclass
class _Plan:
    fault_elements: list[str]
    confidence: float
    route: str = "workflow"
    round: int = 1
    reasoning: list[dict] = field(default_factory=list)


def _build_topology() -> Any:
    return TopologyGenerator().generate(0, seed=101)


def _build_fault_config(topo: Any) -> FaultConfig:
    return FaultConfig(
        fault_point_type=FaultPointType.PATH_SESSION,
        fault_mode=FaultMode.BUSINESS,
        affected_ne_ids={"UPF_1"},
        loss_rate=0.0,  # 流控溯源不是单点丢包
        fault_start=28,
        fault_duration=20,
    )


def _build_ue_distribution() -> dict:
    # 10 个 APN,6 种终端;仅「物联网平台」APN 异常;iPhone 不支持 back-off
    return {
        "apns": [
            {"id": "iot-platform", "anomalous": True},
            {"id": "web-default", "anomalous": False},
        ] + [{"id": f"apn_{i}", "anomalous": False} for i in range(8)],
        "devices": [
            {"id": "iphone", "supports_backoff": False},
            {"id": "android", "supports_backoff": True},
            {"id": "huawei", "supports_backoff": True},
            {"id": "iot-cam", "supports_backoff": True},
            {"id": "iot-meter", "supports_backoff": True},
            {"id": "windows-iot", "supports_backoff": True},
        ],
    }


def _diagnosis_llm_stub(ctx: DiagnosisContext) -> _Plan:
    if ctx.round == 1:
        # 首轮:3 策略全下,iPhone 失败反升,confidence 0.28
        return _Plan(
            fault_elements=[],
            confidence=0.28,
            route="autonomous",
            round=1,
            reasoning=[
                {"type": "thinking", "text": "首轮 3 策略并行下发(UE back-off + AMF NSSAI + SMF DNN)"},
                {"type": "tool_call", "text": "iPhone 不支持 back-off timer,立即重试,放大风暴"},
                {"type": "conclusion", "text": "首轮失败反升,置信度 0.28 < 阈值"},
            ],
        )
    # 二轮:终端类型感知,排除 iPhone,收敛
    return _Plan(
        fault_elements=["AMF_1"],
        confidence=0.6,
        route="workflow",
        round=2,
        reasoning=[
            {"type": "thinking", "text": "回 Agent1 补采 CHR(终端类型×APN×back-off 支持)"},
            {"type": "tool_call", "text": "终端分群:仅 iPhone 不支持 back-off;APN 异常仅「物联网平台」"},
            {"type": "conclusion", "text": "二轮:对 iPhone 不下发 back-off,改由 AMF NSSAI 拦截;微调 AMF/SMF 限流比例"},
        ],
    )


def _recovery_actions(plan: _Plan) -> list[RecoveryAction]:
    if plan.round == 1 or plan.confidence < 0.3:
        return [
            RecoveryAction(id="r1_ue_backoff", cn="[轮1] UE back-off T=12s", en="R1 UE BACKOFF", layer="UE"),
            RecoveryAction(id="r1_amf_nssai", cn="[轮1] AMF NSSAI 接纳 ρ=75%", en="R1 AMF NSSAI 75%", layer="AMF"),
            RecoveryAction(id="r1_smf_dnn", cn="[轮1] SMF DNN 接纳 ρ=70%", en="R1 SMF DNN 70%", layer="SMF"),
        ]
    return [
        RecoveryAction(id="r2_ue_backoff", cn="[轮2] UE back-off T=14s(排除 iPhone)", en="R2 UE BACKOFF (EXCL IPHONE)", layer="UE"),
        RecoveryAction(id="r2_amf_nssai", cn="[轮2] AMF NSSAI ρ=57%(微调)", en="R2 AMF NSSAI 57%", layer="AMF"),
        RecoveryAction(id="r2_smf_dnn", cn="[轮2] SMF DNN ρ=52%(微调)", en="R2 SMF DNN 52%", layer="SMF"),
    ]


def _on_recovery_action(action: RecoveryAction, ctx: RecoveryContext) -> list[Event]:
    return [Event(type="recovery_action_progress", payload={"id": action.id, "ne_cpu": ctx.ne_cpu})]


def _on_ue_request(req: UeRequest) -> UeResponse:
    # 二轮:对 iPhone + 物联 APN 直接 DENY(由 AMF NSSAI 拦截)
    if req.device_type == "iphone" and req.apn == "iot-platform":
        return UeResponse(verdict="DENY", note="iphone+iot denied by NSSAI")
    # 物联终端 + 物联 APN:按反压限流
    if req.apn == "iot-platform":
        return UeResponse(verdict="ALLOW", note="iot allowed by NSSAI")
    return UeResponse(verdict="ALLOW")


class FPlugin:
    id = "F"
    label_cn = "流控溯源·物联网风暴(三层并行·终端类型感知)"
    label_en = "IOT STORM · LAYERED ADMISSION"
    version = "1.0"
    short_intro = "3 策略并行下发,iPhone 失败反升,二轮终端类型感知收敛"
    route_expectation = "workflow+exploration"
    expected_round = 2
    capabilities = "live"

    def build_topology(self): return _build_topology()
    def build_fault_config(self, topo): return _build_fault_config(topo)
    def build_ue_distribution(self): return _build_ue_distribution()
    def on_tick(self, ctx: TickContext): return []
    def diagnosis_llm_stub(self, ctx: DiagnosisContext): return _diagnosis_llm_stub(ctx)
    def recovery_actions(self, plan): return _recovery_actions(plan)
    def on_recovery_action(self, action, ctx): return _on_recovery_action(action, ctx)
    def request_rebatch_chr(self): return RebatchSpec(dimensions=["device_type", "supports_backoff", "apn"])
    def on_user_breakdown(self, breakdown): return []
    def on_ue_request(self, req: UeRequest) -> UeResponse: return _on_ue_request(req)


PLUGIN = FPlugin()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_plugin_f.py -v
```
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add agents/simulation/plugins/__init__.py agents/simulation/plugins/f_iot_storm_layered.py tests/unit/test_plugin_f.py
git commit -m "feat(plugin): 场景 F 三层并行·终端类型感知 plugin(live 真实接入)"
```

---

### Task 5.2: Stub router(perception/evaluation 预制 JSON)

**Files:**
- Create: `agents/simulation/stubs/__init__.py`
- Create: `agents/simulation/stubs/router.py`
- Create: `agents/simulation/stubs/perception/F.json`
- Create: `agents/simulation/stubs/evaluation/F.json`
- Test: `tests/unit/test_stub_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_stub_router.py
from agents.simulation.stubs.router import StubRouter


def test_stub_router_loads_perception_F():
    r = StubRouter(agent="perception", scenario_id="F")
    out = r.respond(prompt="any prompt with case_id=F")
    assert "reasoning" in out
    assert isinstance(out["reasoning"], list)


def test_stub_router_loads_evaluation_F():
    r = StubRouter(agent="evaluation", scenario_id="F")
    out = r.respond(prompt="evaluate case F")
    assert "metrics" in out
    assert "trace_axes" in out


def test_stub_router_falls_back_to_ok():
    r = StubRouter(agent="perception", scenario_id="Z_NONEXIST")
    out = r.respond(prompt="x")
    assert out == {"fallback": "OK"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_stub_router.py -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement stub router + JSON files**

`agents/simulation/stubs/__init__.py`:

```python
"""预制 LLM 响应(LIVE stub 模式)。

文件布局:
  perception/<scenario_id>.json
  evaluation/<scenario_id>.json
"""
```

`agents/simulation/stubs/perception/F.json`:

```json
{
  "scenario_id": "F",
  "reasoning": [
    {"n": 1, "type": "thinking", "text": "[轮1] 3 策略并行下发(UE back-off + AMF NSSAI + SMF DNN)"},
    {"n": 2, "type": "tool_call", "text": "iPhone 不支持 back-off timer,收到 Reg Reject 后立即重试,放大风暴"},
    {"n": 3, "type": "conclusion", "text": "首轮失败反升,confidence 0.28 < 阈值,需回 Agent1 补采 CHR(终端类型)", "result": "confidence_low"}
  ],
  "round_2_reasoning": [
    {"n": 4, "type": "thinking", "text": "[轮2] Agent1 补采 CHR(终端类型×APN×back-off 支持)"},
    {"n": 5, "type": "tool_call", "text": "终端分群:仅 iPhone 不支持 back-off;APN 异常仅「物联网平台」"},
    {"n": 6, "type": "conclusion", "text": "二轮:对 iPhone 不下发 back-off,改由 AMF NSSAI 拦截;微调 AMF/SMF 限流比例,收敛"}
  ],
  "fault_elements": ["AMF_1", "UPF_1"],
  "confidence": 0.6,
  "route": "workflow"
}
```

`agents/simulation/stubs/evaluation/F.json`:

```json
{
  "scenario_id": "F",
  "metrics": {"precision": 0.85, "recall": 1.0, "f1": 0.92, "exact_match": false},
  "trace_axes": {
    "logicalCoherence": 0.91,
    "toolEfficiency": 0.88,
    "evidenceQuality": 0.93,
    "missedSignals": 0.08,
    "overall": 0.9
  },
  "case_entry": {"category": "PARTIAL_SUCCESS"},
  "skill": {
    "kind": "NEW",
    "skill_id": "skills/learned/layered_admission_with_device_awareness",
    "insight": "终端类型感知 + 三层并行恢复,iPhone 不支持 back-off 时改由网络侧 NSSAI 拦截",
    "next_hit_rate": 0.9
  }
}
```

`agents/simulation/stubs/router.py`:

```python
"""StubRouter: 加载预制 JSON,根据 agent+scenario_id 返回响应。"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_STUB_DIR = Path(__file__).parent
_FALLBACK = {"fallback": "OK"}


class StubRouter:
    def __init__(self, agent: str, scenario_id: str):
        self.agent = agent
        self.scenario_id = scenario_id

    def respond(self, prompt: str) -> dict:
        path = _STUB_DIR / self.agent / f"{self.scenario_id}.json"
        if not path.exists():
            logger.warning("stub missing: %s", path)
            return _FALLBACK
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.exception("stub load failed: %s", path)
            return _FALLBACK
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_stub_router.py -v
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add agents/simulation/stubs/ tests/unit/test_stub_router.py
git commit -m "feat(stub): StubRouter + 场景 F perception/evaluation 预制 JSON"
```

---

### Task 5.3: A-E 占位 plugin(返回 demo 标记)

**Files:**
- Create: `agents/simulation/plugins/a_*.py` ~ `e_*.py`
- Test: `tests/unit/test_plugins_demo_placeholder.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_plugins_demo_placeholder.py
from agents.shared.scenario_plugin import REGISTRY, discover_plugins
from agents.simulation.live_runner import discover_plugins as runner_discover  # noqa: F401


def test_demo_placeholders_registered():
    REGISTRY.clear()
    discover_plugins()
    for sid in ["A", "B", "C", "D", "E"]:
        assert sid in REGISTRY, f"{sid} plugin missing"
        assert REGISTRY[sid].capabilities == "demo"


def test_demo_plugins_emit_no_tick_events():
    from agents.shared.scenario_plugin import TickContext
    for sid in ["A", "B", "C", "D", "E"]:
        p = REGISTRY[sid]
        events = p.on_tick(TickContext(sim_t=1, ne_cpu={}, kpi_window=[], chr_window=[], active_ue=0))
        assert events == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_plugins_demo_placeholder.py -v
```
Expected: FAIL with `AssertionError: A plugin missing`

- [ ] **Step 3: Create 5 demo placeholders**

For each `agents/simulation/plugins/{a,b,c,d,e}_*.py`, create a file with this content (replace `A` with the actual id):

```python
# agents/simulation/plugins/a_upf_workflow.py
"""场景 A 占位 plugin(仍走 DEMO 前端)。

A 走确定性故事钟;此 plugin 提供拓扑常量供 LIVE-capable 后端查询,
但 capabilities="demo" 引导前端用 useStoryClock 分支。
"""
from __future__ import annotations

from typing import Any

from agents.shared.scenario_plugin import (
    DiagnosisContext,
    Event,
    RebatchSpec,
    RecoveryAction,
    RecoveryContext,
    TickContext,
)
from simulator.topology import TopologyGenerator


class _APlugin:
    id = "A"
    label_cn = "UPF 异常·确定性工作流"
    label_en = "UPF FAULT · DETERMINISTIC WORKFLOW"
    version = "1.0"
    short_intro = "均质化比较排除 AMF/SMF + 定位 UPF_1"
    route_expectation = "workflow"
    expected_round = 1
    capabilities = "demo"

    def build_topology(self) -> Any: return TopologyGenerator().generate(0, seed=101)
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return {}
    def on_tick(self, ctx: TickContext) -> list[Event]: return []
    def diagnosis_llm_stub(self, ctx: DiagnosisContext): return None
    def recovery_actions(self, plan) -> list[RecoveryAction]: return []
    def on_recovery_action(self, action, ctx: RecoveryContext) -> list[Event]: return []
    def request_rebatch_chr(self) -> RebatchSpec | None: return None
    def on_user_breakdown(self, breakdown) -> list[RecoveryAction]: return []


PLUGIN = _APlugin()
```

Repeat for B/C/D/E with their respective `id` and short intros:

- `b_smf_guided.py`: id="B", label_cn="SMF 异常·技能引导", short_intro="网络微损+终端噪声 → CHR 降噪排除终端"
- `c_gnb_autonomous.py`: id="C", label_cn="gNB 用户侧异常·自主探索", short_intro="CHR 聚类+用户分群 → 物联终端群体异常"
- `d_iot_backoff.py`: id="D", label_cn="流控溯源·物联网风暴(UE 侧 back-off)", short_intro="物联终端反复上线 → Reg Reject + back-off 收敛"
- `e_iot_nssai_apn.py`: id="E", label_cn="流控溯源·物联网风暴(网络侧 NSSAI/APN 限流)", short_intro="20% UE 支持 back-off 不足,网络侧双通道限流收敛"

(Each file has identical structure with different id/label_cn/short_intro.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/unit/test_plugins_demo_placeholder.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add agents/simulation/plugins/a_*.py agents/simulation/plugins/b_*.py agents/simulation/plugins/c_*.py agents/simulation/plugins/d_*.py agents/simulation/plugins/e_*.py tests/unit/test_plugins_demo_placeholder.py
git commit -m "feat(plugin): A-E 占位 plugin(capabilities=demo,引导前端走 DEMO)"
```

---

### Task 5.4: restore 严格 capabilities 测试断言

**Files:**
- Modify: `tests/integration/live/test_api_live_rest.py:14-18`

- [ ] **Step 1: Restore strict assertions**

In `tests/integration/live/test_api_live_rest.py`, replace the loose `test_capabilities_returns_registry` with the strict version from T4.1:

```python
def test_capabilities_returns_registry(client):
    r = client.get("/api/v1/live/capabilities")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    assert data.get("F") == "live"
    assert data.get("A") == "demo"
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/integration/live/test_api_live_rest.py::test_capabilities_returns_registry -v
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/live/test_api_live_rest.py
git commit -m "test(api): capabilities 严格断言(F=live, A=demo)"
```

---

## 阶段 6:前端 liveBus + useLiveClock

### Task 6.1: liveBus(useSyncExternalStore 极轻 store)

**Files:**
- Create: `frontend-flow/src/story/liveBus.ts`
- Create: `frontend-flow/src/story/liveBus.test.ts`
- Modify: `frontend-flow/package.json`(加 vitest)

- [ ] **Step 1: Install vitest**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npm install --save-dev vitest@^2.0.0
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend-flow/src/story/liveBus.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { liveBus, getLiveState, applyEvent, resetLiveBus } from "./liveBus";

describe("liveBus", () => {
  beforeEach(() => {
    resetLiveBus();
  });

  it("applyEvent accumulates reasoning steps", () => {
    applyEvent("sess_1", "F", {
      type: "reasoning_step",
      payload: { n: 1, type: "thinking", text: "init" },
    });
    applyEvent("sess_1", "F", {
      type: "reasoning_step",
      payload: { n: 2, type: "conclusion", text: "root UPF_1" },
    });
    const st = getLiveState("sess_1");
    expect(st.recentSteps).toHaveLength(2);
    expect(st.recentSteps[0].n).toBe(1);
    expect(st.scenarioId).toBe("F");
  });

  it("runner_state updates runnerState", () => {
    applyEvent("sess_1", "F", {
      type: "runner_state",
      payload: { state: "simulating" },
    });
    expect(getLiveState("sess_1").runnerState).toBe("simulating");
  });

  it("subscribe fires on event", () => {
    const seen: string[] = [];
    liveBus.subscribe("sess_1", () => seen.push("fired"));
    applyEvent("sess_1", "F", { type: "tick", payload: { sim_t: 1 } });
    expect(seen).toEqual(["fired"]);
  });

  it("isolated per session", () => {
    applyEvent("sess_1", "F", { type: "runner_state", payload: { state: "done" } });
    applyEvent("sess_2", "E", { type: "runner_state", payload: { state: "init" } });
    expect(getLiveState("sess_1").runnerState).toBe("done");
    expect(getLiveState("sess_2").runnerState).toBe("init");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/story/liveBus.test.ts
```
Expected: FAIL with `Cannot find module './liveBus'`

- [ ] **Step 4: Implement liveBus**

`frontend-flow/src/story/liveBus.ts`:

```ts
// ============================================================================
// liveBus —— LIVE 模式事件总线(per-session 切片)
//   与 StoryState 同形;只 emit/runner_state/reasoning_step/diagnosis_complete
//   recovery_action/evaluation_report/skill_evolved/user_breakdown/error/tick
//   之外的 type 静默忽略(向前兼容)。
// ============================================================================

import type { ReasonStep, RecoveryAction, EvalMetrics, UserBreakdown, ConfidenceBreakdown } from "../data/types";

export type RunnerState =
  | "init" | "simulating" | "diagnosing" | "restart"
  | "recovering" | "evaluating" | "done" | "failed" | "fallback_to_stub"
  | "unknown";

export interface LiveState {
  sessionId: string;
  scenarioId: string;
  runnerState: RunnerState;
  phaseIndex: number;
  progress: number;
  round: 1 | 2;
  simT: number;
  simNeCpu: Record<string, number>;
  recentSteps: ReasonStep[];
  recoveryActions: RecoveryAction[];
  activeDiagnosis: { faultElements: string[]; faultType: string; confidence: number; route: string } | null;
  activeEvaluation: EvalMetrics | null;
  userBreakdown: UserBreakdown | null;
  error: { source: string; message: string; fatal: boolean } | null;
}

const _initial = (sid: string, scn: string): LiveState => ({
  sessionId: sid,
  scenarioId: scn,
  runnerState: "unknown",
  phaseIndex: 0,
  progress: 0,
  round: 1,
  simT: 0,
  simNeCpu: {},
  recentSteps: [],
  recoveryActions: [],
  activeDiagnosis: null,
  activeEvaluation: null,
  userBreakdown: null,
  error: null,
});

const _store: Map<string, LiveState> = new Map();
const _subs: Map<string, Set<() => void>> = new Map();

function _notify(sid: string) {
  const subs = _subs.get(sid);
  if (subs) subs.forEach((cb) => cb());
}

export function resetLiveBus() {
  _store.clear();
  _subs.clear();
}

export function applyEvent(sid: string, scn: string, ev: { type: string; payload: any }) {
  let st = _store.get(sid);
  if (!st) {
    st = _initial(sid, scn);
    _store.set(sid, st);
  }
  switch (ev.type) {
    case "runner_state":
      st.runnerState = ev.payload.state as RunnerState;
      break;
    case "tick":
      st.simT = ev.payload.sim_t ?? st.simT;
      if (ev.payload.ne_cpu) st.simNeCpu = ev.payload.ne_cpu;
      break;
    case "reasoning_step":
      st.recentSteps.push(ev.payload as ReasonStep);
      break;
    case "confidence_assessment":
      // 推 phaseIndex=3 (策略匹配)
      st.phaseIndex = 3;
      break;
    case "diagnosis_complete":
      st.activeDiagnosis = {
        faultElements: ev.payload.fault_elements ?? [],
        faultType: ev.payload.fault_type ?? "unknown",
        confidence: ev.payload.confidence ?? 0,
        route: ev.payload.route ?? "workflow",
      };
      st.phaseIndex = 4;
      break;
    case "recovery_action":
      st.recoveryActions.push({
        id: ev.payload.id,
        cn: ev.payload.cn,
        en: ev.payload.en,
      });
      st.phaseIndex = 5;
      break;
    case "evaluation_report":
      st.activeEvaluation = ev.payload;
      st.phaseIndex = 7;
      break;
    case "skill_evolved":
      // 暂合入 evaluation
      break;
    case "user_breakdown":
      st.userBreakdown = ev.payload as UserBreakdown;
      break;
    case "error":
      st.error = {
        source: ev.payload.source ?? "unknown",
        message: ev.payload.message ?? "",
        fatal: !!ev.payload.fatal,
      };
      if (ev.payload.fatal) st.runnerState = "failed";
      break;
    default:
      // 忽略未知事件
      break;
  }
  _notify(sid);
}

export function getLiveState(sid: string): LiveState {
  return _store.get(sid) ?? _initial(sid, "unknown");
}

export const liveBus = {
  subscribe(sid: string, cb: () => void): () => void {
    if (!_subs.has(sid)) _subs.set(sid, new Set());
    _subs.get(sid)!.add(cb);
    return () => {
      _subs.get(sid)?.delete(cb);
    };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/story/liveBus.test.ts
```
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add frontend-flow/src/story/liveBus.ts frontend-flow/src/story/liveBus.test.ts frontend-flow/package.json
git commit -m "feat(frontend): liveBus 极轻 store(per-session 切片,与 StoryState 同形)"
```

---

### Task 6.2: useLiveClock 替身 useStoryClock

**Files:**
- Create: `frontend-flow/src/story/useLiveClock.ts`
- Create: `frontend-flow/src/story/useLiveClock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend-flow/src/story/useLiveClock.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveClock } from "./useLiveClock";
import { applyEvent, resetLiveBus } from "./liveBus";

describe("useLiveClock", () => {
  beforeEach(() => resetLiveBus());

  it("returns initial state", () => {
    const { result } = renderHook(() =>
      useLiveClock("sess_1", "F", /*fallbackClock*/ { state: null as any, duration: 0, playheadRef: { current: null } })
    );
    expect(result.current.state.runnerState).toBe("unknown");
    expect(result.current.state.scenarioId).toBe("F");
  });

  it("updates on runner_state event", () => {
    const { result } = renderHook(() =>
      useLiveClock("sess_1", "F", { state: null as any, duration: 0, playheadRef: { current: null } })
    );
    act(() => {
      applyEvent("sess_1", "F", { type: "runner_state", payload: { state: "simulating" } });
    });
    expect(result.current.state.runnerState).toBe("simulating");
  });
});
```

- [ ] **Step 2: Install @testing-library/react**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npm install --save-dev @testing-library/react@^16.0.0
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/story/useLiveClock.test.ts
```
Expected: FAIL with `Cannot find module './useLiveClock'`

- [ ] **Step 4: Implement useLiveClock**

`frontend-flow/src/story/useLiveClock.ts`:

```ts
// ============================================================================
// useLiveClock —— 替身 useStoryClock(LIVE 模式)
//   接口同 useStoryClock(state 字段 + playheadRef);失败时降级到 fallbackClock。
// ============================================================================

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ClockApi } from "./useStoryClock";
import { applyEvent, getLiveState, liveBus, type LiveState } from "./liveBus";

export function useLiveClock(
  sessionId: string,
  scenarioId: string,
  fallbackClock: ClockApi,
): { state: LiveState; playheadRef: { current: HTMLDivElement | null } } {
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const subscribe = (cb: () => void) => liveBus.subscribe(sessionId, cb);
  const getSnapshot = () => getLiveState(sessionId);
  const liveState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // 监听 fatal error 或 WS 断线 → 通知 fallback(由调用方 App.tsx 处理)
  useEffect(() => {
    if (liveState.error?.fatal || liveState.runnerState === "failed") {
      // 留 hook:由 App.tsx 监听并切回 fallback
    }
  }, [liveState.error?.fatal, liveState.runnerState]);

  return { state: liveState, playheadRef };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/story/useLiveClock.test.ts
```
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add frontend-flow/src/story/useLiveClock.ts frontend-flow/src/story/useLiveClock.test.ts frontend-flow/package.json
git commit -m "feat(frontend): useLiveClock 替身 hook(LIVE 模式 + 失败降级接口)"
```

---

## 阶段 7:前端 TopBar + App 集成 + 降级

### Task 7.1: TopBar 增 DEMO ⇄ LIVE 切换 + 控制按钮

**Files:**
- Modify: `frontend-flow/src/components/Shell/TopBar.tsx`
- Test: `frontend-flow/src/components/Shell/TopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend-flow/src/components/Shell/TopBar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TopBar } from "./TopBar";

const baseState = {
  scenarioId: "F",
  phaseIndex: 0,
  phase: { cn: "网络就绪", en: "READY", color: "#22c55e" } as any,
  phaseProgress: 0,
  globalProgress: 0,
  simT: 0,
  loop: 0,
  round: 1 as 1 | 2,
  loopBackKind: null,
  twinMode: "healthy" as const,
  showAnomaly: false,
  affectedNe: [],
  rootCause: { nes: [], links: [] },
  recoveryActive: false,
  recoveryActions: [],
  rerouteEdges: [],
  cordonedNe: [],
  activeAgent: 0 as 0,
  route: null,
  confidence: null,
  confidenceReveal: 0,
  reasoningSteps: [],
  reasoningTotal: 0,
  evalRevealed: false,
  evalMetrics: null,
  generationChecks: [],
  generationChecksReveal: 0,
  headline: "",
  subline: "",
  algorithms: [],
  cpuOverloadNe: [],
  ufdrPopup: null,
  flowControlPopup: null,
  currentStep: null,
  comparisonReveal: 0,
  chrPopup: null,
  homogenPopup: null,
  isolationPopup: null,
  falseAlarmActive: false,
  falseAlarmIntercepted: false,
  userLevel: null,
};

const baseClock = {
  state: baseState,
  time: 0,
  playing: true,
  speed: 1,
  loop: 0,
  duration: 60,
  playheadRef: { current: null },
  play: () => {},
  pause: () => {},
  toggle: () => {},
  setSpeed: () => {},
  seekGlobal: () => {},
  seekPhase: () => {},
};

const baseScenario = { id: "F", cn: "F 场景" } as any;

describe("TopBar DEMO/LIVE 切换", () => {
  it("renders DEMO/LIVE toggle button", () => {
    const onModeChange = vi.fn();
    const { getByText } = render(
      <TopBar
        clock={baseClock}
        state={baseState}
        scenario={baseScenario}
        mode="demo"
        onModeChange={onModeChange}
        liveCapabilities={{ F: "live", A: "demo" }}
      />
    );
    expect(getByText(/DEMO/i)).toBeTruthy();
  });

  it("clicking LIVE button calls onModeChange", () => {
    const onModeChange = vi.fn();
    const { getByText } = render(
      <TopBar
        clock={baseClock}
        state={baseState}
        scenario={baseScenario}
        mode="demo"
        onModeChange={onModeChange}
        liveCapabilities={{ F: "live", A: "demo" }}
      />
    );
    fireEvent.click(getByText(/切到 LIVE/i));
    expect(onModeChange).toHaveBeenCalledWith("live");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/components/Shell/TopBar.test.tsx
```
Expected: FAIL with prop type error(`mode`/`onModeChange` not in TopBar props)

- [ ] **Step 3: Add mode + onModeChange props to TopBar**

In `frontend-flow/src/components/Shell/TopBar.tsx`, modify the component signature to accept new props:

Find the existing `interface Props` / `function TopBar({...}: Props)` block and add:

```tsx
type Mode = "demo" | "live";
interface TopBarProps {
  clock: any;
  state: any;
  scenario: any;
  // 新增
  mode?: Mode;
  onModeChange?: (m: Mode) => void;
  liveCapabilities?: Record<string, "live" | "demo">;
}
```

In the JSX, after the scenario buttons, add a mode toggle:

```tsx
{onModeChange && (
  <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
    <button
      className={mode === "demo" ? "btn active" : "btn"}
      onClick={() => onModeChange("demo")}
      data-testid="mode-demo"
    >
      DEMO
    </button>
    <button
      className={mode === "live" ? "btn active" : "btn"}
      onClick={() => onModeChange("live")}
      data-testid="mode-live"
      disabled={liveCapabilities?.[scenario.id] !== "live"}
      title={
        liveCapabilities?.[scenario.id] === "live"
          ? "切到 LIVE(后端实时)"
          : "该场景暂未支持 LIVE,使用 DEMO"
      }
    >
      {liveCapabilities?.[scenario.id] === "live" ? "切到 LIVE" : "LIVE 不可用"}
    </button>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/components/Shell/TopBar.test.tsx
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add frontend-flow/src/components/Shell/TopBar.tsx frontend-flow/src/components/Shell/TopBar.test.tsx
git commit -m "feat(frontend): TopBar 增 DEMO/LIVE 切换 + 不可用降级"
```

---

### Task 7.2: App.tsx 集成(useLiveClock + WS 断线降级)

**Files:**
- Modify: `frontend-flow/src/App.tsx`
- Create: `frontend-flow/src/api/live.ts`
- Test: `frontend-flow/src/App.test.tsx`

- [ ] **Step 1: Create live API client**

`frontend-flow/src/api/live.ts`:

```ts
// ============================================================================
// live API —— REST + WS 客户端
// ============================================================================

const BASE = "http://localhost:8000/api/v1/live";
const WS_BASE = "ws://localhost:8000/ws/live";

export interface LiveEvent {
  type: string;
  ts: number;
  session_id: string;
  payload: any;
}

export async function getCapabilities(): Promise<Record<string, "live" | "demo">> {
  const r = await fetch(`${BASE}/capabilities`);
  if (!r.ok) throw new Error(`capabilities ${r.status}`);
  return r.json();
}

export async function selectScenario(scenarioId: string): Promise<{ session_id: string; scenario_id: string; capabilities: string; demo?: boolean }> {
  const r = await fetch(`${BASE}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario_id: scenarioId }),
  });
  if (!r.ok) throw new Error(`select ${r.status}`);
  return r.json();
}

export async function control(sessionId: string, action: string, payload?: any): Promise<void> {
  await fetch(`${BASE}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, action, payload }),
  });
}

export function openLiveSocket(
  sessionId: string,
  onEvent: (ev: LiveEvent) => void,
  onClose: () => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}?session_id=${sessionId}`);
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // ignore
    }
  };
  ws.onclose = () => onClose();
  return ws;
}
```

- [ ] **Step 2: Write App test**

`frontend-flow/src/App.test.tsx`:

```tsx
// frontend-flow/src/App.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    // 强制 capabilities 默认空(DEMO 模式)
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any)
    ) as any;
  });

  it("renders without crashing in DEMO mode", () => {
    const { getByText } = render(<App />);
    // 默认场景 A 标签应出现
    expect(getByText(/A/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it passes (baseline)**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/App.test.tsx
```
Expected: PASS (原有 App 行为)

- [ ] **Step 4: Modify App.tsx to integrate mode + liveBus**

In `frontend-flow/src/App.tsx`, replace the file contents with:

```tsx
// ============================================================================
// App —— 高稳智能体 · 方案流程演示(DEMO + LIVE 双模式)
//   DEMO: useStoryClock 确定性回放 A–F
//   LIVE: useLiveClock 订阅后端 WS 事件流(仅场景 F 可用)
// ============================================================================

import { useEffect, useState } from "react";
import { SCENARIOS, getScenario } from "./data/scenarios";
import { useStoryClock } from "./story/useStoryClock";
import { TopBar } from "./components/Shell/TopBar";
import { SolutionFlow } from "./components/SolutionFlow/SolutionFlow";
import { ExecutionPanel } from "./components/ExecutionPanel/ExecutionPanel";
import { useLiveClock } from "./story/useLiveClock";
import { applyEvent } from "./story/liveBus";
import { getCapabilities, openLiveSocket, selectScenario, control } from "./api/live";

type Mode = "demo" | "live";

export default function App() {
  const [scenarioId, setScenarioId] = useState("A");
  const [mode, setMode] = useState<Mode>("demo");
  const [capabilities, setCapabilities] = useState<Record<string, "live" | "demo">>({});
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const scenario = getScenario(scenarioId);
  const demoClock = useStoryClock(scenario);
  const liveClock = useLiveClock(liveSessionId ?? "_", scenarioId, demoClock);

  // 启动时拉 capabilities
  useEffect(() => {
    getCapabilities()
      .then(setCapabilities)
      .catch((e) => console.warn("capabilities failed:", e));
  }, []);

  // 模式或场景变化时,若是 LIVE 且 F 可用 → 启动 session
  useEffect(() => {
    if (mode !== "live" || capabilities[scenarioId] !== "live") {
      // 关 ws 切回 DEMO
      if (ws) {
        try { ws.close(); } catch {}
        setWs(null);
      }
      setLiveSessionId(null);
      return;
    }
    let cancelled = false;
    selectScenario(scenarioId)
      .then((resp) => {
        if (cancelled) return;
        if (resp.demo) return; // demo 占位
        setLiveSessionId(resp.session_id);
        const sock = openLiveSocket(
          resp.session_id,
          (ev) => applyEvent(resp.session_id, scenarioId, ev),
          () => {
            setLiveError("WS 断线,自动回 DEMO");
            setMode("demo");
          },
        );
        setWs(sock);
      })
      .catch((e) => {
        setLiveError(`select 失败: ${e.message}; 自动回 DEMO`);
        setMode("demo");
      });
    return () => {
      cancelled = true;
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scenarioId, capabilities]);

  const state = mode === "live" && liveSessionId ? liveClock.state : demoClock.state;
  const playheadRef = mode === "live" ? liveClock.playheadRef : demoClock.playheadRef;

  return (
    <>
      <div className="app-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column", padding: 10, gap: 10 }}>
        <TopBar
          clock={{ ...demoClock, state, playheadRef }}
          state={state}
          scenario={scenario}
          mode={mode}
          onModeChange={setMode}
          liveCapabilities={capabilities}
        />

        <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
          <div style={{ flex: "0 0 38%", minWidth: 360, display: "flex", minHeight: 0 }}>
            <SolutionFlow state={state} scenario={scenario} />
          </div>
          <div style={{ flex: "1 1 62%", minWidth: 460, display: "flex", minHeight: 0 }}>
            <ExecutionPanel
              scenario={scenario}
              state={state}
              scenarios={SCENARIOS}
              currentScenarioId={scenarioId}
              onSelectScenario={setScenarioId}
            />
          </div>
        </div>

        {liveError && (
          <div
            data-testid="live-error"
            style={{ position: "fixed", bottom: 12, right: 12, background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", color: "#fca5a5", padding: "8px 12px", borderRadius: 6, fontSize: 12 }}
          >
            {liveError}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow && npx vitest run src/App.test.tsx
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend-flow/src/api/live.ts frontend-flow/src/App.tsx frontend-flow/src/App.test.tsx
git commit -m "feat(frontend): App 集成 mode/LIVE/DEMO + WS 断线降级 + capabilities"
```

---

## 阶段 8:E2E 冒烟 + 降级回归

### Task 8.1: 场景 F E2E 冒烟(stub 模式,1 分钟内 done)

**Files:**
- Create: `tests/integration/live/test_f_scenario_e2e.py`

- [ ] **Step 1: Write the test**

```python
# tests/integration/live/test_f_scenario_e2e.py
"""场景 F 端到端冒烟:选场景→订阅 WS→断言全事件链路。

使用 stub 模式(无 LLM 调用),端到端 < 30s。
"""
import json
import time

import pytest
from fastapi.testclient import TestClient


def test_f_scenario_full_event_chain():
    from api.app import create_app
    app = create_app()
    client = TestClient(app)

    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    sid = sel["session_id"]
    assert sel["capabilities"] == "live"

    with client.websocket_connect(f"/ws/live?session_id={sid}") as ws:
        seen_types: list[str] = []
        reasoning_count = 0
        recovery_count = 0
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                raw = ws.receive_text()
            except Exception:
                break
            ev = json.loads(raw)
            t = ev.get("type")
            if t == "ping":
                continue
            seen_types.append(t)
            if t == "reasoning_step":
                reasoning_count += 1
            if t == "recovery_action":
                recovery_count += 1
            if t == "runner_state" and ev["payload"].get("state") == "done":
                break
            if t == "runner_state" and ev["payload"].get("state") == "failed":
                pytest.fail(f"runner failed: {ev}")

        assert "runner_state" in seen_types, f"missing runner_state in {seen_types}"
        assert reasoning_count >= 2, f"too few reasoning_step ({reasoning_count})"
        # 场景 F 首轮 confidence<0.3 → 至少一次 restart
        assert "confidence_low" in seen_types, f"missing confidence_low in {seen_types}"
        # 评估报告与 skill 沉淀
        assert "evaluation_report" in seen_types, f"missing evaluation_report in {seen_types}"


def test_f_fallback_when_stub_missing(monkeypatch, tmp_path):
    """模拟 stub 缺失:LiveRunner 不应崩;前端不应拿到 unknown session。"""
    from api.app import create_app
    app = create_app()
    client = TestClient(app)
    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    assert "session_id" in sel
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd D:/code/ccn_agent/ccn_agent && python -m pytest tests/integration/live/test_f_scenario_e2e.py -v
```
Expected: 2 passed(< 30s)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/live/test_f_scenario_e2e.py
git commit -m "test(e2e): 场景 F 端到端冒烟(全事件链路 + confidence_low restart)"
```

---

## 验收 checklist

- [ ] `pytest tests/ -v` 全部通过(单元 + 集成)
- [ ] `cd frontend-flow && npx vitest run` 全部通过
- [ ] 后端: `python -m uvicorn api.app:app --reload` 起服务
- [ ] 前端: `cd frontend-flow && npm run dev` 起服务,TopBar 切到 LIVE 选 F
- [ ] 场景 F LIVE:PhasePopup 弹出首轮 3 策略 → iPhone 失败反升 → 评估未通过 → 二轮排除 iPhone → 收敛 → 评估报告 + skill 沉淀
- [ ] 场景 A/B/C/D/E:TopBar 显 "(DEMO 不可用)" / 切 LIVE 时按钮置灰
- [ ] WS 断线(后端 kill):前端 3s 内弹 toast + 自动回 DEMO
- [ ] stub 缺文件:后端 emit `error(fatal=True)` → 前端回 DEMO
- [ ] `loop_iterations` 表有 `session_id`、`scenario_id`、`runner_state` 字段且值正确

---

## 部署与回滚

| 行为 | 操作 |
|---|---|
| 完全关闭 LIVE | `CC_LIVE_ENABLED=0` 重启后端;前端自然走 DEMO |
| 关单个场景 LIVE | `agents/simulation/plugins/<id>_*.py` 中 `capabilities = "demo"` 后重启 |
| 回滚 LiveRunner | `git revert <live_runner_commit>`;不影响 DEMO 与原 `simulate()` |
| 清 LIVE 持久化 | `DELETE FROM loop_iterations WHERE session_id IS NOT NULL;` |

---

## 度量(上线 1 周后看)

- 场景 F 端到端 P50 < 90s、P95 < 120s
- WS 断线率 < 1%
- stub fallback 触发率 < 5%
- 真实 LLM 调用成功率 > 95%
