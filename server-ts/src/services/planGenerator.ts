import type { MsgStore } from '../msgStore.js';
import type { PlanJob, TaskWithPayload } from '../models.js';
import { generatePlanAndTasklistWithAgentStrict } from '../planner/index.js';
import type { AppState } from '../state.js';
import { loadRulesSection, persistStoreOutputs } from '../routes/shared.js';
import { handleAutoApproval, handleAutoStart } from './planAutostart.js';
import { openPlanDebugLogFile, writePlanDebugLog } from './planService.js';
import { buildMemoriesSection } from './memoryService.js';

// -- Plan generation job --

export function spawnPlanGenerationJob(
  state: AppState,
  job: PlanJob,
  task: TaskWithPayload,
  repoPath: string,
  agentCommand: string,
  generationMode: string,
  store: MsgStore,
  autostartJobId: string | undefined,
): void {
  persistStoreOutputs(store, state.db, task.id);

  setImmediate(async () => {
    const debugLog = openPlanDebugLogFile(repoPath, task.jira_issue_key, job.id);
    const logFile = debugLog.file;
    const logPath = debugLog.path;

    writePlanDebugLog(
      logFile,
      `plan job started: job_id=${job.id} task_id=${task.id} issue_key=${task.jira_issue_key} mode=${job.mode} generation_mode=${generationMode} repo_path=${repoPath}`,
    );
    writePlanDebugLog(logFile, `agent command: ${agentCommand}`);

    state.db.markPlanJobRunning(job.id);
    state.db.touchPlanJob(job.id);
    store.push({ type: 'agent_text', data: 'Plan pipeline started.' });

    if (logPath) {
      const message = `Plan debug log file: ${logPath}`;
      store.push({ type: 'agent_text', data: message });
      writePlanDebugLog(logFile, message);
    }

    function failAutostart(msg: string): void {
      if (autostartJobId) {
        try {
          state.db.failAutostartJob(autostartJobId, msg);
        } catch {
          // Ignore
        }
      }
    }

    function failJob(message: string, planId?: string): void {
      writePlanDebugLog(logFile, message);
      state.db.updateTaskPipelineState(task.id, message);
      state.db.failPlanJob(job.id, message, planId);
      failAutostart(message);
      store.pushStderr(message);
      store.pushFinished(null, 'failed');
      logFile?.end();
    }

    let targetVersion: number;
    try {
      targetVersion = state.db.getNextPlanVersion(task.id);
    } catch (error) {
      failJob(`plan pipeline failed before generation: ${error}`);
      return;
    }

    const rulesSection = loadRulesSection(state.db, task.repo_id);
    const revision = job.revision_comment;
    let previousSessionId: string | null = null;
    if (revision) {
      previousSessionId = state.db.getLatestCompletedPlanJobSession(task.id);
    }

    const memoriesSection = buildMemoriesSection(state.db, task);

    writePlanDebugLog(logFile, 'Starting plan generation...');
    let generated;
    try {
      generated = await generatePlanAndTasklistWithAgentStrict(
        repoPath,
        task,
        agentCommand,
        revision,
        targetVersion,
        (msg) => {
          state.db.touchPlanJob(job.id);
          writePlanDebugLog(logFile, `[progress] ${msg.type}: ${msg.data.slice(0, 200)}`);
          store.push(msg);
        },
        previousSessionId,
        rulesSection,
        memoriesSection,
      );
    } catch (error) {
      failJob(`plan pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    let plan;
    try {
      plan = state.db.createPlan(
        task.id,
        'drafted',
        generated.plan_markdown,
        generated.tasklist_json,
        1,
        generationMode,
        undefined,
        'agent',
      );
    } catch (error) {
      failJob(`plan save failed: ${error}`);
      return;
    }

    try {
      state.db.updateTaskStatus(task.id, 'PLAN_DRAFTED');
    } catch (error) {
      failJob(`task status update failed: ${error}`, plan.id);
      return;
    }

    state.db.updateTaskPipelineState(task.id);
    state.db.completePlanJob(job.id, plan.id, generated.session_id ?? undefined);
    store.push({ type: 'agent_text', data: `Plan version v${plan.version} created.` });
    writePlanDebugLog(logFile, `plan version created: v${plan.version} id=${plan.id}`);

    let autostartHandled = false;

    if (task.auto_approve_plan) {
      handleAutoApproval(state, store, logFile, task, plan);

      if (task.auto_start) {
        autostartHandled = await handleAutoStart(
          state, store, logFile, plan, autostartJobId, task,
        );
      }
    }

    if (autostartJobId && !autostartHandled) {
      state.db.completeAutostartJob(autostartJobId, plan.id);
      writePlanDebugLog(logFile, 'autostart job completed (plan generated, awaiting manual action)');
    }

    writePlanDebugLog(logFile, 'plan job completed successfully');
    store.pushFinished(0, 'done');
    logFile?.end();
  });
}
