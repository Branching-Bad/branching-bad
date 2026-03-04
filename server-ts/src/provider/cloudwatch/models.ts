// ── AWS Models ──

export interface CallerIdentity {
  account: string;
  arn: string;
}

export interface LogGroup {
  logGroupName: string;
}

export interface QueryResult {
  status: string;
  results: ResultField[][];
}

export interface ResultField {
  field: string;
  value: string;
}

// ── Investigation Models ──

export interface InvestigationRequest {
  question: string;
  logGroup: string;
  timeRangeMinutes: number;
  repoPath: string;
  agentCommand: string;
}

export interface InvestigationResult {
  phase1Query: string;
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
  logStream: string;
}

export interface AnalysisResult {
  summary: string;
  rootCause: string;
  suggestion: string;
  severity: string;
}

// ── DB Models (moved from models.ts) ──

export interface CwInvestigation {
  id: string;
  repo_id: string;
  provider_account_id: string;
  log_group: string;
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

export interface CwSavedQuery {
  id: string;
  repo_id: string;
  log_group: string;
  label: string;
  question: string;
  query_template: string;
  keywords: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}
