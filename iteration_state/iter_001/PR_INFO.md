# 迭代 001 - PR 信息

## PR 标题
`feat: 迭代001 - 故障感知系统基线评估与修复`

## 源分支
`develop_hermes` -> 目标分支 `main`

## PR 内容摘要
见 `.pr_body.md`

## GitHub 手动操作
由于环境未配置 GitHub CLI 和 API token，请手动创建 PR：
1. 访问 https://github.com/lzq0927/ccn_agent
2. 点击 "Compare & pull request"
3. 选择 base: `main`, head: `develop_hermes`
4. 填写标题和描述后提交

## 当前状态
- [x] 代码已推送到 `origin/develop_hermes`
- [ ] PR 需手动创建
- [ ] 待修复问题见下方

---

# 迭代 001 - 评估结果与问题分析

## 基线评估结果（第一轮）

| 指标 | 值 |
|------|------|
| 精确率 | 4.2% (46/90 FP) |
| 召回率 | 2.2% (88/90 FN) |
| F1分数 | 2.9% |
| 正确数 | 2/90 |

## 根因分析

### 问题1：假阳性率过高 (46/90)
**症状**: 感知Agent输出了大量网元，但真实故障只有一个/少数几个
**案例**: case_011 - GT是`AMF_1`单点故障，但感知输出`[AMF_1, gNB_2, SMF_2, gNB_1]`四个元素
**根因**: LLM多智能体投票机制过于宽松，任何"可能相关"的元素都被纳入

### 问题2：假阴性率过高 (88/90)
**症状**: 感知Agent完全没有输出或输出不包含真实故障
**根因**: 需要进一步分析，可能是:
  - 正常场景也被误判为故障
  - 复杂故障类型(PATH_LINK, RESOURCE_POOL)难以感知
  - LLM调用失败返回空结果

### 问题3：空字符串元素
**症状**: `perceived_fault_elements` 中包含 `''` 空字符串
**根因**: Agent推理过程中产生的伪影

## 已修复的问题
1. `data_types.py` - `timestamp=None`导致`isoformat()`崩溃
2. `run_iteration.py` - 评估解析逻辑使用错误的字段名`faults`，应为`perceived_fault_elements`

## 待修复问题（优先级排序）
1. **[P4]** 假阴性：感知Agent对复杂故障类型召回率低
2. **[P4]** 假阳性：投票机制过于宽松
3. **[P3]** 空字符串过滤：拓扑匹配时应过滤空字符串
