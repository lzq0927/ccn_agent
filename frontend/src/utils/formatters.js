export function formatDate(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatDuration(ms) {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = ((ms % 60000) / 1000).toFixed(0)
  return `${mins}m ${secs}s`
}

export function formatPercent(value, decimals = 1) {
  if (value == null) return '-'
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatConfidence(value) {
  if (value == null) return '-'
  const pct = (value * 100).toFixed(1)
  return `${pct}%`
}

export function truncate(str, maxLen = 50) {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

export function formatCaseId(id) {
  if (!id) return '-'
  return id.toString().padStart(8, '0')
}

export function parseTags(tags) {
  if (!tags) return []
  if (Array.isArray(tags)) return tags
  try {
    return JSON.parse(tags)
  } catch {
    return [tags]
  }
}
