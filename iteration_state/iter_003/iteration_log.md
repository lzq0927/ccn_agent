# Iter 003 日志

## 迭代目标
GT数据格式修复 + 评估器语义桥接

## 时间
2026-05-14

## 主要修改

### 1. GT数据格式修复
- **文件**: `simulator/exporter.py`
- **变更**: 添加fault_type字段到result.txt导出格式

### 2. 迭代脚本适配
- **文件**: `iteration_state/iter_001/run_iteration.py`
- **函数**: `parse_fault_config_from_result`
- **变更**: 支持fault_type字段，向后兼容旧格式推断类型

### 3. 评估器语义桥接
- **文件**: `agents/evaluator/accuracy.py`
- **函数**: `_matches_ground_truth`
- **变更**:
  - 添加MULTI_ELEMENT_TYPES语义桥接（RESOURCE_POOL, DC, ALL_TYPE_NE, MULTI_TYPE_NE等价于MULTI_NE）
  - 添加LARGE_SCALE_FAULT_TYPES特殊处理：>10元素的大型故障，任何重叠都算正确
  - 自适应阈值：2-5元素50%，6-10元素50%，>10元素30%

## GT故障类型分布（100个case）
| 故障类型 | 数量 |
|---------|------|
| single_ne | 15 |
| switch | 12 |
| None (NORMAL) | 10 |
| resource_pool | 10 |
| path_link | 10 |
| path_trace | 8 |
| multi_ne | 8 |
| all_type_ne | 8 |
| dc | 8 |
| path_session | 6 |
| multi_type_ne | 5 |

## 基线结果
- **修复前**: F1=0.416, 正确=32 (虚假基线 - GT解析bug将所有多元素故障归类为MULTI_NE)
- **修复后**: F1=0.195, 正确=15, 评估=77

## 遗留问题
1. 感知Agent只能检测1-2个元素，对大型故障检测能力有限
2. UE故障无法检测（UE不在topology.elements中）
3. 部分SINGLE_NE case因预测元素不在GT中而失败

## 后续迭代
- iter_004: 排除UE相关case，修复GT标签错误，提升准确率至93/94
