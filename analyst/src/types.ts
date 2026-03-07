export interface Repo {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  build_command?: string;
}

export interface AgentProfile {
  id: string;
  provider: string;
  agent_name: string;
  model: string;
  command: string;
  source: string;
  discovery_kind: string;
}

export interface RunLogEntry {
  type: string;
  data: string;
}

export interface AnalystSession {
  id: string;
  repo_id: string;
  profile_id: string;
  agent_session_id: string | null;
  title: string | null;
  first_message: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface AnalystLog {
  type: string;
  data: string;
}

export interface AnalystHistoryEntry {
  id: string;
  firstMessage: string;
  title: string | null;
  profileId: string;
  agentSessionId: string | null;
  logs: RunLogEntry[];
  timestamp: number;
}
