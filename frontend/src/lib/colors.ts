// 图表配色：分类色按固定顺序分配（不循环），状态色只用于聚集程度/异常语义
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export const OTHER = '#c3c2b7'
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e9e8e3', axis: '#c3c2b7', surface: '#ffffff' }
export const STATUS = { critical: '#d03b3b', serious: '#ec835a', warning: '#fab219', good: '#0ca30c', accent: '#2a78d6' }

export const GRADE_COLOR: Record<string, string> = {
  high: STATUS.critical, mid: STATUS.serious, low: STATUS.accent, none: STATUS.accent, noise: OTHER,
}
export const GRADE_LABEL: Record<string, string> = {
  high: '强聚集', mid: '中聚集', low: '弱聚集', none: '无聚集', noise: '常态底噪',
}
