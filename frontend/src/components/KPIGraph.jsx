import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { formatDate } from '../utils/formatters'

export default function KPIGraph({ data = [], anomalies = [], height = 300, title }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ 
        height, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        color: '#8b98a5',
        background: '#1a1f25',
        borderRadius: '12px'
      }}>
        暂无数据
      </div>
    )
  }

  const formattedData = data.map((item, idx) => ({
    ...item,
    index: idx,
    time: item.timestamp ? formatDate(item.timestamp) : item.time || String(idx)
  }))

  const anomalyXValues = new Set(anomalies.map(a => a.index))

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div style={{ 
          background: '#1a1f25', 
          border: '1px solid #2f3336', 
          borderRadius: '8px', 
          padding: '12px',
          fontSize: '12px'
        }}>
          <p style={{ color: '#e7e9ea', marginBottom: '4px' }}>{data.time}</p>
          <p style={{ color: '#1d9bf0' }}>值: {data.value?.toFixed(2)}</p>
          {data.isAnomaly && <p style={{ color: '#f4212e' }}>异常点</p>}
        </div>
      )
    }
    return null
  }

  return (
    <div style={{ background: '#1a1f25', borderRadius: '12px', padding: '16px' }}>
      {title && (
        <h3 style={{ fontSize: '14px', color: '#e7e9ea', marginBottom: '16px' }}>{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={formattedData}>
          <CartesianGrid stroke="#2f3336" strokeDasharray="3 3" />
          <XAxis 
            dataKey="time" 
            tick={{ fill: '#8b98a5', fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fill: '#8b98a5', fontSize: 11 }} width={50} />
          <Tooltip content={<CustomTooltip />} />
          {anomalies.map((anomaly, idx) => (
            <ReferenceLine
              key={idx}
              x={anomaly.index}
              stroke="#f4212e"
              strokeDasharray="5 5"
              label={{ value: '异常', fill: '#f4212e', fontSize: 10, position: 'top' }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="value"
            stroke="#1d9bf0"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#1d9bf0' }}
          />
        </LineChart>
      </ResponsiveContainer>
      {anomalies.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#f4212e' }}>
          检测到 {anomalies.length} 个异常点
        </div>
      )}
    </div>
  )
}
