// ============================================================================
// api —— 可选 live 模式客户端(REST)。主演示为脚本化，不依赖后端。
//   需后端:1) CORS 放行 5174  2) GET /api/v1/generation/cases/{id}/files
// ============================================================================

const BASE = "/api/v1";

export interface DashboardSummary {
  total_cases: number;
  total_diagnoses: number;
  total_evaluations: number;
  overall_accuracy: number;
  by_route?: Record<string, number>;
  by_fault_type?: Record<string, number>;
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const r = await fetch("/health", { cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function fetchDashboard(): Promise<DashboardSummary | null> {
  try {
    const r = await fetch(`${BASE}/dashboard/summary`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as DashboardSummary;
  } catch {
    return null;
  }
}

export async function fetchCaseFiles(caseId: number): Promise<Record<string, string> | null> {
  try {
    const r = await fetch(`${BASE}/generation/cases/${caseId}/files`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, string>;
  } catch {
    return null;
  }
}
