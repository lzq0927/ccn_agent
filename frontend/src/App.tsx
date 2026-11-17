import { useEffect, useState } from 'react'
import { Console } from './components/Console'
import { Icon } from './components/Icon'
import { WorkflowBar } from './components/WorkflowBar'
import { short } from './lib/format'
import { useRun } from './store'
import type { Meta, Stage, Topo } from './types'
import { AnalysisView } from './views/AnalysisView'
import { DecisionView } from './views/DecisionView'
import { PerceptionView } from './views/PerceptionView'

const SPEEDS = [0.5, 1, 2, 4]

export default function App() {
  const { state, start } = useRun()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [topo, setTopo] = useState<Topo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState<Stage>('perception')
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    Promise.all([fetch('/api/meta').then((r) => r.json()), fetch('/api/topology').then((r) => r.json())])
      .then(([m, t]) => { setMeta(m); setTopo(t) })
      .catch(() => setLoadError(true))
  }, [])

  // 回放过程中视图跟随当前执行阶段；手动切换后停止跟随
  useEffect(() => { if (follow && state.activeStage) setView(state.activeStage) }, [follow, state.activeStage])

  const run = () => { setFollow(true); setView('perception'); start(speed) }
  const running = state.status === 'running'
  const agentState = state.steps['analysis.agent'] === 'running' ? '推理中'
    : state.steps['analysis.agent'] === 'skipped' ? '未触发' : state.steps['analysis.agent'] === 'done' ? '已完成' : '待命'
  const c = state.conclusion
  const summaries: Record<Stage, string | null> = {
    perception: state.perception ? `${state.perception.stats.n_anomalous} 个持续突增 · 降噪 ${state.perception.stats.filtered_pct}%` : null,
    analysis: state.crossval ? (state.crossval.decision === 'conclusion' ? '唯一结论' : '转慢推理') : null,
    decision: c ? `${short(c.root.ne) || '待确认'} · 置信度 ${Math.round(c.confidence * 100)}%` : null,
  }
  const status = state.status === 'error' ? { cls: 'err', text: '连接中断' }
    : running ? (state.perception ? { cls: 'alert', text: '发现异常，分析中' } : { cls: 'run', text: '感知中' })
      : c ? { cls: 'alert', text: c.definitive ? '根因已定位' : '待人工确认' }
        : state.status === 'done' ? { cls: 'ok', text: '未发现异常' } : { cls: 'idle', text: '待回放' }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><Icon name="activity" size={17} /></span>
          <div>
            <h1>CHR 故障感知与分析</h1>
            <p>5GC 云核心网{meta ? ` · ${meta.raw_rows.toLocaleString('en-US')} 条 CHR · ${meta.minutes} 分钟` : ''}</p>
          </div>
        </div>
        <div className="controls">
          <span className={`status ${status.cls}`}><i />{status.text}</span>
          <span className="clock"><Icon name="clock" size={14} /><b>{state.tick?.time ?? '--:--'}</b></span>
          <div className="seg" role="group" aria-label="回放倍速">
            {SPEEDS.map((s) => <button key={s} className={s === speed ? 'on' : ''} disabled={running} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
          <button className="primary" onClick={run} disabled={running || !meta}>
            <Icon name="play" size={13} />{running ? '回放中' : state.status === 'idle' ? '开始回放' : '重新回放'}
          </button>
        </div>
      </header>

      <WorkflowBar steps={state.steps} activeStage={state.activeStage} running={running} view={view} summaries={summaries}
        onView={(s) => { setView(s); setFollow(false) }} />

      <div className="body">
        <main className="content">
          {loadError && <div className="card"><div className="empty tall">无法连接后端服务，请确认已启动：uvicorn backend.server:app --port 8000</div></div>}
          {meta && topo && (
            <>
              {view === 'perception' && <PerceptionView state={state} topo={topo} meta={meta} />}
              {view === 'analysis' && <AnalysisView state={state} />}
              {view === 'decision' && <DecisionView state={state} topo={topo} />}
            </>
          )}
        </main>
        <Console logs={state.logs} agentLogs={state.agentLogs} agentState={agentState} />
      </div>
    </div>
  )
}
