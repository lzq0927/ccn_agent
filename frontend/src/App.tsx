import React, { useState, useEffect } from 'react';
import { api } from './api/client';
import type { DashboardSummary, WSEvent } from './api/types';
import { useWebSocket } from './hooks/useWebSocket';
import DataGenView from './components/DataGenView';
import FaultPerceptionView from './components/FaultPerceptionView';
import EvaluationView from './components/EvaluationView';

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  cursor: 'pointer',
  borderBottom: active ? '2px solid #4f46e5' : '2px solid transparent',
  color: active ? '#4f46e5' : '#6b7280',
  fontWeight: active ? 600 : 400,
  background: 'none',
  border: 'none',
  borderBottomWidth: '2px',
  fontSize: '14px',
});

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '8px',
  padding: '20px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
};

const metricStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  color: '#111827',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

export default function App() {
  const [tab, setTab] = useState<'dashboard' | 'generation' | 'perception' | 'evaluation'>('dashboard');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const { events, connected } = useWebSocket();

  useEffect(() => {
    api.dashboard.summary().then(setSummary).catch(console.error);
  }, []);

  // Refresh on WS events
  useEffect(() => {
    if (events.length > 0) {
      api.dashboard.summary().then(setSummary).catch(console.error);
    }
  }, [events.length]);

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', background: '#f9fafb', minHeight: '100vh' }}>
      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>5GC Fault Diagnosis</span>
            <span style={{ fontSize: 11, background: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: 4 }}>
              Closed-Loop System
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 12, color: connected ? '#16a34a' : '#dc2626' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 4, padding: '0 24px' }}>
          <button style={tabStyle(tab === 'dashboard')} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button style={tabStyle(tab === 'generation')} onClick={() => setTab('generation')}>Data Generation</button>
          <button style={tabStyle(tab === 'perception')} onClick={() => setTab('perception')}>Fault Perception</button>
          <button style={tabStyle(tab === 'evaluation')} onClick={() => setTab('evaluation')}>Evaluation</button>
        </div>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {tab === 'dashboard' && <Dashboard summary={summary} events={events} />}
        {tab === 'generation' && <DataGenView />}
        {tab === 'perception' && <FaultPerceptionView />}
        {tab === 'evaluation' && <EvaluationView />}
      </main>
    </div>
  );
}

function Dashboard({ summary, events }: { summary: DashboardSummary | null; events: WSEvent[] }) {
  if (!summary) return <div>Loading...</div>;

  return (
    <div>
      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={cardStyle}>
          <div style={metricStyle}>{summary.total_cases}</div>
          <div style={labelStyle}>Total Cases</div>
        </div>
        <div style={cardStyle}>
          <div style={metricStyle}>{summary.total_diagnoses}</div>
          <div style={labelStyle}>Diagnoses</div>
        </div>
        <div style={cardStyle}>
          <div style={metricStyle}>{(summary.overall_accuracy * 100).toFixed(1)}%</div>
          <div style={labelStyle}>Accuracy</div>
        </div>
        <div style={cardStyle}>
          <div style={metricStyle}>{summary.total_evaluations}</div>
          <div style={labelStyle}>Evaluations</div>
        </div>
      </div>

      {/* Three-Loop Progress */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Three-Loop Progress</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          <LoopCard title="Loop 1: Data Generation" items={summary.by_fault_type} />
          <LoopCard title="Loop 2: Fault Perception" items={summary.by_route} />
          <LoopCard title="Loop 3: Evaluation" items={{ accuracy: summary.overall_accuracy }} />
        </div>
      </div>

      {/* Live Events */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Live Events</h3>
        <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
          {events.slice(-20).reverse().map((e, i) => (
            <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ color: '#6b7280' }}>[{e.type}]</span>{' '}
              <span>{JSON.stringify(e).slice(0, 200)}</span>
            </div>
          ))}
          {events.length === 0 && <div style={{ color: '#9ca3af' }}>No events yet. Start a batch or diagnosis to see live updates.</div>}
        </div>
      </div>
    </div>
  );
}

function LoopCard({ title, items }: { title: string; items: Record<string, unknown> }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {Object.entries(items).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
          <span style={{ color: '#6b7280' }}>{k}</span>
          <span style={{ fontWeight: 500 }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}
