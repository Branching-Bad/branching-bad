import type { LogMsg } from '../msgStore.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeneratedPlan {
  plan_markdown: string;
  session_id: string | null;
}

export interface GeneratedPlanTasklist {
  plan_markdown: string;
  tasklist_json: any;
  session_id: string | null;
}

export interface AgentOutput {
  text: string;
  session_id: string | null;
}

export interface RepoContext {
  topLevelDirs: string[];
  topLevelFiles: string[];
  candidateFiles: string[];
}

export type ProgressCallback = (msg: LogMsg) => void;

// ---------------------------------------------------------------------------
// Internal types (shared across planner modules)
// ---------------------------------------------------------------------------

export interface PlanGenerationEnvelope {
  schema_version: number;
  plan_markdown: string;
}

export interface TasklistItem {
  id: string;
  title: string;
  description: string;
  blocked_by: string[];
  blocks: string[];
  affected_files: string[];
  acceptance_criteria: string[];
  suggested_subagent?: string | null;
  estimated_size?: string | null;
  suggested_model?: string | null;
  complexity?: string | null;
}

export interface TasklistPhase {
  id: string;
  name: string;
  description: string;
  order: number;
  tasks: TasklistItem[];
}

export interface StrictTasklistJson {
  schema_version: number;
  issue_key: string;
  generated_from_plan_version: number;
  phases: TasklistPhase[];
}

export interface TasklistEnvelope {
  schema_version: number;
  tasklist_json: StrictTasklistJson;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAN_MARKDOWN_MAX_BYTES = 64 * 1024;
export const TASKLIST_JSON_MAX_BYTES = 256 * 1024;
export const GENERATION_MAX_ATTEMPTS = 2;
