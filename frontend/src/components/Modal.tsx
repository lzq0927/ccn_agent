import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'

/** 明细弹窗：点击遮罩或按 Esc 关闭。 */
export function Modal({ title, onClose, children, wide, xwide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; xwide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-mask" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`modal ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header><h3>{title}</h3><button className="modal-x" onClick={onClose} aria-label="关闭"><Icon name="x" size={16} /></button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
