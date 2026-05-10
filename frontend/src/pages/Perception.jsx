import React, { useState, useEffect } from 'react'
import { usePerceptionCurrent } from '../hooks/useApi'
import ConfidenceGauge from '../components/ConfidenceGauge'
import ReasoningTraceView from '../components/ReasoningTraceView'
import KPIGraph from '../components/KPIGraph'
import { formatDate, formatDuration } from '../utils/formatters'
import { getStatusColor, getStatusLabel, getModeLabel } from '../utils/constants'

export default function Perception() {
  const { data: current, loading, error, refetch } = usePerceptionCurrent()
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      refetch()
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, refetch])

  if (loading && !current) {
    return <div style={{ color: '#8b98a5', padding: '40px', textAlign: 'center' }}>加载中...</div>
  }

  if (error && !current) {
    return (
      <div style={{ color: '#f4212e', padding: '40px', textAlign: 'center' }}>
        加载失败: {error}
      </div>
    )
  }

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  }

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  }

  const titleStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: '#e7e9ea'
  }

  const controlsStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  }

  const refreshBtnStyle = (active) => ({
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    background: active ? '#1d9bf0' : '#1a1f25',
    color: active ? '#fff' : '#8b98a5',
    cursor: 'pointer',
    fontSize: '13px'
  })

  const sectionStyle = {
    background: '#1a1f25',
    border: '1px solid #2f3336',
    borderRadius: '12px',
    padding: '20px'
  }

  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: '#e7e9ea',
    marginBottom: '16px'
  }

  const statusBadgeStyle = (status) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 16px',
    borderRadius: '20px',
    background: `${getStatusColor(status)}20`,
    color: getStatusColor(status),
    fontSize: '14px',
    fontWeight: '500'
  })

  const dotStyle = (status) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: getStatusColor(status)
  })

  const kpiGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginTop: '16px'
  }

  const kpiCardStyle = {
    background: '#0f1419',
    borderRadius: '8px',
    padding: '16px'
  }

  const kpiLabelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const kpiValueStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: '#e7e9ea',
    marginTop: '4px'
  }

  const contentGridStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 300px',
    gap: '24px'
  }

  const faultListStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '12px'
  }

  const faultTagStyle = {
    padding: '6px 14px',
    borderRadius: '6px',
    background: '#f4212e20',
    color: '#f4212e',
    fontSize: '13px',
    fontWeight: '500'
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>感知实时监控</h1>
          <p style={{ color: '#8b98a5', marginTop: '4px', fontSize: '14px' }}>
            实时监控故障感知Agent的运行状态和推理过程
          </p>
        </div>
        <div style={controlsStyle}>
          <span style={statusBadgeStyle(current?.status || 'idle')}>
            <span style={dotStyle(current?.status || 'idle')} />
            {getStatusLabel(current?.status || 'idle')}
          </span>
          <button 
            style={refreshBtnStyle(autoRefresh)} 
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '自动刷新中' : '已暂停'}
          </button>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>当前状态</h2>
        <div style={kpiGridStyle}>
          <div style={kpiCardStyle}>
            <div style={kpiLabelStyle}>感知模式</div>
            <div style={kpiValueStyle}>{getModeLabel(current?.perception_mode) || '-'}</div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiLabelStyle}>置信度</div>
            <div style={{ ...kpiValueStyle, color: current?.perception_confidence >= 0.85 ? '#00ba7c' : current?.perception_confidence >= 0.5 ? '#ffad1f' : '#f4212e' }}>
              {current?.perception_confidence != null ? `${(current.perception_confidence * 100).toFixed(1)}%` : '-'}
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiLabelStyle}>处理延迟</div>
            <div style={kpiValueStyle}>{formatDuration(current?.perception_latency_ms) || '-'}</div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiLabelStyle}>更新时间</div>
            <div style={{ ...kpiValueStyle, fontSize: '14px' }}>{formatDate(current?.updated_at) || '-'}</div>
          </div>
        </div>
      </div>

      <div style={contentGridStyle}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>KPI 时序数据</h2>
          <KPIGraph 
            data={current?.kpi_data || []} 
            anomalies={current?.anomalies || []}
            height={300}
          />
        </div>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>置信度</h2>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <ConfidenceGauge confidence={current?.perception_confidence} size={180} />
          </div>
        </div>
      </div>

      {current?.perceived_fault_elements?.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>感知故障元素</h2>
          <div style={faultListStyle}>
            {current.perceived_fault_elements.map(el => (
              <span key={el} style={faultTagStyle}>{el}</span>
            ))}
          </div>
        </div>
      )}

      {current?.reasoning_trace?.length > 0 && (
        <ReasoningTraceView trace={current.reasoning_trace} title="推理过程" />
      )}

      {(!current || current.status === 'idle') && (
        <div style={{ 
          ...sectionStyle, 
          textAlign: 'center', 
          padding: '60px 20px',
          color: '#8b98a5'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <div style={{ fontSize: '16px' }}>当前没有进行中的感知任务</div>
          <div style={{ fontSize: '13px', marginTop: '8px' }}>
            等待故障数据输入或手动触发感知测试
          </div>
        </div>
      )}
    </div>
  )
}
