---
name: reliability-mechanism-design
description: 根据知识模型为可靠性故障设计隔离、重选、准入控制和退避方案。
---

先读 design_get、scenario_list、knowledge_search，核对当前故障、拓扑与机制前置条件。
机制是参数化动作，不是第二个自治 Agent：

- isolate：kind、ne_id。仅隔离会让绑定业务失败，通常需配合 reroute。
- reroute：kind、from_ne_id、to_ne_id。目标必须是同类型健康实例。
- flow_control：kind、layer（UE/AMF/SMF）、ratio（0–0.95，且 >0）、
  flt（sst/dnn/device_type 的可选组合）。多字段为 AND 条件，空过滤器影响全部业务。

先 design_validate，再按用户意图保存。对独立候选使用 design_create，
编辑原方案用 design_update 并传 expected_revision 和完整 design。
不得靠修改目标掩盖机制无效；比较中保持目标、场景、种子和观测窗口可比。
流控拒绝数、终端退避支持率与恢复收益必须一并考虑。设计完成仅表示候选已保存，
只有 simulation_run 的真实结果才构成仿真证据。
