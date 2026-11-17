import { useEffect, useState } from 'react'

/** 按窗口宽度返回列数，用于决定一屏内展示多少张小图。 */
export function useCols(breakpoint: number, wide: number, narrow: number) {
  const pick = () => (window.innerWidth >= breakpoint ? wide : narrow)
  const [cols, setCols] = useState(pick)
  useEffect(() => {
    const on = () => setCols(pick())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  })
  return cols
}
