export interface DashboardSummary {
  total_cases: number;
  total_diagnoses: number;
  total_evaluations: number;
  overall_accuracy: number;
  by_route: Record<string, number>;
  by_fault_type: Record<string, number>;
}

export interface CaseInfo {
  case_id: number;
  source: string;
  fault_type: string | null;
  fault_mode: string | null;
  difficulty: string | null;
  is_normal: number;
  validation_status: string;
}

export interface SessionInfo {
  session_id: string;
  case_id: number;
  route_taken: string;
  initial_confidence: number;
  final_confidence: number;
  fault_type_predicted: string | null;
  fault_elements_predicted: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export interface ReasoningStep {
  step_number: number;
  step_type: string;
  content: string;
  tool_name: string | null;
  tool_result: string | null;
}

export interface Suggestion {
  id: number;
  suggestion_type: string;
  target: string;
  suggestion_content: string;
  priority: number;
  status: string;
}

export interface WSEvent {
  type: string;
  [key: string]: unknown;
}
