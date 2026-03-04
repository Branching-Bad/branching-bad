export interface AgentProfile {
  id: string;
  provider: string;
  agent_name: string;
  model: string;
  command: string;
  source: string;
  discovery_kind: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface AgentProfileWithMetadata {
  id: string;
  provider: string;
  agent_name: string;
  model: string;
  command: string;
  source: string;
  discovery_kind: string;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface RepoAgentPreference {
  repo_id: string;
  agent_profile_id: string;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredProfile {
  provider: string;
  agent_name: string;
  model: string;
  command: string;
  source: string;
  discovery_kind: string;
  metadata: any;
}
