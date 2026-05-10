import React from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import IterationDetail from './pages/IterationDetail'
import Perception from './pages/Perception'
import PerceptionHistory from './pages/PerceptionHistory'
import CaseLibrary from './pages/CaseLibrary'
import Reports from './pages/Reports'

const navStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 20px',
  height: '56px',
  background: '#1a1f25',
  borderBottom: '1px solid #2f3336',
  gap: '8px'
}

const linkStyle = {
  color: '#8b98a5',
  textDecoration: 'none',
  padding: '8px 16px',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: '500',
  transition: 'all 0.2s'
}

const activeLinkStyle = {
  ...linkStyle,
  color: '#1d9bf0',
  background: 'rgba(29, 155, 240, 0.1)'
}

const logoStyle = {
  color: '#1d9bf0',
  fontWeight: '700',
  fontSize: '18px',
  marginRight: '32px',
  letterSpacing: '-0.5px'
}

const mainStyle = {
  padding: '24px',
  maxWidth: '1400px',
  margin: '0 auto'
}

export default function App() {
  const location = useLocation()

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1419' }}>
      <nav style={navStyle}>
        <span style={logoStyle}>CCN OPS</span>
        <Link to="/" style={isActive('/') ? activeLinkStyle : linkStyle}>总览</Link>
        <Link to="/perception" style={isActive('/perception') ? activeLinkStyle : linkStyle}>感知监控</Link>
        <Link to="/perception/history" style={isActive('/perception/history') ? activeLinkStyle : linkStyle}>感知历史</Link>
        <Link to="/case-library" style={isActive('/case-library') ? activeLinkStyle : linkStyle}>案例库</Link>
        <Link to="/reports" style={isActive('/reports') ? activeLinkStyle : linkStyle}>报告</Link>
      </nav>
      <main style={mainStyle}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/iteration/:id" element={<IterationDetail />} />
          <Route path="/perception" element={<Perception />} />
          <Route path="/perception/history" element={<PerceptionHistory />} />
          <Route path="/case-library" element={<CaseLibrary />} />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </main>
    </div>
  )
}
