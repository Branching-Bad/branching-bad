export interface AnalystSession {
  id: string;
  repo_id: string;
  profile_id: string;
  agent_session_id: string | null;
  title: string | null;
  first_message: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface AnalystLog {
  id: number;
  session_id: string;
  type: string;
  data: string;
  created_at: string;
}
