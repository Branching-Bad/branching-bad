export interface Repo {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  build_command: string | null;
  queue_mode: boolean;
  created_at: string;
  updated_at: string;
}

export interface RepositoryRule {
  id: string;
  repo_id: string | null;
  content: string;
  source: string;
  source_comment_id: string | null;
  created_at: string;
  updated_at: string;
}
