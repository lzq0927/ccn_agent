# Hermes Agent 安装指南

## 安装结果

**Hermes Agent v0.13.0** — 已于 Python 3.14 环境下安装成功。

安装来源：`D:\hermes\hermes-agent`（editable 模式）

安装命令：

```bash
cd D:/hermes/hermes-agent
pip install -e ".[mcp]"
```

> 注意：跳过了 `[pty]` 和 `[cli]` 依赖。`pywinpty` 在 Python 3.14 上无预编译 wheel，需要从源码构建耗时很长；`simple-term-menu` 在 Windows 上不完全兼容。核心功能不受影响。

---

## 启动方式

### 方式一：python 直接运行（无需改 PATH）

```bash
python "D:/hermes/hermes-agent/hermes"
```

### 方式二：用绝对路径运行 hermes.exe

```bash
"C:/Users/36129/AppData/Roaming/Python/Python314/Scripts/hermes.exe"
```

### 方式三：把 Scripts 目录加到 PATH（一劳永逸）

在 PowerShell 中运行：

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Users\36129\AppData\Roaming\Python\Python314\Scripts", "User")
```

重启终端后直接 `hermes` 即可。

---

## 首次使用流程

1. **选模型** — `hermes model` 或在对话中输入 `/model`，选择 LLM 提供商（推荐 OpenRouter 或 z.ai/GLM）
2. **开始对话** — `hermes` 启动交互式 TUI
3. **让 Hermes 优化项目** — 在对话中告诉它分析 `D:\code\project_ccn_agent_hermes` 下的代码

## 常用命令

| 命令 | 用途 |
|------|------|
| `hermes` | 启动交互式 CLI 对话 |
| `hermes model` | 选择 LLM 提供商和模型 |
| `hermes tools` | 配置启用的工具 |
| `hermes config set` | 设置单个配置项 |
| `hermes setup` | 运行完整设置向导（一次性配置所有内容） |
| `hermes doctor` | 诊断问题 |
| `hermes update` | 更新到最新版本 |

## 项目结构

```
D:\code\project_ccn_agent_hermes\
├── simulator/          # 模拟引擎（Python，含 100 个测试用例）
├── 顶层设计/           # 角色定义、协作协议、Agent 技能矩阵
├── data/               # 数据文件
└── docs/               # 文档
```
