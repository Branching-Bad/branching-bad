import fs from 'fs';
import path from 'path';

import type { PlanJob, PlanWithParsed, TaskWithPayload } from '../models.js';
import type { AppState } from '../state.js';
import { planStoreKey } from '../routes/shared.js';

// -- Debug log helpers --

export function sanitizeLogSegment(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function openPlanDebugLogFile(
  repoPath: string,
  issueKey: string,
  jobId: string,
): { file: fs.WriteStream | null; path: string | null } {
  const issueSegment = sanitizeLogSegment(issueKey);
  const jobSegment = sanitizeLogSegment(jobId);
  let jobShort = jobSegment || 'job';
  if (jobShort.length > 12) {
    jobShort = jobShort.slice(0, 12);
  }
  const issueShort = issueSegment || 'task';

  const logDir = path.join(repoPath, '.branching-bad', 'plan-logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (error) {
    console.error(`Warning: failed to create plan log dir ${logDir}: ${error}`);
    return { file: null, path: null };
  }

  const logPath = path.join(logDir, `${issueShort}-${jobShort}.log`);
  try {
    const file = fs.createWriteStream(logPath, { flags: 'a' });
    return { file, path: logPath };
  } catch (error) {
    console.error(`Warning: failed to open plan log file ${logPath}: ${error}`);
    return { file: null, path: null };
  }
}

export function writePlanDebugLog(file: fs.WriteStream | null, message: string): void {
  if (!file) {
    return;
  }
  const ts = new Date().toISOString();
  file.write(`[${ts}] ${message}\n`);
}

// -- Plan job orchestration --

export async function ensurePlanJobRunning(
  state: AppState,
  task: TaskWithPayload,
  repoPath: string,
  agentCommand: string,
  mode: string,
  revisionComment?: string,
  autostartJobId?: string,
): Promise<PlanJob> {
  const { spawnPlanGenerationJob } = await import('./planGenerator.js');

  let job = state.db.createPlanJob(task.id, mode, revisionComment);

  const storeKey = planStoreKey(job.id);
  const hasStore = !!state.processManager.getStore(storeKey);

  if (!hasStore && job.status === 'running') {
    state.db.failPlanJob(
      job.id,
      `Recovered stale running ${mode} job (missing live process store).`,
      job.plan_id ?? undefined,
    );
    job = state.db.createPlanJob(task.id, mode, revisionComment);
  }

  if (job.status === 'pending' && !state.processManager.getStore(planStoreKey(job.id))) {
    const { MsgStore: MsgStoreClass } = await import('../msgStore.js');
    const store = new MsgStoreClass();
    state.processManager.registerStore(planStoreKey(job.id), store);
    spawnPlanGenerationJob(state, job, task, repoPath, agentCommand, mode, store, autostartJobId);
  }

  return job;
}

// -- Plan review prompt builder --

export function buildPlanReviewPrompt(task: TaskWithPayload, plan: PlanWithParsed): string {
  const taskPayloadStr = JSON.stringify(task.payload, null, 2);
  const tasklistStr = JSON.stringify(plan.tasklist, null, 2);
  const planMd = plan.plan_markdown || '(empty)';

  return `You are a senior software architect reviewing an implementation plan.
IMPORTANT: You are ONLY providing feedback. Do NOT take any action, do NOT modify any files, do NOT execute any commands. Your ONLY job is to review and return a JSON verdict.

## Task
**Key:** ${task.jira_issue_key}
**Title:** ${task.title}
**Priority:** ${task.priority ?? 'unset'}
**Description:** ${task.description ?? '(no description)'}

## Task Payload (raw source data)
\`\`\`json
${taskPayloadStr}
\`\`\`

## Plan
${planMd}

## Tasklist (JSON)
\`\`\`json
${tasklistStr}
\`\`\`

Review this plan for completeness, risks, architecture, scope, and task ordering.

Return ONLY a valid JSON object in this exact format, nothing else:
\`\`\`json
{
  "verdict": "passed" or "failed",
  "comments": [
    // If verdict is "passed": leave empty array []
    // If verdict is "failed": include objects like below
    {
      "category": "completeness" | "risk" | "architecture" | "scope" | "ordering",
      "severity": "critical" | "major" | "minor",
      "reason": "Why this is a problem",
      "suggestion": "What should be changed or improved"
    }
  ]
}
\`\`\`

Rules:
- If the plan adequately covers the task requirements, return verdict "passed" with empty comments.
- If there are issues, return verdict "failed" with comments explaining each problem.
- Each comment MUST include: category, severity, reason, and suggestion.
- Be concise and actionable. Focus on real problems, not style preferences.
- Return ONLY the JSON. No markdown fences, no extra text.`;
}
