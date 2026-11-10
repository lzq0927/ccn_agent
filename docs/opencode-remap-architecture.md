# ReMAP AI 系统可靠性机制设计与仿真

## 定位与参考

本模块基于 ccn_agent 的 develop 分支。参考 ReMAP 的 `packages/agents`、
`packages/mcp-runtime`、`skills/workflow.json` 和 `opencode.json`：由一个 OpenCode
Agent 使用领域 Skill 和 MCP，数值求解独立于 LLM。ReMAP 的可用度分配/评估覆盖
平台通用流程，本模块重点实现 AI 系统分区下的机制设计与仿真验证。

归属不等于已具备全部 AI 系统物理模型。当前复用的是 A–G 七个 5GC 服务保障合成场景，
包括网元丢损、接入侧群体异常、物联风暴及 AI 平台流量引起的 UDM 过载。
训练检查点、推理副本、模型服务熔断等需要新增适配器和校准证据。

## 分层与责任

| 层 | 实现 | 责任 |
| --- | --- | --- |
| 产品入口 | `frontend/src/components/ReliabilityView.tsx` | 系统/目标、机制方案、基线比较、历史与报告 |
| 基础 Agent | `reliability/opencode.py`、`opencode.json` | OpenCode 服务健康、项目目录、会话摘要与命令；官方管理模型 |
| Skill | `.opencode/skills/*/SKILL.md` | 系统建模、机制设计、仿真验证 |
| MCP 工具 | `reliability/mcp_server.py` | 原生 SDK stdio，结构化参数与工具错误 |
| 领域服务 | `reliability/service.py`、`models.py` | 方案校验、修订冲突、冻结实验、重放、报告 |
| 知识库/模型 | `reliability/knowledge/`、`catalog.py` | 版本化实体、关系、适用性、来源、证据等级 |
| 仿真适配 | `reliability/solver.py` | 复用 `agents/simulation/realtime_engine.py`，基线/候选对照 |
| 实验存储 | `reliability/store.py` | SQLite，独立方案版本与不可覆盖的实验记录 |

知识库目前是可检索的本地结构化资产与方法文档，未引入向量数据库或额外模型。
知识模型包含系统、故障、机制、指标、证据，以及 exposed_to/mitigates/measured_by/
supported_by 关系。节点有 source 与 evidence_level，冻结实验包含完整知识快照。

## 可执行闭环

1. 工作台或 OpenCode 读取 capabilities、scenarios 与知识模型，明确目标和输入假设。
2. 使用 Design schema 创建独立方案，包含场景、机制参数、窗口、种子和验收目标。
3. `design_validate` 校验未知网元、跨类型重选、受损目标、重复动作、过滤器与实验预算。
4. `simulation_run` 读取指定修订，运行正常段/故障段，复制同一引擎状态，分别运行无机制
   基线与候选方案。隔离、重选、流控真正施加于仿真器，不通过硬编码事件宣称恢复。
5. 保存输入/结果 SHA-256、相关源代码 SHA-256、Python/依赖版本、知识与方法快照、每个种子的轨迹与指标。
6. `report_export` 从保存结果生成报告；`run_replay` 创建新记录，引用原实验并使用原输入。
   引擎代码或运行环境版本变更时拒绝同版本重放，可恢复原版本或进行新评估。

方案更新使用 expected_revision 防止覆盖并发修改。API 与 MCP 共享相同目录下的 SQLite，
每次操作使用短连接与事务，没有全局“当前方案”。每次调用都明确 design_id/run_id。
OpenCode 会话绑定方案 ID 和创建时修订；通过 API 启动旧会话工作流时会检测版本冲突。
会话摘要用 noReply 写入，不自行触发模型；在官方界面使用 `/ai-reliability` 开始协作。

## MCP 与 REST 契约

所有工具都由 `python -m reliability.mcp_server` 提供，stdio 的 stdout 专供协议使用。

| MCP | REST（前缀 `/api/v1/reliability`） |
| --- | --- |
| reliability_capabilities | GET `/capabilities` |
| knowledge_search | GET `/knowledge?query=...` |
| scenario_list | GET `/scenarios` |
| design_list / design_get | GET `/designs`、GET `/designs/{id}` |
| design_create / design_update | POST `/designs`、PUT `/designs/{id}` |
| design_validate | POST `/designs/validate` |
| simulation_run | POST `/designs/{id}/runs`，body: `{ "expected_revision": 1 }` |
| run_list / run_get | GET `/designs/{id}/runs`、GET `/runs/{id}` |
| run_replay | POST `/runs/{id}/replay` |
| report_export | GET `/runs/{id}/report` |

MCP 同时提供 `reliability://knowledge/model`、`reliability://knowledge/boundaries`、
`reliability://contracts/design` 资源。HTTP 404 表示对象不存在，409 表示修订冲突，
422 表示输入无效，503 表示 OpenCode 未就绪。MCP 错误使用协议的 isError 返回。
设计 schema 是 Python/Pydantic 单一来源，由 FastAPI OpenAPI 与 MCP SDK 自动发布。

实验同步执行并限制为最多 20 个种子、6000 个总仿真 tick；仅完成后保存记录，
失败请求不产生“已完成”实验。进程中断时未完成计算不会自动续算。

## 指标和限制

注册/PDU 成功率分别使用引擎 12 tick 精确滚动计数比值，不用四舍五入后的展示值判定达标。最后一窗的比值跨种子取均值，
不是全体请求加权成功率。CPU 使用全部核心网元最大值，不含 gNB。
连续 N tick 满足成功率与 CPU 目标时记录恢复确认时间；从未达到则为 null。
最终窗口再次失败仍会显示未达标。报告不会把中途曾恢复等同于最终持续恢复。

两个分支拥有相同初始状态和随机数状态，但机制可能改变后续随机数消费顺序。
因此不能声称恢复段逐事件使用共同随机数。逐种子值与均值均保留，目前未提供总体
置信区间或正式可靠性认证。流控拒绝和退避是滚动窗口计数，不跨 tick 累加。

详见 [方法边界](../reliability/knowledge/boundaries.md)。

## ReMAP 接入与兼容

`config/remap-module.json` 描述 `ai-systems` 父级、Agent、Skill、MCP、API 前缀与已实现域。
ReMAP 可把此模块注册为独立子工作台，或给其 OpenCode 项目增加这个 stdio MCP server；
配置服务命令时使用本仓库虚拟环境的绝对 Python 路径，并把工作目录设为本仓库。
若共用一个 OpenCode 实例，API 的 directory 参数区分项目；模型仍由 OpenCode 官方管理。
接入时须给 API 与 MCP 相同的 CCN_RELIABILITY_DATA 绝对目录。

当前只改造本仓库，没有写入 ReMAP 主仓库，也未将它的任务令牌/多用户隔离协议
移植到本地模块。这是本地单用户工具，API 与 OpenCode 默认监听回环地址。
公网或团队托管需要额外的认证、任务权限与部署层适配。

旧 `agents/closed_loop.py`、故障诊断 LLM 循环、`/api/v1/live` 及多套演示前端保持兼容，
不参与新机制仿真服务。旧领域诊断 Skill 仍可作为参考资料。后续如果迁移 LIVE 的
交互诊断，应通过同一 OpenCode 接口和独立工具完成，不能重新引入嵌套 Agent Loop。
