import type { TaskWithPayload } from '../models.js';
import { invokeAgentCli } from './agent.js';
import { emitProgressText } from './helpers.js';
import { parseStrictPlanResponse, parseStrictTasklistResponse } from './parse.js';
import { buildPlanPrompt, buildTasklistPrompt } from './prompts.js';
import type { GeneratedPlan, GeneratedPlanTasklist, ProgressCallback } from './types.js';
import { GENERATION_MAX_ATTEMPTS } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generatePlanAndTasklistWithAgentStrict(
  repoPath: string,
  task: TaskWithPayload,
  agentCommand: string,
  revisionComment: string | null,
  targetPlanVersion: number,
  progress: ProgressCallback | null,
  resumeSessionId: string | null,
  rulesSection: string,
): Promise<GeneratedPlanTasklist> {
  emitProgressText(progress, 'Starting strict plan generation...');

  const planResult = await generatePlanWithAgentStrict(
    repoPath,
    task,
    agentCommand,
    revisionComment,
    progress,
    resumeSessionId,
    rulesSection,
  );

  emitProgressText(progress, 'Plan validated. Generating strict tasklist...');

  const tasklistJson = await generateTasklistFromPlanStrict(
    repoPath,
    task,
    agentCommand,
    planResult.plan_markdown,
    targetPlanVersion,
    progress,
  );

  emitProgressText(progress, 'Strict tasklist JSON validated.');

  return {
    plan_markdown: planResult.plan_markdown,
    tasklist_json: tasklistJson,
    session_id: planResult.session_id,
  };
}

export async function generatePlanWithAgentStrict(
  repoPath: string,
  task: TaskWithPayload,
  agentCommand: string,
  revisionComment: string | null,
  progress: ProgressCallback | null,
  resumeSessionId: string | null,
  rulesSection: string,
): Promise<GeneratedPlan> {
  const prompt = buildPlanPrompt(repoPath, task, revisionComment, rulesSection);
  const errors: string[] = [];

  for (let attempt = 1; attempt <= GENERATION_MAX_ATTEMPTS; attempt++) {
    emitProgressText(
      progress,
      `Plan generation attempt ${attempt}/${GENERATION_MAX_ATTEMPTS} started.`,
    );
    let rawOutputText = '';
    try {
      const output = await invokeAgentCli(agentCommand, prompt, repoPath, progress, resumeSessionId);
      rawOutputText = output.text;
      const plan = parseStrictPlanResponse(output.text);
      emitProgressText(progress, `Plan generation attempt ${attempt} succeeded.`);
      return { plan_markdown: plan.markdown, session_id: output.session_id };
    } catch (err) {
      const errText = `attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`;
      emitProgressText(
        progress,
        `Plan generation attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (rawOutputText) {
        emitProgressText(progress, `[debug] raw output (${rawOutputText.length} chars): ${rawOutputText.substring(0, 500)}`);
      }
      errors.push(errText);
    }
  }

  throw new Error(
    `strict plan generation failed after ${GENERATION_MAX_ATTEMPTS} attempts: ${errors.join(' | ')}`,
  );
}

export async function generateTasklistFromPlanStrict(
  repoPath: string,
  task: TaskWithPayload,
  agentCommand: string,
  planMarkdown: string,
  targetPlanVersion: number,
  progress: ProgressCallback | null,
): Promise<any> {
  const prompt = buildTasklistPrompt(task, planMarkdown, targetPlanVersion);
  const errors: string[] = [];

  for (let attempt = 1; attempt <= GENERATION_MAX_ATTEMPTS; attempt++) {
    emitProgressText(
      progress,
      `Tasklist generation attempt ${attempt}/${GENERATION_MAX_ATTEMPTS} started.`,
    );
    try {
      const output = await invokeAgentCli(agentCommand, prompt, repoPath, progress, null);
      const tasklistJson = parseStrictTasklistResponse(
        output.text,
        task,
        targetPlanVersion,
      );
      emitProgressText(progress, `Tasklist generation attempt ${attempt} succeeded.`);
      return tasklistJson;
    } catch (err) {
      const errText = `attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`;
      emitProgressText(
        progress,
        `Tasklist generation attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      errors.push(errText);
    }
  }

  throw new Error(
    `strict tasklist generation failed after ${GENERATION_MAX_ATTEMPTS} attempts: ${errors.join(' | ')}`,
  );
}
