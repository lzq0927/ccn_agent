import { useEffect, useRef } from 'react'
import type { LogLine } from '../types'
import { Icon } from './Icon'

const STAGE_CLS: Record<string, string> = { 感知: 'perception', 分析: 'analysis', 决策: 'decision', Agent: 'agent', 系统: 'system' }

function Lines({ lines, empty }: { lines: LogLine[]; empty: string }) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight }, [lines.length])
  return (
    <div className="log-box" ref={box} onScroll={(e) => {
      const el = e.currentTarget
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }}>
      {lines.length === 0 && <div className="log-empty">{empty}</div>}
      {lines.map((l, i) => (
        <div key={i} className={`log-line ${l.level}`}>
          <span className="log-time">{l.time}</span>
          <span className={`log-stage ${STAGE_CLS[l.stage] ?? 'system'}`}>{l.stage}</span>
          <span className="log-text">{l.text}</span>
        </div>
      ))}
    </div>
  )
}

export function Console({ logs, agentLogs, agentState }: { logs: LogLine[]; agentLogs: LogLine[]; agentState: string }) {
  return (
    <aside className="console">
      <section className="console-main">
        <header><h3><Icon name="layers" size={14} />执行过程</h3><span className="count">{logs.length}</span></header>
        <Lines lines={logs} empty="这里按时间顺序记录每一步的执行情况。" />
      </section>
      <section className="console-agent">
        <header><h3><Icon name="cpu" size={14} />Agent</h3><span className={`chip st-${agentState}`}>{agentState}</span></header>
        <Lines lines={agentLogs} empty="慢推理 Agent 的输出显示在这里。" />
      </section>
    </aside>
  )
}
