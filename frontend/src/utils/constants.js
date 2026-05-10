export const STATUS_COLORS = {
  idle: '#8b98a5',
  running: '#1d9bf0',
  done: '#00ba7c',
  error: '#f4212e'
}

export const STATUS_LABELS = {
  idle: '空闲',
  running: '运行中',
  done: '已完成',
  error: '错误'
}

export const MODE_LABELS = {
  skill: '技能模式',
  llm_explorer: 'LLM探索',
  single_deep: '单Agent深度',
  multi_parallel: '多Agent并行',
  hybrid: '混合模式'
}

export const SOURCE_LABELS = {
  simulator: '仿真器生成',
  perception_failure: '感知失败案例',
  manual: '手动添加'
}

export function getStatusColor(status) {
  return STATUS_COLORS[status] || '#8b98a5'
}

export function getStatusLabel(status) {
  return STATUS_LABELS[status] || status
}

export function getModeLabel(mode) {
  return MODE_LABELS[mode] || mode
}

export function getSourceLabel(source) {
  return SOURCE_LABELS[source] || source
}

export function getConfidenceLevel(confidence) {
  if (confidence >= 0.85) return { label: '高', color: '#00ba7c' }
  if (confidence >= 0.5) return { label: '中', color: '#ffad1f' }
  return { label: '低', color: '#f4212e' }
}

export function getAccuracyColor(accuracy) {
  if (accuracy >= 0.9) return '#00ba7c'
  if (accuracy >= 0.7) return '#ffad1f'
  return '#f4212e'
}

export function getTagColor(tag) {
  const colorMap = {
    multi_ne: '#9c27b0',
    ambiguous: '#ff9800',
    normal: '#4caf50',
    hard_case: '#f4212e',
    high_confidence: '#00ba7c',
    low_confidence: '#f4212e'
  }
  return colorMap[tag] || '#8b98a5'
}
