import type { LogMsg } from '../msgStore.js';

export type { LogMsg };

export interface WorktreeInfo {
  worktreePath: string;
}

export interface ApplyResult {
  filesChanged: number;
  baseBranch: string;
}

export interface MergeConflictError {
  conflictedFiles: string[];
}

export interface GitStatusInfo {
  commits: string[];
  diffStat: string;
  ahead: number;
  behind: number;
}

export type ApplyOutcome =
  | { ok: true; result: ApplyResult }
  | { ok: false; conflict: MergeConflictError }
  | { ok: false; error: string };
