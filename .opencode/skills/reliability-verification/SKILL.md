---
name: reliability-verification
description: 运行确定性的基线与候选机制对照仿真，重放实验并导出证据报告。
---

读取 reliability://knowledge/boundaries 和 design_get，核对最新 revision。
用户要求评估时调用 simulation_run(design_id, expected_revision)，同步返回已完成实验。
不要调用旧 LLM Agent Loop 来替代数值求解，也不要自行填入恢复成功事件。

检查每个种子的 healthy/fault/baseline/candidate，展示失败、负收益与 warnings。
baseline 与 candidate 从相同故障状态分支，机制改变后随机序列消费可能分化。
最终成功率是 12 tick 滚动窗比值的跨种子均值；持续恢复时间是 N tick 连续达标的
确认时刻，null 表示未恢复。末端持续达标与中途曾恢复分别报告。
末窗拒绝计数不可跨 tick 累加；恢复比例不能称为年度可用度。

run_list 发现历史实验，run_get 读取完整快照，report_export 导出报告。
用户要求可复现验证时 run_replay，用 input_hash/result_hash 与源实验比较。
不同引擎代码版本不能冒充同版本重放。需要新模型时新建评估并说明差异。
输出方案与实验 ID、真实指标、种子/窗口/版本和证据边界。知识库条目的实现状态
不能替代当前参数下的验证结果。
