# Agent 开发指南

## 快速开始

### 环境准备
```bash
# 安装依赖
pip install -e ".[dev]"

# 配置LLM
# 方式1: 环境变量
export OPENAI_API_KEY="your-key"

# 方式2: 修改 config/llm.yaml
```

### Agent 1: 数据生成
```bash
# 生成10个用例
python -m agents.data_generation.agent --count 10

# 生成100个用例
python -m agents.data_generation.agent --count 100 --seed 42
```

### Agent 2: 故障感知
```bash
# 诊断单个用例
python -m agents.fault_perception.agent --case-id 1

# 批量诊断
python -m agents.fault_perception.agent --batch --count 10
```

### Agent 3: 评估优化
```bash
# 评估所有诊断结果
python -m agents.evaluation.agent --evaluate-all

# 运行完整闭环
python -m agents.evaluation.agent --closed-loop
```

## 模块说明

### agents/shared/ - 共享基础设施
- `llm_client.py`: OpenAI兼容LLM客户端，支持重试和回退
- `models.py`: 跨Agent共享数据模型
- `storage.py`: SQLite存储层，封装所有数据库操作
- `message_bus.py`: 异步消息总线，Agent间通信

### agents/data_generation/ - Agent 1
- `agent.py`: 主编排，包含自校验闭环
- `simulator_wrapper.py`: 封装已有simulator
- `validator.py`: LLM数据校验

### agents/fault_perception/ - Agent 2
- `agent.py`: Hermes风格Agent Loop
- `confidence.py`: 置信度评估，决定路由方式
- `prompt_builder.py`: 渐进式Skill加载
- `context_manager.py`: 上下文窗口管理

### agents/evaluation/ - Agent 3
- `agent.py`: 主编排
- `evaluator.py`: 真值对比
- `trace_analyzer.py`: 推理过程分析
- `case_library.py`: 案例库构建
- `optimization_advisor.py`: 优化建议生成

### tools/ - 诊断工具集
- `registry.py`: 工具注册表
- `kpi_analyzer.py`: KPI数据分析
- `topology_tools.py`: 拓扑查询
- `flow_tracer.py`: 业务流追踪
- `fault_isolator.py`: 故障定位
- `statistical_tools.py`: 统计分析

### skills/ - Skill系统
- `index.md`: L0索引
- `core/`: 核心诊断Skill (7个)
- `workflows/`: 固定工作流
- `learned/`: 自动学习生成的Skill

## 数据格式

### 用例目录结构
```
storage/cases/case_001/
├── data.csv          # KPI时序数据
├── topo.txt          # 网络拓扑
├── process.txt       # 业务流程
├── result.txt        # 故障标签(真值)
└── metadata.json     # 用例元数据
```

### data.csv 格式
```csv
timestamp,level,ue_id,src,dst,success_rate
1,link,,AMF_1,SMF_2,0.9972
1,trace,UE_1,gNB_2,AMF_3,0.9981
1,session,UE_1,,,0.9841
```

### result.txt 格式
```json
{
  "fault_elements": ["AMF_2"],
  "fault_links": []
}
```

## 闭环工作流

```
1. Agent 1 生成用例 → LLM校验 → 入库
2. Agent 2 加载用例 → 置信度评估 → 路由诊断
3. Agent 3 评估结果 → 沉淀案例 → 生成建议
4. 建议反馈到 Agent 1 (新用例) 和 Agent 2 (Skill更新)
5. 重复迭代
```
