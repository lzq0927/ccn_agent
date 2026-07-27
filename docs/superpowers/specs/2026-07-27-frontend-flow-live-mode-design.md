# frontend-flow LIVE 模式设计

**日期**: 2026-07-27
**状态**: 设计已批准，待实施
**优先级场景**: F(三层并行恢复·终端类型感知)
**目标**: 在 frontend-flow 中新增 LIVE 模式，复用后端 data_generation / fault_perception / evaluation 三 Agent 的真实仿真与推理能力；D/E 走 DEMO 不变；F 真实接入 LIVE；为未来场景提供 plugin 扩展点。

## 1. 架构与边界

### 新增模块
- `agents/shared/live_runner.py` — 进程级 LiveRunner 管理器，session_id 一份 runner，含七状态机。
- `agents/shared/scenario_plugin.py` — `ScenarioPlugin` Protocol + 注册表，自动 import `agents/simulation/plugins/<id>.py`。
- `agents/simulation/engine_step.py` — 现有 `simulator/engine.py` 拆分版，提供 `step(dt)` 单步推进 + `on_event` 回调；保留原 `simulate()` 兼容性。
- `agents/simulation/live_engine.py` — `LiveEngine` 包装，订阅 plugin 的 `on_tick` 钩子，emit KPI/CHR/NE 状态事件。
- `agents/fault_perception/live_diagnoser.py` — `FaultPerceptionAgent.diagnose` 流式化：每步 emit `reasoning_step`，低置信度时 emit `confidence_low`。
- `agents/evaluation/live_evaluator.py` — `evaluate_streaming()`，诊断完成后立即评估并 emit 评估事件。
- `api/routes/live.py` — REST 控制端点 + session-scoped WebSocket。
- `agents/simulation/plugins/f_iot_storm_layered.py` — 场景 F 真实插件(MVP 唯一实现)。
- `agents/simulation/plugins/a_*.py` ~ `e_*.py` — 占位 `_NoopPlugin`，`capabilities="demo"` 引导前端走 DEMO。
- `agents/simulation/stubs/{perception,evaluation}/<scenario_id>.json` — 预制推理与评估响应。

### 前端新增
- `frontend-flow/src/api/live.ts` — WS 客户端 + REST 调用。
- `frontend-flow/src/story/liveBus.ts` — 极轻 store(useSyncExternalStore)，按 session_id 切片，state shape 与 `StoryState` 对齐。
- `frontend-flow/src/story/useLiveClock.ts` — 替身 `useStoryClock`，订阅 liveBus；与 `direct(scenario, t, loop)` 接口一致。
- `frontend-flow/src/components/Shell/TopBar.tsx` — 增 `DEMO ⇄ LIVE` 切换 + 速度/暂停/重置按钮(仅 LIVE 下可用)。

### 复用不修改
- `frontend-flow` 所有 Phase/Topology/Popup/KPI 组件、`SolutionFlow`、`DigitalTwin`、`Timeline`。
- `simulator/`(除 step 拆分)、`agents/closed_loop.py`、`tools/`、`skills/`。
- `agents/shared/storage.py` SQLite schema(仅 `loop_iterations` 表新增字段，向后兼容)。
- `agents/shared/llm_client.py`(加 `mode` 字段即可)。

### MVP 边界
- 仅场景 F 真实接入 LIVE。
- A/B/C/D/E 仍走 DEMO。
- 错误降级:WS 断线 3s → 自动回 DEMO;LLM 失败 → stub;simulator 异常 → emit `error` + `runner_state=failed`。
- 不做:多客户端同时观看同一 session、跨 session 对比、AI 自主调度(不接管后端状态机)。

## 2. 数据契约与事件协议

### REST 端点(`api/routes/live.py`)
- `POST /live/select` body `{ scenario_id: "F" }` → `{ session_id, scenario_meta, capabilities }`
- `POST /live/control` body `{ session_id, action, ... }` action ∈ `pause`|`resume`|`set_speed`|`seek`|`restart`|`inject_strategy`
- `GET /live/state/{session_id}` → 当前快照(断线重连后回放)
- `GET /live/capabilities` → `{ F: "live", A: "demo", ... }`

### WebSocket `/ws/live?session_id=...` 事件协议
统一格式 `{ type, ts, session_id, payload }`，后端只推 `session_id` 匹配的消息。

| 事件 type | 来源 | payload 关键字段 | 用途 |
|---|---|---|---|
| `runner_state` | LiveRunner | `{ state, scenario_id }` | 顶栏徽标 + 控制按钮启用/禁用 |
| `tick` | LiveEngine | `{ sim_t, kpi_window, ne_cpu, chr_window, active_ue }` | KPI 曲线、CPU 仪表、CHR 时序滚动 |
| `confidence_assessment` | LiveDiagnoser | `{ score, route, breakdown, matched_patterns }` | SolutionFlow ◇决策节点 + PhasePopup |
| `reasoning_step` | LiveDiagnoser | `{ n, type, tool?, text, result?, highlight? }` | 推理链逐步揭示 |
| `confidence_low` | LiveDiagnoser | `{ score, current_attempt, hint }` | LiveRunner 决定是否 restart(场景 F 首轮回 Agent1) |
| `diagnosis_complete` | LiveDiagnoser | `{ fault_elements, fault_type, fault_mode, confidence, route, iterations }` | 关闭推理链面板 |
| `recovery_action` | LiveRunner | `{ id, cn, en, ts, layer? }` | 恢复动作序列(F 三层并行) |
| `evaluation_report` | LiveEvaluator | `{ metrics, trace_axes, suggestions, case_entry }` | phase 7 评估面板 + 优化建议 |
| `skill_evolved` | LiveEvaluator | `{ kind, skill_id, insight, next_hit_rate }` | 能力沉淀面板 |
| `user_breakdown` | LiveDiagnoser | `{ apns, devices, anomalous_apn, unsupported_device, summary }` | 场景 F 二轮用户分类弹窗 |
| `error` | 任意 | `{ source, code, message, fatal? }` | 弹 toast;fatal 时前端自动回 DEMO |

### 前端 liveBus 状态 shape
```ts
{
  phaseIndex: number;       // 复用 0-7
  progress: number;         // 0-1
  round: 1 | 2;             // 场景 F 双轮
  simT: number;
  simNeCpu: Record<NEId, number>;
  activeRoute: RouteKey | null;
  activeDiagnosis?: DiagnosisSnapshot;
  activeEvaluation?: EvaluationSnapshot;
  recentSteps: ReasonStep[];
  recoveryActions: RecoveryAction[];
  userBreakdown?: UserBreakdown;  // F 专用
  runnerState: RunnerState;
  capabilities: Record<ScenarioId, "live"|"demo">;
}
```

### 降级契约
- `runner_state=failed` 或 WS 断开 3s → 前端把 hook 切回 `useStoryClock`、state 切回 DEMO;保留错误 toast。

## 3. LiveRunner 状态机

### 状态转移
```
select_scenario → init
                ↓
            simulating (1..N ticks;产 tick/confidence_assessment/reasoning_step)
                ↓
            diagnosing (LiveDiagnoser 流式推理;每步 emit reasoning_step)
                ↓
              ┌─────────────────┐
              │ confidence < 0.3│──→ restart_requested → simulating(loop+1)
              └─────────────────┘     (F 首轮:补采 CHR + 用户分群追踪)
                ↓ (≥ 0.3)
            recovering (按 plugin 定义的 flow_control_action 序列下发;emit recovery_action)
                ↓
            evaluating (LiveEvaluator 评估;emit evaluation_report + skill_evolved)
                ↓
              done
   任意阶段抛异常 → failed(fatal=True 时前端切回 DEMO)
```

### 关键不变量
- 单 session 单 runner 串行推进(`asyncio.Lock`),事件按 emit 顺序推 WS。
- `tick` 频率由 plugin 控(场景 F 默认 1 tick = 1 仿真秒)。
- `set_speed` 改 base_interval 而非跳秒,保证曲线连续。
- 场景 F `restart`:首轮 `confidence < 0.3` 后 LiveRunner 调 `plugin.request_rebatch_chr()` 让 simulator 在原 scenario 上重放一轮并附带"终端类型/不支持 back-off 终端"维度;不重起进程、不新 session。
- 暂停:不丢缓冲区,恢复后从暂停 sim_t 续推。
- seek:LiveEngine 时钟重置;不重发已 emit 的历史事件;前端用 snapshot 补齐曲线缺口。

### 存储
- `loop_iterations` 表加新行 `session_id, scenario_id, runner_state, started_at, ended_at, restart_count, llm_mode`。
- 用例文件不写盘(与 DEMO 一致)。
- 状态机 `done` 后 30s 自动释放;超过 10 个活跃 session 拒绝新建返回 503。

### 与 `closed_loop.py` 关系
不复用。ClosedLoopRunner 是"批次生成+串行批诊断",LiveRunner 是"实时长跑+状态机+流式"。两条入口互不依赖。

## 4. ScenarioPlugin 协议

### 协议定义(`agents/shared/scenario_plugin.py`)
```python
class ScenarioPlugin(Protocol):
    id: str
    label_cn: str
    label_en: str
    version: str

    # 元数据
    short_intro: str
    route_expectation: RouteKey
    expected_round: 1 | 2

    # 构造层(选场景时调一次)
    def build_topology(self) -> Topology: ...
    def build_fault_config(self, topo: Topology) -> FaultConfig: ...
    def build_ue_distribution(self) -> UeDistribution: ...

    # 每 tick 钩子
    def on_tick(self, ctx: TickContext) -> list[Event]: ...
    def on_ue_request(self, req: UeRequest) -> UeResponse: ...  # 可选:注册/会话准入

    # 推理与恢复
    def diagnosis_llm_stub(self, ctx: DiagnosisContext) -> DiagnosisPlan: ...
    def recovery_actions(self, plan: DiagnosisPlan) -> list[RecoveryAction]: ...
    def on_recovery_action(self, action, ctx) -> list[Event]: ...

    # 双轮补采(F 用)
    def request_rebatch_chr(self) -> RebatchSpec: ...
    def on_user_breakdown(self, breakdown: UserBreakdown) -> list[RecoveryAction]: ...
```

### 注册表
- 模块级 `dict[str, ScenarioPlugin]`,启动时 `discover_plugins()` 自动 import `agents/simulation/plugins/<id>.py`。
- 场景 F 真实 plugin: `agents/simulation/plugins/f_iot_storm_layered.py`。
- 其它场景占位: `a_*.py` ~ `e_*.py` 各导出一个 `_NoopPlugin`,`on_tick` 返回空事件,`capabilities: "demo"`。

### LiveEngine 集成
- `LiveEngine(engine, plugin)`:包装 `engine.simulate()`,改为 `for t in range(sim_window): plugin_ctx = TickContext(...); engine.step(plugin_ctx); events = plugin.on_tick(plugin_ctx); emit_events(events)`。
- 场景 F `on_ue_request` hook:LiveEngine 在生成注册/PDU 会话请求时调,plugin 返回 `DENY`/`ALLOW`/`BACKOFF(秒)`。

### 前端 capabilities 接口
- 启动时 `GET /live/capabilities` → `{ F: "live", A: "demo", ... }`
- TopBar 场景选择器:A/B/C/D/E 显示 `(DEMO)` 灰角标,F 不带角标;点击 F 走 LIVE 分支,其它仍走 DEMO 钟。

## 5. LLM Stub 与降级

### `agents/shared/llm_client.py` 扩展
- `LLMConfig` 加字段 `mode: Literal["stub", "live", "auto"]`,默认 `"auto"`。
- `LLMClient` 构造时读环境变量 `CC_LIVE_LLM_MODE` 覆盖;`auto` 模式下检查 `OPENAI_API_KEY` 设置情况:有 → `live`,无 → `stub`。
- `stub` 模式:所有 `acomplete()` / `achat()` 调用走 `_StubRouter`。

### `_StubRouter` 行为
- 解析 prompt 里的 case_id / scenario_id 关键字。
- 到 `agents/simulation/stubs/<agent>/<scenario_id>.json` 加载预制响应。
- 按 prompt 角色(诊断/评估/...)取对应字段。
- 返回字符串(LLMResponse 兼容 shape)。

### Stub 内容
- `agents/simulation/stubs/perception/F.json` — 完整推理链(场景 F 两轮 12 步 + 终端类型感知 + 反压比例解释),与 `constructed.ts` SPEC_F 同步。
- `agents/simulation/stubs/evaluation/F.json` — 评估指标 + trace_axes + suggestions(与 SPEC_F EVAL_F 对齐)。
- A–E stubs:复用 `scenarios.ts` 的 `reasoning` / `evaluation` 字段翻译成 JSON。
- 加载顺序:场景 plugin 路径 → stub 路径 → 内置 fallback `"FALLBACK_OK"`。

### 降级链
1. `mode=live` + LLM 调失败(超时/限流/网络)→ 重试 1 次(5s)→ 仍失败 → 切 `mode=stub` 并 emit `runner_state=fallback_to_stub` + 顶栏橙色徽标"STUB 模式"。
2. `mode=stub` + stub 加载失败 → emit `error(fatal=True)` → LiveRunner 转 `failed` → 前端 3s 后自动回 DEMO。
3. WS 断线(前端 3s 心跳超时)→ 自动回 DEMO;用户可手动重连。

## 6. 测试、风险与回滚

### 测试策略
1. **端到端冒烟** `tests/integration/live/test_f_scenario_e2e.py`:起 FastAPI testclient → `POST /live/select F` → 订阅 WS → 断言 1 分钟内收到 `runner_state`、`tick`×60、`confidence_assessment`、`reasoning_step`×N、`recovery_action`×6(首轮 3 + 二轮 3)、`evaluation_report`、`runner_state=done`。CI 必跑。
2. **状态机单元** `tests/unit/live/test_live_runner.py`:mock LiveEngine + StubRouter,覆盖全部 7 个状态转移 + 4 类异常路径。
3. **Plugin 协议** `tests/unit/live/test_plugin_protocol.py`:F plugin 行为断言(首次 confidence<0.3、rebatch 后二轮恢复、首轮 iPhone 不下发 back-off)。
4. **前端 Hook** `tests/frontend/liveBus.test.ts`(vitest):mock WS,断言 state 派生与 `useStoryClock` 形状一致。
5. **降级回归** `tests/integration/live/test_fallback.py`:断网 → `mode=stub` → 仍产出全量事件;stub 缺文件 → `failed` → 前端 3s 后回 DEMO。

### 风险与对策
- **仿真器未拆 step 接口** — 风险:回滚 engine 改动量大。对策:保留旧 `simulate()` 完整签名;`engine_step.py` 内部封装 `step()`,原 `simulate()` 改为 `for _ in range(window): step()`,零行为变化。
- **stub 内容与真实 LLM 推理脱节** — 风险:真实 LLM 时差异被忽略。对策:stub 拆成 `<scenario_id>.json` + `live_override.json`(仅当真实 LLM 返回时记 diff),便于事后比对。
- **WS 大消息** — 风险:60s × 1k KPI 行 ≈ 60k 消息/min,拥塞。对策:tick 事件限流(最小间隔 200ms),KPI 走窗口聚合(delta 而非全量)。
- **LiveRunner 内存泄漏** — 风险:长跑累积 100+ session。对策:`done` 后 30s 自动释放;>10 个活跃 session 拒绝新建返回 503。
- **CORS 跨域** — 风险:5175 端口未在 `api/app.py` allow_origins。对策:CORS 列表加 `http://localhost:5175`(仅 dev)。

### 回滚策略
- 后端:所有新模块用 `try: import` 包 try-except;`api/routes/live.py` 用 `if settings.FEATURE_LIVE else None` 守护;env `CC_LIVE_ENABLED=0` 时全模块不加载。
- 前端:`liveBus` / `useLiveClock` 隔离在 `frontend-flow/src/story/live*`;`App.tsx` 切换通过 `useState<Mode>` 控制;失败即回 `useStoryClock`,无残留 state。
- 数据库:仅 `loop_iterations` 表加字段(向后兼容;旧记录字段为 NULL)。

### 度量指标(上线 1 周后看)
- 场景 F 端到端 P50 < 90s、P95 < 120s。
- WS 断线率 < 1%(按 session 计)。
- stub fallback 触发率 < 5%。
- 真实 LLM 调用成功率 > 95%(按 call 计)。
