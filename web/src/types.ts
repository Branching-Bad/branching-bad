/* ─── Types ─── */
export type Repo = { id: string; name: string; path: string };
export type AgentProfile = {
  id: string; provider: string; agent_name: string;
  model: string; command: string; source: string; discovery_kind: string;
};
export type Task = {
  id: string; jira_issue_key: string; title: string;
  description: string | null; status: string; priority: string | null;
  require_plan: boolean;
  auto_start: boolean;
  auto_approve_plan: boolean;
  use_worktree: boolean;
  last_pipeline_error?: string | null;
  last_pipeline_at?: string | null;
  agent_profile_id?: string | null;
  source?: string; updated_at: string;
};
export type Plan = {
  id: string; version: number;
  status: "drafted" | "revise_requested" | "approved" | "rejected";
  plan_markdown: string;
  plan: unknown;
  tasklist: unknown;
  tasklist_schema_version: number;
  generation_mode: "manual" | "auto_pipeline" | "revise" | "direct_execution" | string;
  validation_errors?: unknown;
  created_by: string;
  created_at: string;
};
export type RunEvent = { id: string; type: string; payload: unknown; created_at: string };
export type RunAgent = {
  id: string;
  provider: string;
  agent_name: string;
  model: string;
};
export type ActiveRun = {
  id: string;
  status: string;
  branch_name: string;
  agent?: RunAgent;
};
export type RunLogEntry = { type: string; data: string };
export type RunResponse = {
  run: ActiveRun;
  events: RunEvent[]; artifactPath: string;
};
export type PlanJob = {
  id: string;
  task_id: string;
  mode: string;
  status: "pending" | "running" | "done" | "failed" | string;
  revision_comment?: string | null;
  plan_id?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};
export type TaskRunState = {
  activeRun: ActiveRun | null;
  runLogs: RunLogEntry[];
  runFinished: boolean;
  runResult: RunResponse | null;
};
export type TaskPlanState = {
  activeJob: PlanJob | null;
  planLogs: RunLogEntry[];
  planFinished: boolean;
};
export type ReviewComment = {
  id: string;
  task_id: string;
  run_id: string;
  comment: string;
  status: "pending" | "processing" | "addressed";
  result_run_id: string | null;
  addressed_at: string | null;
  created_at: string;
  file_path?: string | null;
  line_start?: number | null;
  line_end?: number | null;
  diff_hunk?: string | null;
  review_mode?: string;
  batch_id?: string | null;
};
export type LineComment = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  diffHunk: string;
  text: string;
};
export type ProviderItem = {
  id: string; provider_id: string; external_id: string; title: string;
  status: string; linked_task_id: string | null;
  data_json: string;
};
export type ProviderResource = {
  id: string; provider_account_id: string; provider_id: string;
  external_id: string; name: string; extra_json: string;
};
export type ChatMessage = {
  id: string;
  task_id: string;
  role: "user" | "assistant";
  content: string;
  result_run_id: string | null;
  status: "sent" | "queued" | "dispatched";
  created_at: string;
};
export type LaneKey = "todo" | "inprogress" | "inreview" | "done" | "archived";

/* ─── Provider Types ─── */
export type ConnectField = {
  key: string;
  label: string;
  field_type: "text" | "password";
  required: boolean;
  placeholder: string;
};
export type ProviderMeta = {
  id: string;
  display_name: string;
  connect_fields: ConnectField[];
  resource_label: string;
  has_items_panel: boolean;
};
export type ProviderAccount = {
  id: string;
  providerId: string;
  displayName: string;
  config: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export const EMPTY_TASK_RUN_STATE: TaskRunState = {
  activeRun: null,
  runLogs: [],
  runFinished: false,
  runResult: null,
};
export const EMPTY_TASK_PLAN_STATE: TaskPlanState = {
  activeJob: null,
  planLogs: [],
  planFinished: false,
};
