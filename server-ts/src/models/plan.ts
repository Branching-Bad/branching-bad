export interface Plan {
  id: string;
  task_id: string;
  version: number;
  status: string;
  plan_markdown: string;
  tasklist_json: string;
  tasklist_schema_version: number;
  generation_mode: string;
  validation_errors_json: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PlanWithParsed {
  id: string;
  task_id: string;
  version: number;
  status: string;
  plan_markdown: string;
  tasklist: any;
  tasklist_schema_version: number;
  generation_mode: string;
  validation_errors: any | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PlanJob {
  id: string;
  task_id: string;
  mode: string;
  status: string;
  revision_comment: string | null;
  plan_id: string | null;
  error: string | null;
  agent_session_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AutostartJob {
  id: string;
  task_id: string;
  trigger_kind: string;
  state: string;
  plan_id: string | null;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ClearPipelineResult {
  plan_jobs_failed: number;
  autostart_jobs_failed: number;
  task_reset: boolean;
}
