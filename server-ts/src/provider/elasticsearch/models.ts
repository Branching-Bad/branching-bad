// ── Models ──

export interface ClusterHealth {
  clusterName: string;
  status: string;
  numberOfNodes: number;
}

export interface IndexInfo {
  index: string;
  health: string;
  docsCount: string | null;
  storeSize: string | null;
}

export interface SearchResult {
  total: number;
  hits: any[];
}

// ── Investigation Models ──

export interface InvestigationRequest {
  question: string;
  indexPattern: string;
  timeRangeMinutes: number;
  repoPath: string;
  agentCommand: string;
}

export interface InvestigationResult {
  phase1Query: any;
  phase1Reasoning: string;
  relevantFiles: string[];
  correlationIdField: string;
  errorLogs: LogEntry[];
  correlationIds: string[];
  traceLogs: Record<string, LogEntry[]>;
  analysis?: AnalysisResult;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  source: any;
}

export interface AnalysisResult {
  summary: string;
  rootCause: string;
  suggestion: string;
  severity: string;
}

// ── Auth ──

export type EsAuth =
  | { kind: 'none' }
  | { kind: 'basic'; user: string; pass: string }
  | { kind: 'apiKey'; key: string };

// ── DB Models (moved from models.ts) ──

export interface EsInvestigation {
  id: string;
  repo_id: string;
  provider_account_id: string;
  index_pattern: string;
  question: string;
  time_range_minutes: number;
  query_phase1: string | null;
  query_phase2: string | null;
  result_json: any;
  status: string;
  linked_task_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface EsInvestigationSummary {
  id: string;
  question: string;
  index_pattern: string;
  status: string;
  created_at: string;
}

export interface EsSavedQuery {
  id: string;
  repo_id: string;
  index_pattern: string;
  label: string;
  question: string;
  query_template: string;
  keywords: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}
