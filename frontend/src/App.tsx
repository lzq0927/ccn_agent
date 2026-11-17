import { useEffect, useRef, useState } from 'react'
import { Console } from './components/Console'
import { Icon } from './components/Icon'
import { WorkflowBar } from './components/WorkflowBar'
import { short } from './lib/format'
import { control, useLive } from './store'
import type { Meta, Stage, Topo } from './types'
import { AnalysisView } from './views/AnalysisView'
import { DecisionView } from './views/DecisionView'
import { PerceptionView } from './views/PerceptionView'

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return now
}
const two = (n: number) => String(n).padStart(2, '0')

export default function App() {
  const state = useLive()
  const now = useNow()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [topo, setTopo] = useState<Topo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [view, setView] = useState<Stage>('perception')

  useEffect(() => {
    Promise.all([fetch('/api/meta').then((r) => r.json()), fetch('/api/topology').then((r) => r.json())])
      .then(([m, t]) => { setMeta(m); setTopo(t) })
      .catch(() => setLoadError(true))
  }, [])

  // 发现异常进入分析/决策时自动切到对应页面；回到常态感知后保留用户当前所在页面
  const prevStage = useRef<Stage | null>(null)
  useEffect(() => {
    const s = state.activeStage
    if (s && s !== prevStage.current && s !== 'perception') setView(s)
    prevStage.current = s
  }, [state.activeStage])
  // 重新开始后回到感知页
  useEffect(() => { if (state.connected && !state.tick) setView('perception') }, [state.connected, state.tick])
  // 打开页面时若已有进行中的故障，直接展示结论
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current && state.connected) {
      opened.current = true
      if (state.conclusion && state.incident?.status === 'active') setView('decision')
    }
  }, [state.connected, state.conclusion, state.incident])

  const inc = state.incident
  const c = state.conclusion
  const analyzing = state.activeStage !== 'perception' && Object.entries(state.steps).some(([k, v]) => !k.startsWith('perception.') && v === 'running')
  const agentStep = state.steps['analysis.agent']
  const agentState = agentStep === 'running' ? '推理中' : agentStep === 'skipped' ? '未触发' : agentStep === 'done' ? '已完成' : '待命'
  const summaries: Record<Stage, string | null> = {
    perception: inc?.status === 'active' && state.perception ? `${state.perception.stats.n_anomalous} 个维度突增 · 降噪 ${Math.round(state.perception.stats.filtered_pct)}%`
      : state.tick ? '未见异常' : null,
    analysis: state.crossval ? (state.crossval.decision === 'conclusion' ? '唯一结论' : '转慢推理') : null,
    decision: c ? `${short(c.root.ne) || '待确认'} · 置信度 ${Math.round(c.confidence * 100)}%` : null,
  }
  const run = state.run
  const stepMode = (run?.mode ?? meta?.mode) === 'step'
  const going = state.connected && (!stepMode || run?.status === 'running')
  const status = !state.connected ? { cls: 'err', text: '连接中断，重连中' }
    : analyzing ? { cls: 'alert', text: '发现异常，分析中' }
      : inc?.status === 'active' ? { cls: 'alert', text: inc.definitive ? '故障进行中 · 根因已定位' : '故障进行中 · 待人工确认' }
        : inc?.status === 'recovered' ? { cls: 'ok', text: `故障已恢复 ${inc.recovered_at ?? ''}` }
          : stepMode && run?.status === 'idle' ? { cls: 'idle', text: '待开始' }
            : { cls: 'ok', text: '运行正常' }
  const d = new Date(now)
  const remain = state.nextAt ? Math.max(0, Math.round((state.nextAt - now) / 1000)) : null
  const runText = { idle: '待开始', running: '运行中', paused: '已暂停', finished: '已结束' }[run?.status ?? 'idle']
  const pct = run?.total ? Math.min(100, (run.minute / run.total) * 100) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><Icon name="activity" size={17} /></span>
          <div>
            <h1>CHR 故障感知与分析</h1>
            <p>5GC 云核心网{meta ? ` · ${meta.instances} 个网元实例 · 每分钟感知一次` : ''}</p>
          </div>
        </div>
        <div className="controls">
          <span className={`status ${status.cls}`}><i />{status.text}</span>
          {inc && <span className="inc-id">{inc.id}</span>}
          {stepMode ? (
            <>
              <span className="clock" title="当前数据时间"><Icon name="clock" size={14} /><b>{run?.time ?? '--:--'}</b></span>
              <span className={`live-pill ${run?.status === 'running' ? 'on' : run?.status ?? ''}`}><i />{runText}</span>
              {run?.status === 'running'
                ? <button className="btn" onClick={() => control('pause')}><Icon name="pause" size={13} />暂停</button>
                : run?.status === 'paused'
                  ? <button className="btn primary" onClick={() => control('resume')}><Icon name="play" size={13} />继续</button>
                  : run?.status === 'idle'
                    ? <button className="btn primary" onClick={() => control('start')}><Icon name="play" size={13} />开始</button>
                    : null}
              <button className={`btn ${run?.status === 'finished' ? 'primary' : ''}`} onClick={() => control('restart')}
                disabled={run?.status === 'idle'}><Icon name="restart" size={13} />重新开始</button>
            </>
          ) : (
            <>
              <span className="next">下次感知 <b>{remain == null ? '--' : `${two(Math.floor(remain / 60))}:${two(remain % 60)}`}</b></span>
              <span className="clock"><Icon name="clock" size={14} /><b>{two(d.getHours())}:{two(d.getMinutes())}:{two(d.getSeconds())}</b></span>
              <span className={`live-pill ${state.connected ? 'on' : ''}`}><i />实时</span>
            </>
          )}
        </div>
      </header>
      {stepMode && <div className="progress" aria-hidden><i style={{ width: `${pct}%` }} /></div>}

      <WorkflowBar steps={state.steps} activeStage={state.activeStage} connected={going} view={view} summaries={summaries}
        onView={setView} />

      <div className="body">
        <main className="content">
          {loadError && <div className="card"><div className="empty tall">无法连接后端服务，请确认服务已启动。</div></div>}
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
