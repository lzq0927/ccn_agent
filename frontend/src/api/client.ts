import type { DashboardSummary, CaseInfo, SessionInfo, Suggestion } from './types';

const BASE = '/api/v1';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  dashboard: {
    summary: () => fetchJSON<DashboardSummary>(`${BASE}/dashboard/summary`),
  },
  generation: {
    listCases: (page = 1, pageSize = 20) =>
      fetchJSON<{ total: number; cases: CaseInfo[] }>(`${BASE}/generation/cases?page=${page}&page_size=${pageSize}`),
    startBatch: (count = 50, seed = 42) =>
      fetch(`${BASE}/generation/batch?count=${count}&seed=${seed}`).then(r => r.json()),
    getBatch: (batchId: string) =>
      fetchJSON<{ status: string; completed: number; results: unknown[] }>(`${BASE}/generation/batch/${batchId}`),
  },
  perception: {
    diagnose: (caseId: number) =>
      fetch(`${BASE}/perception/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      }).then(r => r.json()),
    getSession: (sessionId: string) =>
      fetchJSON<SessionInfo & { reasoning_steps: unknown[] }>(`${BASE}/perception/session/${sessionId}`),
    history: (page = 1) =>
      fetchJSON<{ sessions: SessionInfo[] }>(`${BASE}/perception/history?page=${page}`),
    status: () => fetchJSON<{ status: string }>(`${BASE}/perception/status`),
  },
  evaluation: {
    suggestions: (status?: string) =>
      fetchJSON<Suggestion[]>(`${BASE}/evaluation/suggestions${status ? `?status=${status}` : ''}`),
    applySuggestion: (id: number) =>
      fetch(`${BASE}/evaluation/suggestions/${id}?action=apply`, { method: 'PUT' }).then(r => r.json()),
    loopProgress: () => fetchJSON<DashboardSummary>(`${BASE}/evaluation/loop-progress`),
    caseLibrary: () => fetchJSON<Record<string, unknown>>(`${BASE}/evaluation/case-library`),
  },
};
