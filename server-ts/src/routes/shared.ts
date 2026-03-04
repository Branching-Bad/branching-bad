import os from 'os';

import type { Db } from '../db/index.js';
import { ApiError } from '../errors.js';
import type { AgentProfile, RepositoryRule, TaskWithPayload } from '../models.js';
import type { AppState } from '../state.js';

// -- Status helpers --

const TODO_LANE_STATUSES = new Set([
  'TO DO',
  'TODO',
  'PLAN_GENERATING',
  'PLAN_DRAFTED',
  'PLAN_APPROVED',
  'PLAN_REVISE_REQUESTED',
  'FAILED',
  'CANCELLED',
]);

export function isTodoLaneStatus(status: string): boolean {
  const upper = status.trim().toUpperCase();
  if (TODO_LANE_STATUSES.has(upper)) {
    return true;
  }
  return status.toLowerCase().includes('to do');
}

// -- Branch sanitization --

export function sanitizeBranchSegment(input: string): string {
  const replaced = input
    .toLowerCase()
    .split('')
    .map((c) => {
      if (/[a-z0-9._\-/]/.test(c)) {
        return c;
      }
      return '-';
    })
    .join('');

  return replaced
    .split('-')
    .filter((s) => s.length > 0)
    .join('-')
    .slice(0, 45);
}

// -- Home directory --

export function homeDir(): string {
  return os.homedir() || process.env['HOME'] || process.env['USERPROFILE'] || os.tmpdir();
}

// -- Agent command resolution --

export function resolveAgentCommand(state: AppState, repoId: string): string | null {
  const pref = state.db.getRepoAgentPreference(repoId);
  if (!pref) {
    return null;
  }
  const profile = state.db.getAgentProfileById(pref.agent_profile_id);
  if (!profile) {
    return null;
  }
  return buildAgentCommand(profile);
}

// -- 3-tier agent profile resolution --

export function resolveAgentProfile(
  state: AppState,
  explicitProfileId: string | undefined | null,
  task: TaskWithPayload,
): AgentProfile {
  const trimmedExplicit = explicitProfileId?.trim();
  if (trimmedExplicit) {
    const profile = state.db.getAgentProfileById(trimmedExplicit);
    if (!profile) {
      throw ApiError.badRequest('Agent profile not found.');
    }
    return profile;
  }

  if (task.agent_profile_id) {
    const profile = state.db.getAgentProfileById(task.agent_profile_id);
    if (!profile) {
      throw ApiError.badRequest('Task agent profile not found.');
    }
    return profile;
  }

  const pref = state.db.getRepoAgentPreference(task.repo_id);
  if (!pref) {
    throw ApiError.badRequest('Select an AI profile for this repo.');
  }

  const profile = state.db.getAgentProfileById(pref.agent_profile_id);
  if (!profile) {
    throw ApiError.badRequest('Agent profile not found.');
  }
  return profile;
}

// -- Build agent command with model flags --

export function buildAgentCommand(profile: AgentProfile): string {
  const command = profile.command.trim();
  if (!command) {
    return profile.command;
  }

  const provider = profile.provider.toLowerCase();
  const model = profile.model.trim();

  if (!model || model.toLowerCase() === 'default') {
    return command;
  }

  if (provider.includes('codex')) {
    return `${command} -m ${model}`;
  }

  if (provider.includes('claude') || provider.includes('gemini') || provider.includes('cursor')) {
    return `${command} --model ${model}`;
  }

  return command;
}

// -- Autostart queueing --

export function enqueueAutostartIfEnabled(
  state: AppState,
  task: TaskWithPayload,
  triggerKind: string,
): void {
  if (!task.auto_start) {
    return;
  }
  if (!isTodoLaneStatus(task.status)) {
    return;
  }
  state.db.enqueueAutostartJob(task.id, triggerKind);
}

// -- Plan store key --

export function planStoreKey(jobId: string): string {
  return `plan-job:${jobId}`;
}

// -- Persist store outputs to DB --

export function persistStoreOutputs(
  store: import('../msgStore.js').MsgStore,
  db: import('../db/index.js').Db,
  taskId: string,
): () => void {
  const unsubscribe = store.subscribe((msg) => {
    try {
      db.pushTaskOutput(taskId, msg.type, msg.data);
    } catch {
      // Ignore DB write failures for output logs
    }
    if (msg.type === 'finished') {
      unsubscribe();
    }
  });
  return unsubscribe;
}

// -- Rules loading --

export function loadRulesSection(db: Db, repoId: string): string {
  let rules: RepositoryRule[];
  try {
    rules = db.listRulesForPrompt(repoId);
  } catch {
    rules = [];
  }
  return formatRulesPromptSection(rules);
}

export function formatRulesPromptSection(rules: RepositoryRule[]): string {
  if (rules.length === 0) {
    return '';
  }
  const lines = rules.map((r) => `- ${r.content}`);
  return `\n\nRepository Rules (follow these strictly):\n${lines.join('\n')}\n`;
}
