# Phase 1 完成总结 — free5GC 忠实 CHR 数据管线

> **日期**:2026-06-25 | **状态**:✅ 已完成并验收 | **对应计划**:`docs/plans/free5gc-chr-and-exploration-mode.md`(Phase 1 部分)

## 概述

Phase 1 让仿真器按 free5GC 真实数据模型(SUPI/订阅档/PDU 会话生命周期/5GMM·5GSM·SBI 原因码)产出用户级 CHR,端到端贯通到诊断 prompt。纯 Python、确定性可复现、无 Docker。

**验收结果**:37 个测试全绿,全仓库 `ruff check .` 清洁,closed_loop 端到端跑通并落盘 `chr.jsonl`。

---

## 建了什么(6 个里程碑全绿)

### 新建文件
| 文件 | 内容 |
|---|---|
| `simulator/free5gc_types.py` | `Cause5GMM`/`Cause5GSM`/`SBIStatus` 真实原因码枚举(TS 24.501 诊断相关子集) |
| `simulator/subscriber.py` | `SubscriberProfile`(SUPI/IMSI/MSISDN/slice/DNN)、`PDUSession` 状态机、确定性 `SubscriberRegistry`(seed 自 case_id) |
| `simulator/nrf_view.py` | NRF 注册视图富化(`nf_instance_id`/`sbi_endpoint`/`nf_status`,幂等) |
| `simulator/chr_generator.py` | `CHRGenerator`——故障→原因码决策树(LINK→503/504+38、BUSINESS→500+26/31、PATH_SESSION→67/28、拥塞类→429+22),seed 自 case_id |
| `tests/test_chr_pipeline.py` | 37 个测试覆盖枚举/订阅档/CHRGenerator/engine 一致性/持久化 round-trip/消费者/adapter/端到端/可复现性 |

### 修改文件
| 文件 | 改动 |
|---|---|
| `simulator/engine.py` | 在 trace hop 旁发射 CHR;`_calc_link_sr`/`_calc_trace_sr` 改返回 `(sr, fault_hit)` **保证 KPI↔CHR 同源**;加 `chr_background_fail_rate` 可注入 |
| `simulator/models.py` | 新增 `CHRRecord`;`SimulationResult` 加 `chr_records`/`subscribers`/`sessions`;`NetworkElement` 加 NRF 字段 |
| `simulator/exporter.py` | 加 `_write_chr_jsonl` → `data/case{N}/chr.jsonl` |
| `simulator/scenario.py` | `ScenarioGenerator.generate` 支持任意 count(原硬编码 100,小 count 必崩) |
| `agents/shared/models.py` | `CasePackage.chr_data`、`CaseData.chr_records`、`parse_chr_jsonl` 辅助 |
| `agents/shared/storage.py` | `save/load_case_files` 读写 `chr.jsonl`(向后兼容旧用例) |
| `agents/data_generation/simulator_wrapper.py` | 镜像 CHR 写入 `CasePackage`;移除不存在的 `is_train=` 构造参数 |
| `agents/data_generation/free5gc_adapter.py` | **复用为忠实生成器**(`CaseSource.FREE5GC` + `free5gc` tag) |
| `agents/data_generation/validator.py` | `_build_validation_prompt` 加 CHR 失败计数摘要 |
| `agents/closed_loop.py` + `api/routes/perception.py` | 解析 `chr.jsonl` → `chr_records` |
| `agents/fault_perception/context_manager.py` | `build_user_message` 追加 CHR 失败摘要块;修 `success_rate:.4f` 字符串格式 bug |

---

## 关键设计点

### 1. KPI↔CHR 同源
复用 `_is_fault_active`/`_is_link_affected`/`_is_trace_affected`/`affected_sessions` 判定,使 KPI 与 CHR 指认**同一组受影响 hop**。`_calc_link_sr`/`_calc_trace_sr` 改为返回 `(sr, fault_hit)` 元组,CHR outcome 由 `fault_hit` 驱动。

### 2. CHR 比 0.995 阈值更敏感(微损/隐患信号)
严格一致性方向:**降级 KPI(<0.995)⟹ CHR failure**(测了)。反向不成立:轻/间接故障在 CHR 里失败,但聚合成功率可能仍 ≥0.995。这个"余量"正是 CHR 相对 KPI 的增量价值——区分真网络异常与终端/波动噪声。

### 3. 确定性
`CHRGenerator` 与 `SubscriberRegistry` 各持 `random.Random(seed=case_id)`;engine 的模块级 `random` 由 `create_flows(case_id*1000)` 重置。同 case_id/seed → 字节一致 `chr.jsonl`(哈希测了)。

### 4. 数据契约
CHRRecord 15 字段:`timestamp, supi, pdu_session_id, procedure_type, msg_hop, nf_src, nf_dst, service, sbi_status, outcome, cause5gmm, cause5gsm, latency_ms, message_name, ue_id`。`ue_id`(UE_1..n)保留为内部 join 键,SUPI 是叠加身份层。

---

## 顺带修复的预存 bug

这些不在严格 Phase 1 范围,但不修则系统跑不通,已一并修复:

1. **`ScenarioGenerator` 硬编码 `assert normal_count==10`** —— 任意 count≠100 必崩 → 改为按 `FAULT_DISTRIBUTION` 权重缩放。
2. **`generate_batch` 传不存在的 `CaseMetadata(is_train=...)`** → `TypeError` → 移除该参数。
3. **`prompt_builder.py` 拼写 bug**:`SKILLS_GUIDANCE`(定义,GUIDA**N**CE)vs `SKILLS_GUIDAGE`(使用,GUIDA**G**E)→ `build_system_prompt` 必 `NameError`,**诊断系统提示词构建此前一直是坏的**。
4. **`context_manager.build_user_message` 对字符串 `success_rate` 用 `:.4f`** → CSV 加载的用例必崩 → 改 `float(...)`。
5. 36 处预存未用 import(`ruff --fix`)。

---

## 验收证据

- `python -m pytest tests/ -q` → **37 passed**
- `python -m ruff check .` → **All checks passed**(全仓库清洁)
- `python -m agents.closed_loop --cases 5` → exit 0,批量生成跑通(无 LLM 时诊断阶段跳过,符合预期)
- 端到端落盘验证:`storage/cases/case_001/chr.jsonl` 54,000 行 / ~20MB,含全部 15 字段,51 条失败记录(SBI 500 / `cause5gsm` 31 等),SUPI 格式有效(`imsi-001011005696348`)
- 可复现:同 case_id/seed → `chr.jsonl` 哈希一致

---

## 已知特性(非 bug)

**CHR 粒度 = 每 hop 每秒**(镜像 trace KPI 以保同源)→ 单用例约 54k 行 / ~20MB,100 用例批量约 2GB。如需瘦身可后续做 gzip 或按 UE 聚合,但会打破 per-second 一致性 —— 属优化,不在 Phase 1。Phase 2 的探索检测器会消费完整 `chr_records`。

---

## 后续:Phase 2(待启动)

Phase 2 在真实 CHR 之上构建**探索模式**:`Route.EXPLORATION` + 多算法框架(EWMA/CUSUM/PCA 残差/Isolation Forest/贝叶斯后验)+ 参数扫描与多视图消融 + `ParallelExplorer` 重构为算法编排器。详见计划文档 Phase 2 部分。**受 Phase 1 验收门控,需确认后启动。**
