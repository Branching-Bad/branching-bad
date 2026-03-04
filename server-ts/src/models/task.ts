export interface TaskWithPayload {
  id: string;
  repo_id: string;
  jira_account_id: string | null;
  jira_board_id: string | null;
  jira_issue_key: string;
  title: string;
  description: string | null;
  assignee: string | null;
  status: string;
  priority: string | null;
  require_plan: boolean;
  auto_start: boolean;
  auto_approve_plan: boolean;
  use_worktree: boolean;
  last_pipeline_error: string | null;
  last_pipeline_at: string | null;
  agent_profile_id: string | null;
  source: string;
  pr_url: string | null;
  pr_number: number | null;
  payload: any;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskPayload {
  repoId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  requirePlan?: boolean;
  autoStart?: boolean;
  autoApprovePlan?: boolean;
  useWorktree?: boolean;
  agentProfileId?: string;
}

export interface UpsertTaskTransition {
  task_id: string;
  is_new: boolean;
  previous_status: string | null;
  current_status: string;
}

export interface UpsertTasksResult {
  synced: number;
  transitions: UpsertTaskTransition[];
}

export interface JiraIssueForTask {
  jira_issue_key: string;
  title: string;
  description: string | null;
  assignee: string | null;
  status: string;
  priority: string | null;
  payload: any;
}
