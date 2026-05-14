# Hermes Agent 多实例运行与隔离方案

## 默认情况下：会冲突，记忆和状态是共用的

Hermes 默认所有数据都存在 `~/.hermes/` 下，多个实例**共享**：

| 共享资源 | 路径 | 风险 |
|---------|------|------|
| 配置 | `~/.hermes/config.yaml` | 低，只读为主 |
| API 密钥 | `~/.hermes/.env` | 无冲突 |
| 会话数据库 | `~/.hermes/state.db` (SQLite) | **中** — WAL 模式支持并发读，但写会竞争，有 30 秒重试机制 |
| 记忆 | `~/.hermes/memories/` | **高** — 不同项目的记忆会混在一起 |
| 技能 | `~/.hermes/skills/` | 低，只读为主 |

**最大的问题是记忆（memory）**：多个项目各自产生的经验、偏好会写入同一个记忆库，互相污染。A 项目的 agent 可能会读到 B 项目的上下文。

## 解决方案：用 Profile 隔离

Hermes 内置了 **Profile 机制**，每个 Profile 有完全独立的目录：

```
~/.hermes/profiles/<name>/
├── config.yaml      # 独立配置
├── .env             # 独立 API 密钥
├── state.db         # 独立会话数据库
├── memories/        # 独立记忆
├── skills/          # 独立技能
├── sessions/        # 独立会话
└── logs/            # 独立日志
```

### 操作方法

```bash
# 为每个项目创建独立 profile
hermes profile create project-a
hermes profile create project-b

# 启动时指定 profile
python "D:/hermes/hermes-agent/hermes" -p project-a
python "D:/hermes/hermes-agent/hermes" -p project-b
```

两个实例的记忆、会话、配置完全隔离，互不干扰，可以同时运行。

## 对比总结

| 方式 | 记忆 | 会话 | 配置 | 能否同时运行 |
|------|------|------|------|------------|
| 默认（无 profile） | 共用 | 共用 | 共用 | 能跑，但记忆会混 |
| 不同 Profile（`-p`） | 独立 | 独立 | 独立 | 完全隔离，推荐 |
