---
name: ai-system-modeling
description: 为 ReMAP AI 系统可靠性机制实验明确系统边界、故障、目标和证据来源。
---

调用 reliability_capabilities、scenario_list 和 knowledge_search。
把需求映射到“系统—故障—机制—指标—证据”模型，确认当前可执行域。
目前只有 5GC 消息级 DES A–G 场景，不把通信网元自动映射成 GPU、推理实例或模型服务。

已有方案先 design_get；无 ID 时 design_list 供发现；新建则 design_create。
输入包含 name、scenario_id、actions、seeds、warmup_ticks、fault_ticks、recovery_ticks、
targets（success_rate、max_core_cpu、sustained_ticks）和 rationale。
读取 reliability://contracts/design 获取精确 JSON Schema。
建议默认采用多种子 [42,43,44]，不要重复种子增加名义样本量。

可通过知识节点的 source 追溯本地实现；旧 skills/core、skills/workflows、
skills/exploration 是诊断领域参考，原 LLM 三 Agent 不再作为新工作流的编排器。
证据不足时把假设写入 rationale。用户未要求的真实网络操作不属于此模块能力。
