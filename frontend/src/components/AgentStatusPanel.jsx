import React from 'react'
import { getStatusColor, getStatusLabel } from '../utils/constants'
import { formatDuration } from '../utils/formatters'

export default function AgentStatusPanel({ agentName, status, metrics = {}, onClick }) {
  const statusColor = getStatusColor(status)
  const statusLabel = getStatusLabel(status)

  const panelStyle = {
    background: '#1a1f25',
    border: '1px solid #2f3336',
    borderRadius: '12px',
    padding: '20px',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'all 0.2s'
  }

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  }

  const nameStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: '#e7e9ea'
  }

  const statusBadgeStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 12px',
    borderRadius: '16px',
    background: `${statusColor}20`,
    fontSize: '12px',
    fontWeight: '500'
  }

  const dotStyle = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: statusColor
  }

  const metricsStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px'
  }

  const metricStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  }

  const metricLabelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const metricValueStyle = {
    fontSize: '20px',
    fontWeight: '600',
    color: '#e7e9ea'
  }

  return (
    <div style={panelStyle} onClick={onClick}>
      <div style={headerStyle}>
        <span style={nameStyle}>{agentName}</span>
        <div style={statusBadgeStyle}>
          <div style={dotStyle} />
          <span style={{ color: statusColor }}>{statusLabel}</span>
        </div>
      </div>
      <div style={metricsStyle}>
        {Object.entries(metrics).map(([key, value]) => (
          <div key={key} style={metricStyle}>
            <span style={metricLabelStyle}>{key}</span>
            <span style={metricValueStyle}>
              {key.includes('latency') || key.includes('duration') 
                ? formatDuration(value) 
                : typeof value === 'number' ? value.toFixed(2) : value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
