import type { ReactNode } from 'react'

interface Props {
  no?: string; title: string; hint?: string; takeaway?: ReactNode; tone?: 'critical' | 'good' | 'accent'
  children: ReactNode; className?: string
  /** 标题栏右侧的操作，例如“明细”按钮 */
  action?: { label: string; onClick: () => void }
  /** 标题栏右侧的额外控件，例如下拉框 */
  extra?: ReactNode
}

/** 卡片：标题 + 一句话要点 + 可选的明细入口；正文区域占满剩余高度。 */
export function Section({ no, title, hint, takeaway, tone, children, className, action, extra }: Props) {
  return (
    <section className={`card ${className ?? ''}`}>
      <header className="sec-head">
        <div className="sec-title">
          {no && <span className="sec-no">{no}</span>}
          <h3>{title}</h3>
          {hint && <span className="sec-hint">{hint}</span>}
        </div>
        <div className="sec-right">
          {takeaway && <div className={`takeaway ${tone ?? ''}`}>{takeaway}</div>}
          {extra}
          {action && <button className="more-btn" onClick={action.onClick}>{action.label}</button>}
        </div>
      </header>
      <div className="sec-body">{children}</div>
    </section>
  )
}
