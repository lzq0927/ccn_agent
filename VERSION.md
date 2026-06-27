# 版本管理 — ccn-agent

> 本文件是 `ccn-agent` 项目的**版本信息单一来源(single source of truth)**。每次发版在此登记:当前版本号、发布分支、Git 标签、以及变更记录。代码侧的版本号同步维护在 [`pyproject.toml`](pyproject.toml) 的 `[project].version`。

---

## 当前版本

| 项 | 值 |
|----|----|
| **版本号** | `v0.1` |
| **内部版本(包)** | `0.1.0`(见 `pyproject.toml`) |
| **发布日期** | 2026-06-27 |
| **Git 标签** | [`v0.1`](#) |
| **发布分支** | `develop-v0.1` |
| **基线 commit** | 见 `git log v0.1 -1` |

---

## 版本约定

采用**语义化版本(SemVer 风格)**:`MAJOR.MINOR.PATCH`,Git 标签以 `v` 开头。

- `MAJOR`——不兼容的架构变更(如数据契约、Agent 间接口破坏性改动)。
- `MINOR`——向下兼容的新功能(新增 Agent / 工具 / 视图)。
- `PATCH`——向下兼容的缺陷修复。

> `v0.x` 阶段处于快速迭代期,次版本号(`0.1 → 0.2`)即代表一次可交付里程碑;`1.0` 起进入稳定语义化。标签写法:`v0.1`、`v0.1.1`、`v0.2`、`v1.0`。本文件只记录里程碑版本,详细提交历史以 `git log` 为准。

---

## 发布记录(Changelog)

### v0.1 — 2026-06-27 · 首次基线版本

首个可交付基线,确立「数据生成 → 故障感知 → 评估优化」三 Agent 闭环骨架,并具备全栈可视化。

**新增**

- **三 Agent 闭环**(`agents/closed_loop.py::ClosedLoopRunner` 编排):
  - Agent 1 数据生成(设计态):离散事件仿真器 + LLM 多维度校验 + 自校验重试。
  - Agent 2 故障感知(运行态,核心):基于置信度的路由 + Hermes 风格 Agent Loop。
  - Agent 3 评估优化(设计态):真值比对(P/R/F1)+ 推理链分析 + 案例库 + 优化建议回流。
- **离散事件仿真器**(`simulator/`):从 5GC 拓扑 + 业务流模板生成 link / trace / session 三级 KPI 时序,注入 link / business 两类故障,产出带真值标签的故障用例。
- **基于置信度的路由**(`agents/fault_perception/confidence.py`):规则式评估 → `>0.7` WORKFLOW / `0.3–0.7` GUIDED / `≤0.3` AUTONOMOUS。
- **Hermes 风格 Agent Loop**:工具自注册(`tools/registry.py`)、Skill 渐进式披露(`skills/`)、迭代上限与上下文管理。
- **诊断工具集**:KPI 异常检测、拓扑解析、业务流追踪、故障候选排序、时序模式分析。
- **OpenAI 兼容 LLM 客户端**(`agents/shared/llm_client.py`):改 `base_url` 即可对接 OpenAI / OpenRouter / 本地 Ollama。
- **存储层**(`agents/shared/storage.py`):SQLite(6 张表)+ 用例目录 / 会话轨迹文件系统辅助。
- **FastAPI 后端**(`api/`):REST(`/api/v1`)+ WebSocket(`/ws/updates`)实时进度。
- **管理后台前端**(`frontend/`):React 18 + TS + Vite + recharts,Dashboard + 三视图。
- **展会演示前端**(`frontend-show/`):高稳智能体 · 5GC 数字孪生指挥中心,DEMO / LIVE 双模式。

**已知限制**

- 置信度阈值 `THRESHOLD_HIGH`(0.7)/ `THRESHOLD_LOW`(0.3)为 `confidence.py` 模块常量,未接通 `config/default.yaml`。
- 暂无 `tests/` 用例(`pytest` 当前无可执行用例)。
- 仿真与诊断的运行时输出(`storage/`、`data/`)由仿真器重新生成,不入库。

---

## 如何发新版本

1. 完成功能并合并到 `develop-v*` 分支;同步更新 `pyproject.toml` 的 `version`。
2. 在本文件顶部「当前版本」表更新版本号 / 日期 / 标签 / 分支,并在「发布记录」追加一段。
3. 打标签:`git tag -a v0.x -m "release: v0.x ..."`,推送:`git push origin v0.x`。
4. 推送发版分支:`git push origin develop-v0.x`。
