export const pct = (x: number | null | undefined, digits = 0) =>
  x == null ? '—' : `${(x * 100).toFixed(digits)}%`
export const num = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-US'))
export const short = (instance: string) => instance.split(':').pop() ?? instance
export const seriesTitle = (key: string) => key.split('|').join(' · ')
