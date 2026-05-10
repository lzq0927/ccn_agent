import React from 'react'
import { getConfidenceLevel } from '../utils/constants'

export default function ConfidenceGauge({ confidence, size = 120 }) {
  const level = getConfidenceLevel(confidence)
  const percentage = confidence != null ? confidence * 100 : 0
  
  const radius = (size - 20) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  const svgStyle = {
    transform: 'rotate(-90deg)'
  }

  const backgroundStyle = {
    fill: 'none',
    stroke: '#2f3336',
    strokeWidth: '10'
  }

  const progressStyle = {
    fill: 'none',
    stroke: level.color,
    strokeWidth: '10',
    strokeLinecap: 'round',
    strokeDasharray: circumference,
    strokeDashoffset: strokeDashoffset,
    transition: 'stroke-dashoffset 0.5s ease'
  }

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  }

  const valueStyle = {
    fontSize: size / 4,
    fontWeight: '700',
    color: level.color
  }

  const labelStyle = {
    fontSize: '12px',
    color: '#8b98a5'
  }

  const levelStyle = {
    padding: '2px 8px',
    borderRadius: '4px',
    background: `${level.color}20`,
    color: level.color,
    fontSize: '11px',
    fontWeight: '600'
  }

  return (
    <div style={containerStyle}>
      <svg width={size} height={size} style={svgStyle}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          style={backgroundStyle}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          style={progressStyle}
        />
      </svg>
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={valueStyle}>{percentage.toFixed(1)}%</span>
        <span style={labelStyle}>置信度</span>
      </div>
      <div style={levelStyle}>{level.label}置信度</div>
    </div>
  )
}
