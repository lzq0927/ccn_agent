import React, { useState } from 'react'
import { formatDate } from '../utils/formatters'

export default function ReasoningTraceView({ trace = [], title = '推理过程' }) {
  const [expandedSteps, setExpandedSteps] = useState(new Set([trace.length - 1]))

  const toggleStep = (index) => {
    const newExpanded = new Set(expandedSteps)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedSteps(newExpanded)
  }

  if (!trace || trace.length === 0) {
    return (
      <div style={{ 
        padding: '20px', 
        background: '#1a1f25', 
        borderRadius: '8px',
        color: '#8b98a5',
        fontSize: '14px'
      }}>
        暂无推理过程
      </div>
    )
  }

  const containerStyle = {
    background: '#1a1f25',
    borderRadius: '12px',
    overflow: 'hidden'
  }

  const headerStyle = {
    padding: '16px 20px',
    borderBottom: '1px solid #2f3336',
    fontSize: '14px',
    fontWeight: '600',
    color: '#e7e9ea'
  }

  const stepStyle = (index, isLast) => ({
    position: 'relative',
    paddingLeft: index === 0 ? '20px' : '44px',
    paddingRight: '20px',
    paddingTop: '12px',
    paddingBottom: '12px',
    borderLeft: index === 0 ? 'none' : '2px solid #2f3336',
    marginLeft: '20px',
    cursor: 'pointer'
  })

  const connectorStyle = (index) => ({
    position: 'absolute',
    left: '-5px',
    top: index === 0 ? '24px' : '12px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: '#1d9bf0',
    border: '2px solid #1a1f25'
  })

  const stepHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  }

  const stepNumberStyle = {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#1d9bf0',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    flexShrink: 0
  }

  const stepTitleStyle = {
    fontSize: '14px',
    fontWeight: '500',
    color: '#e7e9ea'
  }

  const stepContentStyle = {
    marginTop: '8px',
    marginLeft: '36px',
    padding: '12px',
    background: '#0f1419',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.6',
    color: '#8b98a5'
  }

  const expandIconStyle = (isExpanded) => ({
    marginLeft: 'auto',
    transition: 'transform 0.2s',
    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
    color: '#8b98a5'
  })

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>{title}</div>
      <div style={{ padding: '16px 0' }}>
        {trace.map((step, index) => {
          const isExpanded = expandedSteps.has(index)
          const isLast = index === trace.length - 1
          
          return (
            <div key={index} style={stepStyle(index, isLast)}>
              {index > 0 && <div style={connectorStyle(index)} />}
              <div style={stepHeaderStyle} onClick={() => toggleStep(index)}>
                <div style={stepNumberStyle}>{index + 1}</div>
                <span style={stepTitleStyle}>{step.title || step}</span>
                <span style={expandIconStyle(isExpanded)}>▼</span>
              </div>
              {isExpanded && typeof step === 'object' && step.content && (
                <div style={stepContentStyle}>{step.content}</div>
              )}
              {isExpanded && typeof step === 'string' && (
                <div style={stepContentStyle}>{step}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
