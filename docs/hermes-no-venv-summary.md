# Hermes Agent 为什么不需要虚拟环境 — 经验总结

## 为什么本机不需要虚拟环境，其他电脑需要

### 核心原因：本机是「全局安装」模式

| 项目 | 本机 | 其他电脑（典型） |
|------|------|------------------|
| Python 安装方式 | **系统级安装** `C:\Python314\` | 通常用 venv/conda 隔离 |
| hermes-agent 安装位置 | `C:\Users\36129\AppData\Roaming\Python\Python314\site-packages` | 依赖在虚拟环境的 `lib/` 下 |
| 安装模式 | `pip install -e ".[mcp]"`（editable） | 需要在 venv 里执行相同命令 |
| 是否在虚拟环境中 | `False` — 直接用的系统 Python | `True` — venv 隔离环境 |
| 运行方式 | `python "D:/hermes/hermes-agent/hermes"` 直接可用 | 必须先 activate 虚拟环境 |

### 成功的关键条件（3 个缺一不可）

#### 1. 系统级 Python（非 venv）+ pip install -e 安装

使用 `pip install -e ".[mcp]"` 进行 editable 安装，`-e` 模式在用户级 site-packages 创建了一个**指针文件**，指向 `D:\hermes\hermes-agent`。因此：

- 系统全局的 `python` 能直接 `import hermes_cli`
- 不需要激活任何虚拟环境

#### 2. 入口文件 `hermes` 本身就是纯 Python 脚本

```python
#!/usr/bin/env python3
if __name__ == "__main__":
    from hermes_cli.main import main
    main()
```

只有 3 行有效代码，`python hermes` 等于直接运行这个脚本，依赖的包已经全局安装好了，所以能直接运行。

#### 3. Windows 文件访问

Hermes agent 本身就是 Python 进程，继承了 Windows 下 Python 的全部文件系统权限。没有任何沙箱或容器隔离，可以自由访问 Windows 文件系统。

---

## 其他电脑复现方法

在新电脑上执行以下步骤即可获得相同效果（无需虚拟环境）：

```bash
# 1. 安装 Python 3.11+（系统级，勾选 "Add to PATH"）
# 2. 克隆 hermes-agent
git clone <hermes-repo> D:/hermes/hermes-agent

# 3. 用系统 pip 做 editable 安装
cd D:/hermes/hermes-agent
pip install -e ".[mcp]"

# 4. 直接运行
python "D:/hermes/hermes-agent/hermes"
```

## 其他电脑「必须用虚拟环境」的常见原因

- 系统有多个 Python 版本，用 venv 确保版本一致
- 项目有冲突的依赖版本，不能用全局安装
- 公司/团队规范要求所有项目在 venv 中隔离

这些都不是 Hermes 本身的要求，而是环境管理策略不同。单 Python 版本 + 全局 editable 安装是最简单的方案。
