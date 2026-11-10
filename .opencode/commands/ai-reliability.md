---
description: ReMAP AI 系统可靠性机制设计与仿真
agent: remap-ai-reliability
---

处理本次可靠性工作：$ARGUMENTS

1. 读取 reliability_capabilities，加载 ai-system-modeling Skill，明确方案 ID、场景与目标。
2. 加载 reliability-mechanism-design Skill，依据知识模型和已有方案设计候选机制。
3. 按用户本次意图，加载 reliability-verification Skill 执行本地仿真、复核与报告。
4. 使用实际工具结果回答；若用户只要设计，停在可评审方案并说明尚未仿真。
