import React from 'react'
import { Link } from 'react-router-dom'
import AgentStatusPanel from '../components/AgentStatusPanel'
import { useDashboard, useIterations } from '../hooks/useApi'
import { formatDate, formatPercent, formatConfidence } from '../utils/formatters'
import { getAccuracyColor } from '../utils/constants'

export default function Dashboard() {
  const { data: summary, loading: summaryLoading, error: summaryError } = useDashboard()
  const { data: iterations, loading: iterationsLoading } = useIterations()

  if (summaryLoading) {
    return <div style={{ color: '#8b98a5', padding: '40px', textAlign: 'center' }}>加载中...</div>
  }

  if (summaryError) {
    return (
      <div style={{ color: '#f4212e', padding: '40px', textAlign: 'center' }}>
        加载失败: {summaryError}
      </div>
    )
  }

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  }

  const titleStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: '#e7e9ea',
    marginBottom: '8px'
  }

  const subtitleStyle = {
    fontSize: '14px',
    color: '#8b98a5'
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px'
  }

  const statGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px'
  }

  const statCardStyle = {
    background: '#1a1f25',
    border: '1px solid #2f3336',
    borderRadius: '12px',
    padding: '20px'
  }

  const statLabelStyle = {
    fontSize: '12px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px'
  }

  const statValueStyle = {
    fontSize: '28px',
    fontWeight: '700',
    color: '#e7e9ea'
  }

  const sectionTitleStyle = {
    fontSize: '18px',
    fontWeight: '600',
    color: '#e7e9ea',
    marginBottom: '16px'
  }

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse'
  }

  const thStyle = {
    textAlign: 'left',
    padding: '12px 16px',
    borderBottom: '1px solid #2f3336',
    fontSize: '12px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const tdStyle = {
    padding: '12px 16px',
    borderBottom: '1px solid #2f3336',
    fontSize: '14px',
    color: '#e7e9ea'
  }

  const linkCellStyle = {
    color: '#1d9bf0',
    textDecoration: 'none'
  }

  const iterListStyle = {
    background: '#1a1f25',
    borderRadius: '12px',
    overflow: 'hidden'
  }

  const currentIteration = summary?.current_iteration
  const agentStatuses = summary?.agent_statuses || {}

  return (
    <div style={containerStyle}>
      <div>
        <h1 style={titleStyle}>系统总览</h1>
        <p style={subtitleStyle}>
          {currentIteration 
            ? `当前迭代 #${currentIteration.iteration} • ${formatDate(currentIteration.started_at)}` 
            : '暂无进行中的迭代'}
        </p>
      </div>

      <div style={statGridStyle}>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>总案例数</div>
          <div style={statValueStyle}>{summary?.total_cases ?? 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>本周新增</div>
          <div style={statValueStyle}>{summary?.cases_this_week ?? 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>平均准确率</div>
          <div style={{ ...statValueStyle, color: getAccuracyColor(summary?.avg_accuracy ?? 0) }}>
            {formatPercent(summary?.avg_accuracy ?? 0)}
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>平均置信度</div>
          <div style={statValueStyle}>{formatConfidence(summary?.avg_confidence ?? 0)}</div>
        </div>
      </div>

      <div>
        <h2 style={sectionTitleStyle}>Agent 状态</h2>
        <div style={gridStyle}>
          <AgentStatusPanel
            agentName="故障数据生成"
            status={agentStatuses.data_gen?.status || 'idle'}
            metrics={{
              '生成数': agentStatuses.data_gen?.cases_generated || 0,
              '通过数': agentStatuses.data_gen?.cases_passed || 0
            }}
          />
          <AgentStatusPanel
            agentName="故障感知"
            status={agentStatuses.perception?.status || 'idle'}
            metrics={{
              '准确率': agentStatuses.perception?.accuracy || 0,
              '置信度': agentStatuses.perception?.avg_confidence || 0
            }}
          />
          <AgentStatusPanel
            agentName="评估优化"
            status={agentStatuses.evaluator?.status || 'idle'}
            metrics={{
              '评估数': agentStatuses.evaluator?.cases_evaluated || 0,
              '建议数': agentStatuses.evaluator?.suggestions || 0
            }}
          />
        </div>
      </div>

      <div>
        <h2 style={sectionTitleStyle}>最近迭代</h2>
        <div style={iterListStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>迭代</th>
                <th style={thStyle}>数据生成</th>
                <th style={thStyle}>感知状态</th>
                <th style={thStyle}>评估状态</th>
                <th style={thStyle}>感知准确率</th>
                <th style={thStyle}>开始时间</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {(iterations || []).slice(0, 5).map(iter => (
                <tr key={iter.iteration}>
                  <td style={tdStyle}>#{iter.iteration}</td>
                  <td style={tdStyle}>{iter.data_gen_status}</td>
                  <td style={tdStyle}>{iter.perception_status}</td>
                  <td style={tdStyle}>{iter.eval_status}</td>
                  <td style={{ ...tdStyle, color: getAccuracyColor(iter.perception_accuracy ?? 0) }}>
                    {formatPercent(iter.perception_accuracy ?? 0)}
                  </td>
                  <td style={tdStyle}>{formatDate(iter.started_at)}</td>
                  <td style={tdStyle}>
                    <Link to={`/iteration/${iter.iteration}`} style={linkCellStyle}>
                      查看详情 →
                    </Link>
                  </td>
                </tr>
              ))}
              {(!iterations || iterations.length === 0) && (
                <tr>
                  <td colSpan="7" style={{ ...tdStyle, textAlign: 'center', color: '#8b98a5' }}>
                    暂无迭代记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 style={sectionTitleStyle}>快捷入口</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Link 
            to="/perception" 
            style={{ 
              padding: '12px 24px', 
              background: '#1d9bf0', 
              color: '#fff', 
              borderRadius: '8px', 
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            进入感知监控
          </Link>
          <Link 
            to="/case-library" 
            style={{ 
              padding: '12px 24px', 
              background: '#1a1f25', 
              color: '#e7e9ea', 
              borderRadius: '8px', 
              textDecoration: 'none',
              fontWeight: '500',
              border: '1px solid #2f3336'
            }}
          >
            浏览案例库
          </Link>
          <Link 
            to="/reports" 
            style={{ 
              padding: '12px 24px', 
              background: '#1a1f25', 
              color: '#e7e9ea', 
              borderRadius: '8px', 
              textDecoration: 'none',
              fontWeight: '500',
              border: '1px solid #2f3336'
            }}
          >
            查看报告
          </Link>
        </div>
      </div>
    </div>
  )
}
