# Hermes Agent 自进化闭环体系 — 核心理念与代码架构

> 本文档总结 Hermes Agent（v0.13.0）的自进化闭环设计理念，为本项目 3-Agent 故障感知体系（数据生成 → 故障感知 → 评估优化）提供方法论参考。

---

## 一、核心理念：Experience → Skill → Evolution

Hermes 的自进化遵循一个三阶段闭环：

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ① 经验积累          ② 技能固化          ③ 自我优化  │
│  (Experience)   →   (Skill)        →   (Evolution)  │
│       ↑                                        │    │
│       └────────────────────────────────────────┘    │
│                    闭环反馈                          │
└─────────────────────────────────────────────────────┘
```

**关键洞察**：Hermes 不是简单地"记住做过什么"，而是将成功的经验提炼为**可复用的程序性知识（Skill）**，并在使用中持续优化这些知识。这比纯记忆（Memory）更强大——记忆是**陈述性**的（"我做过X"），技能是**程序性**的（"如何做X"）。

---

## 二、四大自进化机制

### 机制 1：技能创建 — 从成功经验中学习

**触发条件**（`skill_manager_tool.py` 的 tool schema 描述）：
- 复杂任务成功完成（5+ 次 API 调用）
- 克服了错误并找到解决方案
- 用户纠正后方案生效
- 发现非平凡的 workflow
- 用户主动要求记住某个流程

**创建流程**：
```
任务成功 → Agent 判断是否值得固化为技能
         → skill_manage(action="create", name="xxx", content=SKILL.md)
         → 验证名称/格式/frontmatter
         → 原子写入 ~/.hermes/skills/<name>/SKILL.md
         → 更新技能缓存（立即可用）
```

**技能的目录结构**：
```
~/.hermes/skills/my-skill/
├── SKILL.md          # 核心指令文件（必需）
├── references/       # 参考文档、API 摘要、领域笔记
├── templates/        # 可复制的模板文件
├── scripts/          # 可执行的验证/探测脚本
└── assets/           # 其他资源
```

**SKILL.md 格式**（YAML frontmatter + Markdown body）：
```yaml
---
name: my-skill
description: 一句话描述（用于技能搜索和匹配）
version: 1.0.0
metadata:
  hermes:
    tags: [tag1, tag2]
    category: devops
---

# 技能标题

## When to Use — 触发条件
## Procedure — 步骤指令
## Pitfalls — 已知陷阱
## Verification — 验证方法
```

**对本项目的启发**：
- 每个 Agent 成功完成一次故障分析后，应将分析路径固化为技能
- 技能不是简单的日志，而是提炼后的**可执行流程**

---

### 机制 2：技能演进 — 在使用中持续改进

**触发条件**：
- 使用技能时发现指令过时/有误
- 遇到 OS 特有的失败
- 发现缺失的步骤或新陷阱
- 用户给出纠正

**改进手段**（三种粒度）：

| 操作 | 粒度 | 场景 |
|------|------|------|
| `patch` | 局部替换 | 修复某个步骤、添加一个 Pitfall |
| `edit` | 全量重写 | 技能需要大幅重构 |
| `write_file` | 添加辅助文件 | 补充 references/templates/scripts |

**关键设计：即时改进**
> "If you used a skill and hit issues not covered by it, patch it immediately."
> — skill_manager_tool.py schema description

Agent 被指示在遇到问题时**立即修复技能**，而不是事后批量更新。这保证了技能库始终与实际使用环境同步。

**对本项目的启发**：
- 评估 Agent 发现感知 Agent 的某条规则有误时，应立即修复该规则
- 数据生成 Agent 发现某类 case 的 ground truth 有问题时，应立即修正生成逻辑

---

### 机制 3：Curator — 后台自动整理与合并

**这是 Hermes 最精妙的自进化设计。**

Curator 是一个后台运行的角色，定期（默认 7 天）审查所有 Agent 自创建的技能，执行**伞形合并（Umbrella Consolidation）**。

**Curator 的工作流程**：

```
第 1 步：自动状态转换（纯规则，无需 LLM）
├── 30 天未使用 → 标记为 stale
├── 90 天未使用 → 归档到 .archive/
└── 重新使用的 stale 技能 → 恢复为 active

第 2 步：LLM 驱动的合并审查
├── 扫描所有 Agent 创建的技能
├── 识别前缀聚类（共享领域关键词的技能组）
├── 对每个聚类执行伞形合并：
│   ├── 方案 A：合并到已有伞形技能（patch 扩展）
│   ├── 方案 B：创建新伞形技能（create）
│   └── 方案 C：降级为辅助文件（references/templates/scripts）
├── 归档被合并的子技能
└── 生成结构化报告（consolidations + prunings）
```

**Curator 的核心哲学**（摘自 `curator.py` 的 CURATOR_REVIEW_PROMPT）：

> "A collection of hundreds of narrow skills where each one captures one session's specific bug is a FAILURE of the library — not a feature. One broad umbrella skill with labeled subsections beats five narrow siblings for discoverability."

**翻译**：上百个只记录单次会话具体 bug 的窄技能，是库的**失败**，不是特性。一个包含分类子节的宽泛伞形技能，在可发现性上胜过五个窄的兄弟技能。

**安全边界**：
- 只操作 Agent 自创建的技能，不碰 bundled/hub 安装的技能
- 不删除，只归档（可恢复）
- Pinned 技能跳过所有自动操作
- 合并后自动更新引用了旧技能名的 cron 任务

**对本项目的启发**：
- 故障感知规则库需要类似的"合并归类"机制
- 从大量具体的 case 级规则中提炼出通用故障模式
- 将"一 case 一规则"的窄规则合并为"一模式一技能"的通用规则

---

### 机制 4：渐进式披露 — 高效的知识检索

Hermes 不一次性加载所有技能内容，而是采用三层渐进式披露：

| 层级 | 内容 | Token 开销 | 触发方式 |
|------|------|-----------|---------|
| Tier 0 | 名称 + 描述 | ~3K tokens | 自动（System Prompt） |
| Tier 1 | 完整 SKILL.md | 完整内容 | `skill_view(name)` |
| Tier 2 | 辅助文件 | 按需 | `skill_view(name, path)` |

技能在 System Prompt 中只显示名称和一行描述（Tier 0），Agent 根据任务需要按需加载完整内容（Tier 1）和参考文件（Tier 2）。

**对本项目的启发**：
- 故障规则库不应全量注入 prompt，应按需检索
- 先匹配故障类型（Tier 0），再加载对应的推理规则（Tier 1）

---

## 三、完整闭环流程

```
┌──────────────────────────────────────────────────────────────────┐
│                     Hermes 自进化完整闭环                        │
│                                                                  │
│  ┌─────────┐    成功经验     ┌──────────┐    即时修复            │
│  │  任务    │ ──────────→    │ 技能创建  │ ←──────────────┐      │
│  │  执行    │                │ (create) │                │      │
│  └────┬────┘                └────┬─────┘                │      │
│       │                          │                      │      │
│       │ 使用技能                  │ 存入技能库            │ 使用中│
│       │                          ↓                      │ 发现  │
│       │                   ┌──────────────┐              │ 问题  │
│       └────────────────→  │   技能库      │  ────────────┘      │
│                           │ ~/.hermes/   │                      │
│                           │   skills/    │ ←─────────┐         │
│                           └──────┬───────┘           │         │
│                                  │                   │         │
│                          Curator │ 定期审查          │ 技能    │
│                                  ↓                   │ 演进    │
│                           ┌──────────────┐           │         │
│                           │ 伞形合并      │ ──────────┘         │
│                           │ (consolidate) │                     │
│                           └──────┬───────┘                     │
│                                  │                              │
│                                  │ 归档窄技能                    │
│                                  │ 创建/扩展伞形技能              │
│                                  │ 更新 cron 引用                │
│                                  ↓                              │
│                           ┌──────────────┐                     │
│                           │ 精炼后的      │ ──→ 下次任务使用更优技能│
│                           │ 技能库        │                     │
│                           └──────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 四、关键代码文件索引

| 文件 | 职责 | 核心概念 |
|------|------|---------|
| `tools/skill_manager_tool.py` | 技能 CRUD（create/patch/edit/delete） | 程序性知识的创建与维护 |
| `agent/curator.py` | 后台 Curator 审查引擎 | 伞形合并、状态转换、报告生成 |
| `tools/skill_usage.py` | 技能使用遥测 | 生命周期状态追踪（active→stale→archived） |
| `tools/skills_tool.py` | 技能检索（skills_list/skill_view） | 渐进式披露 Tier 0/1/2 |
| `agent/skill_commands.py` | 斜杠命令注册与技能调用 | 技能变为可执行命令 |
| `agent/memory_manager.py` | 记忆管理 | 陈述性记忆（Memory）与程序性知识（Skill）分离 |
| `run_agent.py` | 主 Agent 循环 | 迭代预算、推理提取、自我修正 |

---

## 五、对本项目 3-Agent 体系的映射建议

### 当前项目架构

```
数据生成 Agent  →  故障感知 Agent  →  评估优化 Agent
   (Simulator)      (Perception)       (Evaluator)
```

### 映射到 Hermes 自进化模式

| Hermes 概念 | 本项目对应 | 具体做法 |
|------------|-----------|---------|
| **技能创建** | 故障感知规则 | 感知 Agent 成功识别故障后，将推理路径固化为规则 |
| **技能演进** | 规则优化 | 评估 Agent 发现规则缺陷时，即时 patch 该规则 |
| **Curator 合并** | 规则泛化 | 将多个 case-specific 规则合并为通用故障模式规则 |
| **渐进式披露** | 按需加载规则 | 先匹配故障类型，再加载对应的推理规则链 |
| **使用遥测** | 规则效果追踪 | 记录每条规则的命中率、误报率，驱动淘汰/强化 |
| **记忆 vs 技能** | 案例 vs 规则 | 案例库是陈述性记忆，规则库是程序性技能 |
| **状态转换** | 规则生命周期 | active（在用）→ stale（命中率低）→ archived（淘汰） |
| **Pinned 保护** | 核心规则保护 | 领域专家确认的核心规则不参与自动淘汰 |

### 建议的闭环流程

```
1. 数据生成 Agent 生成 case → 仿真执行 → 获得带标签的 KPI 数据

2. 故障感知 Agent 分析数据 → 应用现有规则 → 输出故障诊断
   ├── 规则命中且正确 → bump_use（强化该规则）
   ├── 规则命中但错误 → 即时 patch（修复规则）
   └── 无规则命中 → LLM 探索 → 成功则 create 新规则

3. 评估优化 Agent 对比 ground truth → 计算指标 → 生成优化建议
   ├── 整体 F1 下降 → 触发 Curator 式规则审查
   ├── 发现规则冲突 → 触发伞形合并
   └── 发现弱覆盖区域 → 反馈给数据生成 Agent（定向生成难例）

4. Curator 后台定期：
   ├── 合并同类规则（伞形化）
   ├── 淘汰长期低效规则
   └── 生成规则库健康度报告
```

---

## 六、核心设计原则总结

1. **程序性知识 > 声明性记忆**：技能（怎么做）比记忆（做过什么）更有价值
2. **即时修正 > 批量优化**：发现问题立即修复技能，不等定期审查
3. **伞形合并 > 窄技能堆积**：一个通用规则胜过五个具体规则
4. **安全边界**：只自动处理 Agent 创建的内容，保护人工审核的核心规则
5. **归档不删除**：所有淘汰的内容可恢复，降低自进化的风险
6. **渐进式加载**：按需检索知识，避免 prompt 膨胀
7. **遥测驱动**：基于使用数据（命中率、使用频率）驱动决策，而非主观判断
8. **闭环反馈**：评估结果必须能回流到知识创建和改进环节
