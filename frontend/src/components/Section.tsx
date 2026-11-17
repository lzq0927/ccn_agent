import type { ReactNode } from 'react'

/** 卡片标题：编号 + 标题 + 一句话要点（右侧），正文说明压缩为一行提示。 */
export function Section({ no, title, hint, takeaway, tone, children, id }:
  { no?: string; title: string; hint?: string; takeaway?: ReactNode; tone?: 'critical' | 'good' | 'accent'; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id}>
      <header className="sec-head">
        <div className="sec-title">
          {no && <span className="sec-no">{no}</span>}
          <h3>{title}</h3>
          {hint && <span className="sec-hint">{hint}</span>}
        </div>
        {takeaway && <div className={`takeaway ${tone ?? ''}`}>{takeaway}</div>}
      </header>
      {children}
    </section>
  )
}
