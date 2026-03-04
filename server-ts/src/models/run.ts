export interface Run {
  id: string;
  task_id: string;
  plan_id: string;
  status: string;
  branch_name: string;
  agent_profile_id: string | null;
  pid: number | null;
  exit_code: number | null;
  agent_session_id: string | null;
  review_comment_id: string | null;
  chat_message_id: string | null;
  worktree_path: string | null;
  base_sha: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunEvent {
  id: string;
  run_id: string;
  type: string;
  payload: any;
  created_at: string;
}

export interface ReviewComment {
  id: string;
  task_id: string;
  run_id: string;
  comment: string;
  status: string;
  result_run_id: string | null;
  addressed_at: string | null;
  created_at: string;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  diff_hunk: string | null;
  review_mode: string;
  batch_id: string | null;
}

export interface ChatMessage {
  id: string;
  task_id: string;
  role: string;
  content: string;
  result_run_id: string | null;
  status: string;
  created_at: string;
}
