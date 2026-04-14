// server-ts/src/workflow/model.ts

export type NodeKind = 'script' | 'agent' | 'merge';
export type OnFail = 'halt-subtree' | 'halt-all';
export type Lang = 'python' | 'typescript' | 'custom';
export type SourceMode = 'inline' | 'file';

export interface NodeBase {
  id: string;
  label: string;
  position: { x: number; y: number };
  onFail: OnFail;
}

export interface ScriptNode extends NodeBase {
  kind: 'script';
  lang: Lang;
  source: SourceMode;
  code?: string;
  filePath?: string;
  runCommand?: string;
}

export interface AgentNode extends NodeBase {
  kind: 'agent';
  agentProfileId: string;
  promptTemplate: string;
}

export interface MergeNode extends NodeBase {
  kind: 'merge';
}

export type GraphNode = ScriptNode | AgentNode | MergeNode;

export interface Edge {
  id: string;
  from: string;
  to: string;
  required: boolean;
  inputOrder: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
}

export type RunTrigger = 'manual' | 'cron';
export type RunStatus = 'running' | 'done' | 'failed' | 'halted' | 'cancelled';
export type AttemptStatus =
  | 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface Workflow {
  id: string;
  repo_id: string;
  name: string;
  graph: Graph;
  cron: string | null;
  cron_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  snapshot: Graph;
}

export interface NodeAttempt {
  id: string;
  run_id: string;
  node_id: string;
  attempt_num: number;
  status: AttemptStatus;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  stdout_inline: string | null;
  stderr_inline: string | null;
  stdout_file: string | null;
  stderr_file: string | null;
}
