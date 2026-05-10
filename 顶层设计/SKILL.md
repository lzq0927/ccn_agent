# 工具与任务分工

## Agent 能力矩阵

### 主 Agent (Team Lead)

**可用工具**
- `Agent`: 创建和管理子 Agent
- `TaskCreate/TaskList/TaskUpdate`: 任务管理
- `SendMessage`: 团队沟通
- `Read/Glob/Grep`: 代码探索
- `AskUserQuestion`: 需求确认

**任务分工**
- 接收用户需求，评估可行性
- 规划整体开发流程
- 创建和分配任务给子 Agent
- 协调 Agent 之间的协作
- 决策关键问题
- 验收最终交付成果

---

### 需求分析 Agent

**可用工具**
- `Read/Glob/Grep`: 探索现有代码库
- `Write`: 编写需求文档
- `AskUserQuestion`: 澄清模糊需求
- `WebSearch/WebFetch`: 调研参考方案

**任务分工**
- 与用户沟通，收集完整需求
- 分析需求的可行性和复杂度
- 编写 `SPEC.md` 或需求说明
- 识别技术依赖和约束条件
- 划分需求优先级

---

### 架构设计 Agent

**可用工具**
- `Read/Glob/Grep`: 分析现有架构
- `Write`: 编写架构文档
- `Plan`: 设计实现方案
- `WebSearch`: 调研技术选型

**任务分工**
- 设计系统架构和技术选型
- 规划模块划分和边界
- 制定代码规范和命名约定
- 设计数据模型和 API 结构
- 编写技术设计文档

---

### 项目管理 Agent

**可用工具**
- `TaskCreate/TaskList/TaskUpdate`: 任务管理
- `Read/Glob/Grep`: 跟踪代码进度
- `AskUserQuestion`: 确认任务细节

**任务分工**
- 将需求拆解为可执行的任务
- 创建任务列表，设置依赖关系
- 跟踪任务进度和状态
- 识别阻塞项并上报
- 维护项目里程碑

---

### 后端开发 Agent

**可用工具**
- `Read/Write/Edit`: 代码读写编辑
- `Glob/Grep`: 代码搜索
- `Bash`: 执行命令
- `mcp__ide__executeCode`: 执行代码
- `mcp__ide__getDiagnostics`: 获取诊断信息

**任务分工**
- 实现服务端业务逻辑
- 设计和实现 API 接口
- 数据库设计和实现
- 编写后端单元测试
- 集成测试和调试

---

### 前端开发 Agent

**可用工具**
- `Read/Write/Edit`: 代码读写编辑
- `Glob/Grep`: 代码搜索
- `Bash`: 执行命令
- `mcp__ide__executeCode`: 执行代码
- `mcp__ide__getDiagnostics`: 获取诊断信息

**任务分工**
- 实现用户界面和组件
- 页面路由和状态管理
- 样式和交互实现
- 编写前端单元测试
- 响应式适配和浏览器兼容

---

### 测试 Agent

**可用工具**
- `Read/Write/Edit`: 测试代码读写
- `Glob/Grep`: 搜索测试用例
- `Bash`: 执行测试命令
- `WebFetch`: 调研测试方案

**任务分工**
- 编写测试用例
- 执行单元测试和集成测试
- 验证功能正确性
- 记录和跟踪 bug
- 编写测试报告

---

### 监督 Agent (QA Lead)

**可用工具**
- `Read/Glob/Grep`: 代码审查
- `mcp__ide__getDiagnostics`: 代码诊断
- `Bash`: 执行质量检查
- `TaskList`: 查看任务状态

**任务分工**
- 审查代码质量和规范
- 评估各 Agent 工作成果
- 识别系统性风险
- 监控整体进度
- 提供改进建议
- 验收交付标准

---

## 任务流转规则

```
用户需求 → 主 Agent
    ↓
需求分析 → 架构设计 → 项目管理
    ↓                   ↓
后端开发 ←──────→ 前端开发
    ↓         ↓
测试 ←───────────┘
    ↓
监督 Agent 审查
    ↓
主 Agent 验收
```
