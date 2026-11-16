import { useEffect, useState } from 'react'
import { Console } from './components/Console'
import { WorkflowBar } from './components/WorkflowBar'
import { useRun } from './store'
import type { Meta, Stage, Topo } from './types'
import { AnalysisView } from './views/AnalysisView'
import { DecisionView } from './views/DecisionView'
import { PerceptionView } from './views/PerceptionView'

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <div>
            <h1>CHR 故障感知与分析</h1>
            <p>5GC 云核心网{meta ? ` · ${meta.raw_rows.toLocaleString('en-US')} 条 CHR · ${meta.start} 起 ${meta.minutes} 分钟` : ''}</p>
          </div>
        </div>
        <div className="controls">
          {state.tick && <span className="clock">仿真时间 <b>{state.tick.time}</b></span>}
          {state.status === 'error' && <span className="err">连接中断</span>}
          <label className="speed">倍速
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={running}>
              <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
            </select>
          </label>
          <button className="primary" onClick={run} disabled={running || !meta}>
            {running ? '回放中…' : state.status === 'idle' ? '开始回放' : '重新回放'}
          </button>
        </div>
      </header>

      <WorkflowBar steps={state.steps} activeStage={state.activeStage} running={running} view={view}
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
